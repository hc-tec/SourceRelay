import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECTOR_CONTROL_SURFACE_REVISION,
  COLLECTOR_EXTENSION_VERSION
} from '@intelligence/collector-contracts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'dist');
const manifestPath = resolve(outputDirectory, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const packageMetadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const runtimeBuild = JSON.parse(await readFile(resolve(outputDirectory, 'runtime-build.json'), 'utf8'));

const approved = {
  permissions: ['alarms', 'debugger', 'nativeMessaging', 'storage', 'scripting', 'webNavigation'],
  hostPermissions: [
    'https://space.bilibili.com/*',
    'https://api.bilibili.com/*',
    'https://search.bilibili.com/*',
    'https://www.bilibili.com/*',
    'https://www.xiaohongshu.com/*'
  ],
  optionalHostPermissions: [
    'http://127.0.0.1/*',
    'https://www.zhihu.com/*',
    'https://zhuanlan.zhihu.com/*',
    'https://s.weibo.com/*',
    'https://weibo.com/*',
    'https://m.weibo.cn/*'
  ],
  optionalPermissions: ['webRequest']
};

assert.equal(manifest.manifest_version, 3, 'build artifact must be Manifest V3');
assert.equal(manifest.version, packageMetadata.version, 'manifest and package versions must match');
assert.equal(runtimeBuild.schemaVersion, 1, 'runtime build metadata schema must be 1');
assert.equal(
  runtimeBuild.collectorVersion,
  COLLECTOR_EXTENSION_VERSION,
  'runtime build metadata must name the compiled collector version'
);
assert.equal(
  runtimeBuild.controlSurfaceRevision,
  COLLECTOR_CONTROL_SURFACE_REVISION,
  'runtime build metadata must name the compiled control surface revision'
);
assert.match(runtimeBuild.buildFingerprint, /^[a-f0-9]{64}$/, 'runtime build fingerprint must be a SHA-256 hex digest');
assert.equal(/\btest\b/i.test(manifest.name), false, 'production artifact must not be test-branded');
assert.deepEqual(manifest.permissions ?? [], approved.permissions, 'core permissions changed without approval');
assert.deepEqual(
  manifest.optional_permissions ?? [],
  approved.optionalPermissions,
  'optional API permissions changed without approval'
);
assert.deepEqual(manifest.host_permissions ?? [], approved.hostPermissions, 'strategy host permissions changed without approval');
assert.deepEqual(
  manifest.optional_host_permissions ?? [],
  approved.optionalHostPermissions,
  'optional host permissions changed without approval'
);

const forbiddenPermissions = new Set([
  'cookies',
  'downloads',
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
  const isApprovedLoopbackPermission = pattern === 'http://127.0.0.1/*';
  assert.equal(
    /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(pattern) && !isApprovedLoopbackPermission,
    false,
    'only the exact optional 127.0.0.1 Gateway permission is allowed'
  );
}

assert.equal('externally_connectable' in manifest, false, 'external page connections changed without approval');
assert.equal('web_accessible_resources' in manifest, false, 'extension scripts must not be page-accessible resources');
assert.deepEqual(manifest.content_scripts ?? [], [], 'platform scripts must be exact, short-lived registrations only');
assert.equal(manifest.action?.default_popup, 'control.html', 'the extension action must open the control surface');

const requiredScripts = [
  manifest.background?.service_worker,
  'network-capture-bridge.js',
  'bilibili-account-profile-document-bridge.js',
  'bilibili-account-video-inventory-document-bridge.js',
  'bilibili-native-search-document-bridge.js',
  'bilibili-video-detail-document-bridge.js',
  'main-world-network-observer.js',
  'xiaohongshu-search-main-world-observer.js',
  'control.js'
];
for (const script of requiredScripts) {
  assert.equal(typeof script, 'string', 'build contract must reference JavaScript files');
  await access(resolve(outputDirectory, script));
}
for (const pageArtifact of ['control.html', 'control.css']) {
  await access(resolve(outputDirectory, pageArtifact));
}
await access(resolve(outputDirectory, 'runtime-build.json'));

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
const accountVideoInventoryDocumentBridgeSource = await readFile(
  resolve(outputDirectory, 'bilibili-account-video-inventory-document-bridge.js'),
  'utf8'
);
const accountProfileDocumentBridgeSource = await readFile(
  resolve(outputDirectory, 'bilibili-account-profile-document-bridge.js'),
  'utf8'
);
const nativeSearchDocumentBridgeSource = await readFile(
  resolve(outputDirectory, 'bilibili-native-search-document-bridge.js'),
  'utf8'
);
const videoDetailDocumentBridgeSource = await readFile(
  resolve(outputDirectory, 'bilibili-video-detail-document-bridge.js'),
  'utf8'
);
const mainWorldObserverSource = await readFile(resolve(outputDirectory, 'main-world-network-observer.js'), 'utf8');
const controlSource = await readFile(resolve(outputDirectory, 'control.js'), 'utf8');

assert.match(backgroundSource, /connectNative/, 'Native Messaging bridge connection is required');
  assert.match(backgroundSource, /collector_bind_strategy_observer/, 'exact Strategy bind command is required');
assert.match(backgroundSource, /collector_read_strategy_observation/, 'exact Strategy read command is required');
assert.match(
  backgroundSource,
  /collector_read_xiaohongshu_current_page_network_observation/,
  'the fixed Xiaohongshu metadata-only read command is required'
);
  assert.match(
    backgroundSource,
    /collector_read_strategy_binding_diagnostics/,
    'failure-only strategy binding diagnostics are required'
  );
assert.match(backgroundSource, /bilibili\.dynamic\.account-feed\.response-dom\.v1/, 'compiled Bilibili dynamic Strategy is required');
assert.match(backgroundSource, /bilibili\.video\.detail\.dom\.v2/, 'compiled Bilibili DOM-only detail Strategy is required');
assert.match(backgroundSource, /bilibili\.account\.video-inventory\.dom\.v1/, 'compiled Bilibili DOM-only inventory Strategy is required');
assert.match(backgroundSource, /bilibili\.account\.profile\.dom\.v2/, 'compiled Bilibili DOM-only profile Strategy is required');
assert.match(backgroundSource, /bilibili\.search\.breadth\.dom\.v2/, 'compiled Bilibili native-search Strategy is required');
assert.match(backgroundSource, /document_start/, 'observer bridge must be registered before document scripts run');
assert.match(backgroundSource, /persistAcrossSessions:\s*false/, 'observer bridge registration must be short-lived');
assert.match(
  backgroundSource,
  /collector-xhs-profile-|xiaohongshu-search-main-world-observer\.js/,
  'Xiaohongshu profile-link Network observer registration is required'
);
assert.match(
  backgroundSource,
  /collector_bilibili_video_detail_document_ready/,
  'video-detail DOM projection must bind one exact Chrome document before reading it'
);
assert.match(
  backgroundSource,
  /collector_bilibili_account_video_inventory_document_ready/,
  'account-video inventory DOM projection must bind one exact Chrome document before reading it'
);
assert.match(
  backgroundSource,
  /collector_bilibili_account_profile_document_ready/,
  'account-profile DOM projection must bind one exact Chrome document before reading it'
);
assert.match(
  backgroundSource,
  /collector_bilibili_native_search_document_ready/,
  'native-search DOM projection must bind one exact Chrome document before reading it'
);
assert.match(backgroundSource, /collector\.native-bridge-config\.v1/, 'Browser Host bridge bootstrap key is required');
assert.match(backgroundSource, /collector\.runtime-bootstrap\.v1/, 'worker runtime marker is required');
assert.match(
  backgroundSource,
  /(?:COLLECTOR_CONTROL_SURFACE_REVISION\s*=\s*16|controlSurfaceRevision:\s*16)/,
  'runtime revision must remain the public revision 16'
);
assert.match(backgroundSource, /webRequest\.onCompleted/, 'Xiaohongshu may observe only completed metadata events');
assert.match(backgroundSource, /removeListener/, 'Xiaohongshu metadata listener must be removable after its short lease');
assert.match(backgroundSource, new RegExp(runtimeBuild.buildFingerprint), 'worker must publish the current build fingerprint');
assert.doesNotMatch(
  backgroundSource,
  /collector\.pollGatewayTasks|collector\.pairGateway|collector\.startCapabilityValidation|collector\.startDetailCapabilityValidation|collector\.startTranscriptCapabilityValidation|collector\.collectionResult|stageLease|localhost/i,
  'retired Gateway loopback, stage lease, and old task protocols must not ship'
);
assert.match(
  backgroundSource,
  /\/v1\/extension\/work-items\/next/,
  'worker may poll only the fixed paired work-item read route'
);
assert.match(
  backgroundSource,
  /\/v1\/extension\/work-items\/result/,
  'worker may submit only the fixed paired work-item result route'
);
assert.match(backgroundSource, /x-collector-body-sha256/, 'worker work transport must bind an exact body digest');
assert.match(backgroundSource, /extension_work_signature_invalid/, 'worker must verify the Gateway work-item signature');
assert.doesNotMatch(
  backgroundSource,
  /chrome\.cookies|document\.cookie|localStorage|sessionStorage/i,
  'worker must not gain credential or arbitrary web storage access'
);
assert.match(backgroundSource, /chrome\.debugger\.attach/, 'trusted input must explicitly attach to one internal tab');
assert.match(backgroundSource, /chrome\.debugger\.detach/, 'trusted input must detach on every terminal path');
assert.match(backgroundSource, /Input\.dispatchMouseEvent/, 'trusted input must use the fixed mouse-input command');
assert.match(backgroundSource, /Input\.dispatchKeyEvent/, 'trusted input must use the fixed key-input command');
assert.match(backgroundSource, /Input\.insertText/, 'trusted input must use the fixed text-input command');
assert.doesNotMatch(
  backgroundSource,
  /(?:Runtime|Network|Fetch|Page|DOM|Storage|Target)\.[A-Za-z]+/,
  'worker must not ship arbitrary debugger domains or network/runtime CDP commands'
);

assert.match(bridgeSource, /armedRouteIds/, 'isolated bridge must revalidate exact armed route IDs');
assert.match(bridgeSource, /collector\.networkCaptureBridgeReady/, 'isolated bridge must bind to the worker before forwarding');
assert.match(accountVideoInventoryDocumentBridgeSource, /collector_bilibili_account_video_inventory_document_ready/);
assert.doesNotMatch(
  accountVideoInventoryDocumentBridgeSource,
  /querySelector|document\.(?:body|documentElement)|fetch\s*\(/,
  'inventory document-start bridge may send identity readiness only, never page data or a network request'
);
assert.match(accountProfileDocumentBridgeSource, /collector_bilibili_account_profile_document_ready/);
assert.doesNotMatch(
  accountProfileDocumentBridgeSource,
  /querySelector|document\.(?:body|documentElement)|fetch\s*\(/,
  'profile document-start bridge may send identity readiness only, never page data or a network request'
);
assert.match(nativeSearchDocumentBridgeSource, /collector_bilibili_native_search_document_ready/);
assert.doesNotMatch(
  nativeSearchDocumentBridgeSource,
  /querySelector|document\.(?:body|documentElement)|fetch\s*\(/,
  'native-search document-start bridge may send identity readiness only, never page data, query, or a network request'
);
assert.match(videoDetailDocumentBridgeSource, /collector_bilibili_video_detail_document_ready/);
assert.doesNotMatch(
  videoDetailDocumentBridgeSource,
  /querySelector|document\.(?:body|documentElement)|fetch\s*\(/,
  'document-start detail bridge may send identity readiness only, never page data or a network request'
);
assert.match(mainWorldObserverSource, /maximumBodyBytes/, 'MAIN-world observer must enforce route-specific byte ceilings');
assert.match(mainWorldObserverSource, /__personalIntelligenceNetworkCaptureRouteIds/, 'MAIN-world observer must remain route-bound');
assert.match(
  controlSource,
  /collector\.user-browser\.gateway-pairing\.v1/,
  'control page must expose only the explicitly paired user-browser Gateway record'
);
assert.match(
  controlSource,
  /\/v1\/extension\/pairing\/claim/,
  'control page must use the fixed Gateway pairing endpoint'
);
assert.doesNotMatch(
  controlSource,
  /chrome\.debugger|chrome\.cookies|document\.cookie|localStorage|sessionStorage/i,
  'control page must not gain debugger, cookie, or arbitrary web storage access'
);

const digest = createHash('sha256').update(await readFile(manifestPath)).digest('hex');
console.log(JSON.stringify({
  ok: true,
  gate: 'production-extension-strategy-artifacts',
  manifest: 'dist/manifest.json',
  sha256: digest,
  permissions: manifest.permissions,
  hostPermissions: manifest.host_permissions ?? [],
  optionalHostPermissions: manifest.optional_host_permissions,
  backgroundLoopbackRuntime: 'fixed_paired_auth_only',
  staticPlatformScriptsExcluded: true
}, null, 2));
