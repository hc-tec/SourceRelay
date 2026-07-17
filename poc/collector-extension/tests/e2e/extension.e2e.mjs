import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { nativeRouteFixtures, startFixtureServer } from './fixture-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const extensionPath = resolve(root, 'dist-test');

async function waitForServiceWorker(context) {
  const existing = context.serviceWorkers();
  if (existing.length > 0) return existing[0];
  return context.waitForEvent('serviceworker', { timeout: 15_000 });
}

async function launchExtensionContext(userDataDir, headless) {
  return chromium.launchPersistentContext(userDataDir, {
    // Chrome and Edge have removed reliable CLI extension side-loading. The
    // Playwright-managed Chromium channel is the supported test browser for
    // loading an unpacked MV3 extension in a persistent context.
    channel: 'chromium',
    headless,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
}

async function launchWithAutomatedFallback(userDataDir) {
  let context;
  try {
    context = await launchExtensionContext(userDataDir, true);
    await waitForServiceWorker(context);
    return { context, mode: 'headless' };
  } catch (headlessError) {
    await context?.close().catch(() => undefined);
    context = await launchExtensionContext(userDataDir, false);
    try {
      await waitForServiceWorker(context);
      return { context, mode: 'headed-automated-fallback', headlessError: String(headlessError) };
    } catch (headedError) {
      await context.close().catch(() => undefined);
      throw new AggregateError([headlessError, headedError], 'Chrome failed to load the unpacked extension.');
    }
  }
}

async function waitForStoredResult(worker, tabId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await worker.evaluate(async (id) => {
      const key = `collector.visible-result.${id}`;
      return (await chrome.storage.session.get(key))[key] ?? null;
    }, tabId);
    if (result) return result;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Background worker did not store a content-script result for tab ${tabId}.`);
}

async function main() {
  await access(extensionPath);
  const userDataDir = await mkdtemp(resolve(tmpdir(), 'collector-extension-e2e-'));
  const fixtureServer = await startFixtureServer();
  let context;
  try {
    const launched = await launchWithAutomatedFallback(userDataDir);
    context = launched.context;
    const unexpectedRequests = [];
    await context.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      if (requestUrl.startsWith(fixtureServer.baseUrl)) return route.continue();
      if (requestUrl.startsWith('http://') || requestUrl.startsWith('https://')) {
        unexpectedRequests.push(requestUrl);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    const worker = await waitForServiceWorker(context);
    const extensionId = new URL(worker.url()).host;
    assert.match(extensionId, /^[a-p]{32}$/);
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}/test-driver.html`);

    for (const fixture of nativeRouteFixtures) {
      const response = await driver.evaluate(
        ({ platform, query, fixtureBaseUrl }) => window.__collectorExtensionTest.startNativeSearch(platform, query, fixtureBaseUrl),
        { platform: fixture.platform, query: 'DeepSeek', fixtureBaseUrl: fixtureServer.baseUrl }
      );
      assert.equal(response.ok, true);
      assert.equal(response.task.nativeUrl, fixture.nativeUrl);
      assert.equal(response.task.navigationUrl.startsWith(`${fixtureServer.baseUrl}/${fixture.platform}`), true);
      const stored = await waitForStoredResult(worker, response.task.tabId);
      assert.equal(stored.platform, fixture.platform);
      assert.equal(stored.sourceUrl.startsWith(`${fixtureServer.baseUrl}/${fixture.platform}`), true);
      assert.equal(stored.items[0].url, fixture.expectedUrl);
    }

    assert.deepEqual(unexpectedRequests, []);
    await driver.close();

    console.log(JSON.stringify({ ok: true, extensionId, testMode: launched.mode }, null, 2));
  } finally {
    await context?.close().catch(() => undefined);
    await fixtureServer.close().catch(() => undefined);
    await rm(userDataDir, { recursive: true, force: true });
  }
}

await main();
