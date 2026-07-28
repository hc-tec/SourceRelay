import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readdir, readFile, rm, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { BrowserHostClient } from '../dist/client.js';
import { approveExactExtensionPermission } from '../../collector-extension/scripts/native-permission-harness.mjs';

const pocRoot = resolve(import.meta.dirname, '..', '..');
const endpointPath = resolve(pocRoot, 'runtime', 'xiaohongshu-validation', 'host', 'endpoint.json');
const extensionSourceDirectory = resolve(pocRoot, 'collector-extension');
const gatewayDirectory = resolve(pocRoot, 'collector-gateway');
const profileId = 'xiaohongshu_validation';
const exploreUrl = 'https://www.xiaohongshu.com/explore';
const query = process.env.COLLECTOR_XIAOHONGSHU_CANARY_QUERY ?? '咖啡豆';
const validateNoteDetail = process.argv.includes('--note-detail');
const timeline = [];
let client = null;
let gateway = null;
let stateDirectory = null;
let acquired = null;
let released = false;

try {
  const port = await availableLoopbackPort();
  const gatewayOrigin = `http://127.0.0.1:${port}`;
  stateDirectory = await mkdtemp(resolve(tmpdir(), 'collector-xiaohongshu-gateway-e2e-'));
  gateway = startGateway(port, stateDirectory);
  await waitForGateway(gatewayOrigin);
  record('gateway_started', { originRole: 'ephemeral_loopback' });

  client = await BrowserHostClient.connect(endpointPath, 'xiaohongshu-gateway-e2e');
  const profile = profileFrom(await snapshot());
  if (!profile.running || profile.leasedPages !== 0) throw new Error('xiaohongshu_gateway_e2e_profile_not_ready');

  const runId = randomUUID();
  acquired = await client.command({
    type: 'acquire_page',
    request: {
      profileId,
      taskId: 'xiaohongshu-gateway-e2e',
      runId,
      platform: 'xiaohongshu',
      pageRole: 'public_search',
      targetUrl: exploreUrl,
      maximumManagedPages: 1,
      leaseDurationMs: 120_000
    }
  });
  record('page_acquired', { pageAlias: acquired.page.pageAlias });
  await client.command({
    type: 'navigate_page',
    request: {
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      actionId: 'xiaohongshu-gateway-e2e-explore-baseline-once',
      url: exploreUrl,
      waitUntil: 'domcontentloaded',
      timeoutMs: 25_000
    }
  }, { timeoutMs: 30_000 });
  record('baseline_navigation_completed', { validationNavigations: 1 });
  const baseline = await waitForStableDocument(15_000);
  const beforeVisual = await capture(baseline, runId);
  record('baseline_visible', { visualEvidenceId: beforeVisual.evidenceId });

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
    throw new Error('xiaohongshu_gateway_e2e_pairing_postcondition_unmet');
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
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      input: { query }
    })
  }, 201);
  const operationId = dispatch.result?.operationId;
  if (!uuid(operationId)) throw new Error('xiaohongshu_gateway_e2e_operation_missing');
  record('operation_dispatched', { operationId });

  const operation = await waitForOperation(gatewayOrigin, token, operationId, 90_000);
  if (operation.state !== 'completed' || operation.terminalReason !== 'search_ready' ||
    !uuid(operation.artifact?.artifactId) || typeof operation.artifact?.retrievalPath !== 'string') {
    throw new Error(operation.errorCode ?? 'xiaohongshu_gateway_e2e_operation_not_completed');
  }
  record('operation_completed', {
    operationId,
    terminalReason: operation.terminalReason,
    artifactId: operation.artifact.artifactId
  });

  const artifactPayload = await apiJson(`${gatewayOrigin}${operation.artifact.retrievalPath}`, {
    headers: { authorization: `Bearer ${token}` }
  }, 200);
  const artifact = artifactPayload.artifact;
  assertArtifact(artifact, operationId);
  record('artifact_retrieved', {
    itemCount: artifact.summary.itemCount,
    queryDigest: artifact.queryDigest,
    rawPayloadStored: false,
    responseUrlsStored: false
  });

  let reportedOperation = operation;
  let reportedArtifact = artifact;
  if (validateNoteDetail) {
    const detailDispatch = await apiJson(`${gatewayOrigin}/v2/collect`, {
      method: 'POST',
      headers: serviceHeaders(token),
      body: JSON.stringify({
        schemaVersion: 2,
        browserBindingId: control.browserBindingId,
        platform: 'xiaohongshu',
        capability: 'xiaohongshu.note.public_detail.v1',
        executionTarget: 'existing_public_search_tab',
        input: { resultRank: 1 }
      })
    }, 201);
    const detailOperationId = detailDispatch.result?.operationId;
    if (!uuid(detailOperationId)) throw new Error('xiaohongshu_note_detail_e2e_operation_missing');
    record('note_detail_operation_dispatched', { operationId: detailOperationId, resultRank: 1 });
    const detailOperation = await waitForOperation(gatewayOrigin, token, detailOperationId, 90_000);
    if (detailOperation.state !== 'completed' || detailOperation.terminalReason !== 'note_detail_ready' ||
      !uuid(detailOperation.artifact?.artifactId) || typeof detailOperation.artifact?.retrievalPath !== 'string') {
      throw new Error(detailOperation.errorCode ?? 'xiaohongshu_note_detail_e2e_operation_not_completed');
    }
    const detailArtifactPayload = await apiJson(`${gatewayOrigin}${detailOperation.artifact.retrievalPath}`, {
      headers: { authorization: `Bearer ${token}` }
    }, 200);
    record('note_detail_artifact_diagnostics', {
      state: detailArtifactPayload.artifact?.result?.state ?? null,
      terminalReason: detailArtifactPayload.artifact?.result?.terminalReason ?? null,
      publicSurface: detailArtifactPayload.artifact?.result?.page?.publicSurface ?? null,
      captureMode: detailArtifactPayload.artifact?.result?.projection?.captureMode ?? null,
      publicTextLength: detailArtifactPayload.artifact?.result?.projection?.publicText?.length ?? 0,
      semanticActionCount: detailArtifactPayload.artifact?.result?.semanticAction?.attemptCount ?? null,
      debuggerDetached: detailArtifactPayload.artifact?.provenance?.debuggerDetached ?? null
    });
    assertNoteDetailArtifact(detailArtifactPayload.artifact, detailOperationId);
    reportedOperation = detailOperation;
    reportedArtifact = detailArtifactPayload.artifact;
    record('note_detail_artifact_retrieved', {
      captureMode: reportedArtifact.summary.captureMode,
      publicTextLength: reportedArtifact.result.projection.publicText.length,
      rawPayloadStored: false,
      responseUrlsStored: false
    });
  }

  const after = await leasedPage();
  const afterVisual = await capture(after, runId);
  record('visual_postcondition', { visualEvidenceId: afterVisual.evidenceId });
  const persistedQueryCopies = await countTextInGatewayMetadataFiles(stateDirectory, query);
  if (persistedQueryCopies !== 0) throw new Error('xiaohongshu_gateway_e2e_query_persisted');
  const retained = await release('retained_for_review');
  if (retained.state !== 'retained_for_review') throw new Error('xiaohongshu_gateway_e2e_page_not_retained');

  writeJson({
    ok: true,
    runId,
    gatewayPath: 'user_browser_api_to_signed_queue_to_production_extension',
    validatedCapability: validateNoteDetail ? 'xiaohongshu.note.public_detail.v1' : 'xiaohongshu.search.public_notes.v1',
    productPlatformNavigations: reportedArtifact.result.navigation.attemptCount,
    validationBaselineNavigations: 1,
    semanticActions: reportedArtifact.result.semanticAction.attemptCount,
    automaticPlatformRetries: 0,
    operation: {
      operationId: reportedOperation.operationId,
      state: reportedOperation.state,
      terminalReason: reportedOperation.terminalReason,
      artifactId: reportedOperation.artifact.artifactId
    },
    artifact: {
      captureMode: reportedArtifact.summary.captureMode ?? 'search_projection',
      itemCount: reportedArtifact.summary.itemCount ?? null,
      queryDigest: reportedArtifact.queryDigest ?? null,
      rawPayloadStored: reportedArtifact.provenance.rawPayloadStored,
      responseUrlsStored: reportedArtifact.provenance.responseUrlsStored,
      debuggerDetached: reportedArtifact.provenance.debuggerDetached
    },
    persistedQueryCopies,
    visualEvidence: { before: beforeVisual, after: afterVisual },
    finalPageState: retained.state,
    timeline
  });
} catch (error) {
  await retainIfLeased().catch(() => undefined);
  writeJson({ ok: false, error: safeErrorCode(error), timeline });
  process.exitCode = 1;
} finally {
  client?.close();
  if (gateway) await stopGateway(gateway);
  if (stateDirectory) await rm(stateDirectory, { recursive: true, force: true });
}

