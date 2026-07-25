import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = await readFile(resolve(root, 'dist', 'isolated-browser-server.js'), 'utf8');
const userBrowserSource = await readFile(resolve(root, 'dist', 'user-browser-server.js'), 'utf8');
const packageMetadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

assert.equal(
  Object.prototype.hasOwnProperty.call(packageMetadata.dependencies ?? {}, 'playwright'),
  false,
  'Gateway package must not depend on Playwright'
);
assert.equal(
  Object.prototype.hasOwnProperty.call(packageMetadata.dependencies ?? {}, '@intelligence/collector-browser-host'),
  true,
  'isolated test Gateway must retain its Browser Host client package'
);
assert.match(source, /browser_host_not_running/, 'Gateway must expose an explicit stopped Host state');
assert.match(source, /launch_profile/, 'Gateway must launch Profiles through typed Browser Host commands');
assert.match(source, /get_snapshot/, 'Gateway must read the Browser Host PagePoolSnapshot');
assert.match(source, /shutdown_host/, 'Explicit Browser Host exit must remain available');
assert.match(source, /browserManager\.disconnect\(\)/, 'Gateway shutdown must only disconnect its Host client');
assert.match(source, /\/v1\/browser-host\/snapshot/, 'Gateway must expose the Host Snapshot to the local Console');
assert.match(source, /\/v1\/browser-host\/exit/, 'Gateway must expose explicit Host exit separately');
assert.match(source, /extensionTabBound/, 'Console must display exact extension tab binding state');
assert.match(source, /nativeBridgeConnected/, 'Console must display Native Messaging readiness');
assert.match(source, /\/v1\/dynamic-artifacts/, 'Existing dynamic artifacts must remain readable during migration');

assert.match(
  userBrowserSource,
  /user_owned_browser_extension/,
  'User-browser artifact must advertise the direct deployment mode'
);
assert.match(
  userBrowserSource,
  /user_browser_legacy_route_not_available/,
  'User-browser artifact must explicitly reject the isolated test route family'
);
assert.match(
  userBrowserSource,
  /browserProcessControl: "not_available"/,
  'User-browser artifact must state that browser process control is unavailable'
);

for (const forbidden of [
  'BrowserProfileRegistry',
  'CollectionBrowserManager',
  'GatewayBrowserHostRuntime',
  'launchPersistentContext',
  'browserHostStateDirectory',
  'browserManager.disconnect'
]) {
  assert.equal(
    userBrowserSource.includes(forbidden),
    false,
    'User-browser artifact must not carry isolated Browser Host code: ' + forbidden
  );
}

for (const forbidden of [
  'launchPersistentContext',
  'BrowserContext',
  'managed-extension-runtime',
  'managed-target-page',
  'acquireManagedTargetPage',
  'retainManagedTargetPage',
  'managedTargetUrlDigest',
  'lastManagedTargetUrlDigest',
  'managedWorkTab',
  'pageLifecycle',
  'chrome://extensions'
]) {
  assert.equal(source.includes(forbidden), false, `Gateway artifact still contains forbidden legacy symbol: ${forbidden}`);
}

console.log(JSON.stringify({
  ok: true,
  gate: 'gateway-browser-host-zero-compatibility-artifact',
  playwrightDependency: false,
  directBrowserOwnership: true,
  userBrowserArtifactHasNoBrowserHost: true,
  legacyManagedTargetSymbols: false,
  gatewayShutdownClosesBrowser: false,
  explicitHostExitAvailable: true,
  dynamicArtifactsPreserved: true
}, null, 2));
