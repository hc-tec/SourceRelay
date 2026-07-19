import type {
  DetailCapabilityValidationRunSnapshot,
  VisibleDetailCollectionResult,
  VisiblePageState
} from '../shared/protocol';
import { COLLECTOR_CORE_VERSION } from '../shared/protocol';
import { resolveDetailStrategy, strategyProvenance } from '../shared/strategy-registry';

const DETAIL_VALIDATION_KEY_PREFIX = 'collector.detail-capability-validation.';
const DETAIL_VALIDATION_TTL_MS = 45_000;
const terminalStates = new Set(['completed', 'inconclusive', 'failed']);

function validationKey(runId: string): string {
  return `${DETAIL_VALIDATION_KEY_PREFIX}${runId}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalBilibiliVideoUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.hostname === 'www.bilibili.com' && url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
    if (url.protocol !== 'https:' || !match || url.username || url.password || url.search || url.hash) return null;
    return `https://www.bilibili.com/video/${match[1]}`;
  } catch {
    return null;
  }
}

function isDetailValidation(value: unknown): value is DetailCapabilityValidationRunSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DetailCapabilityValidationRunSnapshot>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.collectorVersion === 'string' &&
    typeof candidate.runId === 'string' &&
    typeof candidate.profileId === 'string' &&
    candidate.platform === 'bilibili' &&
    candidate.accountCategory === 'anonymous' &&
    candidate.evidenceObjective === 'detail_read' &&
    Boolean(candidate.strategy) &&
    typeof candidate.targetUrlDigest === 'string' &&
    typeof candidate.navigationUrlDigest === 'string' &&
    typeof candidate.windowId === 'number' &&
    typeof candidate.tabId === 'number' &&
    typeof candidate.state === 'string' &&
    typeof candidate.startedAt === 'string' &&
    typeof candidate.expiresAt === 'string'
  );
}

async function storedRuns(): Promise<DetailCapabilityValidationRunSnapshot[]> {
  const stored = await chrome.storage.session.get(null);
  return Object.entries(stored)
    .filter(([key]) => key.startsWith(DETAIL_VALIDATION_KEY_PREFIX))
    .map(([, value]) => value)
    .filter(isDetailValidation);
}

async function saveRun(run: DetailCapabilityValidationRunSnapshot): Promise<void> {
  await chrome.storage.session.set({ [validationKey(run.runId)]: run });
}

export async function getDetailCapabilityValidationRun(
  runId: string
): Promise<DetailCapabilityValidationRunSnapshot | null> {
  const key = validationKey(runId);
  const value = (await chrome.storage.session.get(key))[key];
  if (!isDetailValidation(value)) return null;
  if (!terminalStates.has(value.state) && Date.parse(value.expiresAt) <= Date.now()) {
    const expired: DetailCapabilityValidationRunSnapshot = {
      ...value,
      state: 'inconclusive',
      terminalStatus: 'source_unavailable',
      errorCode: 'detail_validation_run_timed_out',
      completedAt: new Date().toISOString()
    };
    await saveRun(expired);
    return expired;
  }
  return value;
}

