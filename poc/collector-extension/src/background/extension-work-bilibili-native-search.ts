import {
  type BilibiliNativeSearchDomObservation,
  type ExtensionWorkItem,
  type ExtensionWorkResult
} from '@intelligence/collector-contracts';
import { observeBilibiliNativeSearchPage } from './extension-work-bilibili-native-search-page-observation';
import type { BilibiliNativeSearchDomSnapshot } from './strategies/bilibili-native-search-dom-projection';
import {
  acquireExtensionWorkTab,
  abandonExtensionWorkTab,
  navigateExtensionWorkTabOnce,
  releaseExtensionWorkTab,
  type ExtensionWorkTabLease,
  type WorkTabAcquisition,
  type WorkTabDisposition
} from './extension-work-tabs';

/**
 * Direct native-search MVP: one signed navigation to the fixed public
 * comprehensive first page, followed by a bounded DOM-only projection. It
 * never clicks search, changes sort/type, scrolls, paginates, or reads a
 * network response body.
 */
export async function executeBilibiliNativeSearchExtensionWork(
  item: Extract<ExtensionWorkItem, { capability: 'bilibili.native_search' }>,
  lifecycle: {
    onWorkTabAcquired?(acquisition: WorkTabAcquisition): Promise<void>;
    onNavigationIntent?(): Promise<void>;
  } = {}
): Promise<Extract<ExtensionWorkResult, { capability: 'bilibili.native_search' }>> {
  let workTab: ExtensionWorkTabLease | null = null;
  let acquisition: WorkTabAcquisition | 'not_acquired' = 'not_acquired';
  let navigationAttempted = false;
  let observation: BilibiliNativeSearchDomObservation | null = null;
  if (Date.parse(item.expiresAt) <= Date.now()) {
    return result(item, {
      state: 'stopped',
      errorCode: 'extension_work_expired',
      terminalReason: 'run_deadline_exceeded',
      navigationAttempted: false,
      acquisition: 'not_acquired',
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
    const observed = await observeNativeSearch(workTab, item.input.canonicalSearchUrl, item.expiresAt);
    observation = observed.observation;
    const disposition = observed.kind === 'ready' || observed.kind === 'empty'
      ? releaseExtensionWorkTab(workTab)
      : abandonExtensionWorkTab(workTab);
    workTab = null;
    if (observed.kind === 'ready') {
      return result(item, {
        state: 'completed',
        errorCode: null,
        terminalReason: 'search_ready',
        navigationAttempted,
        acquisition,
        disposition,
        observation
      });
    }
    if (observed.kind === 'empty') {
      return result(item, {
        state: 'completed',
        errorCode: null,
        terminalReason: 'search_empty',
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

async function observeNativeSearch(
  workTab: ExtensionWorkTabLease,
  expectedCanonicalSearchUrl: string,
  expiresAt: string
): Promise<
  | { kind: 'ready'; observation: BilibiliNativeSearchDomObservation }
  | { kind: 'empty'; observation: BilibiliNativeSearchDomObservation }
  | {
    kind: 'stopped';
    observation: BilibiliNativeSearchDomObservation | null;
    errorCode: string;
    terminalReason: 'verification_required' | 'rate_limited' | 'source_unavailable';
  }
  | {
    kind: 'incomplete';
    observation: BilibiliNativeSearchDomObservation | null;
    errorCode: string;
    terminalReason: 'search_results_partial' | 'dom_projection_failed' | 'document_context_changed' | 'run_deadline_exceeded';
  }
> {
  const outcome = await observeBilibiliNativeSearchPage({
    workTab,
    expectedCanonicalSearchUrl,
    expiresAt
  });
  const observation = outcome.dom ? toObservation(outcome.dom) : null;
  if (outcome.kind === 'ready' || outcome.kind === 'empty') {
    return { kind: outcome.kind, observation: observation! };
  }
  return {
    kind: outcome.kind,
    observation,
    errorCode: outcome.errorCode,
    terminalReason: outcome.terminalReason
  };
}

function toObservation(
  dom: BilibiliNativeSearchDomSnapshot
): BilibiliNativeSearchDomObservation | null {
  if (dom.resultType !== 'comprehensive' || dom.sort !== 'relevance') return null;
  return {
    searchInputVisible: dom.searchInputVisible,
    resultListVisible: dom.resultListVisible,
    emptyStateVisible: dom.emptyStateVisible,
    resultType: 'comprehensive',
    sort: 'relevance',
    page: 1,
    semanticResultCardCount: dom.semanticResultCardCount,
    cards: dom.cards.map((card) => ({ ...card })),
    loginOverlayVisible: dom.loginOverlayVisible,
    risk: { ...dom.risk }
  };
}

function result(
  item: Extract<ExtensionWorkItem, { capability: 'bilibili.native_search' }>,
  input: {
    state: 'completed' | 'partial' | 'stopped' | 'failed';
    errorCode: string | null;
    terminalReason: Extract<ExtensionWorkResult, { capability: 'bilibili.native_search' }>['terminalReason'];
    navigationAttempted: boolean;
    acquisition: WorkTabAcquisition | 'not_acquired';
    disposition: WorkTabDisposition;
    observation: BilibiliNativeSearchDomObservation | null;
  }
): Extract<ExtensionWorkResult, { capability: 'bilibili.native_search' }> {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.native_search',
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
): Extract<ExtensionWorkResult, { capability: 'bilibili.native_search' }>['terminalReason'] {
  if (errorCode === 'work_tab_closed') return 'work_tab_closed';
  if (errorCode === 'work_tab_user_taken_over') return 'work_tab_user_taken_over';
  if (errorCode === 'work_tab_foreground_unavailable') return 'work_tab_foreground_unavailable';
  return navigationAttempted ? 'navigation_outcome_unknown' : 'work_tab_closed';
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'extension_work_execution_failed';
}
