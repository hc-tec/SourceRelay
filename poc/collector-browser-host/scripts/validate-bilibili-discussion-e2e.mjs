import { randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';
import { BrowserHostClient } from '../dist/client.js';
import {
  browserHostEndpointPath,
  validationProfileId
} from './validation-browser-config.mjs';
import { runValidationExtensionControl } from './validate-extension-control.mjs';

const BVID = 'BV1qZSLBYEpa';
const canonicalVideoUrl = `https://www.bilibili.com/video/${BVID}`;
const testbenchOrigin = loopbackOrigin(process.env.COLLECTOR_TESTBENCH_ORIGIN ?? 'http://127.0.0.1:43128');
const controllerId = 'validation-bilibili-discussion-e2e';
const POLL_INTERVAL_MS = 1_000;
const MAX_OPERATION_POLLS = 45;

let client = null;
let acquired = null;
let released = false;

try {
  client = await BrowserHostClient.connect(browserHostEndpointPath, controllerId);
  const initial = await snapshot(client);
  const profile = profileFrom(initial);
  if (!profile.running) throw new Error('validation_discussion_profile_not_running');
  if (profile.leasedPages !== 0) throw new Error('validation_discussion_existing_page_lease');

  const runId = randomUUID();
  acquired = await client.command({
    type: 'acquire_page',
    request: {
      profileId: validationProfileId,
      taskId: 'validation-discussion-user-selected-e2e',
      runId,
      platform: 'bilibili',
      // The Host's trusted-scroll guard intentionally only accepts this
      // source-specific role.  A generic `discussion` role must never be
      // silently treated as a Bilibili video discussion page.
      pageRole: 'video_discussion',
      targetUrl: canonicalVideoUrl,
      maximumManagedPages: 1,
      leaseDurationMs: 60_000
    }
  });
  if (!isAcquire(acquired)) throw new Error('validation_discussion_acquire_invalid');

  await client.command({
    type: 'navigate_page',
    request: {
      profileId: validationProfileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      actionId: 'validation-discussion-navigate-once',
      url: canonicalVideoUrl,
      waitUntil: 'domcontentloaded',
      timeoutMs: 20_000
    }
  });
  const stableBeforeScroll = await waitForStableDocument(client, acquired, 10_000);

  const scroll = await client.command({
    type: 'scroll_page',
    request: {
      profileId: validationProfileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      runId,
      expectedRecordVersion: stableBeforeScroll.recordVersion,
      expectedDocumentGeneration: stableBeforeScroll.documentGeneration,
      actionId: 'validation-discussion-scroll-once',
      deltaY: 760,
      timeoutMs: 10_000,
      bilibiliVideoBvid: BVID
    }
  });
  if (!isScroll(scroll) || scroll.after.scrollY <= scroll.before.scrollY) {
    throw new Error('validation_discussion_scroll_postcondition_unmet');
  }

  // Waiting is local-only. It gives Bilibili's already-requested lazy module
  // a short opportunity to render without issuing a second platform input.
  await delay(3_000);
  const afterScroll = await leasedPage(client, acquired);
  await client.command({
    type: 'capture_page_visual_evidence',
    request: {
      profileId: validationProfileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      expectedRecordVersion: afterScroll.recordVersion,
      runId
    }
  });
  const retained = await client.command({
    type: 'release_page',
    request: {
      profileId: validationProfileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      disposition: 'retained_for_review'
    }
  });
  if (retained?.state !== 'retained_for_review') throw new Error('validation_discussion_page_not_retained');
  released = true;
  client.close();
  client = null;

  const control = await runValidationExtensionControl();
  const operationId = await enqueueDiscussion(control.browserBindingId);
  const terminal = await waitForTerminalOperation(operationId);
  if (terminal.state !== 'completed' || terminal.terminalReason !== 'discussion_ready') {
    throw new Error(terminal.errorCode ?? terminal.terminalReason ?? 'validation_discussion_operation_not_completed');
  }
  const artifact = await readArtifact(operationId);
  const summary = validateArtifact(artifact);

  writeJson({
    ok: true,
    target: BVID,
    browser: {
      platformNavigations: 1,
      semanticActions: 1,
      scrollBeforeY: scroll.before.scrollY,
      scrollAfterY: scroll.after.scrollY,
      pageRetainedForReview: true,
      visualEvidenceCaptured: true
    },
    extension: {
      pairingState: control.pairingState,
      discussionSelection: control.discussionSelection,
      controlTargetDisposed: control.controlTargetDisposed,
      permission: control.permission
    },
    operation: {
      state: terminal.state,
      terminalReason: terminal.terminalReason
    },
    artifact: summary
  });
} catch (error) {
  await quarantineIfLeased().catch(() => undefined);
  writeJson({ ok: false, target: BVID, error: safeErrorCode(error) });
  process.exitCode = 1;
} finally {
  client?.close();
}

async function enqueueDiscussion(browserBindingId) {
  const response = await fetch(`${testbenchOrigin}/api/operations`, {
    method: 'POST',
    headers: {
      origin: testbenchOrigin,
      'x-collector-testbench-request': '1',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      browserBindingId,
      kind: 'discussion',
      input: { bvid: BVID }
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await response.json().catch(() => null);
  const operationId = payload?.result?.operationId;
  if (!response.ok || typeof operationId !== 'string' || !isUuid(operationId)) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'validation_discussion_enqueue_failed');
  }
  return operationId;
}

async function waitForTerminalOperation(operationId) {
  for (let attempt = 0; attempt < MAX_OPERATION_POLLS; attempt += 1) {
    const response = await fetch(`${testbenchOrigin}/api/operations/${operationId}`, {
      headers: { origin: testbenchOrigin },
      signal: AbortSignal.timeout(10_000)
    });
    const payload = await response.json().catch(() => null);
    const result = payload?.result;
    if (!response.ok || !result || typeof result !== 'object') {
      throw new Error(typeof payload?.error === 'string' ? payload.error : 'validation_discussion_operation_read_failed');
    }
    if (['completed', 'partial', 'stopped', 'failed', 'expired'].includes(result.state)) {
      return result;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('validation_discussion_operation_poll_timeout');
}

async function readArtifact(operationId) {
  const response = await fetch(`${testbenchOrigin}/api/operations/${operationId}/artifact`, {
    headers: { origin: testbenchOrigin },
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.artifact?.artifact) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'validation_discussion_artifact_read_failed');
  }
  return payload.artifact.artifact;
}

function validateArtifact(artifact) {
  const provenance = artifact?.provenance;
  const result = artifact?.result;
  const rootCommentTexts = result?.observation?.rootCommentTexts;
  if (artifact?.capability !== 'bilibili.discussion' || artifact?.state !== 'completed' ||
    provenance?.executionTarget !== 'user_selected_tab' ||
    provenance?.captureMode !== 'passive_dom_projection' ||
    provenance?.responseBodies !== 'not_read' || provenance?.semanticActions !== 0 ||
    provenance?.platformNavigations !== 0 || provenance?.userSelectedTabDisposition !== 'observed' ||
    result?.navigation?.attempted !== false || result?.navigation?.attemptCount !== 0 ||
    !Array.isArray(rootCommentTexts) || rootCommentTexts.length < 1 || containsForbiddenBrowserId(artifact)) {
    throw new Error('validation_discussion_artifact_contract_unmet');
  }
  return {
    executionTarget: provenance.executionTarget,
    captureMode: provenance.captureMode,
    responseBodies: provenance.responseBodies,
    semanticActions: provenance.semanticActions,
    platformNavigations: provenance.platformNavigations,
    userSelectedTabDisposition: provenance.userSelectedTabDisposition,
    rootCommentCount: rootCommentTexts.length,
    browserIdentifiersAbsent: true
  };
}

async function waitForStableDocument(host, acquire, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let previousGeneration = null;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const page = await leasedPage(host, acquire);
    if (page.documentGeneration > 0 && page.documentGeneration === previousGeneration && Date.now() - stableSince >= 2_500) {
      return page;
    }
    if (page.documentGeneration !== previousGeneration) {
      previousGeneration = page.documentGeneration;
      stableSince = Date.now();
    }
    await delay(250);
  }
  throw new Error('validation_discussion_document_stability_timeout');
}

async function leasedPage(host, acquire) {
  const current = await snapshot(host);
  const page = profileFrom(current).pages?.find((candidate) => candidate?.pageAlias === acquire.page.pageAlias);
  if (!page || page.state !== 'leased' || page.activeLease?.pageLeaseId !== acquire.lease.pageLeaseId ||
    page.activeLease?.runId !== acquire.lease.runId) {
    throw new Error('validation_discussion_page_context_changed');
  }
  return page;
}

async function snapshot(host) {
  const value = await host.command({ type: 'get_snapshot' });
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.profiles)) {
    throw new Error('validation_discussion_snapshot_invalid');
  }
  return value;
}

