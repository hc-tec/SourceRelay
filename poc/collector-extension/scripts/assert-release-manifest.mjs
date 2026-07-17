import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'dist');
const manifestPath = resolve(outputDirectory, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

assert.equal(manifest.manifest_version, 3, 'release artifact must be Manifest V3');
assert.equal(manifest.name.includes('(test)'), false, 'release artifact must not be test-branded');

const forbiddenPermissions = new Set(['cookies', 'debugger', 'downloads', 'webRequest', 'webRequestBlocking']);
for (const permission of manifest.permissions ?? []) {
  assert.equal(forbiddenPermissions.has(permission), false, `forbidden release permission: ${permission}`);
}

const allMatches = [
  ...(manifest.host_permissions ?? []),
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.matches ?? [])
];
assert.equal(allMatches.includes('<all_urls>'), false, 'release artifact must not use <all_urls>');
assert.equal(
  allMatches.some((match) => /^https?:\/\/(?:127\.0\.0\.1|localhost)/.test(match)),
  false,
  'release artifact must not contain test-only localhost matches'
);

const mainWorldEntries = (manifest.content_scripts ?? []).filter((entry) => entry.world === 'MAIN');
assert.equal(mainWorldEntries.length, 0, 'release artifact must not statically inject a MAIN-world observer');
assert.deepEqual(manifest.permissions, ['activeTab', 'storage', 'scripting']);
const bridgeEntries = (manifest.content_scripts ?? []).filter((entry) => entry.js?.includes('network-capture-bridge.js'));
assert.equal(bridgeEntries.length, 1, 'release artifact must have exactly one isolated network bridge');
assert.deepEqual(bridgeEntries[0].matches, [
  'https://search.bilibili.com/all*',
  'https://www.zhihu.com/search*',
  'https://s.weibo.com/weibo*',
  'https://www.xiaohongshu.com/search_result_ai*'
]);
assert.equal(bridgeEntries[0].run_at, 'document_start');
assert.equal(bridgeEntries[0].all_frames, false);
assert.equal('web_accessible_resources' in manifest, false, 'release artifact must not expose extension scripts to pages');

await access(resolve(outputDirectory, 'main-world-network-observer.js'));

for (const script of [manifest.background?.service_worker, ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? [])]) {
  assert.equal(typeof script, 'string', 'release manifest must reference extension JavaScript');
  await access(resolve(outputDirectory, script));
}

const digest = createHash('sha256').update(await readFile(manifestPath)).digest('hex');
console.log(JSON.stringify({ ok: true, manifest: 'dist/manifest.json', sha256: digest }, null, 2));
