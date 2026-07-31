import {
  canonicalBilibiliCollectionSeriesDetailWorkUrl,
  canonicalBilibiliCollectionSeriesOverviewWorkUrl,
  canonicalBilibiliDynamicWorkUrl,
  canonicalBilibiliPassiveVideoWorkUrl,
  type BilibiliCollectionSeriesDetailDomObservation,
  type BilibiliCollectionSeriesOverviewDomObservation,
  type BilibiliDanmakuDomObservation,
  type BilibiliDynamicDomObservation,
  type BilibiliPassiveExtensionWorkItem,
  type BilibiliPassiveExtensionWorkResult,
  type ExtensionWorkItem,
  type ExtensionWorkResult
} from '@intelligence/collector-contracts';
import { captureBilibiliDynamicDom } from './strategies/bilibili-dynamic-dom-projection';
import { captureBilibiliCollectionSeriesDom } from './strategies/bilibili-collection-series-dom-projection';
import { captureBilibiliCollectionSeriesDetailDom } from './strategies/bilibili-series-detail-dom-projection';
import { captureBilibiliDanmakuDom } from './strategies/bilibili-danmaku-dom-projection';
import {
  armBilibiliCollectionOverviewNetworkObservation,
  clearBilibiliCollectionOverviewNetworkObservation,
  readBilibiliCollectionOverviewNetworkObservation
} from './extension-work-bilibili-collection-network';
import {
  acquireExtensionWorkTab,
  abandonExtensionWorkTab,
  navigateExtensionWorkTabOnce,
  readExtensionWorkTab,
  releaseExtensionWorkTab,
  type ExtensionWorkTabLease,
  type WorkTabAcquisition,
  type WorkTabDisposition
} from './extension-work-tabs';
import {
  BILIBILI_SPACE_DOM_OBSERVATION_INTERVAL_MS,
  BILIBILI_SPACE_PAGE_SETTLE_MS,
  boundedBilibiliSpaceDomObservationDeadline
} from './extension-work-bilibili-space-observation';

const BILIBILI_VIDEO_PAGE_SETTLE_MS = 4_000;
const BILIBILI_VIDEO_DOM_OBSERVATION_MAX_MS = 30_000;
// A Chrome tabs/scripting promise must never keep the MV3 worker alive past
// the signed work lease. These are local command bounds, not platform retries:
// an unknown command outcome is returned once and the managed tab is abandoned
// for review by the existing catch path.
const PASSIVE_TAB_ACQUIRE_TIMEOUT_MS = 5_000;
const PASSIVE_NAVIGATION_TIMEOUT_MS = 20_000;
const PASSIVE_TAB_READ_TIMEOUT_MS = 3_000;
const PASSIVE_DOM_CAPTURE_TIMEOUT_MS = 5_000;

type PassiveItem = Extract<ExtensionWorkItem, { capability: BilibiliPassiveExtensionWorkItem['capability'] }>;
type PassiveResult = Extract<ExtensionWorkResult, { capability: BilibiliPassiveExtensionWorkItem['capability'] }>;
type PassiveObservation =
  | BilibiliDynamicDomObservation
  | BilibiliCollectionSeriesOverviewDomObservation
  | BilibiliCollectionSeriesDetailDomObservation
  | BilibiliDanmakuDomObservation;

/**
 * One common runner for the passive Bilibili additions.  Every variant owns
 * exactly one signed navigation and no semantic page input.  It deliberately
 * does not reopen a page, retry a platform action, scroll, or click a filter.
 * The collection-overview variant is the sole exception to DOM-only capture:
 * it may read one fixed, temporary sanitised response and immediately reduce
 * it to allowlisted public list identities before the result is returned.
 */
