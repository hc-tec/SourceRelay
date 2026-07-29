import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { BrowserHostClient } from '../dist/client.js';
import { approveExactExtensionPermission } from '../../collector-extension/scripts/native-permission-harness.mjs';

/**
 * Real, zero-navigation canary for the existing-public-profile-tab execution
 * target.  The short-lived profile-link canary has a separate runner because
 * it is allowed one navigation.  This runner deliberately refuses to navigate
 * and only adopts a page that the managed validation browser already retains.
 */
const pocRoot = resolve(import.meta.dirname, '..', '..');
const endpointPath = resolve(pocRoot, 'runtime', 'xiaohongshu-validation', 'host', 'endpoint.json');
const extensionSourceDirectory = resolve(pocRoot, 'collector-extension');
const gatewayDirectory = resolve(pocRoot, 'collector-gateway');
const profileId = 'xiaohongshu_validation';
const maximumScrolls = 3;
const validationLeaseDurationMs = 120_000;
const timeline = [];
let client = null;
let gateway = null;
let stateDirectory = null;
let acquired = null;
let released = false;

try {
  const runId = randomUUID();
  const port = await availableLoopbackPort();
  const gatewayOrigin = `http://127.0.0.1:${port}`;
  stateDirectory = await mkdtemp(resolve(tmpdir(), 'collector-xiaohongshu-profile-tab-e2e-'));
  gateway = startGateway(port, stateDirectory);
  await waitForGateway(gatewayOrigin);
  record('gateway_started', { originRole: 'ephemeral_loopback' });

  client = await BrowserHostClient.connect(endpointPath, 'xiaohongshu-profile-tab-e2e');
  const initial = profileFrom(await snapshot());
  const retained = (initial.pages ?? []).filter((page) =>
    page.state === 'retained_for_review' && page.platform === 'xiaohongshu' &&
    (page.pageRole === 'public_profile' || page.pageRole === 'public_search')
  );
  if (retained.length !== 1) {
    throw new Error(retained.length === 0
      ? 'xiaohongshu_existing_public_profile_tab_required'
      : 'xiaohongshu_existing_public_profile_tab_ambiguous');
  }
  acquired = await client.command({
    type: 'adopt_xiaohongshu_validation_public_page',
    request: {
      schemaVersion: 1,
      profileId,
      taskId: 'xiaohongshu-profile-tab-e2e',
      runId,
      leaseDurationMs: validationLeaseDurationMs
    }
  });
  record('page_adopted_without_navigation', {
    pageAlias: acquired.page.pageAlias,
    selection: acquired.selection,
    initialDocumentGeneration: acquired.page.documentGeneration,
    initialRecordVersion: acquired.page.recordVersion
  });

  const before = await leasedPage();
  const beforeVisual = await capture(before, runId);
  record('baseline_visible', { visualEvidenceId: beforeVisual.evidenceId, navigationCount: 0 });

  const pairing = await createPairing(gatewayOrigin);
  let permissionApproval = approveExactExtensionPermission(
    extensionSourceDirectory,
    '127.0.0.1',
    '127.0.0.1',
    8,
    { allowAbsence: true }
  );
  let control;
  try {
    control = await client.command({
      type: 'run_validation_extension_control',
      request: {
        schemaVersion: 1,
        profileId,
        loopbackOrigin: gatewayOrigin,
        identityFingerprint: pairing.identityFingerprint,
        pairingSessionId: pairing.pairingSessionId,
        pairingCode: pairing.pairingCode,
        selection: 'pair_only'
      }
    }, { timeoutMs: 35_000 });
    await permissionApproval;
  } finally {
    await permissionApproval.catch(() => undefined);
    permissionApproval = null;
  }
  if (control.connectionState !== 'online' || control.discussionSelection !== 'not_requested' ||
    control.controlTargetDisposed !== true) {
    throw new Error('xiaohongshu_profile_tab_e2e_pairing_postcondition_unmet');
  }
  record('extension_paired', {
    browserBindingId: control.browserBindingId,
    controlTargetDisposed: true,
    platformSelectionPerformed: false
  });

  const token = await issueClientToken(gatewayOrigin);
  const dispatch = await apiJson(`${gatewayOrigin}/v2/collect`, {
    method: 'POST',
    headers: serviceHeaders(token),
    body: JSON.stringify({
      schemaVersion: 2,
      browserBindingId: control.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.account.public_notes.v1',
      executionTarget: 'existing_public_profile_tab',
      input: { maximumScrolls }
    })
  }, 201);
  const operationId = dispatch.result?.operationId;
  if (!uuid(operationId)) throw new Error('xiaohongshu_profile_tab_e2e_operation_missing');
  record('account_notes_operation_dispatched', {
    operationId,
    executionTarget: 'existing_public_profile_tab',
    maximumScrolls,
    platformNavigationBudgetConsumed: 0
  });

  const operation = await waitForOperation(gatewayOrigin, token, operationId, 90_000);
  if (operation.state !== 'completed' || operation.terminalReason !== 'profile_notes_ready' ||
    !uuid(operation.artifact?.artifactId) || typeof operation.artifact?.retrievalPath !== 'string') {
    throw new Error(operation.errorCode ?? 'xiaohongshu_profile_tab_e2e_operation_not_completed');
  }
  const artifactPayload = await apiJson(`${gatewayOrigin}${operation.artifact.retrievalPath}`, {
    headers: { authorization: `Bearer ${token}` }
  }, 200);
  const artifact = artifactPayload.artifact;
  assertArtifact(artifact, operationId);
  record('account_notes_artifact_retrieved', {
    operationId,
    artifactId: artifact.summary.artifactId,
    itemCount: artifact.summary.itemCount,
    semanticActionCount: artifact.result.semanticAction.attemptCount,
    completedScrolls: artifact.result.scroll.completedCount,
    networkMatchedPayloadCount: artifact.result.projection.matchedPayloadCount,
    networkBodyBytesRead: artifact.result.projection.bodyBytesRead,
    rawPayloadStored: false,
    responseUrlsStored: false
  });

  const after = await leasedPage();
  const afterVisual = await capture(after, runId);
  record('visual_postcondition', { visualEvidenceId: afterVisual.evidenceId });
  await release('retained_for_review');
  record('cleanup_verified', {
    finalPageState: 'retained_for_review',
    platformNavigations: artifact.provenance.platformNavigations,
    pageReloads: artifact.provenance.pageReloads,
    pageInitiatedNewTabs: artifact.provenance.pageInitiatedNewTabs
  });

  writeJson({
    ok: true,
    runId,
    gatewayPath: 'user_browser_api_to_signed_queue_to_production_extension',
    validatedCapability: 'xiaohongshu.account.public_notes.v1',
    executionTarget: 'existing_public_profile_tab',
    validationOutcome: 'completed',
    productPlatformNavigations: artifact.provenance.platformNavigations,
    validationBaselineNavigations: 0,
    semanticActions: artifact.result.semanticAction.attemptCount,
    completedScrolls: artifact.result.scroll.completedCount,
    automaticPlatformRetries: 0,
    operation: {
      operationId,
      state: operation.state,
      terminalReason: operation.terminalReason,
      artifactId: artifact.summary.artifactId
    },
    artifact: {
      itemCount: artifact.summary.itemCount,
      networkMatchedPayloadCount: artifact.result.projection.matchedPayloadCount,
      networkBodyBytesRead: artifact.result.projection.bodyBytesRead,
      rawPayloadStored: artifact.provenance.rawPayloadStored,
      responseUrlsStored: artifact.provenance.responseUrlsStored,
      debuggerDetached: artifact.provenance.debuggerDetached
    },
    visualEvidence: {
      before: { evidenceId: beforeVisual.evidenceId, screenshot: beforeVisual.screenshot },
      after: { evidenceId: afterVisual.evidenceId, screenshot: afterVisual.screenshot }
    },
    finalPageState: 'retained_for_review',
    timeline
  });
} catch (error) {
  await retainIfLeased().catch(() => undefined);
  writeJson({
    ok: false,
    error: safeErrorCode(error),
    timeline
  });
  process.exitCode = 1;
} finally {
  client?.close();
  await stopGateway(gateway);
  if (stateDirectory) await rm(stateDirectory, { recursive: true, force: true }).catch(() => undefined);
}

