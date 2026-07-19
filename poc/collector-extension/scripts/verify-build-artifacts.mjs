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
  outputNames.includes('transcript-validation.js'),
  false,
  'Synthetic transcript interaction content must not be present in the production artifact'
);
assert.equal(
  outputNames.some((name) => /(?:^|[-_.])(?:test|fixture)(?:[-_.]|$)/i.test(name)),
  false,
  'production artifact must not contain test or fixture entry points'
);

const digest = createHash('sha256').update(await readFile(manifestPath)).digest('hex');
const backgroundSource = await readFile(resolve(outputDirectory, manifest.background.service_worker), 'utf8');
assert.match(backgroundSource, /collector\.startCapabilityValidation/, 'validation-run protocol is missing');
assert.match(backgroundSource, /collector\.startDetailCapabilityValidation/, 'detail validation-run protocol is missing');
assert.match(backgroundSource, /bilibili\.video\.detail\.dom\.v1/, 'Bilibili detail strategy is missing');
assert.match(
  backgroundSource,
  /2a5008a7-97ab-488c-b0bd-25b98e277093/,
  'admitted Bilibili detail live-validation record is missing'
);
assert.match(backgroundSource, /collector\.pollGatewayTasks/, 'explicit Gateway polling control is missing');
assert.match(backgroundSource, /collector\.probeContentInstallation/, 'content installation receipt is missing');
assert.match(backgroundSource, /gateway_content_injection_failed/, 'bounded task injection failure is missing');
assert.match(backgroundSource, /contentInjectionFlights/, 'task content injection must be single-flight');
assert.match(backgroundSource, /gateway_stage_render_timeout/, 'bounded task collection terminal is missing');
assert.match(backgroundSource, /gateway_stage_watchdog_expired/, 'durable stage watchdog terminal is missing');
assert.match(
  backgroundSource,
  /LOCAL_EVIDENCE_FLUSH_ATTEMPTS\s*=\s*3/,
  'Pending loopback Evidence recovery must remain explicitly bounded'
);
assert.match(
  backgroundSource,
  /flushPendingEvidenceWithReceiptBarrier/,
  'Accepted stage receipt must be followed by a loopback Evidence flush barrier'
);
assert.match(
  backgroundSource,
  /await clearStageWatchdog\(lease\.leaseId\)/,
  'Content-driven Evidence success must clear its stage watchdog immediately'
);
assert.match(
  backgroundSource,
  /stageLeaseForTab\(tabId\)\.catch\(\(\) => null\)[\s\S]{0,260}scheduleGatewayContinuation\(\)\.catch\([\s\S]{0,160}collection_result_storage_failed/,
  'Content-driven delivery failure may schedule loopback recovery but must not repeat platform work'
);
const contentSource = await readFile(resolve(outputDirectory, 'content.js'), 'utf8');
const bridgeSource = await readFile(resolve(outputDirectory, 'network-capture-bridge.js'), 'utf8');
const mainWorldObserverSource = await readFile(resolve(outputDirectory, 'main-world-network-observer.js'), 'utf8');
assert.match(contentSource, /collector\.collectionResult/, 'content-driven result delivery is missing');
assert.match(contentSource, /pageUrl:\s*safePageUrl\d*\(\)/, 'content installation receipt must bind its document URL');
assert.match(
  backgroundSource,
  /updateStageLeaseStatus\(pending\.tabId,\s*["']completed["']\)[\s\S]{0,240}windows\.remove\(lease\.windowId\)/,
  'stage window cleanup is missing'
);
assert.match(backgroundSource, /\/v1\/extension\/evidence/, 'authenticated evidence submission route is missing');
assert.match(backgroundSource, /collector\.pending-evidence\.v1\./, 'pending evidence retry storage is missing');
assert.match(
  backgroundSource,
  /bb91e996-7758-4447-ba94-486bc99b7872/,
  'admitted Bilibili live-validation record is missing'
);
assert.match(backgroundSource, /live_anonymous_verified/, 'admitted anonymous strategy maturity is missing');
assert.match(backgroundSource, /productionRoutes\s*=\s*\[\]/, 'production response routes must remain empty');
assert.match(
  backgroundSource,
  /bilibili\.video\.transcript\.response\.v1/,
  'The suspended Bilibili transcript strategy must remain explicit in the production artifact'
);
assert.match(
  backgroundSource,
  /collector\.startTranscriptCapabilityValidation/,
  'The bounded transcript validation protocol is missing'
);
assert.match(
  backgroundSource,
  /collector\.completeTranscriptCapabilityValidation/,
  'The Gateway-owned transcript completion protocol is missing'
);
assert.match(
  backgroundSource,
  /COLLECTOR_CONTROL_SURFACE_REVISION\s*=\s*2/,
  'The runtime snapshot must expose the current control-surface revision'
);
assert.match(
  backgroundSource,
  /controlSurfaceRevision:\s*COLLECTOR_CONTROL_SURFACE_REVISION/,
  'The control snapshot must publish the control-surface revision'
);
assert.match(
  backgroundSource,
  /bilibili\.video\.transcript\.track-directory\.response\.v1/,
  'The transcript research arm must use the exact track-directory route ID'
);
assert.match(
  backgroundSource,
  /bilibili\.video\.transcript\.document\.response\.v1/,
  'The transcript research arm must use the exact public-document route ID'
);
assert.match(
  backgroundSource,
  /runAt:\s*["']document_start["'][\s\S]{0,180}persistAcrossSessions:\s*false/,
  'The network bridge must be a short-lived document-start registration'
);
assert.doesNotMatch(
  backgroundSource,
  /collector-transcript-content-|transcript-validation\.js/,
  'Transcript validation must not register a synthetic interaction content script'
);
assert.match(backgroundSource, /admissionEligible:\s*false/, 'Transcript validation must remain ineligible for admission');
assert.match(backgroundSource, /unchanged_empty/, 'Transcript validation must retain the empty production-route safeguard');
assert.match(
  backgroundSource,
  /reveal_player_controls[\s\S]{0,600}open_caption_menu[\s\S]{0,600}select_caption_language/,
  'The complete human transcript action ledger must remain explicit'
);
assert.match(
  backgroundSource,
  /vd_source/,
  'Observed Bilibili documents must canonicalize the verified platform tracking query'
);
assert.match(bridgeSource, /armedRouteIds/, 'The isolated bridge must revalidate the exact armed research route IDs');
assert.match(
  mainWorldObserverSource,
  /maximumBodyBytes/,
  'The MAIN-world observer must enforce the route-specific transcript byte ceiling'
);
assert.match(
  mainWorldObserverSource,
  /__personalIntelligenceNetworkCaptureRouteIds/,
  'The MAIN-world observer must remain limited to route IDs supplied by the bound arm'
);
console.log(JSON.stringify({
  ok: true,
  gate: 'production-build-artifacts',
  manifest: 'dist/manifest.json',
  sha256: digest,
  permissions: manifest.permissions,
  hostPermissions: manifest.host_permissions ?? [],
  optionalHostPermissions: manifest.optional_host_permissions
}, null, 2));
