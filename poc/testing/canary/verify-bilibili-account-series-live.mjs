import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { approveExactExtensionPermission } from '../../collector-extension/scripts/native-permission-harness.mjs';
import { launchProductionExtension } from '../../collector-extension/scripts/extension-test-harness.mjs';

const pocRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const extensionPath = resolve(pocRoot, 'collector-extension', 'dist');
const extensionSourceDirectory = resolve(pocRoot, 'collector-extension');
const gatewayDirectory = resolve(pocRoot, 'collector-gateway');
const profileUrl = 'https://space.bilibili.com/7481602';
const schemaVersion = 3;

/**
 * Explicit live evidence for the current user-owned-browser Bilibili lane.
 * This is intentionally not part of the default local suite: it starts one
 * fresh headed Chromium profile, pairs the production MV3 build, and performs
 * four bounded public read-only operations in sequence. No profile, cookie,
 * token, response body, screenshot, or raw platform payload is persisted.
 */
async function main() {
  const port = await availableLoopbackPort();
  const stateDirectory = await mkdtemp(resolve(process.env.TEMP ?? process.env.TMP ?? '.', 'collector-live-account-series-'));
  const gatewayOrigin = `http://127.0.0.1:${port}`;
  const gateway = startGateway(port, stateDirectory);
  const retainState = process.env.COLLECTOR_ACCOUNT_SERIES_RETAIN_STATE === '1';
  const platformNavigations = [];
  let launched;
  let consolePage;
  let controlPage;
  try {
    await waitForGateway(gatewayOrigin);
    launched = await launchProductionExtension(extensionPath, 'collector-live-account-series-', {
      forceHeaded: true,
      onContext(context) {
        context.on('request', (request) => {
          if (!request.isNavigationRequest()) return;
          const url = new URL(request.url());
          if (url.hostname === 'space.bilibili.com') {
            platformNavigations.push(`${url.origin}${url.pathname}${url.search}`);
          }
        });
      }
    });

    consolePage = await launched.context.newPage();
    await consolePage.goto(gatewayOrigin);
    await consolePage.locator('#create-browser-binding-pairing').click();
    await waitForText(consolePage, '#browser-binding-pairing-fingerprint', /^[a-f0-9]{64}$/);
    await waitForText(consolePage, '#browser-binding-pairing-session', /^[0-9a-f-]{36}$/i);
    await waitForText(consolePage, '#browser-binding-pairing-code', /^\d{8}$/);
    const fingerprint = await consolePage.locator('#browser-binding-pairing-fingerprint').textContent();
    const sessionId = await consolePage.locator('#browser-binding-pairing-session').textContent();
    const pairingCode = await consolePage.locator('#browser-binding-pairing-code').textContent();
    assert.match(fingerprint ?? '', /^[a-f0-9]{64}$/);
    assert.match(sessionId ?? '', /^[0-9a-f-]{36}$/i);
    assert.match(pairingCode ?? '', /^\d{8}$/);

    const extensionId = await launched.worker.evaluate(() => chrome.runtime.id);
    controlPage = await launched.context.newPage();
    await controlPage.goto(`chrome-extension://${extensionId}/control.html`);
    await controlPage.locator('input[name="loopbackOrigin"]').fill(gatewayOrigin);
    await controlPage.locator('input[name="identityFingerprint"]').fill(fingerprint ?? '');
    await controlPage.locator('input[name="pairingSessionId"]').fill(sessionId ?? '');
    await controlPage.locator('input[name="pairingCode"]').fill(pairingCode ?? '');
    const approval = approveExactExtensionPermission(extensionSourceDirectory, '127.0.0.1', '127.0.0.1', 20);
    await controlPage.locator('#pair-gateway button[type="submit"]').click();
    await approval;
    await waitForText(controlPage, '#gateway-state', '已连接');

    const clientToken = await issueClientToken(consolePage);
    const bindingId = await readOnlineBinding(gatewayOrigin, clientToken);

    const profile = await collect(gatewayOrigin, clientToken, bindingId, 'bilibili.account_profile', {
      canonicalProfileUrl: profileUrl
    });
    assert.equal(profile.operation.terminalReason, 'profile_ready');
    assert.equal(profile.artifact.capability, 'bilibili.account_profile');
    assert.equal(profile.artifact.artifact.manifest.stableAccountId, '7481602');
    assert.equal(profile.artifact.artifact.manifest.actions[0].attemptCount, 1);

    const inventory = await collect(gatewayOrigin, clientToken, bindingId, 'bilibili.account_inventory', {
      canonicalProfileUrl: profileUrl
    });
    assert.equal(inventory.operation.terminalReason, 'inventory_ready');
    assert.equal(inventory.artifact.capability, 'bilibili.account_inventory');
    assert.equal(inventory.artifact.artifact.manifest.stableAccountId, '7481602');
    assert.equal(inventory.artifact.artifact.manifest.actions[0].attemptCount, 1);
    assert.ok(inventory.artifact.artifact.page?.items?.length > 0, 'inventory items should be visible');

    const overview = await collect(gatewayOrigin, clientToken, bindingId, 'bilibili.collection_series.overview', {
      canonicalProfileUrl: profileUrl
    });
    assert.equal(overview.operation.terminalReason, 'collection_series_overview_ready');
    assert.equal(overview.artifact.capability, 'bilibili.collection_series.overview');
    const items = overview.artifact.artifact.result?.observation?.items;
    assert.ok(Array.isArray(items) && items.length > 0, 'collection overview should expose public list identities');
    const selected = items.find((item) => /^\d{1,20}$/.test(item?.stableSeriesId ?? '') &&
      (item.listType === 'series' || item.listType === 'season'));
    assert.ok(selected, 'collection overview must supply a stable detail candidate');

    const detail = await collect(gatewayOrigin, clientToken, bindingId, 'bilibili.collection_series.detail', {
      canonicalProfileUrl: profileUrl,
      stableSeriesId: selected.stableSeriesId,
      listType: selected.listType
    });
    assert.equal(detail.operation.terminalReason, 'collection_series_detail_ready');
    assert.equal(detail.artifact.capability, 'bilibili.collection_series.detail');
    assert.equal(detail.artifact.artifact.result?.observation?.stableAccountId, '7481602');
    assert.equal(detail.artifact.artifact.result?.observation?.stableSeriesId, selected.stableSeriesId);
    assert.equal(detail.artifact.artifact.result?.observation?.listType, selected.listType);

    const targets = new Set(platformNavigations.map((value) => {
      const url = new URL(value);
      return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
    }));
    for (const target of [
      profileUrl,
      `${profileUrl}/upload/video`,
      `${profileUrl}/lists`,
      `${profileUrl}/lists/${selected.stableSeriesId}`
    ]) {
      assert.ok(targets.has(target), `missing public navigation target: ${target}`);
    }

    console.log(JSON.stringify({
      ok: true,
      gate: 'bilibili-account-profile-inventory-collection-series-live',
      capabilities: [
        profile.operation.capability,
        inventory.operation.capability,
        overview.operation.capability,
        detail.operation.capability
      ],
      states: [profile.operation.state, inventory.operation.state, overview.operation.state, detail.operation.state],
      inventoryItemCount: inventory.artifact.artifact.page.items.length,
      collectionItemCount: items.length,
      selectedListType: selected.listType,
      navigationTargets: [...targets].filter((target) => target.includes('space.bilibili.com/7481602'))
    }));
  } finally {
    await controlPage?.close().catch(() => undefined);
    await consolePage?.close().catch(() => undefined);
    await launched?.close().catch(() => undefined);
    await stopGateway(gateway);
    if (!retainState) {
      await rm(stateDirectory, { recursive: true, force: true });
    } else {
      console.error(`retained_gateway_state:${stateDirectory}`);
    }
  }
}