export async function createDetailCapabilityValidationRun(input: {
  runId: string;
  profileId: string;
  canonicalUrl: string;
}): Promise<DetailCapabilityValidationRunSnapshot> {
  const canonicalUrl = canonicalBilibiliVideoUrl(input.canonicalUrl);
  if (!canonicalUrl) throw new Error('detail_validation_url_invalid');
  if ((await getDetailCapabilityValidationRun(input.runId)) !== null) {
    throw new Error('detail_validation_run_already_exists');
  }
  if ((await storedRuns()).some((run) => !terminalStates.has(run.state))) {
    throw new Error('detail_validation_run_already_active');
  }
  const strategy = resolveDetailStrategy('bilibili');
  const hasPermission = await chrome.permissions.contains({
    origins: [...strategy.browser.optionalHostPermissions]
  });
  if (!hasPermission) throw new Error('detail_validation_host_permission_required');

  const createdWindow = await chrome.windows.create({ url: 'about:blank', focused: true, type: 'normal' });
  const tab = createdWindow?.tabs?.[0];
  if (typeof createdWindow?.id !== 'number' || typeof tab?.id !== 'number') {
    if (typeof createdWindow?.id === 'number') await chrome.windows.remove(createdWindow.id).catch(() => undefined);
    throw new Error('detail_validation_window_creation_failed');
  }
  const startedAt = new Date();
  const targetDigest = await sha256(canonicalUrl);
  const run: DetailCapabilityValidationRunSnapshot = {
    schemaVersion: 1,
    collectorVersion: COLLECTOR_CORE_VERSION,
    runId: input.runId,
    profileId: input.profileId,
    platform: 'bilibili',
    accountCategory: 'anonymous',
    evidenceObjective: 'detail_read',
    strategy: strategyProvenance(strategy),
    targetUrlDigest: targetDigest,
    navigationUrlDigest: targetDigest,
    windowId: createdWindow.id,
    tabId: tab.id,
    state: 'navigating',
    terminalStatus: null,
    errorCode: null,
    startedAt: startedAt.toISOString(),
    expiresAt: new Date(startedAt.getTime() + DETAIL_VALIDATION_TTL_MS).toISOString(),
    completedAt: null,
    result: null
  };
  await saveRun(run);
  try {
    await chrome.tabs.update(tab.id, { url: canonicalUrl, active: true });
  } catch (error) {
    await completeDetailValidationWithError(run.runId, 'source_unavailable', 'detail_validation_navigation_failed');
    await chrome.windows.remove(createdWindow.id).catch(() => undefined);
    throw error;
  }
  return run;
}

export async function detailCapabilityValidationRunForTab(
  tabId: number
): Promise<DetailCapabilityValidationRunSnapshot | null> {
  const run = (await storedRuns()).find((candidate) => candidate.tabId === tabId);
  return run ? getDetailCapabilityValidationRun(run.runId) : null;
}

export async function activeDetailCapabilityValidationRunForSender(
  tabId: number,
  senderUrl: string | undefined,
  documentId: string | undefined
): Promise<DetailCapabilityValidationRunSnapshot | null> {
  if (!senderUrl || !documentId) return null;
  const canonicalSender = canonicalBilibiliVideoUrl(senderUrl);
  const run = await detailCapabilityValidationRunForTab(tabId);
  if (!canonicalSender || !run || terminalStates.has(run.state)) return null;
  if ((await sha256(canonicalSender)) !== run.navigationUrlDigest) return null;
  if (run.documentId && run.documentId !== documentId) return null;
  const bound: DetailCapabilityValidationRunSnapshot = { ...run, documentId, state: 'collecting' };
  await saveRun(bound);
  return bound;
}

function validDetailResult(
  result: VisibleDetailCollectionResult,
  run: DetailCapabilityValidationRunSnapshot
): boolean {
  const canonicalSource = canonicalBilibiliVideoUrl(result.sourceUrl);
  return (
    result.schemaVersion === 1 &&
    result.platform === 'bilibili' &&
    result.operation === 'detail_read' &&
    result.partial === true &&
    result.strategy?.strategyId === run.strategy.strategyId &&
    result.strategy.version === run.strategy.version &&
    canonicalSource !== null &&
    result.itemCount === (result.detail ? 1 : 0) &&
    (result.detail === null || (
      result.detail.contentType === 'video' &&
      result.detail.canonicalUrl === canonicalSource &&
      /^BV[0-9A-Za-z]{10}$/.test(result.detail.contentId) &&
      typeof result.detail.title === 'string' &&
      result.detail.title.length > 0 &&
      result.detail.title.length <= 500 &&
      result.detail.publishedText !== null &&
      result.detail.visibleMetrics.length >= 2 &&
      result.detail.visibleMetrics.length <= 20 &&
      (result.detail.description !== null || result.detail.creator !== null) &&
      result.detail.tags.length <= 20
    ))
  );
}

