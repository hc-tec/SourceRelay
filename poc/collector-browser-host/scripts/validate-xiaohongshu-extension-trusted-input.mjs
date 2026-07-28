import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { BrowserHostClient } from '../dist/client.js';

const pocRoot = resolve(import.meta.dirname, '..', '..');
const endpointPath = resolve(pocRoot, 'runtime', 'xiaohongshu-validation', 'host', 'endpoint.json');
const profileId = 'xiaohongshu_validation';
const exploreUrl = 'https://www.xiaohongshu.com/explore';
const query = '咖啡豆';
const timeline = [];
let client = null;
let acquired = null;
let released = false;

try {
  client = await BrowserHostClient.connect(endpointPath, 'xiaohongshu-extension-trusted-input-canary');
  const profile = profileFrom(await snapshot());
  if (!profile.running || profile.leasedPages !== 0) throw new Error('xiaohongshu_canary_profile_not_ready');
  const runId = randomUUID();
  acquired = await client.command({
    type: 'acquire_page',
    request: {
      profileId,
      taskId: 'xiaohongshu-extension-trusted-input-canary',
      runId,
      platform: 'xiaohongshu',
      pageRole: 'public_search',
      targetUrl: exploreUrl,
      maximumManagedPages: 1,
      leaseDurationMs: 90_000
    }
  });
  record('page_acquired', { pageAlias: acquired.page.pageAlias });
  await client.command({
    type: 'navigate_page',
    request: {
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      actionId: 'xiaohongshu-extension-explore-baseline-once',
      url: exploreUrl,
      waitUntil: 'domcontentloaded',
      timeoutMs: 25_000
    }
  }, { timeoutMs: 30_000 });
  record('explore_navigation_completed', { navigationCount: 1 });
  const baseline = await waitForStableDocument(15_000);
  const beforeVisual = await capture(baseline, runId);
  record('baseline_visible', { visualEvidenceId: beforeVisual.evidenceId });

  const result = await client.command({
    type: 'extension_trusted_xiaohongshu_search_canary',
    request: {
      schemaVersion: 1,
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      runId,
      expectedRecordVersion: baseline.recordVersion,
      expectedDocumentGeneration: baseline.documentGeneration,
      actionId: randomUUID(),
      query,
      timeoutMs: 30_000
    }
  }, { timeoutMs: 40_000 });
  if (result.state !== 'completed' || result.semanticAction.attemptCount !== 1 ||
    result.navigation.attemptCount !== 0 || result.debuggerDetached !== true ||
    result.projection?.items?.length < 1 || result.rawPayloadStored !== false ||
    result.responseUrlsStored !== false) {
    throw new Error(result.errorCode ?? 'xiaohongshu_extension_canary_postcondition_unmet');
  }
  record('extension_trusted_search_completed', {
    semanticActionCount: result.semanticAction.attemptCount,
    renderedCardCount: result.page.renderedCardCount,
    projectedItems: result.projection.items.length,
    debuggerDetached: result.debuggerDetached
  });
  const after = await leasedPage();
  const afterVisual = await capture(after, runId);
  record('visual_postcondition', { visualEvidenceId: afterVisual.evidenceId });
  const retained = await release('retained_for_review');
  if (retained.state !== 'retained_for_review') throw new Error('xiaohongshu_canary_page_not_retained');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    runId,
    inputPath: 'mv3_chrome_debugger_fixed_input_only',
    productPlatformNavigations: 0,
    validationBaselineNavigations: 1,
    semanticActions: 1,
    automaticRetries: 0,
    result,
    visualEvidence: { before: beforeVisual, after: afterVisual },
    finalPageState: retained.state,
    timeline
  })}\n`);
} catch (error) {
  await retainIfLeased().catch(() => undefined);
  process.stdout.write(`${JSON.stringify({ ok: false, error: safeErrorCode(error), timeline })}\n`);
  process.exitCode = 1;
} finally {
  client?.close();
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
  throw new Error('xiaohongshu_canary_document_stability_timeout');
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
    throw new Error('xiaohongshu_canary_page_context_changed');
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
    throw new Error('xiaohongshu_canary_snapshot_invalid');
  }
  return result;
}

function profileFrom(snapshotValue) {
  const profile = snapshotValue.profiles.find((candidate) => candidate.profileId === profileId);
  if (!profile) throw new Error('xiaohongshu_canary_profile_missing');
  return profile;
}

function record(phase, fact) {
  timeline.push({ at: new Date().toISOString(), phase, fact });
}

function safeErrorCode(error) {
  const value = error instanceof Error ? error.message : '';
  return /^[a-z0-9_.:-]{1,160}$/i.test(value) ? value : 'xiaohongshu_extension_trusted_input_canary_failed';
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