function assertArtifact(artifact, operationId) {
  const actionCount = artifact?.result?.semanticAction?.attemptCount;
  if (!artifact || artifact.operationId !== operationId ||
    artifact.capability !== 'xiaohongshu.account.public_notes.v1' || artifact.state !== 'completed' ||
    artifact.summary?.itemCount < 1 || artifact.result?.terminalReason !== 'profile_notes_ready' ||
    artifact.result?.navigation?.attempted !== false || artifact.result.navigation.attemptCount !== 0 ||
    !Number.isInteger(actionCount) || actionCount < 0 || actionCount > maximumScrolls ||
    artifact.result.semanticAction.attempted !== (actionCount > 0) ||
    artifact.result?.scroll?.requestedCount !== maximumScrolls ||
    artifact.result.scroll.completedCount !== actionCount ||
    artifact.result?.page?.publicSurface !== 'public_profile' ||
    !Array.isArray(artifact.result?.projection?.items) || artifact.result.projection.items.length < 1 ||
    artifact.provenance?.executionTarget !== 'existing_public_profile_tab' ||
    artifact.provenance?.platformNavigations !== 0 || artifact.provenance?.pageReloads !== 0 ||
    artifact.provenance?.pageInitiatedNewTabs !== 0 || artifact.provenance?.rawPayloadStored !== false ||
    artifact.provenance?.responseUrlsStored !== false || artifact.provenance?.debuggerDetached !== true) {
    throw new Error('xiaohongshu_profile_tab_e2e_artifact_invalid');
  }
  if (/(?:"(?:url|responseUrl|route|query|header|cookie|token|rawPayload|tabId|documentId|profileId|selector|script)"\s*:)/i
    .test(JSON.stringify(artifact))) {
    throw new Error('xiaohongshu_profile_tab_e2e_artifact_forbidden_material');
  }
}