export async function executeBilibiliPassiveExtensionWork(
  item: PassiveItem,
  lifecycle: {
    onWorkTabAcquired?(acquisition: WorkTabAcquisition): Promise<void>;
    onNavigationIntent?(): Promise<void>;
  } = {}
): Promise<PassiveResult> {
  let workTab: ExtensionWorkTabLease | null = null;
  let acquisition: WorkTabAcquisition | 'not_acquired' = 'not_acquired';
  let navigationAttempted = false;
  let observation: PassiveObservation | null = null;
  let collectionOverviewNetworkTabId: number | null = null;
  if (Date.parse(item.expiresAt) <= Date.now()) {
    return result(item, {
      state: 'stopped', errorCode: 'extension_work_expired', terminalReason: 'run_deadline_exceeded',
      navigationAttempted: false, acquisition, disposition: 'closed_or_missing', observation: null
    });
  }
  try {
    workTab = await withTimeout(
      acquireExtensionWorkTab(),
      PASSIVE_TAB_ACQUIRE_TIMEOUT_MS,
      'work_tab_acquire_timeout'
    );
    acquisition = workTab.acquisition;
    if (lifecycle.onWorkTabAcquired) {
      await withTimeout(
        lifecycle.onWorkTabAcquired(acquisition),
        PASSIVE_TAB_READ_TIMEOUT_MS,
        'extension_work_lifecycle_timeout'
      );
    }
    if (item.capability === 'bilibili.collection_series.overview') {
      await armBilibiliCollectionOverviewNetworkObservation({ tabId: workTab.tabId, item });
      collectionOverviewNetworkTabId = workTab.tabId;
    }
    await withTimeout(
      navigateExtensionWorkTabOnce(workTab, item, async () => {
        navigationAttempted = true;
        if (lifecycle.onNavigationIntent) {
          await withTimeout(
            lifecycle.onNavigationIntent(),
            PASSIVE_TAB_READ_TIMEOUT_MS,
            'extension_work_lifecycle_timeout'
          );
        }
      }),
      PASSIVE_NAVIGATION_TIMEOUT_MS,
      'navigation_outcome_unknown'
    );
    const observed = await observePassiveWork(workTab, item, collectionOverviewNetworkTabId !== null);
    observation = observed.observation;
    const disposition = observed.kind === 'ready' || observed.kind === 'empty'
      ? releaseExtensionWorkTab(workTab)
      : abandonExtensionWorkTab(workTab);
    workTab = null;
    if (observed.kind === 'ready' || observed.kind === 'empty') {
      return result(item, {
        state: 'completed', errorCode: null, terminalReason: observed.terminalReason,
        navigationAttempted, acquisition, disposition, observation
      });
    }
    return result(item, {
      state: observed.kind === 'partial' ? 'partial' : 'stopped', errorCode: observed.errorCode,
      terminalReason: observed.terminalReason, navigationAttempted, acquisition, disposition, observation
    });
  } catch (error) {
    const disposition = workTab
      ? navigationAttempted
        ? abandonExtensionWorkTab(workTab)
        : releaseExtensionWorkTab(workTab)
      : acquisition === 'not_acquired'
        ? 'closed_or_missing'
        : 'user_taken_over';
    const errorCode = safeErrorCode(error);
    return result(item, {
      state: 'failed', errorCode, terminalReason: terminalReasonForError(errorCode, navigationAttempted),
      navigationAttempted, acquisition, disposition, observation
    });
  } finally {
    if (collectionOverviewNetworkTabId !== null) {
      await clearBilibiliCollectionOverviewNetworkObservation(collectionOverviewNetworkTabId).catch(() => undefined);
    }
  }
}

async function observePassiveWork(
  workTab: ExtensionWorkTabLease,
  item: PassiveItem,
  collectionOverviewNetworkArmed: boolean
): Promise<
  | { kind: 'ready'; observation: PassiveObservation; terminalReason: PassiveResult['terminalReason']; errorCode: null }
  | { kind: 'empty'; observation: PassiveObservation; terminalReason: PassiveResult['terminalReason']; errorCode: null }
  | { kind: 'partial'; observation: PassiveObservation | null; terminalReason: PassiveResult['terminalReason']; errorCode: string }
  | { kind: 'stopped'; observation: PassiveObservation | null; terminalReason: PassiveResult['terminalReason']; errorCode: string }
