import {
  BILIBILI_NATIVE_SEARCH_BATCH_MAX_CARDS_PER_PAGE,
  type BilibiliNativeSearchBatchDomCard,
  type BilibiliNativeSearchBatchPageNumber,
  type BilibiliNativeSearchBatchPageObservation,
  type BilibiliNativeSearchBatchWorkItem,
  type BilibiliNativeSearchBatchWorkResult,
  type ExtensionWorkItem,
  type ExtensionWorkResult
} from '@intelligence/collector-contracts';
import { observeBilibiliNativeSearchPage } from './extension-work-bilibili-native-search-page-observation';
import type { BilibiliNativeSearchDomSnapshot } from './strategies/bilibili-native-search-dom-projection';
import {
  acquireExtensionWorkTab,
  abandonExtensionWorkTab,
  navigateBilibiliNativeSearchBatchPageOnce,
  releaseExtensionWorkTab,
  type ExtensionWorkTabLease,
  type WorkTabAcquisition,
  type WorkTabDisposition
} from './extension-work-tabs';

const INTER_PAGE_COOLDOWN_MS = 1_200;

/**
 * Direct batch search uses exactly one extension-owned work tab and at most
 * the two signed native URLs.  It does not click a pagination control, scroll,
 * change filters, read a response body, or retry a page after an uncertain
 * outcome.
 */
export async function executeBilibiliNativeSearchBatchExtensionWork(
  item: Extract<ExtensionWorkItem, { capability: 'bilibili.native_search_batch' }>,
  lifecycle: {
    onWorkTabAcquired?(acquisition: WorkTabAcquisition): Promise<void>;
    onNavigationIntent?(): Promise<void>;
  } = {}
): Promise<Extract<ExtensionWorkResult, { capability: 'bilibili.native_search_batch' }>> {
  let workTab: ExtensionWorkTabLease | null = null;
  let acquisition: WorkTabAcquisition | 'not_acquired' = 'not_acquired';
  let navigationAttemptCount: 0 | 1 | 2 = 0;
  const pages: BilibiliNativeSearchBatchPageObservation[] = [];
  if (Date.parse(item.expiresAt) <= Date.now()) {
    return result(item, {
      state: 'stopped', errorCode: 'extension_work_expired', terminalReason: 'run_deadline_exceeded',
      navigationAttemptCount, acquisition, disposition: 'closed_or_missing', pages
    });
  }
  try {
    workTab = await acquireExtensionWorkTab();
    acquisition = workTab.acquisition;
    await lifecycle.onWorkTabAcquired?.(acquisition);
    for (const target of item.input.targets) {
      // A settled first page plus the deliberate inter-page cooldown can run
      // past the signed work deadline. Never begin the next irreversible
      // navigation once that deadline has passed.
      if (Date.parse(item.expiresAt) <= Date.now()) {
        const disposition = abandonExtensionWorkTab(workTab);
        workTab = null;
        return result(item, {
          state: pages.length > 0 ? 'partial' : 'stopped',
          errorCode: 'extension_work_expired',
          terminalReason: 'run_deadline_exceeded',
          navigationAttemptCount,
          acquisition,
          disposition,
          pages
        });
      }
      await navigateBilibiliNativeSearchBatchPageOnce(workTab, item, target.page, async () => {
        navigationAttemptCount = (navigationAttemptCount + 1) as 1 | 2;
        await lifecycle.onNavigationIntent?.();
      });
      const observed = await observeBilibiliNativeSearchPage({
        workTab,
        expectedCanonicalSearchUrl: target.canonicalSearchUrl,
        expiresAt: item.expiresAt
      });
      const pageObservation = observed.dom ? compactPageObservation(target.page, observed.dom) : null;
      if (pageObservation) pages.push(pageObservation);
      if (observed.kind === 'ready') {
        if (target.page === 1) {
          await delay(INTER_PAGE_COOLDOWN_MS);
          continue;
        }
        const disposition = releaseExtensionWorkTab(workTab);
        workTab = null;
        return result(item, {
          state: 'completed', errorCode: null,
          terminalReason: hasCards(pages) ? 'search_batch_ready' : 'search_batch_empty',
          navigationAttemptCount, acquisition, disposition, pages
        });
      }
      if (observed.kind === 'empty') {
        // An empty first page proves that a second page cannot improve breadth;
        // do not create a needless second navigation.
        if (target.page === 1) {
          const disposition = releaseExtensionWorkTab(workTab);
          workTab = null;
          return result(item, {
            state: 'completed', errorCode: null, terminalReason: 'search_batch_empty',
            navigationAttemptCount, acquisition, disposition, pages
          });
        }
        const disposition = releaseExtensionWorkTab(workTab);
        workTab = null;
        return result(item, {
          state: 'completed', errorCode: null,
          terminalReason: hasCards(pages) ? 'search_batch_ready' : 'search_batch_empty',
          navigationAttemptCount, acquisition, disposition, pages
        });
      }
      const disposition = abandonExtensionWorkTab(workTab);
      workTab = null;
      return result(item, {
        state: observed.kind === 'incomplete' ? 'partial' : pages.length > 0 ? 'partial' : 'stopped',
        errorCode: observed.errorCode,
        terminalReason: batchTerminalReason(observed.terminalReason),
        navigationAttemptCount,
        acquisition,
        disposition,
        pages
      });
    }
    const disposition = workTab ? releaseExtensionWorkTab(workTab) : 'closed_or_missing';
    workTab = null;
    return result(item, {
      state: 'completed', errorCode: null,
      terminalReason: hasCards(pages) ? 'search_batch_ready' : 'search_batch_empty',
      navigationAttemptCount, acquisition, disposition, pages
    });
  } catch (error) {
    const disposition = workTab
      ? navigationAttemptCount > 0
        ? abandonExtensionWorkTab(workTab)
        : releaseExtensionWorkTab(workTab)
      : acquisition === 'not_acquired'
        ? 'closed_or_missing'
        : 'user_taken_over';
    return result(item, {
      state: pages.length > 0 ? 'partial' : 'failed',
      errorCode: safeErrorCode(error),
      terminalReason: terminalReasonForError(safeErrorCode(error), navigationAttemptCount),
      navigationAttemptCount,
      acquisition,
      disposition,
      pages
    });
  }
}