async function createPairing(origin) {
  const payload = await apiJson(`${origin}/v1/browser-bindings/pairing-sessions`, {
    method: 'POST',
    headers: sameOriginHeaders(origin),
    body: '{}'
  }, 201);
  const pairing = payload.pairing;
  if (!pairing || !/^[a-f0-9]{64}$/.test(pairing.identityFingerprint) ||
    !uuid(pairing.pairingSessionId) || !/^\d{8}$/.test(pairing.pairingCode)) {
    throw new Error('xiaohongshu_gateway_e2e_pairing_session_invalid');
  }
  return pairing;
}

async function issueClientToken(origin) {
  const payload = await apiJson(`${origin}/v2/collector-service/clients`, {
    method: 'POST',
    headers: sameOriginHeaders(origin),
    body: JSON.stringify({
      label: 'xiaohongshu-live-gateway-canary',
      scopes: ['browser-bindings:read', 'collect:execute', 'operations:read', 'artifacts:read']
    })
  }, 201);
  if (typeof payload.token !== 'string' || !/^cst_[A-Za-z0-9_-]{43}$/.test(payload.token)) {
    throw new Error('xiaohongshu_gateway_e2e_client_token_invalid');
  }
  return payload.token;
}

async function waitForOperation(origin, token, operationId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await apiJson(`${origin}/v2/collect/operations/${operationId}`, {
      headers: { authorization: `Bearer ${token}` }
    }, 200);
    const operation = payload.result;
    if (operation?.state === 'completed' || operation?.state === 'stopped' || operation?.state === 'expired') {
      return operation;
    }
    await delay(500);
  }
  throw new Error('xiaohongshu_gateway_e2e_operation_timeout');
}

