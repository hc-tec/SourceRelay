import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserHostClient, launchBrowserHost } from '../dist/client.js';
import {
  acquireRequest,
  asAcquire,
  asReclaimPlan,
  asReclaimResult,
  asSnapshot,
  delay,
  expectHostError,
  navigateRequest,
  onlyProfile,
  processAlive,
  releaseRequest,
  waitForExit
} from './lifecycle-gate-helpers.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(root, '..');
const runId = `managed-page-pool-${Date.now()}`;
const runtimeRoot = resolve(root, 'runtime', runId);
const stateDirectory = resolve(runtimeRoot, 'host-state');
const profileRoot = resolve(runtimeRoot, 'profiles');
const endpointPath = resolve(stateDirectory, 'endpoint.json');
const extensionDirectory = resolve(workspaceRoot, 'collector-extension', 'dist');
const mainModulePath = resolve(root, 'dist', 'main.js');
const profileId = 'real-browser-lifecycle';

await mkdir(stateDirectory, { recursive: true });
await mkdir(profileRoot, { recursive: true });
const extensionManifest = JSON.parse(await readFile(resolve(extensionDirectory, 'manifest.json'), 'utf8'));
const runtimeBuild = JSON.parse(await readFile(resolve(extensionDirectory, 'runtime-build.json'), 'utf8'));
assert.equal(extensionManifest.version, '0.7.17');
assert.match(runtimeBuild.buildFingerprint, /^[a-f0-9]{64}$/);

let endpoint = null;
let client = null;
let replacementClient = null;
let cleanupClient = null;

