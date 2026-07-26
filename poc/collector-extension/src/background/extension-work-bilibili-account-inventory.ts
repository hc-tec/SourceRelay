import {
  canonicalBilibiliAccountVideoInventoryUrl,
  type BilibiliAccountInventoryDomObservation,
  type ExtensionWorkItem,
  type ExtensionWorkResult
} from '@intelligence/collector-contracts';
import { captureBilibiliAccountVideoInventoryDom } from './strategies/bilibili-account-video-inventory-dom-projection';
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

/**
 * Public UP-video MVP: one extension-owned navigation to the derived
 * `/upload/video` page and a passive first-screen card projection. Pagination,
 * scrolling, sort and filter actions remain separate registered capabilities.
 */
export async function executeBilibiliAccountInventoryExtensionWork(
  item: Extract<ExtensionWorkItem, { capability: 'bilibili.account_inventory' }>,
  lifecycle: {
    onWorkTabAcquired?(acquisition: WorkTabAcquisition): Promise<void>;
    onNavigationIntent?(): Promise<void>;
  } = {}
): Promise<Extract<ExtensionWorkResult, { capability: 'bilibili.account_inventory' }>> {
  let workTab: ExtensionWorkTabLease | null = null;
  let acquisition: WorkTabAcquisition | 'not_acquired' = 'not_acquired';
  let navigationAttempted = false;
  let observation: BilibiliAccountInventoryDomObservation | null = null;
  if (Date.parse(item.expiresAt) <= Date.now()) {
    return result(item, {
      state: 'stopped',
      errorCode: 'extension_work_expired',
      terminalReason: 'run_deadline_exceeded',
      navigationAttempted: false,
      acquisition,
      disposition: 'closed_or_missing',
      observation: null
    });
  }
  try {
    workTab = await acquireExtensionWorkTab();
    acquisition = workTab.acquisition;
    await lifecycle.onWorkTabAcquired?.(acquisition);
    await navigateExtensionWorkTabOnce(workTab, item, async () => {
      navigationAttempted = true;
      await lifecycle.onNavigationIntent?.();
    });
    const observed = await observeAccountInventory(workTab, item.input, item.expiresAt);
    observation = observed.observation;
    const disposition = observed.kind === 'ready' || observed.kind === 'incomplete' ||
      observed.terminalReason === 'source_unavailable'
      ? releaseExtensionWorkTab(workTab)
      : abandonExtensionWorkTab(workTab);
    workTab = null;
    if (observed.kind === 'ready') {
      return result(item, {
        state: 'completed',
        errorCode: null,
        terminalReason: 'inventory_ready',
        navigationAttempted,
        acquisition,
        disposition,
        observation
      });
    }
    return result(item, {
      state: observed.kind === 'incomplete' ? 'partial' : 'stopped',
      errorCode: observed.errorCode,
      terminalReason: observed.terminalReason,
      navigationAttempted,
      acquisition,
      disposition,
      observation
    });
  } catch (error) {
    const disposition = workTab
      ? navigationAttempted
        ? abandonExtensionWorkTab(workTab)
        : releaseExtensionWorkTab(workTab)
      : acquisition === 'not_acquired'
        ? 'closed_or_missing'
        : 'user_taken_over';
    const code = safeErrorCode(error);
    return result(item, {
      state: 'failed',
      errorCode: code,
      terminalReason: terminalReasonForError(code, navigationAttempted),
      navigationAttempted,
      acquisition,
      disposition,
      observation
    });
  }
}

async function observeAccountInventory(
  workTab: ExtensionWorkTabLease,
  input: Extract<ExtensionWorkItem, { capability: 'bilibili.account_inventory' }>['input'],
  expiresAt: string
): Promise<
  | { kind: 'ready'; observation: BilibiliAccountInventoryDomObservation }
  | {
    kind: 'stopped';
    observation: BilibiliAccountInventoryDomObservation | null;
    errorCode: string;
    terminalReason: 'verification_required' | 'rate_limited' | 'source_unavailable';
  }
  | {
    kind: 'incomplete';
    observation: BilibiliAccountInventoryDomObservation | null;
    errorCode: string;
    terminalReason: 'inventory_partial' | 'dom_projection_failed' | 'document_context_changed' | 'run_deadline_exceeded';
  }
