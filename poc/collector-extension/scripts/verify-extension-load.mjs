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
    runtimeBootstrap: (await chrome.storage.session.get('collector.runtime-bootstrap.v1'))['collector.runtime-bootstrap.v1']
  }));

  const grantedPermissions = runtime.permissions;
  const registeredContentScripts = runtime.registeredContentScripts;

  assert.match(runtime.extensionId, /^[a-p]{32}$/);
  assert.equal(runtime.manifestVersion, 3);
  assert.equal(runtime.extensionName, 'Personal Intelligence Collector');
  assert.deepEqual(grantedPermissions.origins ?? [], [], 'fresh Profile must not grant optional host permissions');
  assert.deepEqual(registeredContentScripts, [], 'fresh Profile must not register persistent platform scripts');
  assert.deepEqual(runtime.runtimeBootstrap, {
    schemaVersion: 1,
    collectorVersion: runtime.extensionVersion,
    controlSurfaceRevision: 2
  }, 'service worker must publish its compiled runtime identity');

  const controlPage = await context.newPage();
  await controlPage.goto(`chrome-extension://${runtime.extensionId}/control.html`);
  await controlPage.locator('html[data-collector-control-ready="true"]').waitFor();
  assert.equal(await controlPage.locator('h1').textContent(), 'Collector Core');
  const controlResponse = await controlPage.evaluate(() => chrome.runtime.sendMessage({
    type: 'collector.getControlSnapshot'
  }));
  assert.equal(controlResponse?.ok, true, 'control snapshot must be available');
  assert.equal(
    controlResponse?.snapshot?.controlSurfaceRevision,
    2,
    'runtime must expose the current control-surface revision'
  );
  assert.equal(
    controlResponse?.snapshot?.collectorVersion,
    runtime.extensionVersion,
    'runtime and manifest versions must agree'
  );

  console.log(JSON.stringify({
    ok: true,
    gate: 'automatic-production-extension-load',
    browser: 'playwright-managed-chromium',
    mode: launched.mode,
    manifestVersion: runtime.manifestVersion,
    optionalHostOriginsGranted: grantedPermissions.origins?.length ?? 0,
    registeredPlatformScripts: registeredContentScripts.length,
    runtimeBootstrapPublished: true,
    controlSurfaceLoaded: true,
    controlSurfaceRevision: controlResponse.snapshot.controlSurfaceRevision
  }, null, 2));
} finally {
  await launched?.close();
}