> {
  const deadline = observationDeadline(item.expiresAt, item.capability);
  let pageReadyAt: number | null = null;
  let lastObservation: PassiveObservation | null = null;
  while (Date.now() < deadline) {
    const tab = await withTimeout(
      readExtensionWorkTab(workTab),
      PASSIVE_TAB_READ_TIMEOUT_MS,
      'work_tab_read_timeout'
    );
    if (tab.status !== 'complete') {
      await delay(BILIBILI_SPACE_DOM_OBSERVATION_INTERVAL_MS);
      continue;
    }
    if (!tab.url || !targetReached(item, tab.url)) {
      return {
        kind: 'stopped', observation: null, errorCode: 'bilibili_passive_target_not_reached', terminalReason: 'source_unavailable'
      };
    }
    pageReadyAt ??= Date.now();
    if (Date.now() - pageReadyAt < settleDelay(item.capability)) {
      await delay(BILIBILI_SPACE_DOM_OBSERVATION_INTERVAL_MS);
      continue;
    }
    let observation: PassiveObservation;
    try {
      observation = item.capability === 'bilibili.collection_series.overview' && collectionOverviewNetworkArmed
        ? await readBilibiliCollectionOverviewNetworkObservation({
          tabId: workTab.tabId,
          item,
          deadlineMs: Math.max(1, deadline - Date.now())
        })
        : await withTimeout(
          captureObservation(item, workTab.tabId),
          PASSIVE_DOM_CAPTURE_TIMEOUT_MS,
          'bilibili_passive_dom_projection_timeout'
        );
    } catch (error) {
      const code = safeErrorCode(error);
      return {
        kind: 'partial', observation: lastObservation,
        errorCode: code === 'work_tab_closed' ? code : 'bilibili_passive_dom_projection_failed',
        terminalReason: code === 'work_tab_closed' ? 'work_tab_closed' : 'dom_projection_failed'
      };
    }
    lastObservation = observation;
    if (observation.risk.verificationRequired) {
      return { kind: 'stopped', observation, errorCode: 'bilibili_verification_required', terminalReason: 'verification_required' };
    }
    if (observation.risk.rateLimited) {
      return { kind: 'stopped', observation, errorCode: 'bilibili_rate_limited', terminalReason: 'rate_limited' };
    }
    if (observation.risk.sourceUnavailable) {
      return { kind: 'stopped', observation, errorCode: 'bilibili_source_unavailable', terminalReason: 'source_unavailable' };
    }
    const readiness = classifyObservation(item, observation);
    if (readiness) return readiness;
    await delay(BILIBILI_SPACE_DOM_OBSERVATION_INTERVAL_MS);
  }
  return {
    kind: 'partial', observation: lastObservation, errorCode: 'bilibili_passive_dom_not_ready',
    terminalReason: Date.now() >= Date.parse(item.expiresAt) ? 'run_deadline_exceeded' : partialReason(item.capability)
  };
}

async function captureObservation(item: PassiveItem, tabId: number): Promise<PassiveObservation> {
  switch (item.capability) {
    case 'bilibili.dynamic':
      return await captureBilibiliDynamicDom(tabId);
    case 'bilibili.collection_series.overview': {
      const snapshot = await captureBilibiliCollectionSeriesDom(tabId);
      return {
        stableAccountId: snapshot.stableAccountId,
        listVisible: snapshot.listVisible,
        items: snapshot.items.map((entry) => ({
          listType: entry.listType,
          stableSeriesId: entry.stableSeriesId,
          title: entry.title,
          declaredItemCount: entry.declaredItemCount,
          previewBvids: [...entry.visiblePreviewBvids]
        })),
        network: {
          routeStatus: 'not_observed',
          httpStatus: null,
          responseIdentityCount: 0,
          domMatchedItemCount: 0
        },
        loginOverlayVisible: snapshot.loginOverlayVisible,
        risk: { ...snapshot.risk }
      };
    }
    case 'bilibili.collection_series.detail': {
      const snapshot = await captureBilibiliCollectionSeriesDetailDom(tabId);
      return {
        stableAccountId: snapshot.stableAccountId,
        stableSeriesId: snapshot.stableSeriesId,
        listType: snapshot.listType,
        detailVisible: snapshot.detailVisible,
        visibleTitle: snapshot.visibleTitle,
        declaredItemCount: snapshot.declaredItemCount,
        activePageNumber: snapshot.activePageNumber,
        cards: snapshot.videoIds.map((bvid) => ({ bvid, title: snapshot.titleCandidates[bvid]?.[0] ?? null })),
        loginOverlayVisible: snapshot.loginOverlayVisible,
        risk: { ...snapshot.risk }
      };
    }
    case 'bilibili.danmaku': {
      const snapshot = await captureBilibiliDanmakuDom(tabId);
      return {
        bvid: snapshot.bvid,
        playerVisible: snapshot.playerVisible,
        danmakuOverlayVisible: snapshot.danmakuOverlayVisible,
        danmakuEnabled: snapshot.danmakuEnabled,
        overlayItems: snapshot.overlayItems.map((entry) => ({ ...entry })),
        listControlVisible: snapshot.listControlVisible,
        listOpen: snapshot.listOpen,
        listRowCount: snapshot.listRows.length,
        listTotalEstimate: snapshot.listTotalEstimate,
        loginOverlayVisible: snapshot.loginGateVisible,
        risk: { ...snapshot.risk }
      };
    }
  }
}

