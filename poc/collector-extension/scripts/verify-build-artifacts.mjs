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
  permissions: ['nativeMessaging', 'storage', 'scripting'],
  hostPermissions: [
    'https://space.bilibili.com/*',
    'https://api.bilibili.com/*'
  ],
  optionalHostPermissions: [
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
assert.deepEqual(manifest.permissions ?? [], approved.permissions, 'core permissions changed without approval');
assert.deepEqual(manifest.optional_permissions ?? [], [], 'optional API permissions changed without approval');
assert.deepEqual(manifest.host_permissions ?? [], approved.hostPermissions, 'strategy host permissions changed without approval');
assert.deepEqual(
  manifest.optional_host_permissions ?? [],
  approved.optionalHostPermissions,
  'optional host permissions changed without approval'
);

const forbiddenPermissions = new Set([
  'cookies',
  'debugger',
  'downloads',
  'webRequest',
  'webRequestBlocking'
]);
for (const permission of [...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? [])]) {
  assert.equal(forbiddenPermissions.has(permission), false, `forbidden permission: ${permission}`);
}

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
    'the Extension must not connect to a loopback Gateway'
  );
}

assert.equal('externally_connectable' in manifest, false, 'external page connections changed without approval');
assert.equal('web_accessible_resources' in manifest, false, 'extension scripts must not be page-accessible resources');
assert.deepEqual(manifest.content_scripts ?? [], [], 'platform scripts must be exact, short-lived registrations only');
assert.equal(manifest.action?.default_popup, 'control.html', 'the extension action must open the control surface');

const requiredScripts = [
  manifest.background?.service_worker,
  'network-capture-bridge.js',
  'main-world-network-observer.js',
  'control.js'
];
for (const script of requiredScripts) {
  assert.equal(typeof script, 'string', 'build contract must reference JavaScript files');
  await access(resolve(outputDirectory, script));
}
for (const pageArtifact of ['control.html', 'control.css']) {
  await access(resolve(outputDirectory, pageArtifact));
}

const outputNames = await readdir(outputDirectory);
for (const retiredArtifact of ['content.js', 'transcript-validation.js']) {
  assert.equal(outputNames.includes(retiredArtifact), false, `retired artifact must not ship: ${retiredArtifact}`);
}
assert.equal(
  outputNames.some((name) => /(?:^|[-_.])(?:test|fixture)(?:[-_.]|$)/i.test(name)),
  false,
  'production artifact must not contain test or fixture entry points'
);

const backgroundSource = await readFile(resolve(outputDirectory, manifest.background.service_worker), 'utf8');
const bridgeSource = await readFile(resolve(outputDirectory, 'network-capture-bridge.js'), 'utf8');
const mainWorldObserverSource = await readFile(resolve(outputDirectory, 'main-world-network-observer.js'), 'utf8');
const controlSource = await readFile(resolve(outputDirectory, 'control.js'), 'utf8');

assert.match(backgroundSource, /connectNative/, 'Native Messaging bridge connection is required');
assert.match(backgroundSource, /collector_bind_strategy_observer/, 'exact Strategy bind command is required');
assert.match(backgroundSource, /collector_read_strategy_observation/, 'exact Strategy read command is required');
assert.match(backgroundSource, /bilibili\.dynamic\.account-feed\.response-dom\.v1/, 'only compiled Bilibili dynamic Strategy is required');
assert.match(backgroundSource, /document_start/, 'observer bridge must be registered before document scripts run');
assert.match(backgroundSource, /persistAcrossSessions:\s*false/, 'observer bridge registration must be short-lived');
assert.match(backgroundSource, /collector\.native-bridge-config\.v1/, 'Browser Host bridge bootstrap key is required');
assert.match(backgroundSource, /collector\.runtime-bootstrap\.v1/, 'worker runtime marker is required');
assert.match(backgroundSource, /COLLECTOR_CONTROL_SURFACE_REVISION\s*=\s*5|controlSurfaceRevision:\s*5/, 'runtime revision must be 5');
assert.doesNotMatch(
  backgroundSource,
  /collector\.pollGatewayTasks|collector\.pairGateway|collector\.startCapabilityValidation|collector\.startDetailCapabilityValidation|collector\.startTranscriptCapabilityValidation|collector\.collectionResult|stageLease|127\.0\.0\.1|localhost/i,
  'retired Gateway loopback, polling, stage lease, and old task protocols must not ship'
);
assert.doesNotMatch(backgroundSource, /\bfetch\s*\(/, 'worker must not make arbitrary loopback or platform fetches');

assert.match(bridgeSource, /armedRouteIds/, 'isolated bridge must revalidate exact armed route IDs');
assert.match(bridgeSource, /collector\.networkCaptureBridgeReady/, 'isolated bridge must bind to the worker before forwarding');
assert.match(mainWorldObserverSource, /maximumBodyBytes/, 'MAIN-world observer must enforce route-specific byte ceilings');
assert.match(mainWorldObserverSource, /__personalIntelligenceNetworkCaptureRouteIds/, 'MAIN-world observer must remain route-bound');
assert.match(controlSource, /collector\.native-bridge-status\.v1/, 'control page must expose bridge state only');

const digest = createHash('sha256').update(await readFile(manifestPath)).digest('hex');
console.log(JSON.stringify({
  ok: true,
  gate: 'production-extension-strategy-artifacts',
  manifest: 'dist/manifest.json',
  sha256: digest,
  permissions: manifest.permissions,
  hostPermissions: manifest.host_permissions ?? [],
  optionalHostPermissions: manifest.optional_host_permissions,
  retiredLoopbackRuntimeExcluded: true,
  staticPlatformScriptsExcluded: true
}, null, 2));
