import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserHostClient, launchBrowserHost } from '../dist/client.js';
import {
  acquireRequest,
  asAcquire,
  asSnapshot,
  expectHostError,
  onlyProfile,
  processAlive,
  waitForExit
} from './lifecycle-gate-helpers.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(root, '..');
const runtimeParent = resolve(root, 'runtime');
const runtimeRoot = resolve(runtimeParent, `strategy-observer-binding-${Date.now()}`);
const stateDirectory = resolve(runtimeRoot, 'host-state');
const profileRoot = resolve(runtimeRoot, 'profiles');
const endpointPath = resolve(stateDirectory, 'endpoint.json');
const extensionDirectory = resolve(workspaceRoot, 'collector-extension', 'dist');
const mainModulePath = resolve(root, 'dist', 'main.js');
const profileId = 'strategy-observer-binding-local';
const target = {
  stableAccountId: '7481602',
  canonicalUrl: 'https://space.bilibili.com/7481602/dynamic'
};
const videoTarget = {
  bvid: 'BV1qZSLBYEpa',
  canonicalUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa'
};
const accountVideoInventoryTarget = {
  stableAccountId: '7481602',
  canonicalUrl: 'https://space.bilibili.com/7481602/upload/video'
};

if (relative(runtimeParent, runtimeRoot).startsWith('..')) {
  throw new Error('strategy_binding_runtime_path_rejected');
}

await mkdir(stateDirectory, { recursive: true });
await mkdir(profileRoot, { recursive: true });

let endpoint = null;
let client = null;
let acquired = null;
let released = false;
let browserProcessId = null;