function terminalOutcome(pageState: VisiblePageState): {
  state: 'completed' | 'inconclusive';
  terminalStatus: NonNullable<DetailCapabilityValidationRunSnapshot['terminalStatus']>;
  errorCode: string | null;
} {
  switch (pageState) {
    case 'results_visible':
      return { state: 'completed', terminalStatus: 'completed', errorCode: null };
    case 'no_results_visible':
      return { state: 'inconclusive', terminalStatus: 'no_results', errorCode: 'detail_validation_no_result' };
    case 'authentication_required':
      return { state: 'inconclusive', terminalStatus: 'authentication_required', errorCode: 'detail_validation_authentication_required' };
    case 'verification_required':
      return { state: 'inconclusive', terminalStatus: 'verification_required', errorCode: 'detail_validation_verification_required' };
    case 'rate_limited':
      return { state: 'inconclusive', terminalStatus: 'rate_limited', errorCode: 'detail_validation_rate_limited' };
    case 'source_unavailable':
      return { state: 'inconclusive', terminalStatus: 'source_unavailable', errorCode: 'detail_validation_source_unavailable' };
    case 'layout_unrecognized':
      return { state: 'inconclusive', terminalStatus: 'layout_changed', errorCode: 'detail_validation_layout_unrecognized' };
  }
}

export async function completeDetailCapabilityValidationRun(
  runId: string,
  result: VisibleDetailCollectionResult
): Promise<DetailCapabilityValidationRunSnapshot> {
  const run = await getDetailCapabilityValidationRun(runId);
  if (!run) throw new Error('detail_validation_run_not_found');
  if (terminalStates.has(run.state)) return run;
  if (!validDetailResult(result, run)) {
    return completeDetailValidationWithError(runId, 'failed', 'detail_validation_result_invalid');
  }
  const outcome = terminalOutcome(result.pageState);
  if (outcome.state === 'completed' && !result.detail) {
    return completeDetailValidationWithError(runId, 'layout_changed', 'detail_validation_empty_result');
  }
  const completed: DetailCapabilityValidationRunSnapshot = {
    ...run,
    ...outcome,
    completedAt: new Date().toISOString(),
    result
  };
  await saveRun(completed);
  return completed;
}

export async function completeDetailValidationWithError(
  runId: string,
  terminalStatus: NonNullable<DetailCapabilityValidationRunSnapshot['terminalStatus']>,
  errorCode: string
): Promise<DetailCapabilityValidationRunSnapshot> {
  const run = await getDetailCapabilityValidationRun(runId);
  if (!run) throw new Error('detail_validation_run_not_found');
  const completed: DetailCapabilityValidationRunSnapshot = {
    ...run,
    state: terminalStatus === 'failed' ? 'failed' : 'inconclusive',
    terminalStatus,
    errorCode,
    completedAt: new Date().toISOString()
  };
  await saveRun(completed);
  return completed;
}

export async function markDetailValidationTabChanged(tabId: number, changedUrl: string): Promise<void> {
  const run = await detailCapabilityValidationRunForTab(tabId);
  if (!run || terminalStates.has(run.state)) return;
  const canonical = canonicalBilibiliVideoUrl(changedUrl);
  if (!canonical || (await sha256(canonical)) !== run.navigationUrlDigest) {
    await completeDetailValidationWithError(run.runId, 'layout_changed', 'detail_validation_context_changed');
  }
}

export async function markDetailValidationWindowClosed(windowId: number): Promise<void> {
  const runs = await storedRuns();
  await Promise.all(runs
    .filter((run) => run.windowId === windowId && !terminalStates.has(run.state))
    .map((run) => completeDetailValidationWithError(
      run.runId,
      'cancelled_partial',
      'detail_validation_window_closed'
    )));
}

export async function markDetailValidationTabClosed(tabId: number): Promise<void> {
  const run = await detailCapabilityValidationRunForTab(tabId);
  if (run && !terminalStates.has(run.state)) {
    await completeDetailValidationWithError(run.runId, 'cancelled_partial', 'detail_validation_tab_closed');
  }
}

export async function invalidateDetailValidationsWithoutPermissions(): Promise<void> {
  const runs = await storedRuns();
  const strategy = resolveDetailStrategy('bilibili');
  for (const run of runs.filter((candidate) => !terminalStates.has(candidate.state))) {
    const granted = await chrome.permissions.contains({ origins: [...strategy.browser.optionalHostPermissions] });
    if (!granted) {
      await completeDetailValidationWithError(
        run.runId,
        'capability_unavailable',
        'detail_validation_permission_revoked'
      );
    }
  }
}
