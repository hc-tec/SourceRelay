import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchProductionExtension } from './extension-test-harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = resolve(root, 'dist');

let launched;
try {
  launched = await launchProductionExtension(extensionPath, 'collector-extension-build-gate-');
  const { context } = launched;
  const runtime = await launched.worker.evaluate(async () => ({
    extensionId: chrome.runtime.id,
    manifestVersion: chrome.runtime.getManifest().manifest_version,
    extensionVersion: chrome.runtime.getManifest().version,
    extensionName: chrome.runtime.getManifest().name,
    permissions: await chrome.permissions.getAll(),
    registeredContentScripts: await chrome.scripting.getRegisteredContentScripts(),
    runtimeBootstrap: (await chrome.storage.session.get('collector.runtime-bootstrap.v1'))['collector.runtime-bootstrap.v1'],
    nativeBridgeStatus: (await chrome.storage.session.get('collector.native-bridge-status.v1'))['collector.native-bridge-status.v1']
  }));

  assert.match(runtime.extensionId, /^[a-p]{32}$/);
  assert.equal(runtime.manifestVersion, 3);
  assert.equal(runtime.extensionName, 'Personal Intelligence Collector');
  assert.deepEqual(
    [...(runtime.permissions.origins ?? [])].sort(),
    ['https://api.bilibili.com/*', 'https://space.bilibili.com/*'],
    'fresh Profile must grant only the required Bilibili observer origins'
  );
  assert.deepEqual(runtime.registeredContentScripts, [], 'fresh Profile must not register a platform observer');
  assert.deepEqual(runtime.runtimeBootstrap, {
    schemaVersion: 1,
    collectorVersion: runtime.extensionVersion,
    controlSurfaceRevision: 5
  }, 'service worker must publish its compiled runtime identity');
  assert.equal(runtime.nativeBridgeStatus?.state, 'unconfigured', 'fresh Profile must not invent a Browser Host bridge');

  const controlPage = await context.newPage();
  await controlPage.goto(`chrome-extension://${runtime.extensionId}/control.html`);
  await controlPage.locator('html[data-collector-control-ready="true"]').waitFor();
  assert.equal(await controlPage.locator('h1').textContent(), 'Collector Extension');
  assert.match(
    await controlPage.locator('body').innerText(),
    /bilibili\.dynamic\.account-feed\.response-dom\.v1/,
    'control page must describe the compiled narrow Strategy'
  );

  console.log(JSON.stringify({
    ok: true,
    gate: 'automatic-production-extension-load',
    browser: 'playwright-managed-chromium',
    mode: launched.mode,
    manifestVersion: runtime.manifestVersion,
    requiredHostOriginsGranted: runtime.permissions.origins?.length ?? 0,
    registeredPlatformScripts: runtime.registeredContentScripts.length,
    runtimeBootstrapPublished: true,
    nativeBridgeStartsUnconfigured: true,
    controlSurfaceLoaded: true,
    controlSurfaceRevision: runtime.runtimeBootstrap.controlSurfaceRevision
  }, null, 2));
} finally {
  await launched?.close();
}