async function capture(page, runId) {
  return await client.command({
    type: 'capture_page_visual_evidence',
    request: {
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      expectedRecordVersion: page.recordVersion,
      runId
    }
  });
}

async function leasedPage() {
  const page = profileFrom(await snapshot()).pages.find((candidate) => candidate.pageAlias === acquired.page.pageAlias);
  if (!page || page.state !== 'leased' || page.activeLease?.pageLeaseId !== acquired.lease.pageLeaseId) {
    throw new Error('xiaohongshu_profile_tab_e2e_page_context_changed');
  }
  return page;
}

async function retainIfLeased() {
  if (!client || !acquired || released) return;
  const page = profileFrom(await snapshot()).pages.find((candidate) => candidate.pageAlias === acquired.page.pageAlias);
  if (page?.activeLease?.pageLeaseId === acquired.lease.pageLeaseId) await release('retained_for_review');
}

async function release(disposition) {
  await client.command({
    type: 'release_page',
    request: { profileId, pageAlias: acquired.page.pageAlias, pageLeaseId: acquired.lease.pageLeaseId, disposition }
  });
  released = true;
}

async function snapshot() {
  const result = await client.command({ type: 'get_snapshot' });
  if (!result || result.schemaVersion !== 1 || !Array.isArray(result.profiles)) {
    throw new Error('xiaohongshu_profile_tab_e2e_snapshot_invalid');
  }
  return result;
}

function profileFrom(value) {
  const profile = value.profiles.find((candidate) => candidate.profileId === profileId);
  if (!profile) throw new Error('xiaohongshu_profile_tab_e2e_profile_missing');
  return profile;
}

async function createPairing(origin) {
  const payload = await apiJson(`${origin}/v1/browser-bindings/pairing-sessions`, {
    method: 'POST', headers: sameOriginHeaders(origin), body: '{}'
  }, 201);
  const pairing = payload.pairing;
  if (!pairing || !/^[a-f0-9]{64}$/.test(pairing.identityFingerprint) ||
    !uuid(pairing.pairingSessionId) || !/^\d{8}$/.test(pairing.pairingCode)) {
    throw new Error('xiaohongshu_profile_tab_e2e_pairing_invalid');
  }
  return pairing;
}

async function issueClientToken(origin) {
  const payload = await apiJson(`${origin}/v2/collector-service/clients`, {
    method: 'POST', headers: sameOriginHeaders(origin),
    body: JSON.stringify({
      label: 'xiaohongshu-profile-tab-live-canary',
      scopes: ['browser-bindings:read', 'collect:execute', 'operations:read', 'artifacts:read']
    })
  }, 201);
  if (typeof payload.token !== 'string' || !/^cst_[A-Za-z0-9_-]{43}$/.test(payload.token)) {
    throw new Error('xiaohongshu_profile_tab_e2e_client_token_invalid');
  }
  return payload.token;
}

async function waitForOperation(origin, token, operationId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await apiJson(`${origin}/v2/collect/operations/${operationId}`, {
      headers: { authorization: `Bearer ${token}` }
    }, 200);
    if (payload.result?.state === 'completed' || payload.result?.state === 'stopped' ||
      payload.result?.state === 'expired') return payload.result;
    await delay(500);
  }
  throw new Error('xiaohongshu_profile_tab_e2e_operation_timeout');
}

async function apiJson(url, init, expectedStatus) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const payload = await response.json().catch(() => null);
  if (response.status !== expectedStatus || !payload) {
    throw new Error(safeErrorCode(payload?.error ?? `http_${response.status}`));
  }
  return payload;
}

function sameOriginHeaders(origin) {
  return { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
}

function serviceHeaders(token) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

function startGateway(port, directory) {
  return spawn(process.execPath, ['dist/user-browser-server.js'], {
    cwd: gatewayDirectory,
    env: { ...process.env, COLLECTOR_GATEWAY_PORT: String(port), COLLECTOR_GATEWAY_STATE_DIR: directory },
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
      // The temporary Gateway is still binding.
    }
    await delay(100);
  }
  throw new Error('xiaohongshu_profile_tab_e2e_gateway_start_timeout');
}

async function stopGateway(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  const exited = await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => resolvePromise(false), 5_000);
    child.once('exit', () => { clearTimeout(timeout); resolvePromise(true); });
  });
  if (!exited && child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise((resolvePromise) => {
      const timeout = setTimeout(resolvePromise, 1_000);
      child.once('exit', () => { clearTimeout(timeout); resolvePromise(); });
    });
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
}

async function availableLoopbackPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  if (!address || typeof address === 'string' || address.port < 1024) throw new Error('loopback_port_unavailable');
  return address.port;
}

function record(phase, fact) {
  timeline.push({ at: new Date().toISOString(), phase, fact });
}

function safeErrorCode(error) {
  const value = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /^[a-z0-9_.:-]{1,160}$/i.test(value) ? value : 'xiaohongshu_profile_tab_e2e_failed';
}

function uuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