async function collect(origin, token, browserBindingId, capability, input, options = {}) {
  const response = await fetch(`${origin}/v2/collect`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion,
      clientRequestId: randomUUID(),
      browserBindingId,
      platform: 'bilibili',
      capability,
      executionTarget: 'collector_work_tab',
      input
    })
  });
  const dispatch = await response.json();
  assert.equal(response.status, 201, `${capability} dispatch failed: ${JSON.stringify(dispatch)}`);
  const operationId = dispatch.result?.operationId;
  assert.match(operationId ?? '', /^[0-9a-f-]{36}$/i);
  const deadline = Date.now() + 120_000;
  let operation;
  while (Date.now() < deadline) {
    const operationResponse = await fetch(`${origin}/v2/collect/operations/${operationId}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const payload = await operationResponse.json();
    operation = payload.result;
    if (operation && ['completed', 'partial', 'stopped', 'failed'].includes(operation.state)) break;
    await delay(1_000);
  }
  assert.ok(operation, `${capability} operation disappeared`);
  if (options.allowPartial !== true) {
    assert.equal(operation.state, 'completed', `${capability} did not complete: ${JSON.stringify(operation)}`);
  }
  const retrievalPath = operation.artifact?.retrievalPath;
  assert.equal(typeof retrievalPath, 'string');
  const artifactResponse = await fetch(`${origin}${retrievalPath}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(artifactResponse.status, 200, `${capability} artifact read failed`);
  const artifact = await artifactResponse.json();
  assert.equal(artifact.capability, capability);
  return { operation, artifact };
}

async function issueClientToken(consolePage) {
  const issued = await consolePage.evaluate(async () => {
    const response = await fetch('/v2/collector-service/clients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'account-series-live-canary',
        scopes: ['browser-bindings:read', 'collect:execute', 'operations:read', 'artifacts:read']
      })
    });
    const payload = await response.json();
    return { status: response.status, token: payload.token ?? null, error: payload.error ?? null };
  });
  assert.equal(issued.status, 201, JSON.stringify(issued));
  assert.match(issued.token ?? '', /^cst_[A-Za-z0-9_-]{43}$/);
  return issued.token;
}

async function readOnlineBinding(origin, token) {
  const response = await fetch(`${origin}/v2/collector-service/browser-bindings`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const bindingId = payload.bindings?.find((candidate) => candidate.state === 'online')?.browserBindingId;
  assert.match(bindingId ?? '', /^[0-9a-f-]{36}$/i);
  return bindingId;
}

async function availableLoopbackPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

function startGateway(port, stateDirectory) {
  return spawn(process.execPath, ['dist/user-browser-server.js'], {
    cwd: gatewayDirectory,
    env: { ...process.env, COLLECTOR_GATEWAY_PORT: String(port), COLLECTOR_GATEWAY_STATE_DIR: stateDirectory },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

async function waitForGateway(origin) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/v1/status`)).ok) return;
    } catch {
      // Gateway is still starting.
    }
    await delay(100);
  }
  throw new Error('test_gateway_start_timeout');
}

async function waitForText(page, selector, expected) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const text = await page.locator(selector).textContent();
    if (expected instanceof RegExp ? expected.test(text ?? '') : (text ?? '').includes(expected)) return;
    await delay(100);
  }
  throw new Error(`expected_text_missing:${selector}:${expected}`);
}

async function stopGateway(child) {
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  await new Promise((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

main().catch((error) => {
  console.error(`bilibili_account_series_live_failed:${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