function classifyObservation(
  item: PassiveItem,
  observation: PassiveObservation
):
  | { kind: 'ready'; observation: PassiveObservation; terminalReason: PassiveResult['terminalReason']; errorCode: null }
  | { kind: 'empty'; observation: PassiveObservation; terminalReason: PassiveResult['terminalReason']; errorCode: null }
  | null {
  if (item.capability === 'bilibili.dynamic' && isDynamicObservation(observation)) {
    if (observation.stableAccountId !== item.input.stableAccountId || !observation.feedVisible) return null;
    return observation.cards.length > 0
      ? { kind: 'ready', observation, terminalReason: 'dynamic_ready', errorCode: null }
      : { kind: 'empty', observation, terminalReason: 'dynamic_empty', errorCode: null };
  }
  if (item.capability === 'bilibili.collection_series.overview' && isOverviewObservation(observation)) {
    if (observation.stableAccountId !== item.input.stableAccountId || !observation.listVisible ||
      observation.network.routeStatus !== 'captured'
    ) return null;
    return observation.items.length > 0
      ? { kind: 'ready', observation, terminalReason: 'collection_series_overview_ready', errorCode: null }
      : { kind: 'empty', observation, terminalReason: 'collection_series_overview_empty', errorCode: null };
  }
  if (item.capability === 'bilibili.collection_series.detail' && isDetailObservation(observation)) {
    return observation.detailVisible && observation.stableAccountId === item.input.stableAccountId &&
      observation.stableSeriesId === item.input.stableSeriesId && observation.listType === item.input.listType
      ? { kind: 'ready', observation, terminalReason: 'collection_series_detail_ready', errorCode: null }
      : null;
  }
  if (item.capability === 'bilibili.danmaku' && isDanmakuObservation(observation)) {
    return observation.playerVisible && observation.bvid === item.input.bvid
      ? { kind: 'ready', observation, terminalReason: 'danmaku_ready', errorCode: null }
      : null;
  }
  return null;
}

function targetReached(item: PassiveItem, observedUrl: string): boolean {
  switch (item.capability) {
    case 'bilibili.dynamic':
      return canonicalBilibiliDynamicWorkUrl(observedUrl, 'observed_document') === item.input.canonicalDynamicUrl;
    case 'bilibili.collection_series.overview':
      return canonicalBilibiliCollectionSeriesOverviewWorkUrl(observedUrl, 'observed_document') === item.input.canonicalOverviewUrl;
    case 'bilibili.collection_series.detail':
      return canonicalBilibiliCollectionSeriesDetailWorkUrl(observedUrl, 'observed_document') === item.input.canonicalDetailUrl;
    case 'bilibili.danmaku':
      return canonicalBilibiliPassiveVideoWorkUrl(observedUrl, 'observed_document') === item.input.canonicalVideoUrl;
  }
}