function compactPageObservation(
  page: BilibiliNativeSearchBatchPageNumber,
  dom: BilibiliNativeSearchDomSnapshot
): BilibiliNativeSearchBatchPageObservation | null {
  if (dom.resultType !== 'comprehensive' || dom.sort !== 'relevance') return null;
  return {
    page,
    searchInputVisible: dom.searchInputVisible,
    resultListVisible: dom.resultListVisible,
    emptyStateVisible: dom.emptyStateVisible,
    resultType: 'comprehensive',
    sort: 'relevance',
    semanticResultCardCount: dom.semanticResultCardCount,
    cards: dom.cards.slice(0, BILIBILI_NATIVE_SEARCH_BATCH_MAX_CARDS_PER_PAGE).map(compactCard),
    loginOverlayVisible: dom.loginOverlayVisible,
    risk: { ...dom.risk }
  };
}

function compactCard(card: BilibiliNativeSearchDomSnapshot['cards'][number]): BilibiliNativeSearchBatchDomCard {
  return {
    bvid: card.bvid,
    title: compactText(card.title, 180),
    visibleText: compactText(card.visibleText, 240),
    thumbnailUrl: compactImageUrl(card.thumbnailUrl)
  };
}

function compactText(value: string | null, maximum: number): string | null {
  const normalised = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (!normalised || /[\u0000-\u001f\u007f]/.test(normalised)) return null;
  return normalised.slice(0, maximum);
}

function compactImageUrl(value: string | null): string | null {
  if (!value || value.length > 512) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
  } catch {
    return null;
  }
}

function hasCards(pages: readonly BilibiliNativeSearchBatchPageObservation[]): boolean {
  return pages.some((page) => page.cards.length > 0);
}

function result(
  item: BilibiliNativeSearchBatchWorkItem,
  input: {
    state: BilibiliNativeSearchBatchWorkResult['state'];
    errorCode: string | null;
    terminalReason: BilibiliNativeSearchBatchWorkResult['terminalReason'];
    navigationAttemptCount: 0 | 1 | 2;
    acquisition: WorkTabAcquisition | 'not_acquired';
    disposition: WorkTabDisposition;
    pages: BilibiliNativeSearchBatchPageObservation[];
  }
): BilibiliNativeSearchBatchWorkResult {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.native_search_batch',
    executionTarget: 'collector_work_tab',
    state: input.state,
    errorCode: input.errorCode,
    terminalReason: input.terminalReason,
    completedAt: new Date().toISOString(),
    navigation: {
      attempted: input.navigationAttemptCount > 0,
      attemptCount: input.navigationAttemptCount
    },
    workTabAcquisition: input.acquisition,
    workTabDisposition: input.disposition,
    observation: input.pages.length > 0 ? { pages: input.pages.map((page) => structuredClone(page)) } : null
  };
}

function terminalReasonForError(
  errorCode: string,
  navigationAttemptCount: number
): BilibiliNativeSearchBatchWorkResult['terminalReason'] {
  if (errorCode === 'work_tab_closed') return 'work_tab_closed';
  if (errorCode === 'work_tab_user_taken_over') return 'work_tab_user_taken_over';
  if (errorCode === 'work_tab_foreground_unavailable') return 'work_tab_foreground_unavailable';
  return navigationAttemptCount > 0 ? 'navigation_outcome_unknown' : 'work_tab_closed';
}

function batchTerminalReason(
  terminalReason: 'verification_required' | 'rate_limited' | 'source_unavailable' |
    'search_results_partial' | 'document_context_changed' | 'dom_projection_failed' | 'run_deadline_exceeded'
): BilibiliNativeSearchBatchWorkResult['terminalReason'] {
  return terminalReason === 'search_results_partial' ? 'search_batch_page_partial' : terminalReason;
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'extension_work_execution_failed';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
