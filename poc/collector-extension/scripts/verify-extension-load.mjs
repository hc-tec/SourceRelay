import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = resolve(root, 'dist');

async function waitForServiceWorker(context) {
  const existing = context.serviceWorkers();
  if (existing.length > 0) return existing[0];
  return context.waitForEvent('serviceworker', { timeout: 15_000 });
}

async function launch(userDataDirectory, headless) {
  return chromium.launchPersistentContext(userDataDirectory, {
    channel: 'chromium',
    headless,
    args: [
      '--disable-background-networking',
      '--no-first-run',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
}

async function launchWithAutomatedFallback(userDataDirectory) {
  let context;
  try {
    context = await launch(userDataDirectory, true);
    const worker = await waitForServiceWorker(context);
    return { context, worker, mode: 'headless' };
  } catch (headlessError) {
    await context?.close().catch(() => undefined);
    context = await launch(userDataDirectory, false);
    try {
      const worker = await waitForServiceWorker(context);
      return { context, worker, mode: 'headed-automated-fallback' };
    } catch (headedError) {
      await context.close().catch(() => undefined);
      throw new AggregateError(
        [headlessError, headedError],
        'The production extension could not be loaded in Playwright-managed Chromium.'
      );
    }
  }
}

await access(extensionPath);
const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'collector-extension-build-gate-'));
let context;
try {
  const launched = await launchWithAutomatedFallback(userDataDirectory);
  context = launched.context;
  const runtime = await launched.worker.evaluate(async () => ({
    extensionId: chrome.runtime.id,
    manifestVersion: chrome.runtime.getManifest().manifest_version,
    extensionName: chrome.runtime.getManifest().name,
    permissions: await chrome.permissions.getAll(),
    registeredContentScripts: await chrome.scripting.getRegisteredContentScripts()
  }));

  const grantedPermissions = runtime.permissions;
  const registeredContentScripts = runtime.registeredContentScripts;

  assert.match(runtime.extensionId, /^[a-p]{32}$/);
  assert.equal(runtime.manifestVersion, 3);
  assert.equal(runtime.extensionName, 'Personal Intelligence Collector');
  assert.deepEqual(grantedPermissions.origins ?? [], [], 'fresh Profile must not grant optional host permissions');
  assert.deepEqual(registeredContentScripts, [], 'fresh Profile must not register persistent platform scripts');

  const controlPage = await context.newPage();
  await controlPage.goto(`chrome-extension://${runtime.extensionId}/control.html`);
  await controlPage.locator('html[data-collector-control-ready="true"]').waitFor();
  assert.equal(await controlPage.locator('h1').textContent(), 'Collector Core');

  console.log(JSON.stringify({
    ok: true,
    gate: 'automatic-production-extension-load',
    browser: 'playwright-managed-chromium',
    mode: launched.mode,
    manifestVersion: runtime.manifestVersion,
    optionalHostOriginsGranted: grantedPermissions.origins?.length ?? 0,
    registeredPlatformScripts: registeredContentScripts.length,
    controlSurfaceLoaded: true
  }, null, 2));
} finally {
  await context?.close().catch(() => undefined);
  await rm(userDataDirectory, { recursive: true, force: true });
}