function observationDeadline(expiresAt: string, capability: PassiveItem['capability']): number {
  return capability === 'bilibili.dynamic' || capability.startsWith('bilibili.collection_series')
    ? boundedBilibiliSpaceDomObservationDeadline(expiresAt)
    : Math.min(Date.parse(expiresAt), Date.now() + BILIBILI_VIDEO_DOM_OBSERVATION_MAX_MS);
}

function settleDelay(capability: PassiveItem['capability']): number {
  return capability === 'bilibili.danmaku' ? BILIBILI_VIDEO_PAGE_SETTLE_MS : BILIBILI_SPACE_PAGE_SETTLE_MS;
}

function partialReason(capability: PassiveItem['capability']): PassiveResult['terminalReason'] {
  switch (capability) {
    case 'bilibili.dynamic':
      return 'dynamic_partial';
    case 'bilibili.collection_series.overview':
      return 'collection_series_overview_partial';
    case 'bilibili.collection_series.detail':
      return 'collection_series_detail_partial';
    case 'bilibili.danmaku':
      return 'danmaku_partial';
  }
}

function result(
  item: PassiveItem,
  input: {
    state: 'completed' | 'partial' | 'stopped' | 'failed';
    errorCode: string | null;
    terminalReason: PassiveResult['terminalReason'];
    navigationAttempted: boolean;
    acquisition: WorkTabAcquisition | 'not_acquired';
    disposition: WorkTabDisposition;
    observation: PassiveObservation | null;
  }
): PassiveResult {
  const base = {
    schemaVersion: 1 as const,
    protocolVersion: 1 as const,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'bilibili' as const,
    executionTarget: 'collector_work_tab' as const,
    state: input.state,
    errorCode: input.errorCode,
    terminalReason: input.terminalReason,
    completedAt: new Date().toISOString(),
    navigation: { attempted: input.navigationAttempted, attemptCount: (input.navigationAttempted ? 1 : 0) as 0 | 1 },
    workTabAcquisition: input.acquisition,
    workTabDisposition: input.disposition
  };
  switch (item.capability) {
    case 'bilibili.dynamic':
      return { ...base, capability: item.capability, observation: isDynamicObservation(input.observation) ? input.observation : null };
    case 'bilibili.collection_series.overview':
      return { ...base, capability: item.capability, observation: isOverviewObservation(input.observation) ? input.observation : null };
    case 'bilibili.collection_series.detail':
      return { ...base, capability: item.capability, observation: isDetailObservation(input.observation) ? input.observation : null };
    case 'bilibili.danmaku':
      return { ...base, capability: item.capability, observation: isDanmakuObservation(input.observation) ? input.observation : null };
  }
}

function terminalReasonForError(errorCode: string, navigationAttempted: boolean): PassiveResult['terminalReason'] {
  if (errorCode === 'work_tab_closed') return 'work_tab_closed';
  if (errorCode === 'work_tab_user_taken_over') return 'work_tab_user_taken_over';
  if (errorCode === 'work_tab_foreground_unavailable') return 'work_tab_foreground_unavailable';
  return navigationAttempted ? 'navigation_outcome_unknown' : 'work_tab_closed';
}

function isDynamicObservation(value: PassiveObservation | null): value is BilibiliDynamicDomObservation {
  return value !== null && 'feedVisible' in value && 'cards' in value && 'activeFilterLabel' in value;
}

function isOverviewObservation(value: PassiveObservation | null): value is BilibiliCollectionSeriesOverviewDomObservation {
  return value !== null && 'listVisible' in value && 'items' in value && !('detailVisible' in value);
}

function isDetailObservation(value: PassiveObservation | null): value is BilibiliCollectionSeriesDetailDomObservation {
  return value !== null && 'detailVisible' in value && 'stableSeriesId' in value;
}

function isDanmakuObservation(value: PassiveObservation | null): value is BilibiliDanmakuDomObservation {
  return value !== null && 'playerVisible' in value && 'danmakuOverlayVisible' in value;
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'extension_work_execution_failed';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  errorCode: string
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !/^[a-z0-9_]{1,100}$/.test(errorCode)) {
    throw new Error('extension_work_timeout_invalid');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
