import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'dist');
const manifestPath = resolve(outputDirectory, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const packageMetadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

const approved = {
  permissions: ['alarms', 'storage', 'scripting'],
  optionalHostPermissions: [
    'http://127.0.0.1/*',
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
assert.equal(manifest.version, packageMetadata.version, 'manifest and package versions must match');
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
assert.deepEqual(manifest.host_permissions ?? [], [], 'install-time host permissions are forbidden');
assert.deepEqual(
  manifest.optional_host_permissions ?? [],
  approved.optionalHostPermissions,
  'optional host permissions changed without approval'
);
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
  const isApprovedGatewayLoopback = pattern === 'http://127.0.0.1/*' &&
    (manifest.optional_host_permissions ?? []).includes(pattern);
  assert.equal(
    /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(pattern) && !isApprovedGatewayLoopback,
    false,
    'only the approved optional IPv4 loopback Gateway match is allowed'
  );
}

const mainWorldEntries = (manifest.content_scripts ?? []).filter((entry) => entry.world === 'MAIN');
assert.equal(mainWorldEntries.length, 0, 'manifest must not statically inject a MAIN-world observer');
assert.equal('web_accessible_resources' in manifest, false, 'extension scripts must not be page-accessible resources');
assert.deepEqual(manifest.content_scripts ?? [], [], 'platform scripts must be registered only after optional permission grant');
assert.equal('commands' in manifest, false, 'the control surface must not expose a legacy active-tab collection command');
assert.equal(manifest.action?.default_popup, 'control.html', 'the extension action must open the control surface');

const referencedScripts = [
  manifest.background?.service_worker,
  'content.js',
  'network-capture-bridge.js',
  'main-world-network-observer.js',
  'control.js'
];
for (const script of referencedScripts) {
  assert.equal(typeof script, 'string', 'manifest and build contract must reference JavaScript files');
  await access(resolve(outputDirectory, script));
}

for (const pageArtifact of ['control.html', 'control.css']) {
  await access(resolve(outputDirectory, pageArtifact));
}

const outputNames = await readdir(outputDirectory);
assert.equal(
  outputNames.some((name) => /(?:^|[-_.])(?:test|fixture)(?:[-_.]|$)/i.test(name)),
  false,
  'production artifact must not contain test or fixture entry points'
);

const digest = createHash('sha256').update(await readFile(manifestPath)).digest('hex');
const backgroundSource = await readFile(resolve(outputDirectory, manifest.background.service_worker), 'utf8');
assert.match(backgroundSource, /collector\.startCapabilityValidation/, 'validation-run protocol is missing');
assert.match(
  backgroundSource,
  /bb91e996-7758-4447-ba94-486bc99b7872/,
  'admitted Bilibili live-validation record is missing'
);
assert.match(backgroundSource, /live_anonymous_verified/, 'admitted anonymous strategy maturity is missing');
assert.match(backgroundSource, /productionRoutes\s*=\s*\[\]/, 'production response routes must remain empty');
console.log(JSON.stringify({
  ok: true,
  gate: 'production-build-artifacts',
  manifest: 'dist/manifest.json',
  sha256: digest,
  permissions: manifest.permissions,
  hostPermissions: manifest.host_permissions ?? [],
  optionalHostPermissions: manifest.optional_host_permissions
}, null, 2));