> {
  const deadline = boundedBilibiliSpaceDomObservationDeadline(expiresAt);
  let pageReadyAt: number | null = null;
  let lastObservation: BilibiliAccountInventoryDomObservation | null = null;
  while (Date.now() < deadline) {
    const tab = await readExtensionWorkTab(workTab);
    if (tab.status !== 'complete') {
      await delay(BILIBILI_SPACE_DOM_OBSERVATION_INTERVAL_MS);
      continue;
    }
    if (!tab.url || canonicalBilibiliAccountVideoInventoryUrl(tab.url, 'observed_document') !== input.canonicalInventoryUrl) {
      return {
        kind: 'stopped',
        observation: null,
        errorCode: 'bilibili_account_inventory_target_not_reached',
        terminalReason: 'source_unavailable'
      };
    }
    pageReadyAt ??= Date.now();
    if (Date.now() - pageReadyAt < BILIBILI_SPACE_PAGE_SETTLE_MS) {
      await delay(BILIBILI_SPACE_DOM_OBSERVATION_INTERVAL_MS);
      continue;
    }
    let dom: Awaited<ReturnType<typeof captureBilibiliAccountVideoInventoryDom>>;
    try {
      dom = await captureBilibiliAccountVideoInventoryDom(workTab.tabId);
    } catch (error) {
      const code = safeErrorCode(error);
      return {
        kind: 'incomplete',
        observation: lastObservation,
        errorCode: code === 'account_video_inventory_strategy_document_context_changed'
          ? 'bilibili_account_inventory_document_context_changed'
          : 'bilibili_account_inventory_dom_projection_failed',
        terminalReason: code === 'account_video_inventory_strategy_document_context_changed'
          ? 'document_context_changed'
          : 'dom_projection_failed'
      };
    }
    const observation = toObservation(dom);
    lastObservation = observation;
    if (observation.risk.verificationRequired) {
      return {
        kind: 'stopped', observation,
        errorCode: 'bilibili_verification_required', terminalReason: 'verification_required'
      };
    }
    if (observation.risk.rateLimited) {
      return {
        kind: 'stopped', observation,
        errorCode: 'bilibili_rate_limited', terminalReason: 'rate_limited'
      };
    }
    if (observation.risk.sourceUnavailable) {
      return {
        kind: 'stopped', observation,
        errorCode: 'bilibili_source_unavailable', terminalReason: 'source_unavailable'
      };
    }
    if (observation.videoListVisible && observation.stableAccountId === input.stableAccountId &&
      observation.cards.some((card) => card.bvid && card.title && card.visibleText)
    ) {
      return { kind: 'ready', observation };
    }
    await delay(BILIBILI_SPACE_DOM_OBSERVATION_INTERVAL_MS);
  }
  return {
    kind: 'incomplete',
    observation: lastObservation,
    errorCode: 'bilibili_account_inventory_dom_not_ready',
    terminalReason: Date.now() >= Date.parse(expiresAt) ? 'run_deadline_exceeded' : 'inventory_partial'
  };
}

function toObservation(
  dom: Awaited<ReturnType<typeof captureBilibiliAccountVideoInventoryDom>>
): BilibiliAccountInventoryDomObservation {
  return {
    stableAccountId: dom.stableAccountId,
    videoListVisible: dom.videoListVisible,
    cards: dom.cards.map((card) => ({ ...card })),
    loginOverlayVisible: dom.loginOverlayVisible,
    risk: { ...dom.risk }
  };
}

function result(
  item: Extract<ExtensionWorkItem, { capability: 'bilibili.account_inventory' }>,
  input: {
    state: 'completed' | 'partial' | 'stopped' | 'failed';
    errorCode: string | null;
    terminalReason: Extract<ExtensionWorkResult, { capability: 'bilibili.account_inventory' }>['terminalReason'];
    navigationAttempted: boolean;
    acquisition: WorkTabAcquisition | 'not_acquired';
    disposition: WorkTabDisposition;
    observation: BilibiliAccountInventoryDomObservation | null;
  }
): Extract<ExtensionWorkResult, { capability: 'bilibili.account_inventory' }> {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.account_inventory',
    executionTarget: 'collector_work_tab',
    state: input.state,
    errorCode: input.errorCode,
    terminalReason: input.terminalReason,
    completedAt: new Date().toISOString(),
    navigation: {
      attempted: input.navigationAttempted,
      attemptCount: input.navigationAttempted ? 1 : 0
    },
    workTabAcquisition: input.acquisition,
    workTabDisposition: input.disposition,
    observation: input.observation
  };
}

function terminalReasonForError(
  errorCode: string,
  navigationAttempted: boolean
): Extract<ExtensionWorkResult, { capability: 'bilibili.account_inventory' }>['terminalReason'] {
  if (errorCode === 'work_tab_closed') return 'work_tab_closed';
  if (errorCode === 'work_tab_user_taken_over') return 'work_tab_user_taken_over';
  if (errorCode === 'work_tab_foreground_unavailable') return 'work_tab_foreground_unavailable';
  return navigationAttempted ? 'navigation_outcome_unknown' : 'work_tab_closed';
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'extension_work_execution_failed';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
