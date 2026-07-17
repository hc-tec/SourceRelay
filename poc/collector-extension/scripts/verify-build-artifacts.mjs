import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'dist');
const manifestPath = resolve(outputDirectory, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const approved = {
  permissions: ['activeTab', 'storage', 'scripting'],
  hostPermissions: [
    'https://search.bilibili.com/*',
    'https://www.bilibili.com/*',
    'https://www.zhihu.com/*',
    'https://zhuanlan.zhihu.com/*',
    'https://s.weibo.com/*',
    'https://weibo.com/*',
    'https://m.weibo.cn/*',
    'https://www.xiaohongshu.com/*'
  ],
  bridgeMatches: [
    'https://search.bilibili.com/all*',
    'https://www.zhihu.com/search*',
    'https://s.weibo.com/weibo*',
    'https://www.xiaohongshu.com/search_result_ai*'
  ],
  contentMatches: [
    'https://search.bilibili.com/*',
    'https://www.bilibili.com/*',
    'https://www.zhihu.com/*',
    'https://zhuanlan.zhihu.com/*',
    'https://s.weibo.com/*',
    'https://weibo.com/*',
    'https://m.weibo.cn/*',
    'https://www.xiaohongshu.com/*'
  ]
};

assert.equal(manifest.manifest_version, 3, 'build artifact must be Manifest V3');
assert.equal(/\btest\b/i.test(manifest.name), false, 'production artifact must not be test-branded');

const forbiddenPermissions = new Set([
  'cookies',
  'debugger',
  'downloads',
  'webRequest',
  'webRequestBlocking'
]);
const declaredPermissions = [
  ...(manifest.permissions ?? []),
  ...(manifest.optional_permissions ?? [])
];
for (const permission of declaredPermissions) {
  assert.equal(forbiddenPermissions.has(permission), false, `forbidden permission: ${permission}`);
}

assert.deepEqual(manifest.permissions ?? [], approved.permissions, 'core permissions changed without approval');
assert.deepEqual(manifest.optional_permissions ?? [], [], 'optional API permissions changed without approval');
assert.deepEqual(manifest.host_permissions ?? [], approved.hostPermissions, 'host permissions changed without approval');
assert.deepEqual(manifest.optional_host_permissions ?? [], [], 'optional host permissions changed without approval');
assert.equal('externally_connectable' in manifest, false, 'external page connections changed without approval');

const allHostPatterns = [
  ...(manifest.host_permissions ?? []),
  ...(manifest.optional_host_permissions ?? []),
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.matches ?? []),
  ...(manifest.web_accessible_resources ?? []).flatMap((entry) => entry.matches ?? [])
];
for (const pattern of allHostPatterns) {
  assert.equal(typeof pattern, 'string', 'host match patterns must be strings');
  assert.equal(pattern === '<all_urls>', false, 'build artifact must not use <all_urls>');
  assert.equal(/^\*:/.test(pattern), false, `wildcard schemes are forbidden: ${pattern}`);
  assert.equal(/^https?:\/\/\*(?:\.|\/)/.test(pattern), false, `wildcard hosts are forbidden: ${pattern}`);
  assert.equal(
    /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(pattern),
    false,
    'build artifact must not contain loopback or localhost matches'
  );
}

const mainWorldEntries = (manifest.content_scripts ?? []).filter((entry) => entry.world === 'MAIN');
assert.equal(mainWorldEntries.length, 0, 'manifest must not statically inject a MAIN-world observer');
assert.equal('web_accessible_resources' in manifest, false, 'extension scripts must not be page-accessible resources');

const bridgeEntries = (manifest.content_scripts ?? []).filter((entry) =>
  entry.js?.includes('network-capture-bridge.js')
);
assert.equal(bridgeEntries.length, 1, 'manifest must have exactly one isolated network bridge');
assert.deepEqual(bridgeEntries[0].matches, approved.bridgeMatches, 'bridge page scope changed without approval');
assert.equal(bridgeEntries[0].run_at, 'document_start');
assert.equal(bridgeEntries[0].all_frames, false);

const collectionEntries = (manifest.content_scripts ?? []).filter((entry) =>
  entry.js?.includes('content.js')
);
assert.equal(collectionEntries.length, 1, 'manifest must have exactly one isolated DOM collector');
assert.deepEqual(collectionEntries[0].matches, approved.contentMatches, 'DOM collector scope changed without approval');
assert.equal(collectionEntries[0].run_at, 'document_idle');
assert.equal(collectionEntries[0].all_frames, false);
assert.equal(manifest.content_scripts.length, 2, 'content-script declarations changed without approval');

const referencedScripts = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
  'main-world-network-observer.js'
];
for (const script of referencedScripts) {
  assert.equal(typeof script, 'string', 'manifest and build contract must reference JavaScript files');
  await access(resolve(outputDirectory, script));
}

const outputNames = await readdir(outputDirectory);
assert.equal(
  outputNames.some((name) => /(?:^|[-_.])(?:test|fixture)(?:[-_.]|$)/i.test(name)),
  false,
  'production artifact must not contain test or fixture entry points'
);

const digest = createHash('sha256').update(await readFile(manifestPath)).digest('hex');
console.log(JSON.stringify({
  ok: true,
  gate: 'production-build-artifacts',
  manifest: 'dist/manifest.json',
  sha256: digest,
  permissions: manifest.permissions,
  hostPermissions: manifest.host_permissions
}, null, 2));