try {
  const extensionManifest = JSON.parse(await readFile(resolve(extensionDirectory, 'manifest.json'), 'utf8'));
  assert.equal(extensionManifest.version, '0.7.15');

  endpoint = await launchBrowserHost({
    mainModulePath,
    stateDirectory,
    profileRoot,
    extensionDirectory,
    endpointPath,
    timeoutMs: 30_000
  });
  client = await BrowserHostClient.connect(endpointPath, 'strategy-binding-gateway');

  const initial = asSnapshot(await client.command({
    type: 'launch_profile',
    request: {
      profileId,
      maximumManagedPages: 1,
      // Strategy binding is verified against real Chromium and the real MV3
      // worker.  No person needs to inspect this offline-only gate, so avoid
      // opening and then immediately closing a visible test window.
      headless: true,
      offlineOnly: true,
      extensionRuntime: {
        version: extensionManifest.version,
        controlSurfaceRevision: 13,
        runtimeBootstrapKey: 'collector.runtime-bootstrap.v1'
      }
    }
  }));
  const initialProfile = onlyProfile(initial);
  browserProcessId = initialProfile.browserProcessId;
  assert.equal(initialProfile.extensionRuntime?.nativeBridgeConnected, true);
  assert.equal(initialProfile.livePlatformRequests, 0);
  assert.equal(initialProfile.extensionPages <= 1, true);

  const runId = randomUUID();
  acquired = asAcquire(await client.command({
    type: 'acquire_page',
    request: acquireRequest(profileId, 'strategy-binding-task', runId, 'account_dynamic', target.canonicalUrl, {
      platform: 'bilibili',
      maximumManagedPages: 1
    })
  }));
  assert.equal(acquired.page.extensionTabBound, true, 'Host-created page must have one exact Extension tab');
  assert.equal(acquired.page.documentGeneration, 0, 'binding proof must not navigate a platform page');

  const bindingRequest = {
    schemaVersion: 1,
    profileId,
    pageAlias: acquired.page.pageAlias,
    pageLeaseId: acquired.lease.pageLeaseId,
    expectedRecordVersion: acquired.page.recordVersion,
    runId,
    observerBindingId: randomUUID(),
    strategyId: 'bilibili.dynamic.account-feed.response-dom.v1',
    target,
    expiresAt: new Date(Date.now() + 45_000).toISOString(),
    maximumResponseObservations: 1,
    maximumPayloadBytes: 192 * 1024
  };
  const binding = await client.command({ type: 'bind_strategy_observer', request: bindingRequest });
  assert.equal(binding.type, 'collector_strategy_observer_binding');
  assert.equal(binding.observerBindingId, bindingRequest.observerBindingId);
  assert.equal(binding.pageAlias, acquired.page.pageAlias);
  assert.equal(binding.nextDocumentGeneration, acquired.page.documentGeneration + 1);

  // This uses the real MV3 worker and the same blank managed page, but never
  // navigates. It proves that the DOM-only strategy has its own fixed binding
  // path and replaces the prior Strategy binding on that tab.
  const videoBindingRequest = {
    ...bindingRequest,
    observerBindingId: randomUUID(),
    strategyId: 'bilibili.video.detail.dom.v2',
    target: videoTarget,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 96 * 1024
  };
  const videoBinding = await client.command({ type: 'bind_strategy_observer', request: videoBindingRequest });
  assert.equal(videoBinding.type, 'collector_strategy_observer_binding');
  assert.equal(videoBinding.observerBindingId, videoBindingRequest.observerBindingId);
  assert.equal(videoBinding.pageAlias, acquired.page.pageAlias);
  assert.equal(videoBinding.nextDocumentGeneration, acquired.page.documentGeneration + 1);

  // A real MV3/native-messaging round trip for the failure-only diagnostic
  // surface. This stays on about:blank and proves no platform page, DOM, URL,
  // document ID, response metadata, or credentials are returned.
  const videoBindingDiagnostics = await client.command({
    type: 'read_strategy_binding_diagnostics',
    request: {
      schemaVersion: 1,
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      expectedRecordVersion: acquired.page.recordVersion,
      runId,
      observerBindingId: videoBindingRequest.observerBindingId,
      strategyId: videoBindingRequest.strategyId
    }
  });
  assert.deepEqual(videoBindingDiagnostics, {
    schemaVersion: 1,
    type: 'collector_strategy_binding_diagnostics',
    strategyId: videoBindingRequest.strategyId,
    observerBindingId: videoBindingRequest.observerBindingId,
    bindingState: 'active',
    documentBindingState: 'not_bound',
    documentBindCount: 0,
    bridgeRegistration: 'registered',
    currentMainFrameState: 'target_mismatch'
  });

  const accountVideoInventoryBindingRequest = {
    ...bindingRequest,
    observerBindingId: randomUUID(),
    strategyId: 'bilibili.account.video-inventory.dom.v1',
    target: accountVideoInventoryTarget,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 128 * 1024
  };
  const accountVideoInventoryBinding = await client.command({
    type: 'bind_strategy_observer',
    request: accountVideoInventoryBindingRequest
  });
  assert.equal(accountVideoInventoryBinding.type, 'collector_strategy_observer_binding');
  assert.equal(accountVideoInventoryBinding.observerBindingId, accountVideoInventoryBindingRequest.observerBindingId);
  assert.equal(accountVideoInventoryBinding.pageAlias, acquired.page.pageAlias);
  assert.equal(accountVideoInventoryBinding.nextDocumentGeneration, acquired.page.documentGeneration + 1);

  const visual = await client.command({
    type: 'capture_page_visual_evidence',
    request: {
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      expectedRecordVersion: acquired.page.recordVersion,
      runId
    }
  });
  assert.equal(visual.pageAlias, acquired.page.pageAlias);
  assert.equal(visual.documentGeneration, 0);
  assert.match(visual.screenshot.sha256, /^[0-9a-f]{64}$/);
  assert.equal(
    (await stat(resolve(stateDirectory, 'visual-evidence', visual.screenshot.fileName))).size,
    visual.screenshot.byteLength
  );

  await expectHostError(
    () => client.command({
      type: 'bind_strategy_observer',
      request: { ...bindingRequest, observerBindingId: randomUUID(), runId: randomUUID() }
    }),
    'managed_page_run_mismatch'
  );
  await expectHostError(
    () => client.command({
      type: 'bind_strategy_observer',
      request: {
        ...bindingRequest,
        observerBindingId: randomUUID(),
        expectedRecordVersion: bindingRequest.expectedRecordVersion + 1
      }
    }),
    'managed_page_record_version_mismatch'
  );

  const afterBinding = onlyProfile(asSnapshot(await client.command({ type: 'get_snapshot' })));
  const managedPage = afterBinding.pages.find((page) => page.pageAlias === acquired.page.pageAlias);
  assert.equal(afterBinding.livePlatformRequests, 0);
  assert.equal(managedPage?.documentGeneration, 0);
  assert.equal(managedPage?.extensionTabBound, true);
  assert.equal(managedPage?.activeLease?.pageLeaseId, acquired.lease.pageLeaseId);

  await client.command({
    type: 'release_page',
    request: {
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      disposition: 'quarantined',
      quarantineReason: 'test_scoped_strategy_binding_cleanup'
    }
  });
  released = true;
  await client.command({ type: 'close_profile', profileId });
  const shutdown = await client.command({ type: 'shutdown_host' });
  assert.equal(shutdown.ok, true);
  client.close();
  client = null;
  await waitForExit(endpoint.processId, endpointPath, 15_000);

  assert.equal((await readdir(resolve(stateDirectory, 'native-hosts')).catch(() => [])).length, 0);
  console.log(JSON.stringify({
    ok: true,
    gate: 'browser-host-real-chromium-strategy-observer-binding',
    platformNavigationCount: 0,
    livePlatformRequests: 0,
    browserMode: 'headless_test_scoped',
    nativeMessagingBridgeConnected: true,
    hostCreatedPageBoundToOneExtensionTab: true,
    hostToExtensionStrategyCommandRoundTripCompleted: true,
    videoDetailDomOnlyBindingRoundTripCompleted: true,
    videoDetailBindingDiagnosticRoundTripCompleted: true,
    accountVideoInventoryDomOnlyBindingRoundTripCompleted: true,
    priorBindingReplacedWithoutPlatformNavigation: true,
    observerBindingCorrelationVerified: true,
    postObservationVisualEvidenceCaptured: true,
    runLeaseMismatchRejectedBeforeExtensionDispatch: true,
    recordVersionMismatchRejectedBeforeExtensionDispatch: true,
    testScopedExplicitCleanup: true
  }, null, 2));
} finally {
  if (client && acquired && !released) {
    await client.command({
      type: 'release_page',
      request: {
        profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        disposition: 'quarantined',
        quarantineReason: 'test_scoped_strategy_binding_cleanup'
      }
    }).catch(() => undefined);
  }
  if (client && endpoint && await processAlive(endpoint.processId)) {
    await client.command({ type: 'close_profile', profileId }).catch(() => undefined);
    await client.command({ type: 'shutdown_host' }).catch(() => undefined);
    client.close();
    client = null;
  }
  if (endpoint && await processAlive(endpoint.processId)) {
    process.kill(endpoint.processId, 'SIGTERM');
  }
  if (browserProcessId && await processAlive(browserProcessId)) {
    process.kill(browserProcessId, 'SIGTERM');
  }
  await rm(runtimeRoot, { recursive: true, force: true });
}
