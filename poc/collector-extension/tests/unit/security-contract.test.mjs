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