try {
  await writeFile(endpointPath, `${JSON.stringify({
    schemaVersion: 1,
    protocolVersion: 2,
    hostInstanceId: 'stale-host',
    pipeName: process.platform === 'win32' ? '\\\\.\\pipe\\stale-collector-host' : resolve(stateDirectory, 'stale.sock'),
    nativeBridgePipeName: process.platform === 'win32'
      ? '\\\\.\\pipe\\stale-collector-native-host'
      : resolve(stateDirectory, 'stale-native.sock'),
    bootstrapSecret: 'stale-bootstrap-secret',
    processId: 2_147_483_647,
    createdAt: new Date(0).toISOString()
  })}\n`, 'utf8');
  endpoint = await launchBrowserHost({
    mainModulePath,
    stateDirectory,
    profileRoot,
    extensionDirectory,
    endpointPath,
    timeoutMs: 30_000
  });
  client = await BrowserHostClient.connect(endpointPath, 'lifecycle-gateway-a');
  const launched = await client.command({
    type: 'launch_profile',
    request: {
      profileId,
      maximumManagedPages: 3,
      // This is a real Chromium gate, but it is offline-only and does not
      // need a human-visible window.  Keeping it headless prevents the test
      // harness from looking like an unexpected browser flash/crash.
      headless: true,
      offlineOnly: true,
      extensionRuntime: {
        version: extensionManifest.version,
        controlSurfaceRevision: 15,
        runtimeBootstrapKey: 'collector.runtime-bootstrap.v1',
        buildFingerprint: runtimeBuild.buildFingerprint
      }
    }
  });
  const initial = asSnapshot(launched);
  const initialProfile = onlyProfile(initial);
  assert.equal(initial.hostProcessId, endpoint.processId);
  assert.equal(initialProfile.running, true);
  assert.equal(initialProfile.maximumManagedPages, 3);
  assert.equal(initialProfile.livePlatformRequests, 0);
  assert.ok(initialProfile.browserProcessId, 'real Chromium process id must be observable');
  assert.ok(initialProfile.extensionPages <= 1, 'Browser Session must not accumulate extension pages');
  assert.equal(initialProfile.extensionRuntime?.finalRuntimeVersion, extensionManifest.version);
  assert.equal(initialProfile.extensionRuntime?.finalControlSurfaceRevision, 15);
  assert.equal(initialProfile.extensionRuntime?.finalBuildFingerprint, runtimeBuild.buildFingerprint);
  assert.equal(initialProfile.extensionRuntime?.nativeBridgeConnected, true);

  const reusedEndpoint = await launchBrowserHost({
    mainModulePath,
    stateDirectory,
    profileRoot,
    extensionDirectory,
    endpointPath,
    timeoutMs: 30_000
  });
  assert.equal(reusedEndpoint.hostInstanceId, endpoint.hostInstanceId);
  assert.equal(reusedEndpoint.processId, endpoint.processId);
  assert.equal(reusedEndpoint.pipeName, endpoint.pipeName);
  const afterSecondLaunch = asSnapshot(await client.command({ type: 'get_snapshot' }));
  assert.equal(afterSecondLaunch.hostProcessId, initial.hostProcessId);
  assert.equal(onlyProfile(afterSecondLaunch).browserProcessId, initialProfile.browserProcessId);
  assert.equal(afterSecondLaunch.profiles.length, 1);

  const pageA = asAcquire(await client.command({
    type: 'acquire_page',
    request: acquireRequest(profileId, 'task-a', 'run-a', 'inventory', 'about:blank', { maxIdleTrustMs: 100 })
  }));
  const pageB = asAcquire(await client.command({
    type: 'acquire_page',
    request: acquireRequest(profileId, 'task-b', 'run-b', 'detail', 'about:blank#detail')
  }));
  const pageC = asAcquire(await client.command({
    type: 'acquire_page',
    request: acquireRequest(profileId, 'task-c', 'run-c', 'discussion', 'about:blank#discussion')
  }));
  assert.equal(pageA.selection, 'created_new_page');
  assert.equal(pageB.selection, 'created_new_page');
  assert.equal(pageC.selection, 'created_new_page');
  assert.equal(new Set([pageA.page.pageAlias, pageB.page.pageAlias, pageC.page.pageAlias]).size, 3);
  assert.equal(
    [pageA, pageB, pageC].every((result) => result.page.extensionTabBound),
    true,
    'Every Host-created managed page must be causally bound to one extension tab'
  );

  await expectHostError(
    () => client.command({
      type: 'acquire_page',
      request: acquireRequest(profileId, 'task-over-cap', 'run-over-cap', 'detail', 'about:blank#four')
    }),
    'page_pool_capacity_exhausted'
  );

  await client.command({
    type: 'release_page',
    request: releaseRequest(profileId, pageA, 'idle_reusable')
  });
  await delay(150);
  const staleSnapshot = onlyProfile(asSnapshot(await client.command({ type: 'get_snapshot' })));
  const stalePage = staleSnapshot.pages.find((page) => page.pageAlias === pageA.page.pageAlias);
  assert.equal(stalePage?.state, 'idle_stale');
  const reconciledPage = await client.command({
    type: 'reconcile_page',
    request: { profileId, pageAlias: pageA.page.pageAlias }
  });
  assert.equal(reconciledPage.state, 'idle_reusable');
  const reusedA = asAcquire(await client.command({
    type: 'acquire_page',
    request: acquireRequest(profileId, 'task-reuse', 'run-reuse', 'inventory', 'about:blank')
  }));
  assert.equal(reusedA.page.pageAlias, pageA.page.pageAlias);
  assert.equal(reusedA.selection, 'reused_exact_target');

  await client.command({ type: 'release_page', request: releaseRequest(profileId, reusedA, 'idle_reusable') });
  await client.command({ type: 'release_page', request: releaseRequest(profileId, pageB, 'idle_reusable') });
  await client.command({ type: 'release_page', request: releaseRequest(profileId, pageC, 'retained_for_review') });

  const reusedRetainedExact = asAcquire(await client.command({
    type: 'acquire_page',
    request: acquireRequest(profileId, 'task-retained-reuse', 'run-retained-reuse', 'discussion', 'about:blank#discussion')
  }));
  assert.equal(reusedRetainedExact.page.pageAlias, pageC.page.pageAlias);
  assert.equal(reusedRetainedExact.selection, 'reused_exact_target');
  const retainedAfterExactReuse = await client.command({
    type: 'release_page',
    request: releaseRequest(profileId, reusedRetainedExact, 'retained_for_review')
  });
  assert.equal(retainedAfterExactReuse.state, 'retained_for_review');

  const retainedVisual = await client.command({
    type: 'capture_retained_page_visual_evidence',
    request: {
      profileId,
      pageAlias: pageC.page.pageAlias,
      expectedRecordVersion: retainedAfterExactReuse.recordVersion
    }
  });
  assert.equal(retainedVisual.pageAlias, pageC.page.pageAlias);
  assert.ok(retainedVisual.screenshot.byteLength > 0);
  assert.ok((await readFile(resolve(stateDirectory, 'visual-evidence', retainedVisual.screenshot.fileName))).byteLength > 0);
  const afterRetainedVisual = onlyProfile(asSnapshot(await client.command({ type: 'get_snapshot' })));
  const retainedAfterVisual = afterRetainedVisual.pages.find((page) => page.pageAlias === pageC.page.pageAlias);
  assert.equal(retainedAfterVisual?.state, 'retained_for_review');
  assert.equal(retainedAfterVisual?.recordVersion, retainedAfterExactReuse.recordVersion);
  await expectHostError(
    () => client.command({
      type: 'capture_retained_page_visual_evidence',
      request: {
        profileId,
        pageAlias: pageC.page.pageAlias,
        expectedRecordVersion: retainedAfterExactReuse.recordVersion + 1
      }
    }),
    'retained_page_visual_evidence_record_version_mismatch'
  );

  const plan = asReclaimPlan(await client.command({
    type: 'create_reclaim_plan',
    request: { profileId, maximumPagesToClose: 1, expiresInMs: 30_000 }
  }));
  assert.equal(plan.candidates.length, 1);
  assert.notEqual(plan.candidates[0].pageAlias, pageC.page.pageAlias);
  const reclaimed = asReclaimResult(await client.command({
    type: 'execute_reclaim_plan',
    request: { reclaimPlanId: plan.reclaimPlanId }
  }));
  assert.equal(reclaimed.items.filter((item) => item.status === 'closed').length, 1);

  const replayProbe = asAcquire(await client.command({
    type: 'acquire_page',
    request: acquireRequest(profileId, 'task-command-replay', 'run-command-replay', 'inventory', null)
  }));
  const navigationBody = {
    type: 'navigate_page',
    request: navigateRequest(profileId, replayProbe, 'about:blank#command-replay', 'navigate-command-replay')
  };
  const navigationCommandId = randomUUID();
  const firstNavigation = await client.command(navigationBody, { commandId: navigationCommandId });
  assert.equal(firstNavigation.state, 'leased', 'navigation succeeds only after the Host proves its managed tab visible');
  const replayedNavigation = await client.command(navigationBody, { commandId: navigationCommandId });
  assert.deepEqual(replayedNavigation, firstNavigation, 'same command id must return cached outcome');
  await expectHostError(
    () => client.command({
      ...navigationBody,
      request: { ...navigationBody.request, url: 'about:blank#command-id-conflict' }
    }, { commandId: navigationCommandId }),
    'command_id_payload_conflict'
  );
  await client.command({
    type: 'release_page',
    request: releaseRequest(profileId, replayProbe, 'idle_reusable')
  });

  const activeBeforeDisconnect = asAcquire(await client.command({
    type: 'acquire_page',
    request: acquireRequest(profileId, 'task-disconnect', 'run-disconnect', 'detail', null)
  }));
  const beforeDisconnect = asSnapshot(await client.command({ type: 'get_snapshot' }));
  const hostPid = beforeDisconnect.hostProcessId;
  const browserSessionId = onlyProfile(beforeDisconnect).browserSessionId;
  const browserPid = onlyProfile(beforeDisconnect).browserProcessId;
  client.close();
  client = null;
  await delay(250);

  replacementClient = await BrowserHostClient.connect(endpointPath, 'lifecycle-gateway-b');
  const afterReconnect = asSnapshot(await replacementClient.command({ type: 'get_snapshot' }));
  const reconnectedProfile = onlyProfile(afterReconnect);
  assert.equal(afterReconnect.hostProcessId, hostPid);
  assert.equal(reconnectedProfile.browserSessionId, browserSessionId);
  assert.equal(reconnectedProfile.browserProcessId, browserPid);
  const disconnectedPage = reconnectedProfile.pages.find((page) => page.pageAlias === activeBeforeDisconnect.page.pageAlias);
  assert.equal(disconnectedPage?.state, 'quarantined');
  assert.equal(disconnectedPage?.quarantineReason, 'controller_disconnected');
  assert.equal(reconnectedProfile.retainedPages, 1);
  assert.equal(reconnectedProfile.livePlatformRequests, 0);
  assert.ok(reconnectedProfile.extensionPages <= 1);
  assert.equal(reconnectedProfile.extensionRuntime?.nativeBridgeConnected, true);

  await replacementClient.command({ type: 'close_profile', profileId });
  const shutdownResult = await replacementClient.command({ type: 'shutdown_host' });
  assert.equal(shutdownResult.ok, true);
  replacementClient.close();
  replacementClient = null;
  await waitForExit(endpoint.processId, endpointPath, 15_000);

  const nativeHostIdentity = createHash('sha256')
    .update(`${resolve(endpointPath)}\n${profileId}`)
    .digest('hex')
    .slice(0, 32);
  const nativeHostName = `com.intelligence.collector.p_${nativeHostIdentity}`;
  assert.equal((await readdir(resolve(stateDirectory, 'native-hosts')).catch(() => [])).length, 0);
  if (process.platform === 'win32') {
    for (const root of [
      'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
      'HKCU\\Software\\Chromium\\NativeMessagingHosts'
    ]) {
      assert.equal(await registryKeyExists(`${root}\\${nativeHostName}`), false);
    }
  }

  const journalDirectory = resolve(stateDirectory, 'journal');
  const journalNames = await import('node:fs/promises').then(({ readdir }) => readdir(journalDirectory));
  const journalText = (await Promise.all(journalNames.map((name) => readFile(resolve(journalDirectory, name), 'utf8')))).join('\n');
  for (const forbidden of ['cookie', 'authorization', 'requestHeaders', 'requestBody', 'data:text/html']) {
    assert.equal(journalText.toLowerCase().includes(forbidden.toLowerCase()), false, `journal must omit ${forbidden}`);
  }
  assert.equal(/"targetId"\s*:/.test(journalText), false, 'journal must omit raw targetId fields');

  console.log(JSON.stringify({
    ok: true,
    gate: 'browser-host-real-chromium-managed-page-lifecycle',
    livePlatformRequests: 0,
    browserMode: 'headless_test_scoped',
    extensionRuntimeMarkerVerifiedBeforeTestLaunch: true,
    nativeMessagingBridgeConnected: true,
    hostCreatedPagesBoundToExtensionTabs: true,
    nativeMessagingRegistrationCleaned: true,
    staleEndpointReplaced: true,
    repeatedLaunchReusedExistingHost: true,
    repeatedLaunchDidNotCreateSecondBrowser: true,
    gatewayDisconnectDidNotCloseBrowser: true,
    hostPidStableAcrossControllers: true,
    browserPidStableAcrossControllers: true,
    browserSessionStableAcrossControllers: true,
    threeManagedPageCapacityEnforced: true,
    releasedPageReused: true,
    idleStaleReconciledWithoutPlatformInput: true,
    retainedPageProtected: true,
    exactRetainedPageReusedWithoutNewTab: true,
    retainedPageVisualEvidenceReadOnly: true,
    activeLeaseQuarantinedOnControllerDisconnect: true,
    reclaimPlanExecutedExplicitly: true,
    commandReplayDidNotRepeatNavigation: true,
    commandIdPayloadConflictRejected: true,
    foregroundPreconditionVerifiedByRealChromium: true,
    extensionPagesAtMostOne: true,
    testScopedExplicitCleanup: true
  }, null, 2));
} finally {
  client?.close();
  replacementClient?.close();
  if (endpoint && await processAlive(endpoint.processId)) {
    try {
      cleanupClient = await BrowserHostClient.connect(endpointPath, 'lifecycle-cleanup');
      await cleanupClient.command({ type: 'close_profile', profileId }).catch(() => undefined);
      await cleanupClient.command({ type: 'shutdown_host' }).catch(() => undefined);
      cleanupClient.close();
    } catch {
      process.kill(endpoint.processId, 'SIGTERM');
    }
  }
  cleanupClient?.close();
  if (endpoint && await processAlive(endpoint.processId)) {
    try {
      await waitForExit(endpoint.processId, endpointPath, 5_000);
    } catch {
      process.kill(endpoint.processId, 'SIGTERM');
      await waitForExit(endpoint.processId, endpointPath, 5_000).catch(() => undefined);
    }
  }
  await rm(runtimeRoot, { recursive: true, force: true });
}

async function registryKeyExists(key) {
  return await new Promise((resolveQuery) => {
    execFile('reg.exe', ['QUERY', key], { windowsHide: true }, (error) => resolveQuery(!error));
  });
}
