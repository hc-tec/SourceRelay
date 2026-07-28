import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserHostClient } from '../dist/client.js';

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pocRoot = resolve(hostRoot, '..');
const endpointPath = resolve(pocRoot, 'runtime', 'xiaohongshu-validation', 'host', 'endpoint.json');
const evidencePath = resolve(pocRoot, 'runtime', 'xiaohongshu-validation', 'managed-network-last.json');
const profileId = 'xiaohongshu_validation';
const exploreUrl = 'https://www.xiaohongshu.com/explore';
const searchUrl = 'https://www.xiaohongshu.com/search_result?keyword=%E5%92%96%E5%95%A1';

let client = null;
let acquired = null;
let released = false;
const timeline = [];

try {
  client = await BrowserHostClient.connect(endpointPath, 'xiaohongshu-managed-network-validation');
  record('browser_controller_connected', 'local', { controllerHeldForWholeRun: true });
  const initial = await snapshot(client);
  const profile = profileFrom(initial);
  if (!profile.running) throw new Error('xiaohongshu_validation_profile_not_running');
  if (profile.leasedPages !== 0) throw new Error('xiaohongshu_validation_existing_page_lease');

  const runId = randomUUID();
  acquired = await client.command({
    type: 'acquire_page',
    request: {
      profileId,
      taskId: 'xiaohongshu-managed-network-validation',
      runId,
      platform: 'xiaohongshu',
      pageRole: 'public_search',
      targetUrl: exploreUrl,
      maximumManagedPages: 1,
      leaseDurationMs: 120_000
    }
  });
  if (!isAcquire(acquired)) throw new Error('xiaohongshu_validation_acquire_invalid');
  record('page_lease_acquired', 'browser', { pageAlias: acquired.page.pageAlias, runId });

  await navigateOnce('xiaohongshu-baseline-explore-once', exploreUrl);
  const baseline = await waitForStableDocument(12_000);
  record('baseline_visible', 'browser', {
    documentGeneration: baseline.documentGeneration,
    routeGeneration: baseline.routeGeneration
  });
  const baselineVisual = await captureVisual(baseline, runId);

  const armRequest = managedRequest(acquired, baseline, runId);
  const arm = await client.command({
    type: 'arm_xiaohongshu_managed_page_network_observer',
    request: armRequest
  });
  if (arm?.type !== 'xiaohongshu_managed_page_network_observer_armed' ||
    arm.pageAlias !== acquired.page.pageAlias || arm.runId !== runId ||
    arm.permissionState !== 'permission_granted' || arm.selection?.state !== 'armed_next_document') {
    throw new Error(arm?.permissionState === 'permission_required'
      ? 'xiaohongshu_validation_permission_required'
      : 'xiaohongshu_validation_arm_postcondition_unmet');
  }
  record('network_observer_armed', 'network', {
    permissionState: arm.permissionState,
    selectionState: arm.selection.state
  });

  await navigateOnce('xiaohongshu-public-search-once', searchUrl);
  await waitForStableDocument(12_000);
  // Local waiting only: allow already-triggered XHR and lazy rendering to
  // settle. No refresh, second navigation, click, scroll or automatic retry.
  await delay(3_000);
  const current = await leasedPage();
  const observation = await client.command({
    type: 'read_xiaohongshu_managed_page_network_observation',
    request: managedRequest(acquired, current, runId)
  });
  if (observation?.type !== 'xiaohongshu_managed_page_network_observation' ||
    observation.pageAlias !== acquired.page.pageAlias || observation.runId !== runId) {
    throw new Error('xiaohongshu_validation_observation_invalid');
  }
  record('network_postcondition', 'network', {
    permissionState: observation.permissionState,
    selectionState: observation.selection?.state,
    observerState: observation.observation?.observerState,
    excludedRouteCounts: observation.observation?.excludedRouteCounts,
    risk: observation.observation?.risk
  });
  const targetVisual = await captureVisual(current, runId);

  const retained = await client.command({
    type: 'release_page',
    request: {
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      disposition: 'retained_for_review'
    }
  });
  if (retained?.state !== 'retained_for_review') throw new Error('xiaohongshu_validation_page_not_retained');
  released = true;
  record('page_retained_for_review', 'browser', { state: retained.state });

  const evidence = {
    ok: true,
    schemaVersion: 1,
    runId,
    objective: 'prove exact managed PageLease to Xiaohongshu metadata observer closure',
    platform: 'xiaohongshu',
    browserMode: 'visible persistent managed validation profile',
    navigationCount: 2,
    semanticActionCount: 0,
    automaticRetryCount: 0,
    responseBodiesRead: observation.observation.responseBodiesRead,
    rawPayloadBytesRead: observation.observation.rawPayloadBytesRead,
    observation,
    visualEvidence: { baseline: baselineVisual, target: targetVisual },
    finalPage: { pageAlias: retained.pageAlias, state: retained.state },
    timeline
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ...evidence, evidencePath })}\n`);
} catch (error) {
  const errorCode = safeErrorCode(error);
  await retainIfStillLeased(errorCode).catch(() => undefined);
  const evidence = { ok: false, schemaVersion: 1, error: errorCode, timeline };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8').catch(() => undefined);
  process.stdout.write(`${JSON.stringify({ ...evidence, evidencePath })}\n`);
  process.exitCode = 1;
} finally {
  client?.close();
}

async function navigateOnce(actionId, url) {
  record('navigation_submitted', 'browser', { actionId });
  await client.command({
    type: 'navigate_page',
    request: {
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      actionId,
      url,
      waitUntil: 'domcontentloaded',
      timeoutMs: 25_000
    }
  }, { timeoutMs: 30_000 });
  record('navigation_completed', 'browser', { actionId });
}

async function captureVisual(page, runId) {
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

function managedRequest(acquire, page, runId) {
  return {
    schemaVersion: 2,
    profileId,
    pageAlias: acquire.page.pageAlias,
    pageLeaseId: acquire.lease.pageLeaseId,
    expectedRecordVersion: page.recordVersion,
    runId
  };
}

async function waitForStableDocument(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let previousGeneration = null;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const page = await leasedPage();
    if (page.documentGeneration > 0 && page.documentGeneration === previousGeneration &&
      Date.now() - stableSince >= 1_500) return page;
    if (page.documentGeneration !== previousGeneration) {
      previousGeneration = page.documentGeneration;
      stableSince = Date.now();
    }
    await delay(250);
  }
  throw new Error('xiaohongshu_validation_document_stability_timeout');
}

async function leasedPage() {
  const current = await snapshot(client);
  const page = profileFrom(current).pages?.find((candidate) => candidate?.pageAlias === acquired.page.pageAlias);
  if (!page || page.state !== 'leased' || page.activeLease?.pageLeaseId !== acquired.lease.pageLeaseId ||
    page.activeLease?.runId !== acquired.lease.runId) {
    throw new Error('xiaohongshu_validation_page_context_changed');
  }
  return page;
}

async function retainIfStillLeased(reason) {
  if (!client || !acquired || released) return;
  const current = await snapshot(client);
  const page = profileFrom(current).pages?.find((candidate) => candidate?.pageAlias === acquired.page.pageAlias);
  if (!page?.activeLease || page.activeLease.pageLeaseId !== acquired.lease.pageLeaseId) return;
  await client.command({
    type: 'release_page',
    request: {
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      disposition: 'retained_for_review'
    }
  });
  released = true;
  record('page_retained_after_failure', 'browser', { reason });
}

async function snapshot(host) {
  const value = await host.command({ type: 'get_snapshot' });
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.profiles)) {
    throw new Error('xiaohongshu_validation_snapshot_invalid');
  }
  return value;
}

function profileFrom(value) {
  const profile = value.profiles.find((candidate) => candidate?.profileId === profileId);
  if (!profile) throw new Error('xiaohongshu_validation_profile_missing');
  return profile;
}

function isAcquire(value) {
  return value && typeof value === 'object' && value.page && value.lease &&
    typeof value.page.pageAlias === 'string' && typeof value.lease.pageLeaseId === 'string' &&
    typeof value.lease.runId === 'string';
}

function record(phase, source, fact) {
  timeline.push({ at: new Date().toISOString(), phase, source, fact });
}

function safeErrorCode(error) {
  const value = error instanceof Error ? error.message : '';
  return /^[a-z0-9_.:-]{1,160}$/i.test(value) ? value : 'xiaohongshu_validation_failed';
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
