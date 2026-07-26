import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
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
test('direct extension work items read one real Bilibili detail and fixed native-search page', async ({}, testInfo) => {
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
          if (url.hostname === 'www.bilibili.com' || url.hostname === 'search.bilibili.com') {
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
    const dispatchResponse = await fetch(`${gatewayOrigin}/v2/collect`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${clientToken!}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          schemaVersion: 2,
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
        schemaVersion: 2,
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
