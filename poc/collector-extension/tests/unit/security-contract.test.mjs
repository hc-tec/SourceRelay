import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceRoot = resolve(root, 'src');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat();
}

test('production manifest has a least-privilege extension surface', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'public', 'manifest.json'), 'utf8'));
  const forbiddenPermissions = new Set(['cookies', 'debugger', 'downloads', 'webRequest', 'webRequestBlocking']);
  for (const permission of manifest.permissions) {
    assert.equal(forbiddenPermissions.has(permission), false, `forbidden permission: ${permission}`);
  }
  assert.equal(manifest.host_permissions.includes('<all_urls>'), false);
  assert.equal(manifest.content_scripts.flatMap((entry) => entry.matches).includes('<all_urls>'), false);
  assert.deepEqual(manifest.permissions, ['activeTab', 'storage', 'scripting']);

  const mainWorldEntries = manifest.content_scripts.filter((entry) => entry.world === 'MAIN');
  assert.equal(mainWorldEntries.length, 0, 'the observer must be dynamically injected only after a Worker arm');
  const bridgeEntries = manifest.content_scripts.filter((entry) => entry.js?.includes('network-capture-bridge.js'));
  assert.equal(bridgeEntries.length, 1, 'the isolated bridge must remain a single static document_start script');
  assert.deepEqual(bridgeEntries[0].matches, [
    'https://search.bilibili.com/all*',
    'https://www.zhihu.com/search*',
    'https://s.weibo.com/weibo*',
    'https://www.xiaohongshu.com/search_result_ai*'
  ]);
  assert.equal(bridgeEntries[0].run_at, 'document_start');
  assert.equal(bridgeEntries[0].all_frames, false);
  assert.equal('web_accessible_resources' in manifest, false);
});

test('extension source never reads or exports browser credential/state APIs', async () => {
  const forbiddenPatterns = [
    /document\.cookie/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /chrome\.cookies/,
    /\bwebRequest\b/,
    /\bchrome\.debugger\b/,
    /\bstorageState\b/,
    /\bHAR\b/,
    /\btrace\b/,
    /page\.on\(\s*['"](?:request|response)['"]/,
    /context\.cookies\(/,
    /window\.__INITIAL_STATE__/,
    /localStorage\.getItem/,
    /sessionStorage\.getItem/
  ];
  for (const file of await sourceFiles(sourceRoot)) {
    const content = await readFile(file, 'utf8');
    for (const pattern of forbiddenPatterns) {
      assert.equal(pattern.test(content), false, `${file} contains forbidden API pattern ${pattern}`);
    }
  }
});

test('MAIN-world observer has no extension APIs or request-credential access', async () => {
  const observer = await readFile(resolve(sourceRoot, 'content', 'main-world-network-observer.ts'), 'utf8');
  const forbiddenPatterns = [
    /\bchrome\./,
    /document\.cookie/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /getAllResponseHeaders/,
    /setRequestHeader/,
    /(?:Request|request)\.(?:headers|body)\b/,
    /\binit\.headers\b/,
    /Object\.fromEntries\(\s*response\.headers/,
    /Array\.from\(\s*response\.headers/
  ];
  for (const pattern of forbiddenPatterns) {
    assert.equal(pattern.test(observer), false, `MAIN-world observer contains forbidden capability ${pattern}`);
  }
  assert.match(observer, /response\.headers\.get\('content-type'\)/);
  assert.match(observer, /response\.headers\.get\('content-length'\)/);
  assert.match(observer, /getResponseHeader\('content-type'\)/);
  assert.doesNotMatch(observer, /NETWORK_CAPTURE_BRIDGE_READY/);
});
