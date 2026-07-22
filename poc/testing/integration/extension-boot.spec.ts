import { expect, test } from '@playwright/test';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchProductionExtension } from '../../collector-extension/scripts/extension-test-harness.mjs';

const pocRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const extensionPath = resolve(pocRoot, 'collector-extension', 'dist');

test('production MV3 boot uses the actual extension and makes zero platform requests', async () => {
  await access(resolve(extensionPath, 'manifest.json'));
  const platformRequests: string[] = [];
  const launched = await launchProductionExtension(extensionPath, 'collector-real-local-extension-', {
    onContext(context: { on(event: 'request', listener: (request: { url(): string }) => void): void }) {
      context.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          platformRequests.push(`${url.protocol}//${url.host}${url.pathname}`);
        }
      });
    }
  });
  try {
    const runtime = await launched.worker.evaluate(async () => ({
      extensionId: chrome.runtime.id,
      manifest: chrome.runtime.getManifest(),
      permissions: await chrome.permissions.getAll(),
      registeredContentScripts: await chrome.scripting.getRegisteredContentScripts(),
      runtimeBootstrap: (await chrome.storage.session.get('collector.runtime-bootstrap.v1'))['collector.runtime-bootstrap.v1'],
      nativeBridgeStatus: (await chrome.storage.session.get('collector.native-bridge-status.v1'))['collector.native-bridge-status.v1']
    }));

    expect(runtime.extensionId).toMatch(/^[a-p]{32}$/);
    expect(runtime.manifest.manifest_version).toBe(3);
    expect(runtime.manifest.name).toBe('Personal Intelligence Collector');
    expect(runtime.permissions.origins?.sort()).toEqual([
      'https://api.bilibili.com/*',
      'https://space.bilibili.com/*',
      'https://www.bilibili.com/*'
    ]);
    expect(runtime.registeredContentScripts).toEqual([]);
    expect(runtime.runtimeBootstrap).toEqual({
      schemaVersion: 1,
      collectorVersion: runtime.manifest.version,
      controlSurfaceRevision: 11
    });
    expect(runtime.nativeBridgeStatus?.state).toBe('unconfigured');

    const controlPage = await launched.context.newPage();
    await controlPage.goto(`chrome-extension://${runtime.extensionId}/control.html`);
    await expect(controlPage.locator('html[data-collector-control-ready="true"]')).toHaveCount(1);
    await expect(controlPage.locator('h1')).toHaveText('Collector Extension');
    await expect(controlPage.locator('body')).toContainText('bilibili.account.video-inventory.dom.v1');
    await controlPage.close();

    expect(platformRequests).toEqual([]);
  } finally {
    await launched.close();
  }
});
