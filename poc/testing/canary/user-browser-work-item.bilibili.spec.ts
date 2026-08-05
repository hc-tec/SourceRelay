import { expect, test } from '@playwright/test';
import { USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION } from '@intelligence/collector-contracts';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approveExactExtensionPermission } from '../../collector-extension/scripts/native-permission-harness.mjs';
import { launchProductionExtension } from '../../collector-extension/scripts/extension-test-harness.mjs';

const pocRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const extensionPath = resolve(pocRoot, 'collector-extension', 'dist');
const extensionSourceDirectory = resolve(pocRoot, 'collector-extension');
const gatewayDirectory = resolve(pocRoot, 'collector-gateway');
const canonicalVideoUrl = 'https://www.bilibili.com/video/BV1qZSLBYEpa';
const nativeSearchQuery = 'DeepSeek';
const canonicalNativeSearchUrl = `https://search.bilibili.com/all?keyword=${nativeSearchQuery}`;

/**
 * This is evidence, not a fixture-backed E2E: it installs the production MV3
 * build into a fresh real Chromium profile, pairs it to a real temporary
 * Gateway, and performs fixed low-frequency read-only public Bilibili detail
 * and native-search runs. It never uses a managed Browser Host or the user's
 * daily browser.
 */
test('direct extension work items read real Bilibili capabilities', async ({}, testInfo) => {
  test.skip(process.env.COLLECTOR_LIVE_CANARY !== '1', 'requires explicit live-platform canary opt-in');
  test.skip(process.platform !== 'win32', 'native extension-permission verification currently uses Windows UI Automation');
  test.setTimeout(180_000);
  const videoDetailOnly = process.env.COLLECTOR_LIVE_CANARY_SCOPE === 'video_detail';

  const port = await availableLoopbackPort();
  const stateDirectory = await mkdtemp(resolve(tmpdir(), 'collector-live-work-item-'));
  const gatewayOrigin = `http://127.0.0.1:${port}`;
  const gateway = startGateway(port, stateDirectory);
  const platformNavigations: string[] = [];
  let launched: Awaited<ReturnType<typeof launchProductionExtension>> | undefined;
  try {
    await waitForGateway(gatewayOrigin);
    launched = await launchProductionExtension(extensionPath, 'collector-live-work-item-extension-', {
      forceHeaded: true,
      onContext(context: { on(event: 'request', listener: (request: { url(): string; isNavigationRequest(): boolean }) => void): void }) {
        context.on('request', (request) => {
          if (!request.isNavigationRequest()) return;
          const url = new URL(request.url());
          if (url.hostname === 'www.bilibili.com' || url.hostname === 'search.bilibili.com' ||
            url.hostname === 'space.bilibili.com') {
            platformNavigations.push(`${url.origin}${url.pathname}${url.search}`);
          }
        });
      }
    });

    const consolePage = await launched.context.newPage();
    await consolePage.goto(gatewayOrigin);
    await consolePage.locator('#create-browser-binding-pairing').click();
    const identityFingerprintField = consolePage.locator('#browser-binding-pairing-fingerprint');
    const pairingSessionField = consolePage.locator('#browser-binding-pairing-session');
    const pairingCodeField = consolePage.locator('#browser-binding-pairing-code');
    await expect(identityFingerprintField).toHaveText(/^[a-f0-9]{64}$/);
    await expect(pairingSessionField).toHaveText(/^[0-9a-f-]{36}$/i);
    await expect(pairingCodeField).toHaveText(/^\d{8}$/);
    const pairing = {
      identityFingerprint: await identityFingerprintField.textContent(),
      pairingSessionId: await pairingSessionField.textContent(),
      pairingCode: await pairingCodeField.textContent()
    };
    expect(pairing.identityFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(pairing.pairingSessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(pairing.pairingCode).toMatch(/^\d{8}$/);

    const extensionId = await launched.worker.evaluate(() => chrome.runtime.id);
    const controlPage = await launched.context.newPage();
    await controlPage.goto(`chrome-extension://${extensionId}/control.html`);
    await controlPage.locator('input[name="loopbackOrigin"]').fill(gatewayOrigin);
    await controlPage.locator('input[name="identityFingerprint"]').fill(pairing.identityFingerprint!);
    await controlPage.locator('input[name="pairingSessionId"]').fill(pairing.pairingSessionId!);
    await controlPage.locator('input[name="pairingCode"]').fill(pairing.pairingCode!);
    const approval = approveExactExtensionPermission(extensionSourceDirectory, '127.0.0.1', '127.0.0.1', 20);
    await controlPage.locator('#pair-gateway button[type="submit"]').click();
    await approval;
    await expect(controlPage.locator('#gateway-state')).toContainText('已连接');

    const issuedClient = await consolePage.evaluate(async () => {
      const response = await fetch('/v2/collector-service/clients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: 'live-canary',
          scopes: ['browser-bindings:read', 'collect:execute', 'operations:read', 'artifacts:read']
        })
      });
      const payload = await response.json() as { token?: string; error?: { code?: string } };
      return {
        status: response.status,
        token: response.ok ? payload.token ?? null : null,
        errorCode: response.ok ? null : payload.error?.code ?? 'collector_service_client_issue_failed'
      };
    });
    expect(issuedClient.status, issuedClient.errorCode ?? undefined).toBe(201);
    const clientToken = issuedClient.token;
    expect(clientToken).toMatch(/^cst_[A-Za-z0-9_-]{43}$/);
    const bindingResponse = await fetch(`${gatewayOrigin}/v2/collector-service/browser-bindings`, {
      headers: { authorization: `Bearer ${clientToken!}` }
    });
    expect(bindingResponse.status).toBe(200);
    const bindingPayload = await bindingResponse.json() as { bindings?: { browserBindingId?: string; state?: string }[] };
    const bindingId = bindingPayload.bindings?.find((candidate) => candidate.state === 'online')?.browserBindingId ?? null;
    expect(bindingId).toMatch(/^[0-9a-f-]{36}$/i);

    if (process.env.COLLECTOR_LIVE_CANARY_SCOPE === 'discussion') {
      await runDiscussionCanary({
        gatewayOrigin,
        clientToken: clientToken!,
        bindingId: bindingId!,
        launched,
        platformNavigations,
        testInfo
      });
      await controlPage.close();
      await consolePage.close();
      return;
    }

    if (process.env.COLLECTOR_LIVE_CANARY_SCOPE === 'native_search_batch') {
      await runNativeSearchBatchCanary({
        gatewayOrigin,
        clientToken: clientToken!,
        bindingId: bindingId!,
        launched,
        platformNavigations,
        testInfo
      });
      await controlPage.close();
      await consolePage.close();
      return;
    }

    if (process.env.COLLECTOR_LIVE_CANARY_SCOPE === 'python_sdk') {
      await runPythonSdkCanary({
        gatewayOrigin,
        clientToken: clientToken!,
        bindingId: bindingId!,
        platformNavigations
      });
      await controlPage.close();
      await consolePage.close();
      return;
    }

    if (process.env.COLLECTOR_LIVE_CANARY_SCOPE === 'dynamic') {
      await runDynamicCanary({
        gatewayOrigin,
        clientToken: clientToken!,
        bindingId: bindingId!,
        launched,
        platformNavigations,
        testInfo
      });
      await controlPage.close();
      await consolePage.close();
      return;
    }

    if (process.env.COLLECTOR_LIVE_CANARY_SCOPE === 'javascript_sdk') {
      await runJavaScriptSdkCanary({
        gatewayOrigin,
        clientToken: clientToken!,
        platformNavigations
      });
      await controlPage.close();
      await consolePage.close();
      return;
    }

    const dispatchResponse = await fetch(`${gatewayOrigin}/v2/collect`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${clientToken!}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
          clientRequestId: randomUUID(),
          browserBindingId: bindingId,
          platform: 'bilibili',
          capability: 'bilibili.video_detail',
          executionTarget: 'collector_work_tab',
          input: { canonicalVideoUrl }
        })
    });
    const dispatch = await dispatchResponse.json() as { result?: { operationId?: string } };
    expect(dispatchResponse.status).toBe(201);
    const operationId = dispatch.result?.operationId;
    expect(operationId).toMatch(/^[0-9a-f-]{36}$/i);

    await expect.poll(async () => {
      const response = await fetch(`${gatewayOrigin}/v2/collect/operations/${operationId}`, {
        headers: { authorization: `Bearer ${clientToken!}` }
      });
      const payload = await response.json() as { result?: { state?: string } };
      return payload.result?.state ?? null;
    }, { timeout: 120_000, intervals: [1_000, 2_000, 5_000] }).toBe('completed');

    const finalResponse = await fetch(`${gatewayOrigin}/v2/collect/operations/${operationId}`, {
      headers: { authorization: `Bearer ${clientToken!}` }
    });
    const finalOperation = await finalResponse.json() as {
      result?: { artifact?: { artifactId?: string; retrievalPath?: string }; state?: string };
    };
    expect(finalOperation.result?.artifact?.artifactId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(finalOperation.result?.artifact?.retrievalPath).toMatch(/^\/v1\/collect\/artifacts\/bilibili\.video_detail\//);
    const artifactResponse = await fetch(`${gatewayOrigin}${finalOperation.result?.artifact?.retrievalPath}`, {
      headers: { authorization: `Bearer ${clientToken!}` }
    });
    expect(artifactResponse.status).toBe(200);
    const detailArtifact = await artifactResponse.json() as {
      artifact?: { manifest?: { actions?: Array<{ attempted?: unknown; attemptCount?: unknown }> } };
    };
    expect(detailArtifact.artifact?.manifest?.actions).toEqual([
      expect.objectContaining({ attempted: true, attemptCount: 1 })
    ]);
    // Bilibili currently redirects the no-slash canonical input to its
    // trailing-slash representation. Browser-level document events can also
    // include a source-owned reload after a rejected first response, so use
    // the signed result's action ledger above—not raw document-event count—
    // as evidence that Collector issued exactly one navigation.
    const detailNavigationTargets = [...new Set(platformNavigations.map((value) => {
      const target = new URL(value);
      return `${target.origin}${target.pathname.replace(/\/$/, '')}`;
    }))];
    expect(detailNavigationTargets).toEqual([canonicalVideoUrl]);
    expect(platformNavigations.length).toBeGreaterThanOrEqual(1);
    const retainedWorkTab = launched.context.pages().find((page) => page.url().startsWith(canonicalVideoUrl));
    expect(retainedWorkTab).toBeTruthy();
    expect(retainedWorkTab?.isClosed()).toBe(false);
    if (!retainedWorkTab) throw new Error('live_canary_retained_video_work_tab_missing');
    await expect(retainedWorkTab.evaluate(() => document.visibilityState)).resolves.toBe('visible');
    expect((await retainedWorkTab.screenshot({
      path: testInfo.outputPath('bilibili-video-detail-visible.png')
    })).byteLength).toBeGreaterThan(0);

    // A narrow foreground canary should not spend a second platform action
    // when the video-detail tab alone is enough to prove the shared work-tab
    // activation invariant. Full canaries continue to cover search by default.
    if (videoDetailOnly) return;

    const navigationCountBeforeSearch = platformNavigations.length;
    const searchDispatchResponse = await fetch(`${gatewayOrigin}/v2/collect`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${clientToken!}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
        clientRequestId: randomUUID(),
        browserBindingId: bindingId,
        platform: 'bilibili',
        capability: 'bilibili.native_search',
        executionTarget: 'collector_work_tab',
        input: { query: nativeSearchQuery }
      })
    });
    const searchDispatch = await searchDispatchResponse.json() as { result?: { operationId?: string } };
    expect(searchDispatchResponse.status).toBe(201);
    const searchOperationId = searchDispatch.result?.operationId;
    expect(searchOperationId).toMatch(/^[0-9a-f-]{36}$/i);

    await expect.poll(async () => {
      const response = await fetch(`${gatewayOrigin}/v2/collect/operations/${searchOperationId}`, {
        headers: { authorization: `Bearer ${clientToken!}` }
      });
      const payload = await response.json() as {
        result?: { state?: string; errorCode?: string | null; terminalReason?: string | null };
      };
      return payload.result?.state === 'completed'
        ? 'completed'
        : `${payload.result?.state ?? 'missing'}:${payload.result?.errorCode ?? 'none'}:${payload.result?.terminalReason ?? 'none'}`;
    }, { timeout: 120_000, intervals: [1_000, 2_000, 5_000] }).toBe('completed');

    const searchFinalResponse = await fetch(`${gatewayOrigin}/v2/collect/operations/${searchOperationId}`, {
      headers: { authorization: `Bearer ${clientToken!}` }
    });
    const searchFinalOperation = await searchFinalResponse.json() as {
      result?: { artifact?: { artifactId?: string; retrievalPath?: string }; state?: string };
    };
    expect(searchFinalOperation.result?.artifact?.artifactId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(searchFinalOperation.result?.artifact?.retrievalPath).toMatch(/^\/v1\/collect\/artifacts\/bilibili\.native_search\//);
    const searchArtifactResponse = await fetch(`${gatewayOrigin}${searchFinalOperation.result?.artifact?.retrievalPath}`, {
      headers: { authorization: `Bearer ${clientToken!}` }
    });
    expect(searchArtifactResponse.status).toBe(200);
    const searchArtifact = await searchArtifactResponse.json() as {
      artifact?: {
        manifest?: {
          search?: unknown;
          queryDigest?: unknown;
          safeguards?: unknown;
          actions?: Array<{ attempted?: unknown; attemptCount?: unknown }>;
        };
      };
    };
    expect(searchArtifact.artifact?.manifest?.search).toEqual({
      resultType: 'comprehensive', sort: 'relevance', page: 1
    });
    expect(searchArtifact.artifact?.manifest?.queryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(searchArtifact.artifact?.manifest?.safeguards).toMatchObject({
      environment: 'user_owned_browser_extension',
      acquisition: 'extension_owned_tab_navigation_plus_bounded_dom_projection',
      sortAndFilter: 'fixed_comprehensive_first_page_no_input',
      pagination: 'fixed_first_page_no_input',
      responseBodies: 'not_read'
    });
    expect(searchArtifact.artifact?.manifest?.actions).toEqual([
      expect.objectContaining({ attempted: true, attemptCount: 1 })
    ]);
    const searchNavigationTargets = [...new Set(platformNavigations.slice(navigationCountBeforeSearch).map((value) => {
      const target = new URL(value);
      return `${target.origin}${target.pathname}`;
    }))];
    expect(searchNavigationTargets).toEqual(['https://search.bilibili.com/all']);
    expect(platformNavigations.slice(navigationCountBeforeSearch).length).toBeGreaterThanOrEqual(1);
    const retainedSearchTab = launched.context.pages().find((page) => page.url().startsWith(canonicalNativeSearchUrl));
    expect(retainedSearchTab).toBeTruthy();
    expect(retainedSearchTab?.isClosed()).toBe(false);
    if (!retainedSearchTab) throw new Error('live_canary_retained_search_work_tab_missing');
    await expect(retainedSearchTab.evaluate(() => document.visibilityState)).resolves.toBe('visible');
    expect((await retainedSearchTab.screenshot({
      path: testInfo.outputPath('bilibili-native-search-visible.png')
    })).byteLength).toBeGreaterThan(0);

    await controlPage.close();
    await consolePage.close();
  } finally {
    await launched?.close();
    await stopGateway(gateway);
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  if (!address || typeof address === 'string' || address.port < 1024) throw new Error('test_loopback_port_unavailable');
  return address.port;
}

function startGateway(port: number, stateDirectory: string): ChildProcess {
  return spawn(process.execPath, ['dist/user-browser-server.js'], {
    cwd: gatewayDirectory,
    env: {
      ...process.env,
      COLLECTOR_GATEWAY_PORT: String(port),
      COLLECTOR_GATEWAY_STATE_DIR: stateDirectory
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

async function waitForGateway(origin: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/v1/status`);
      if (response.ok) return;
    } catch {
      // The temporary local Gateway is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error('test_gateway_start_timeout');
}

async function stopGateway(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

async function runNativeSearchBatchCanary(input: {
  gatewayOrigin: string;
  clientToken: string;
  bindingId: string;
  launched: Awaited<ReturnType<typeof launchProductionExtension>>;
  platformNavigations: string[];
  testInfo: { outputPath(path: string): string };
}): Promise<void> {
  const dispatchResponse = await fetch(`${input.gatewayOrigin}/v2/collect`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.clientToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      clientRequestId: randomUUID(),
      browserBindingId: input.bindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search_batch',
      executionTarget: 'collector_work_tab',
      input: { query: nativeSearchQuery }
    })
  });
  const dispatch = await dispatchResponse.json() as { result?: { operationId?: string }; error?: string };
  expect(dispatchResponse.status, dispatch.error ?? 'bilibili_native_search_batch_dispatch_failed').toBe(201);
  const operationId = dispatch.result?.operationId;
  expect(operationId).toMatch(/^[0-9a-f-]{36}$/i);

  await expect.poll(async () => {
    const response = await fetch(`${input.gatewayOrigin}/v2/collect/operations/${operationId}`, {
      headers: { authorization: `Bearer ${input.clientToken}` }
    });
    const payload = await response.json() as {
      result?: { state?: string; errorCode?: string | null; terminalReason?: string | null };
    };
    return payload.result?.state === 'completed'
      ? 'completed'
      : `${payload.result?.state ?? 'missing'}:${payload.result?.errorCode ?? 'none'}:${payload.result?.terminalReason ?? 'none'}`;
  }, { timeout: 120_000, intervals: [1_000, 2_000, 5_000] }).toBe('completed');

  const finalResponse = await fetch(`${input.gatewayOrigin}/v2/collect/operations/${operationId}`, {
    headers: { authorization: `Bearer ${input.clientToken}` }
  });
  const finalOperation = await finalResponse.json() as {
    result?: {
      state?: string;
      terminalReason?: string | null;
      artifact?: { artifactId?: string; retrievalPath?: string };
    };
  };
  expect(finalOperation.result?.state).toBe('completed');
  expect(finalOperation.result?.terminalReason).toBe('search_batch_ready');
  expect(finalOperation.result?.artifact?.artifactId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(finalOperation.result?.artifact?.retrievalPath).toMatch(/^\/v1\/collect\/artifacts\/bilibili\.native_search_batch\//);

  const artifactResponse = await fetch(`${input.gatewayOrigin}${finalOperation.result?.artifact?.retrievalPath}`, {
    headers: { authorization: `Bearer ${input.clientToken}` }
  });
  expect(artifactResponse.status).toBe(200);
  const payload = await artifactResponse.json() as {
    capability?: string;
    artifact?: {
      summary?: { capability?: string; itemCount?: number; capturedPages?: number };
      provenance?: {
        environment?: string;
        executionTarget?: string;
        captureMode?: string;
        responseBodies?: string;
        semanticActions?: number;
        platformNavigations?: number;
      };
      search?: {
        resultType?: string;
        sort?: string;
        requestedPages?: number[];
        observedPages?: number[];
        queryDigest?: string;
      };
      actions?: Array<{ page?: number; attempted?: boolean; attemptCount?: number; outcome?: string }>;
      result?: {
        navigation?: { attempted?: boolean; attemptCount?: number };
        observation?: { pages?: Array<{ page?: number; cards?: unknown[] }> };
      };
    };
  };
  expect(payload.capability).toBe('bilibili.native_search_batch');
  expect(payload.artifact?.summary).toMatchObject({
    capability: 'bilibili.native_search_batch',
    capturedPages: 2
  });
  expect(payload.artifact?.summary?.itemCount).toBeGreaterThan(0);
  expect(payload.artifact?.provenance).toMatchObject({
    environment: 'user_owned_browser_extension',
    executionTarget: 'collector_work_tab',
    captureMode: 'bounded_multi_page_dom_projection',
    responseBodies: 'not_read',
    semanticActions: 0,
    platformNavigations: 2
  });
  expect(payload.artifact?.search).toMatchObject({
    resultType: 'comprehensive',
    sort: 'relevance',
    requestedPages: [1, 2],
    observedPages: [1, 2]
  });
  expect(payload.artifact?.search?.queryDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(payload.artifact?.actions).toEqual([
    expect.objectContaining({
      actionId: 'open_fixed_native_search_page_1',
      page: 1,
      attempted: true,
      attemptCount: 1,
      outcome: 'completed',
      errorCode: null
    }),
    expect.objectContaining({
      actionId: 'open_fixed_native_search_page_2',
      page: 2,
      attempted: true,
      attemptCount: 1,
      outcome: 'completed',
      errorCode: null
    })
  ]);
  expect(payload.artifact?.result?.navigation).toEqual({ attempted: true, attemptCount: 2 });
  expect(payload.artifact?.result?.observation?.pages?.map((page) => page.page)).toEqual([1, 2]);

  const pageKeys = new Set(input.platformNavigations
    .filter((value) => new URL(value).hostname === 'search.bilibili.com')
    .map((value) => {
      const url = new URL(value);
      return url.searchParams.get('page') ?? '1';
    }));
  expect(pageKeys).toEqual(new Set(['1', '2']));

  const retainedSearchTab = input.launched.context.pages().find((page) => {
    try {
      const url = new URL(page.url());
      return url.hostname === 'search.bilibili.com' && url.pathname === '/all' && url.searchParams.get('page') === '2';
    } catch {
      return false;
    }
  });
  expect(retainedSearchTab).toBeTruthy();
  expect(retainedSearchTab?.isClosed()).toBe(false);
  if (!retainedSearchTab) throw new Error('live_canary_retained_batch_search_work_tab_missing');
  await expect(retainedSearchTab.evaluate(() => document.visibilityState)).resolves.toBe('visible');
  expect((await retainedSearchTab.screenshot({
    path: input.testInfo.outputPath('bilibili-native-search-batch-page-two-visible.png')
  })).byteLength).toBeGreaterThan(0);
}

async function runDynamicCanary(input: {
  gatewayOrigin: string;
  clientToken: string;
  bindingId: string;
  launched: Awaited<ReturnType<typeof launchProductionExtension>>;
  platformNavigations: string[];
  testInfo: { outputPath(path: string): string };
}): Promise<void> {
  const dispatchResponse = await fetch(`${input.gatewayOrigin}/v2/collect`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.clientToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      clientRequestId: randomUUID(),
      browserBindingId: input.bindingId,
      platform: 'bilibili',
      capability: 'bilibili.dynamic',
      executionTarget: 'collector_work_tab',
      input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
    })
  });
  const dispatch = await dispatchResponse.json() as { result?: { operationId?: string } };
  expect(dispatchResponse.status).toBe(201);
  const operationId = dispatch.result?.operationId;
  expect(operationId).toMatch(/^[0-9a-f-]{36}$/i);

  await expect.poll(async () => {
    const response = await fetch(`${input.gatewayOrigin}/v2/collect/operations/${operationId}`, {
      headers: { authorization: `Bearer ${input.clientToken}` }
    });
    const payload = await response.json() as {
      result?: { state?: string; errorCode?: string | null; terminalReason?: string | null };
    };
    return payload.result?.state && ['completed', 'partial', 'stopped', 'failed'].includes(payload.result.state)
      ? `${payload.result.state}:${payload.result.errorCode ?? 'none'}:${payload.result.terminalReason ?? 'none'}`
      : 'pending';
  }, { timeout: 120_000, intervals: [1_000, 2_000, 5_000] }).not.toBe('pending');

  const finalResponse = await fetch(`${input.gatewayOrigin}/v2/collect/operations/${operationId}`, {
    headers: { authorization: `Bearer ${input.clientToken}` }
  });
  const finalOperation = await finalResponse.json() as {
    result?: {
      state?: string;
      errorCode?: string | null;
      terminalReason?: string | null;
      artifact?: { artifactId?: string; retrievalPath?: string };
    };
  };
  expect(finalResponse.status).toBe(200);
  expect(finalOperation.result?.state).toBeDefined();
  expect(['completed', 'partial']).toContain(finalOperation.result?.state);
  expect(['dynamic_ready', 'dynamic_empty', 'dynamic_partial', 'budget_exhausted', 'feed_terminal_reached'])
    .toContain(finalOperation.result?.terminalReason);
  expect(finalOperation.result?.artifact?.artifactId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(finalOperation.result?.artifact?.retrievalPath)
    .toMatch(/^\/v1\/collect\/artifacts\/bilibili\.dynamic\//);

  const artifactResponse = await fetch(`${input.gatewayOrigin}${finalOperation.result?.artifact?.retrievalPath}`, {
    headers: { authorization: `Bearer ${input.clientToken}` }
  });
  expect(artifactResponse.status).toBe(200);
  const payload = await artifactResponse.json() as {
    artifact?: {
      capability?: string;
      state?: string;
      provenance?: {
        environment?: string;
        executionTarget?: string;
        captureMode?: string;
        responseBodies?: string;
        platformNavigations?: number;
      };
      result?: {
        observation?: { stableAccountId?: string | null; feedVisible?: boolean; cards?: unknown[] } | null;
      };
    };
  };
  expect(payload.artifact?.capability).toBe('bilibili.dynamic');
  expect(payload.artifact?.provenance).toMatchObject({
    environment: 'user_owned_browser_extension',
    executionTarget: 'collector_work_tab',
    captureMode: 'passive_dom_projection',
    responseBodies: 'not_read',
    platformNavigations: 1
  });
  expect(payload.artifact?.result?.observation).toMatchObject({
    stableAccountId: '7481602',
    feedVisible: true
  });

  const dynamicNavigationTargets = [...new Set(input.platformNavigations
    .filter((value) => new URL(value).hostname === 'space.bilibili.com')
    .map((value) => {
      const target = new URL(value);
      return `${target.origin}${target.pathname.replace(/\/$/, '')}`;
    }))];
  expect(dynamicNavigationTargets).toEqual(['https://space.bilibili.com/7481602/dynamic']);
  expect(input.platformNavigations.filter((value) => new URL(value).hostname === 'space.bilibili.com').length)
    .toBeGreaterThanOrEqual(1);

  const retainedWorkTab = input.launched.context.pages().find((page) =>
    page.url().startsWith('https://space.bilibili.com/7481602/dynamic')
  );
  expect(retainedWorkTab).toBeTruthy();
  expect(retainedWorkTab?.isClosed()).toBe(false);
  if (!retainedWorkTab) throw new Error('live_canary_retained_dynamic_work_tab_missing');
  await expect(retainedWorkTab.evaluate(() => document.visibilityState)).resolves.toBe('visible');
  expect((await retainedWorkTab.screenshot({
    path: input.testInfo.outputPath('bilibili-dynamic-visible.png')
  })).byteLength).toBeGreaterThan(0);
}

async function runDiscussionCanary(input: {
  gatewayOrigin: string;
  clientToken: string;
  bindingId: string;
  launched: Awaited<ReturnType<typeof launchProductionExtension>>;
  platformNavigations: string[];
  testInfo: { outputPath(path: string): string };
}): Promise<void> {
  const dispatchResponse = await fetch(`${input.gatewayOrigin}/v2/collect`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.clientToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      clientRequestId: randomUUID(),
      browserBindingId: input.bindingId,
      platform: 'bilibili',
      capability: 'bilibili.discussion',
      executionTarget: 'collector_work_tab',
      input: { canonicalVideoUrl }
    })
  });
  const dispatch = await dispatchResponse.json() as { result?: { operationId?: string } };
  expect(dispatchResponse.status).toBe(201);
  const operationId = dispatch.result?.operationId;
  expect(operationId).toMatch(/^[0-9a-f-]{36}$/i);

  await expect.poll(async () => {
    const response = await fetch(`${input.gatewayOrigin}/v2/collect/operations/${operationId}`, {
      headers: { authorization: `Bearer ${input.clientToken}` }
    });
    const payload = await response.json() as {
      result?: { state?: string; errorCode?: string | null; terminalReason?: string | null };
    };
    return payload.result?.state && ['completed', 'partial', 'stopped', 'failed'].includes(payload.result.state)
      ? `${payload.result.state}:${payload.result.errorCode ?? 'none'}:${payload.result.terminalReason ?? 'none'}`
      : 'pending';
  }, { timeout: 120_000, intervals: [1_000, 2_000, 5_000] }).not.toBe('pending');

  const finalResponse = await fetch(`${input.gatewayOrigin}/v2/collect/operations/${operationId}`, {
    headers: { authorization: `Bearer ${input.clientToken}` }
  });
  const finalOperation = await finalResponse.json() as {
    result?: {
      state?: string;
      errorCode?: string | null;
      terminalReason?: string | null;
      artifact?: { artifactId?: string; retrievalPath?: string };
    };
  };
  expect(finalResponse.status).toBe(200);
  expect(finalOperation.result?.state).toBeDefined();
  expect(['completed', 'stopped']).toContain(finalOperation.result?.state);
  expect(['discussion_ready', 'discussion_empty', 'login_required']).toContain(finalOperation.result?.terminalReason);
  expect(finalOperation.result?.artifact?.artifactId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(finalOperation.result?.artifact?.retrievalPath).toMatch(/^\/v1\/collect\/artifacts\/bilibili\.discussion\//);

  const artifactResponse = await fetch(`${input.gatewayOrigin}${finalOperation.result?.artifact?.retrievalPath}`, {
    headers: { authorization: `Bearer ${input.clientToken}` }
  });
  expect(artifactResponse.status).toBe(200);
  const payload = await artifactResponse.json() as {
    artifact?: {
      capability?: string;
      state?: string;
      provenance?: {
        environment?: string;
        executionTarget?: string;
        captureMode?: string;
        responseBodies?: string;
        semanticActions?: number;
        platformNavigations?: number;
        workTabDisposition?: string;
      };
      result?: {
        state?: string;
        errorCode?: string | null;
        terminalReason?: string | null;
        observation?: {
          bvid?: string | null;
          commentHostPresent?: boolean;
          commentHostVisible?: boolean;
          commentHostInViewport?: boolean;
          commentContentState?: string;
          rootCommentTexts?: string[];
          loginGateVisible?: boolean;
          risk?: {
            verificationRequired?: boolean;
            rateLimited?: boolean;
            sourceUnavailable?: boolean;
          };
        } | null;
      };
    };
  };
  const artifact = payload.artifact;
  const observation = artifact?.result?.observation;
  expect(artifact?.capability).toBe('bilibili.discussion');
  expect(artifact?.provenance).toMatchObject({
    environment: 'user_owned_browser_extension',
    executionTarget: 'collector_work_tab',
    captureMode: 'passive_dom_projection',
    responseBodies: 'not_read',
    semanticActions: 1,
    platformNavigations: 1
  });
  expect(artifact?.result?.state).toBe(finalOperation.result?.state);
  expect(observation).toMatchObject({
    bvid: 'BV1qZSLBYEpa',
    commentHostPresent: true,
    commentHostVisible: true,
    commentHostInViewport: true,
    risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
  });
  if (finalOperation.result?.terminalReason === 'login_required') {
    expect(observation?.loginGateVisible).toBe(true);
  } else if (finalOperation.result?.terminalReason === 'discussion_ready') {
    expect(observation?.commentContentState).toBe('ready');
    expect(observation?.rootCommentTexts?.length).toBeGreaterThan(0);
  } else {
    expect(observation?.commentContentState).toBe('empty');
    expect(observation?.rootCommentTexts).toEqual([]);
  }

  const retainedWorkTab = input.launched.context.pages().find((page) => page.url().startsWith(canonicalVideoUrl));
  expect(retainedWorkTab).toBeTruthy();
  expect(retainedWorkTab?.isClosed()).toBe(false);
  if (!retainedWorkTab) throw new Error('live_canary_retained_discussion_work_tab_missing');
  await expect(retainedWorkTab.evaluate(() => document.visibilityState)).resolves.toBe('visible');
  expect((await retainedWorkTab.screenshot({
    path: input.testInfo.outputPath('bilibili-discussion-visible.png')
  })).byteLength).toBeGreaterThan(0);

  const discussionNavigations = input.platformNavigations.filter((value) => {
    const url = new URL(value);
    return url.hostname === 'www.bilibili.com' && url.pathname.startsWith('/video/');
  });
  expect(discussionNavigations.length).toBeGreaterThanOrEqual(1);
}

async function runPythonSdkCanary(input: {
  gatewayOrigin: string;
  clientToken: string;
  bindingId: string;
  platformNavigations: string[];
}): Promise<void> {
  const pythonScript = resolve(pocRoot, 'collector-python-client', 'scripts', 'real_gateway_smoke.py');
  const pythonSource = resolve(pocRoot, 'collector-python-client', 'src');
  const pythonExecutable = process.env.PYTHON_EXECUTABLE ?? 'python';
  const child = spawn(pythonExecutable, [pythonScript], {
    cwd: resolve(pocRoot, 'collector-python-client'),
    env: {
      ...process.env,
      COLLECTOR_SERVICE_ORIGIN: input.gatewayOrigin,
      COLLECTOR_SERVICE_TOKEN: input.clientToken,
      PYTHONPATH: [pythonSource, process.env.PYTHONPATH].filter(Boolean).join(delimiter)
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
  const exitCode = await new Promise<number>((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolvePromise(code ?? 1));
  });
  expect(exitCode, stderr || stdout).toBe(0);
  const lastLine = stdout.trim().split(/\r?\n/).at(-1);
  if (!lastLine) throw new Error('python_sdk_real_smoke_output_missing');
  let summary: Record<string, unknown>;
  try {
    summary = JSON.parse(lastLine) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`python_sdk_real_smoke_output_invalid:${String(error)}:${stdout}`);
  }
  expect(summary).toMatchObject({
    capabilityCount: 21,
    directReadyCount: 18,
    onlineBinding: true,
    catalogOnlyRejected: true,
    operationState: 'completed',
    operationCapability: 'bilibili.native_search',
    artifactCapability: 'bilibili.native_search'
  });
  expect(summary.openapiPathCount).toBeGreaterThanOrEqual(5);
  expect(summary.capturedItems).toBeGreaterThan(0);
  const searchNavigations = input.platformNavigations
    .filter((value) => new URL(value).hostname === 'search.bilibili.com');
  expect(searchNavigations.length).toBeGreaterThanOrEqual(1);
}

async function runJavaScriptSdkCanary(input: {
  gatewayOrigin: string;
  clientToken: string;
  platformNavigations: string[];
}): Promise<void> {
  const script = resolve(pocRoot, 'collector-client', 'scripts', 'real_gateway_smoke.mjs');
  const child = spawn(process.execPath, [script], {
    cwd: resolve(pocRoot, 'collector-client'),
    env: {
      ...process.env,
      COLLECTOR_SERVICE_ORIGIN: input.gatewayOrigin,
      COLLECTOR_SERVICE_TOKEN: input.clientToken
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
  const exitCode = await new Promise<number>((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolvePromise(code ?? 1));
  });
  expect(exitCode, stderr || stdout).toBe(0);
  const lastLine = stdout.trim().split(/\r?\n/).at(-1);
  if (!lastLine) throw new Error('javascript_sdk_real_smoke_output_missing');
  let summary: Record<string, unknown>;
  try {
    summary = JSON.parse(lastLine) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`javascript_sdk_real_smoke_output_invalid:${String(error)}:${stdout}`);
  }
  expect(summary).toMatchObject({
    capabilityCount: 21,
    directReadyCount: 18,
    onlineBinding: true,
    catalogOnlyRejected: true,
    operationState: 'completed',
    operationCapability: 'bilibili.native_search',
    artifactCapability: 'bilibili.native_search'
  });
  expect(summary.openapiPathCount).toBeGreaterThanOrEqual(5);
  expect(summary.capturedItems).toBeGreaterThan(0);
  const searchNavigations = input.platformNavigations
    .filter((value) => new URL(value).hostname === 'search.bilibili.com');
  expect(searchNavigations.length).toBeGreaterThanOrEqual(1);
}
