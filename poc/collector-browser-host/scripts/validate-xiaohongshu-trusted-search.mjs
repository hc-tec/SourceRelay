import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { BrowserHostClient } from '../dist/client.js';

const pocRoot = resolve(import.meta.dirname, '..', '..');
const endpointPath = resolve(pocRoot, 'runtime', 'xiaohongshu-validation', 'host', 'endpoint.json');
const profileId = 'xiaohongshu_validation';
const exploreUrl = 'https://www.xiaohongshu.com/explore';
const query = '咖啡';
let client = null;
let acquired = null;
let released = false;
const timeline = [];

try {
  client = await BrowserHostClient.connect(endpointPath, 'xiaohongshu-trusted-search-canary');
  const initial = await snapshot();
  const profile = profileFrom(initial);
  if (!profile.running || profile.leasedPages !== 0) throw new Error('xiaohongshu_canary_profile_not_ready');
  const runId = randomUUID();
  acquired = await client.command({
    type: 'acquire_page',
    request: {
      profileId,
      taskId: 'xiaohongshu-trusted-search-canary',
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
      actionId: 'xiaohongshu-explore-baseline-once',
      url: exploreUrl,
      waitUntil: 'domcontentloaded',
      timeoutMs: 25_000
    }
  }, { timeoutMs: 30_000 });
  record('explore_navigation_completed', { navigationCount: 1 });
  const baseline = await waitForStableDocument(15_000);
  const result = await client.command({
    type: 'trusted_xiaohongshu_search',
    request: {
      schemaVersion: 1,
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      runId,
      expectedRecordVersion: baseline.recordVersion,
      expectedDocumentGeneration: baseline.documentGeneration,
      actionId: 'xiaohongshu-visible-search-once',
      query,
      timeoutMs: 30_000
    }
  }, { timeoutMs: 35_000 });
  record('trusted_search_completed', {
    renderedCardCount: result.after.renderedCardCount,
    responseCount: result.network.responseCount,
    jsonResponseCount: result.network.jsonResponseCount
  });
  const current = await leasedPage();
  const observation = await client.command({
    type: 'read_xiaohongshu_managed_page_network_observation',
    request: {
      schemaVersion: 2,
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      expectedRecordVersion: current.recordVersion,
      runId
    }
  });
  const retained = await release('retained_for_review');
  if (retained.state !== 'retained_for_review') throw new Error('xiaohongshu_canary_page_not_retained');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    runId,
    inputPath: 'trusted_visible_search_control',
    directSearchUrlNavigation: false,
    platformNavigations: 1,
    semanticActions: 1,
    automaticRetries: 0,
    result,
    extensionObservation: observation,
    finalPageState: retained.state,
    timeline
  })}\n`);
} catch (error) {
  const code = safeErrorCode(error);
  await retainIfLeased().catch(() => undefined);
  process.stdout.write(`${JSON.stringify({ ok: false, error: code, timeline })}\n`);
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
  if (page?.activeLease?.pageLeaseId !== acquired.lease.pageLeaseId) return;
  await release('retained_for_review');
}

async function release(disposition) {
  const value = await client.command({
    type: 'release_page',
    request: {
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      disposition
    }
  });
  released = true;
  return value;
}

async function snapshot() {
  const value = await client.command({ type: 'get_snapshot' });
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.profiles)) {
    throw new Error('xiaohongshu_canary_snapshot_invalid');
  }
  return value;
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
  return /^[a-z0-9_.:-]{1,160}$/i.test(value) ? value : 'xiaohongshu_trusted_search_canary_failed';
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