function profileFrom(value) {
  const profile = value.profiles.find((candidate) => candidate?.profileId === validationProfileId);
  if (!profile) throw new Error('validation_discussion_profile_missing');
  return profile;
}

function isAcquire(value) {
  return value && typeof value === 'object' && value.page && value.lease &&
    typeof value.page.pageAlias === 'string' && typeof value.lease.pageLeaseId === 'string' &&
    typeof value.lease.runId === 'string';
}

function isScroll(value) {
  return value && typeof value === 'object' && value.schemaVersion === 1 &&
    value.before && value.after && typeof value.before.scrollY === 'number' && typeof value.after.scrollY === 'number';
}

async function quarantineIfLeased() {
  if (!client || !acquired || released) return;
  const current = await snapshot(client);
  const page = profileFrom(current).pages?.find((candidate) => candidate?.pageAlias === acquired.page.pageAlias);
  if (!page?.activeLease || page.activeLease.pageLeaseId !== acquired.lease.pageLeaseId) return;
  await client.command({
    type: 'release_page',
    request: {
      profileId: validationProfileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      disposition: 'quarantined',
      quarantineReason: 'validation_discussion_canary_failed'
    }
  });
}

function containsForbiddenBrowserId(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenBrowserId);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) =>
    key === 'tabId' || key === 'windowId' || key === 'documentId' || key === 'profileId' ||
    containsForbiddenBrowserId(nested)
  );
}

function loopbackOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('validation_discussion_loopback_origin_invalid');
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('validation_discussion_loopback_origin_invalid');
  }
  return url.origin;
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeErrorCode(error) {
  const value = error instanceof Error ? error.message : '';
  return /^[a-z0-9_.:-]{1,160}$/i.test(value) ? value : 'validation_discussion_e2e_failed';
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function writeJson(value) {
  writeSync(process.stdout.fd, `${JSON.stringify(value)}\n`, undefined, 'utf8');
}
