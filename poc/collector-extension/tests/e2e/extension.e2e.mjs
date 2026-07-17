import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  nativeRouteFixtures,
  startFixtureServer,
  syntheticSecretLabels,
  syntheticSecretValues
} from './fixture-server.mjs';

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

async function waitForStoredNetworkCaptures(worker, tabId) {
  let lastCount = 0;
  let lastSummary = [];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const captures = await worker.evaluate(async (id) => {
      const key = `collector.network-captures.${id}`;
      return (await chrome.storage.session.get(key))[key] ?? null;
    }, tabId);
    if (Array.isArray(captures)) {
      lastCount = captures.length;
      lastSummary = captures.map((capture) => ({
        status: capture?.status,
        method: capture?.method,
        rejectionReason: capture?.rejectionReason,
        routeId: capture?.routeId
      }));
      if (captures.length === 3) return captures;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(
    `Background worker did not store the expected bounded network-capture records (safe count: ${lastCount}; safe summary: ${JSON.stringify(lastSummary)}).`
  );
}

async function waitForFixtureNetworkScenario(context, navigationUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const page = context.pages().find((candidate) => candidate.url() === navigationUrl);
    if (page) {
      const state = await page.locator('html').getAttribute('data-fixture-network-state');
      if (state === 'complete') return page;
      if (state?.startsWith('failed-')) {
        throw new Error(`The deterministic fixture network scenario failed at safe stage: ${state.slice('failed-'.length)}.`);
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('The deterministic fixture network scenario did not complete.');
}

async function tabIdForExactUrl(worker, url) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tabId = await worker.evaluate(async (expectedUrl) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((tab) => tab.url === expectedUrl)?.id ?? null;
    }, url);
    if (typeof tabId === 'number') return tabId;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error('Could not identify the isolated fixture tab without exposing its URL in output.');
}

function hasSensitiveKey(value) {
  const fragments = ['cookie', 'authorization', 'token', 'session', 'sid', 'csrf', 'xsrf', 'xsec', 'zc0', 'password', 'passwd', 'captcha', 'verify', 'phone', 'email', 'apikey', 'secret'];
  if (Array.isArray(value)) return value.some((item) => hasSensitiveKey(item));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return fragments.some((fragment) => normalised.includes(fragment)) || hasSensitiveKey(nested);
  });
}

async function main() {
  await access(extensionPath);
  const userDataDir = await mkdtemp(resolve(tmpdir(), 'collector-extension-e2e-'));
  const fixtureServer = await startFixtureServer();
  let context;
  try {
    const launched = await launchWithAutomatedFallback(userDataDir);
    context = launched.context;
    let unexpectedRequestCount = 0;
    await context.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      if (requestUrl.startsWith(fixtureServer.baseUrl)) return route.continue();
      if (requestUrl.startsWith('http://') || requestUrl.startsWith('https://')) {
        // Do not retain an unexpected URL: its query might contain a search
        // term or a future platform's short-lived access parameter, and a
        // failed assertion would otherwise print it into test logs.
        unexpectedRequestCount += 1;
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

    // A page can forge a same-origin postMessage, but it must not create a
    // session artifact unless the Worker itself created and armed that tab.
    const unarmedUrl = `${fixtureServer.baseUrl}/bilibili`;
    const unarmedPage = await context.newPage();
    await unarmedPage.goto(unarmedUrl);
    const unarmedTabId = await tabIdForExactUrl(worker, unarmedUrl);
    await unarmedPage.evaluate((observation) => {
      window.postMessage(
        {
          channel: 'personal-intelligence.collector.network-capture.v1',
          type: 'response-observed',
          observation
        },
        window.location.origin
      );
    }, {
      schemaVersion: 1,
      platform: 'bilibili',
      routeId: 'test-native-search-response',
      status: 'captured',
      method: 'GET',
      responseUrl: `${fixtureServer.baseUrl}/api/network-search`,
      contentType: 'application/json',
      httpStatus: 200,
      capturedAt: Date.now(),
      body: { result: { id: 'forged-but-safe' } }
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    const unarmedObserverInstalled = await unarmedPage.locator('html').getAttribute('data-collector-network-capture-observer-installed');
    assert.equal(unarmedObserverInstalled, null, 'An unarmed page must not receive the MAIN-world observer.');
    const unarmedCaptures = await worker.evaluate(async (id) => {
      const key = `collector.network-captures.${id}`;
      return (await chrome.storage.session.get(key))[key] ?? null;
    }, unarmedTabId);
    assert.equal(unarmedCaptures, null, 'An unarmed page must not create a network-capture artifact.');
    await unarmedPage.close();

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

      const fixturePage = await waitForFixtureNetworkScenario(context, response.task.navigationUrl);
      assert.equal(await fixturePage.locator('html').getAttribute('data-fixture-fetch-arity'), '1');
      assert.equal(await fixturePage.locator('html').getAttribute('data-fixture-xhr-open-arity'), '2');
      assert.equal(await fixturePage.locator('html').getAttribute('data-fixture-xhr-open-arities'), 'ok');
      const captures = await waitForStoredNetworkCaptures(worker, response.task.tabId);
      assert.equal(captures.every((capture) => capture.platform === fixture.platform), true);
      assert.equal(captures.every((capture) => capture.responseUrl === `${fixtureServer.baseUrl}/api/network-search`), true);
      assert.equal(captures.every((capture) => !capture.responseUrl.includes('?') && !capture.responseUrl.includes('#')), true);
      assert.equal(captures.filter((capture) => capture.status === 'captured').length, 2);
      assert.equal(captures.some((capture) => capture.status === 'payload_rejected' && capture.rejectionReason === 'payload_too_large'), true);
      const transports = captures
        .filter((capture) => capture.status === 'captured')
        .map((capture) => capture.body?.result?.transport)
        .sort();
      assert.deepEqual(transports, ['fetch', 'xhr']);

      const serialisedCaptures = JSON.stringify(captures);
      for (const [index, secret] of syntheticSecretValues().entries()) {
        assert.equal(
          serialisedCaptures.includes(secret),
          false,
          `Synthetic credential marker leaked from network capture: ${syntheticSecretLabels()[index]}`
        );
      }
      assert.equal(hasSensitiveKey(captures), false, 'Network capture retained a sensitive field name.');
      assert.equal(serialisedCaptures.includes('SYNTHETIC_NOT_ALLOWED_RESULT'), false, 'A disallowed route reached extension storage.');

      // The arm hashes the exact navigation URL, not merely tabId/platform.
      // A same-tab search-route drift must not receive another observer.
      const driftedUrl = `${fixtureServer.baseUrl}/${fixture.platform}?native_url=https%3A%2F%2Fexample.invalid%2Fanother-search`;
      await fixturePage.goto(driftedUrl);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      assert.equal(
        await fixturePage.locator('html').getAttribute('data-collector-network-capture-observer-installed'),
        null,
        'A same-tab navigation that does not match the armed URL must not receive the observer.'
      );
    }

    assert.equal(unexpectedRequestCount, 0, 'A non-loopback HTTP(S) request was blocked during extension E2E.');
    await driver.close();

    console.log(JSON.stringify({ ok: true, extensionId, testMode: launched.mode }, null, 2));
  } finally {
    await context?.close().catch(() => undefined);
    await fixtureServer.close().catch(() => undefined);
    await rm(userDataDir, { recursive: true, force: true });
  }
}

await main();
