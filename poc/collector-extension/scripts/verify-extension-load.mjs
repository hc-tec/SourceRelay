import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchProductionExtension } from './extension-test-harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = resolve(root, 'dist');
const runtimeBuild = JSON.parse(await readFile(resolve(extensionPath, 'runtime-build.json'), 'utf8'));
assert.equal(runtimeBuild.schemaVersion, 1);
assert.match(runtimeBuild.buildFingerprint, /^[a-f0-9]{64}$/);

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
    ['https://api.bilibili.com/*', 'https://search.bilibili.com/*', 'https://space.bilibili.com/*', 'https://www.bilibili.com/*'],
    'fresh Profile must grant only the required Bilibili Strategy origins'
  );
  assert.deepEqual(runtime.registeredContentScripts, [], 'fresh Profile must not register a platform observer');
  assert.deepEqual(runtime.runtimeBootstrap, {
    schemaVersion: 1,
    collectorVersion: runtime.extensionVersion,
    controlSurfaceRevision: 15,
    buildFingerprint: runtimeBuild.buildFingerprint
  }, 'service worker must publish its compiled runtime identity');
  assert.equal(runtime.nativeBridgeStatus?.state, 'unconfigured', 'fresh Profile must not invent a Browser Host bridge');

  const controlPage = await context.newPage();
  await controlPage.goto(`chrome-extension://${runtime.extensionId}/control.html`);
  await controlPage.locator('html[data-collector-control-ready="true"]').waitFor();
  assert.equal(await controlPage.locator('h1').textContent(), 'Collector Extension');
  const controlText = await controlPage.locator('body').innerText();
  assert.match(controlText, /日常浏览器 Direct Work/, 'control page must distinguish direct work from research Strategy cards');
  assert.match(controlText, /研究 \/ 隔离 Strategy 库/, 'control page must label non-direct Strategy cards explicitly');
  for (const capability of [
    'bilibili.video_detail',
    'bilibili.native_search',
    'bilibili.account_profile',
    'bilibili.account_inventory'
  ]) {
    assert.match(controlText, new RegExp(capability.replace('.', '\\.')),
      `control page must expose local compiled direct work ${capability}`);
  }
  assert.match(
    controlText,
    /bilibili\.dynamic\.account-feed\.response-dom\.v1/,
    'control page must describe the compiled narrow Strategy'
  );
  assert.match(
    controlText,
    /bilibili\.video\.detail\.dom\.v2/,
    'control page must describe the compiled DOM-only video-detail Strategy'
  );
  assert.match(
    controlText,
    /bilibili\.account\.video-inventory\.dom\.v1/,
    'control page must describe the compiled DOM-only account-video inventory Strategy'
  );
  assert.match(
    controlText,
    /bilibili\.account\.profile\.dom\.v2/,
    'control page must describe the compiled DOM-only account-profile Strategy'
  );
  assert.match(
    controlText,
    /bilibili\.search\.breadth\.dom\.v2/,
    'control page must describe the compiled Bilibili native-search Strategy'
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
    directWorkKindsExposed: 4,
    controlSurfaceRevision: runtime.runtimeBootstrap.controlSurfaceRevision,
    buildFingerprint: runtime.runtimeBootstrap.buildFingerprint
  }, null, 2));
} finally {
  await launched?.close();
}
