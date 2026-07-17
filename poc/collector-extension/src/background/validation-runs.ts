import type {
  CapabilityValidationRunSnapshot,
  VisibleCollectionResult,
  VisiblePageState
} from '../shared/protocol';
import { COLLECTOR_CORE_VERSION } from '../shared/protocol';
import { buildNativeSearchUrl } from '../shared/native-search';
import { resolveNativeSearchStrategy, strategyProvenance } from '../shared/strategy-registry';

const VALIDATION_RUN_KEY_PREFIX = 'collector.capability-validation.';
const VALIDATION_RUN_TTL_MS = 30_000;
const terminalStates = new Set(['completed', 'inconclusive', 'failed']);

function validationRunKey(runId: string): string {
  return `${VALIDATION_RUN_KEY_PREFIX}${runId}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isCapabilityValidationRun(value: unknown): value is CapabilityValidationRunSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CapabilityValidationRunSnapshot>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.collectorVersion === 'string' &&
    typeof candidate.runId === 'string' &&
    typeof candidate.profileId === 'string' &&
    candidate.platform === 'bilibili' &&
    candidate.accountCategory === 'anonymous' &&
    candidate.evidenceObjective === 'breadth_search' &&
    Boolean(candidate.strategy) &&
    typeof candidate.queryDigest === 'string' &&
    typeof candidate.navigationUrlDigest === 'string' &&
    typeof candidate.windowId === 'number' &&
    typeof candidate.tabId === 'number' &&
    typeof candidate.state === 'string' &&
    typeof candidate.startedAt === 'string' &&
    typeof candidate.expiresAt === 'string'
  );
}

async function storedRuns(): Promise<CapabilityValidationRunSnapshot[]> {
  const stored = await chrome.storage.session.get(null);
  return Object.entries(stored)
    .filter(([key]) => key.startsWith(VALIDATION_RUN_KEY_PREFIX))
    .map(([, value]) => value)
    .filter(isCapabilityValidationRun);
}

async function saveRun(run: CapabilityValidationRunSnapshot): Promise<void> {
  await chrome.storage.session.set({ [validationRunKey(run.runId)]: run });
}

export async function getCapabilityValidationRun(runId: string): Promise<CapabilityValidationRunSnapshot | null> {
  const key = validationRunKey(runId);
  const value = (await chrome.storage.session.get(key))[key];
  if (!isCapabilityValidationRun(value)) return null;
  if (!terminalStates.has(value.state) && Date.parse(value.expiresAt) <= Date.now()) {
    const expired: CapabilityValidationRunSnapshot = {
      ...value,
      state: 'inconclusive',
      terminalStatus: 'source_unavailable',
      errorCode: 'validation_run_timed_out',
      completedAt: new Date().toISOString()
    };
    await saveRun(expired);
    return expired;
  }
  return value;
}

export async function createCapabilityValidationRun(input: {
  runId: string;
  profileId: string;
  platform: 'bilibili';
  accountCategory: 'anonymous';
  query: string;
}): Promise<CapabilityValidationRunSnapshot> {
  const query = input.query.replace(/\s+/g, ' ').trim();
  if (!query || query.length > 200) throw new Error('validation_query_invalid');
  if ((await getCapabilityValidationRun(input.runId)) !== null) throw new Error('validation_run_already_exists');
  if ((await storedRuns()).some((run) => !terminalStates.has(run.state))) {
    throw new Error('validation_run_already_active');
  }

  const strategy = resolveNativeSearchStrategy(input.platform);
  const hasPermission = await chrome.permissions.contains({
    origins: [...strategy.browser.optionalHostPermissions]
  });
  if (!hasPermission) throw new Error('validation_host_permission_required');

  const navigationUrl = buildNativeSearchUrl(input.platform, query);
  const createdWindow = await chrome.windows.create({
    url: 'about:blank',
    focused: true,
    type: 'normal'
  });
  const tab = createdWindow?.tabs?.[0];
  if (typeof createdWindow?.id !== 'number' || typeof tab?.id !== 'number') {
    if (typeof createdWindow?.id === 'number') await chrome.windows.remove(createdWindow.id).catch(() => undefined);
    throw new Error('validation_window_creation_failed');
  }

  const startedAt = new Date();
  const run: CapabilityValidationRunSnapshot = {
    schemaVersion: 1,
    collectorVersion: COLLECTOR_CORE_VERSION,
    runId: input.runId,
    profileId: input.profileId,
    platform: input.platform,
    accountCategory: input.accountCategory,
    evidenceObjective: 'breadth_search',
    strategy: strategyProvenance(strategy),
    queryDigest: await sha256(query),
    navigationUrlDigest: await sha256(navigationUrl.href),
    windowId: createdWindow.id,
    tabId: tab.id,
    state: 'navigating',
    terminalStatus: null,
    errorCode: null,
    startedAt: startedAt.toISOString(),
    expiresAt: new Date(startedAt.getTime() + VALIDATION_RUN_TTL_MS).toISOString(),
    completedAt: null,
    result: null
  };
  await saveRun(run);
  try {
    await chrome.tabs.update(tab.id, { url: navigationUrl.href, active: true });
  } catch (error) {
    await completeCapabilityValidationRunWithError(run.runId, 'source_unavailable', 'validation_navigation_failed');
    await chrome.windows.remove(createdWindow.id).catch(() => undefined);
    throw error;
  }
  return run;
}

export async function capabilityValidationRunForTab(tabId: number): Promise<CapabilityValidationRunSnapshot | null> {
  const run = (await storedRuns()).find((candidate) => candidate.tabId === tabId);
  return run ? getCapabilityValidationRun(run.runId) : null;
}

export async function activeCapabilityValidationRunForSender(
  tabId: number,
  senderUrl: string | undefined,
  documentId: string | undefined
): Promise<CapabilityValidationRunSnapshot | null> {
  if (!senderUrl || !documentId) return null;
  const run = await capabilityValidationRunForTab(tabId);
  if (!run || terminalStates.has(run.state)) return null;
  if ((await sha256(senderUrl)) !== run.navigationUrlDigest) return null;
  if (run.documentId && run.documentId !== documentId) return null;
  const bound: CapabilityValidationRunSnapshot = {
    ...run,
    documentId,
    state: 'collecting'
  };
  await saveRun(bound);
  return bound;
}

function validBilibiliResult(result: VisibleCollectionResult, run: CapabilityValidationRunSnapshot): boolean {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(result.sourceUrl);
  } catch {
    return false;
  }
  return (
    result.schemaVersion === 1 &&
    result.platform === 'bilibili' &&
    result.operation === 'breadth_search' &&
    result.partial === true &&
    result.strategy?.strategyId === run.strategy.strategyId &&
    result.strategy.version === run.strategy.version &&
    sourceUrl.origin === 'https://search.bilibili.com' &&
    sourceUrl.pathname === '/all' &&
    sourceUrl.search === '' &&
    Number.isSafeInteger(result.itemCount) &&
    result.itemCount === result.items.length &&
    result.items.length <= 20 &&
    result.items.every((item, index) =>
      item.rank === index + 1 &&
      item.contentType === 'video' &&
      typeof item.title === 'string' &&
      item.title.length > 0 &&
      item.title.length <= 500 &&
      item.title.replace(/稍后再看/g, '').replace(/[\p{N}\p{P}\p{S}\p{Z}]/gu, '').length >= 2 &&
      /^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}$/.test(item.url)
    )
  );
}

function terminalOutcome(pageState: VisiblePageState): {
  state: 'completed' | 'inconclusive';
  terminalStatus: CapabilityValidationRunSnapshot['terminalStatus'];
  errorCode: string | null;
} {
  switch (pageState) {
    case 'results_visible':
      return { state: 'completed', terminalStatus: 'completed', errorCode: null };
    case 'no_results_visible':
      return { state: 'inconclusive', terminalStatus: 'no_results', errorCode: 'validation_no_results' };
    case 'authentication_required':
      return { state: 'inconclusive', terminalStatus: 'authentication_required', errorCode: 'validation_authentication_required' };
    case 'verification_required':
      return { state: 'inconclusive', terminalStatus: 'verification_required', errorCode: 'validation_verification_required' };
    case 'rate_limited':
      return { state: 'inconclusive', terminalStatus: 'rate_limited', errorCode: 'validation_rate_limited' };
    case 'source_unavailable':
      return { state: 'inconclusive', terminalStatus: 'source_unavailable', errorCode: 'validation_source_unavailable' };
    case 'layout_unrecognized':
      return { state: 'inconclusive', terminalStatus: 'layout_changed', errorCode: 'validation_layout_unrecognized' };
  }
}

export async function completeCapabilityValidationRun(
  runId: string,
  result: VisibleCollectionResult
): Promise<CapabilityValidationRunSnapshot> {
  const run = await getCapabilityValidationRun(runId);
  if (!run) throw new Error('validation_run_not_found');
  if (terminalStates.has(run.state)) return run;
  if (!validBilibiliResult(result, run)) {
    return completeCapabilityValidationRunWithError(runId, 'failed', 'validation_result_invalid');
  }
  const outcome = terminalOutcome(result.pageState);
  if (outcome.state === 'completed' && result.itemCount === 0) {
    return completeCapabilityValidationRunWithError(runId, 'layout_changed', 'validation_empty_visible_result');
  }
  const completed: CapabilityValidationRunSnapshot = {
    ...run,
    ...outcome,
    completedAt: new Date().toISOString(),
    result
  };
  await saveRun(completed);
  return completed;
}

export async function completeCapabilityValidationRunWithError(
  runId: string,
  terminalStatus: NonNullable<CapabilityValidationRunSnapshot['terminalStatus']>,
  errorCode: string
): Promise<CapabilityValidationRunSnapshot> {
  const run = await getCapabilityValidationRun(runId);
  if (!run) throw new Error('validation_run_not_found');
  const completed: CapabilityValidationRunSnapshot = {
    ...run,
    state: terminalStatus === 'failed' ? 'failed' : 'inconclusive',
    terminalStatus,
    errorCode,
    completedAt: new Date().toISOString()
  };
  await saveRun(completed);
  return completed;
}

export async function markCapabilityValidationTabChanged(tabId: number, changedUrl: string): Promise<void> {
  const run = await capabilityValidationRunForTab(tabId);
  if (!run || terminalStates.has(run.state)) return;
  if ((await sha256(changedUrl)) !== run.navigationUrlDigest) {
    await completeCapabilityValidationRunWithError(run.runId, 'layout_changed', 'validation_context_changed');
  }
}

export async function markCapabilityValidationWindowClosed(windowId: number): Promise<void> {
  const runs = await storedRuns();
  await Promise.all(runs
    .filter((run) => run.windowId === windowId && !terminalStates.has(run.state))
    .map((run) => completeCapabilityValidationRunWithError(run.runId, 'cancelled_partial', 'validation_window_closed')));
}

export async function markCapabilityValidationTabClosed(tabId: number): Promise<void> {
  const run = await capabilityValidationRunForTab(tabId);
  if (run && !terminalStates.has(run.state)) {
    await completeCapabilityValidationRunWithError(run.runId, 'cancelled_partial', 'validation_tab_closed');
  }
}

export async function invalidateCapabilityValidationsWithoutPermissions(): Promise<void> {
  const runs = await storedRuns();
  for (const run of runs.filter((candidate) => !terminalStates.has(candidate.state))) {
    const strategy = resolveNativeSearchStrategy(run.platform);
    const granted = await chrome.permissions.contains({ origins: [...strategy.browser.optionalHostPermissions] });
    if (!granted) {
      await completeCapabilityValidationRunWithError(run.runId, 'capability_unavailable', 'validation_permission_revoked');
    }
  }
}