function assertArtifact(artifact, operationId) {
  if (!artifact || artifact.operationId !== operationId ||
    artifact.capability !== 'xiaohongshu.search.public_notes.v1' || artifact.state !== 'completed' ||
    !/^[a-f0-9]{64}$/.test(artifact.queryDigest) || artifact.summary?.queryDigest !== artifact.queryDigest ||
    artifact.summary?.itemCount < 1 || artifact.result?.projection?.items?.length < 1 ||
    artifact.result?.navigation?.attempted !== false || artifact.result.navigation.attemptCount !== 0 ||
    artifact.result?.semanticAction?.attempted !== true || artifact.result.semanticAction.attemptCount !== 1 ||
    artifact.provenance?.rawPayloadStored !== false || artifact.provenance?.responseUrlsStored !== false ||
    artifact.provenance?.debuggerDetached !== true) {
    throw new Error('xiaohongshu_gateway_e2e_artifact_invalid');
  }
  const serialized = JSON.stringify(artifact);
  if (/"(?:url|responseUrl|route|query|header|cookie|token|rawPayload|tabId|documentId)"\s*:/i.test(serialized)) {
    throw new Error('xiaohongshu_gateway_e2e_artifact_forbidden_material');
  }
}

function assertNoteDetailArtifact(artifact, operationId) {
  if (!artifact || artifact.summary?.operationId !== operationId ||
    artifact.summary?.capability !== 'xiaohongshu.note.public_detail.v1' ||
    artifact.result?.state !== 'completed' || artifact.result?.terminalReason !== 'note_detail_ready' ||
    artifact.result?.navigation?.attempted !== false || artifact.result.navigation.attemptCount !== 0 ||
    artifact.result?.semanticAction?.attempted !== true || artifact.result.semanticAction.attemptCount !== 1 ||
    artifact.result?.page?.publicSurface !== 'note_detail_overlay' ||
    typeof artifact.result?.projection?.publicText !== 'string' || artifact.result.projection.publicText.length < 120 ||
    !['network_projection', 'dom_fallback'].includes(artifact.result.projection.captureMode) ||
    artifact.provenance?.rawPayloadStored !== false || artifact.provenance?.responseUrlsStored !== false ||
    artifact.provenance?.debuggerDetached !== true) {
    throw new Error('xiaohongshu_note_detail_e2e_artifact_invalid');
  }
  const serialized = JSON.stringify(artifact);
  if (/"(?:url|responseUrl|route|query|header|cookie|token|rawPayload|tabId|documentId|selector|script)"\s*:/i
    .test(serialized)) {
    throw new Error('xiaohongshu_note_detail_e2e_artifact_forbidden_material');
  }
}

async function waitForStableDocument(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let generation = null;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const page = await leasedPage();
    if (page.documentGeneration > 0 && page.documentGeneration === generation && Date.now() - stableSince >= 3_000) {
      return page;
    }
    if (page.documentGeneration !== generation) {
      generation = page.documentGeneration;
      stableSince = Date.now();
    }
    await delay(250);
  }
  throw new Error('xiaohongshu_gateway_e2e_document_stability_timeout');
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
    throw new Error('xiaohongshu_gateway_e2e_page_context_changed');
  }
  return page;
}

async function retainIfLeased() {
  if (!client || !acquired || released) return;
  const page = profileFrom(await snapshot()).pages.find((candidate) => candidate.pageAlias === acquired.page.pageAlias);
  if (page?.activeLease?.pageLeaseId === acquired.lease.pageLeaseId) await release('retained_for_review');
}

async function release(disposition) {
  const result = await client.command({
    type: 'release_page',
    request: { profileId, pageAlias: acquired.page.pageAlias, pageLeaseId: acquired.lease.pageLeaseId, disposition }
  });
  released = true;
  return result;
}

async function snapshot() {
  const result = await client.command({ type: 'get_snapshot' });
  if (!result || result.schemaVersion !== 1 || !Array.isArray(result.profiles)) {
    throw new Error('xiaohongshu_gateway_e2e_snapshot_invalid');
  }
  return result;
}

function profileFrom(snapshotValue) {
  const profile = snapshotValue.profiles.find((candidate) => candidate.profileId === profileId);
  if (!profile) throw new Error('xiaohongshu_gateway_e2e_profile_missing');
  return profile;
}

async function countTextInGatewayMetadataFiles(directory, needle) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    // Public result titles may naturally contain the search phrase. The
    // persistence invariant applies to queue/audit metadata, while artifact
    // structure separately forbids a raw `query` field.
    if (entry.isFile() && (await readFile(path, 'utf8')).includes(needle)) count += 1;
  }
  return count;
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

function startGateway(port, directory) {
  return spawn(process.execPath, ['dist/user-browser-server.js'], {
    cwd: gatewayDirectory,
    env: {
      ...process.env,
      COLLECTOR_GATEWAY_PORT: String(port),
      COLLECTOR_GATEWAY_STATE_DIR: directory
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

async function waitForGateway(origin) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/v1/status`);
      if (response.ok) return;
    } catch {
      // The local Gateway has not finished binding yet.
    }
    await delay(100);
  }
  throw new Error('xiaohongshu_gateway_e2e_gateway_start_timeout');
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

function record(phase, fact) {
  timeline.push({ at: new Date().toISOString(), phase, fact });
}

function uuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeErrorCode(error) {
  const value = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /^[a-z0-9_.:-]{1,160}$/i.test(value) ? value : 'xiaohongshu_gateway_e2e_failed';
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
