import { canonicalBilibiliNativeSearchUrl } from '@intelligence/collector-contracts';
import { captureBilibiliNativeSearchDom, type BilibiliNativeSearchDomSnapshot } from './strategies/bilibili-native-search-dom-projection';
import { readExtensionWorkTab, type ExtensionWorkTabLease } from './extension-work-tabs';

const PAGE_SETTLE_MS = 3_000;
const DOM_OBSERVATION_WINDOW_MS = 12_000;
const OBSERVATION_INTERVAL_MS = 350;

export type BilibiliNativeSearchPageObservationOutcome =
  | { kind: 'ready'; dom: BilibiliNativeSearchDomSnapshot }
  | { kind: 'empty'; dom: BilibiliNativeSearchDomSnapshot }
  | {
    kind: 'stopped';
    dom: BilibiliNativeSearchDomSnapshot | null;
    errorCode: 'bilibili_native_search_target_not_reached' | 'bilibili_verification_required' | 'bilibili_rate_limited' | 'bilibili_source_unavailable';
    terminalReason: 'verification_required' | 'rate_limited' | 'source_unavailable';
  }
  | {
    kind: 'incomplete';
    dom: BilibiliNativeSearchDomSnapshot | null;
    errorCode: 'bilibili_native_search_document_context_changed' | 'bilibili_native_search_dom_projection_failed' | 'bilibili_native_search_dom_not_ready';
    terminalReason: 'search_results_partial' | 'document_context_changed' | 'dom_projection_failed' | 'run_deadline_exceeded';
  };

/**
 * One page probe shared by the single-page and fixed two-page search
 * capabilities. It performs no click, scroll, sort or filter action; it only
 * observes the signed page after its navigation has settled.
 */
export async function observeBilibiliNativeSearchPage(input: {
  workTab: ExtensionWorkTabLease;
  expectedCanonicalSearchUrl: string;
  expiresAt: string;
}): Promise<BilibiliNativeSearchPageObservationOutcome> {
  const deadline = Math.min(Date.parse(input.expiresAt), Date.now() + DOM_OBSERVATION_WINDOW_MS + PAGE_SETTLE_MS);
  let pageReadyAt: number | null = null;
  let lastDom: BilibiliNativeSearchDomSnapshot | null = null;
  while (Date.now() < deadline) {
    const tab = await readExtensionWorkTab(input.workTab);
    if (tab.status !== 'complete') {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    if (!tab.url || canonicalBilibiliNativeSearchUrl(tab.url, 'observed_document') !== input.expectedCanonicalSearchUrl) {
      return {
        kind: 'stopped',
        dom: null,
        errorCode: 'bilibili_native_search_target_not_reached',
        terminalReason: 'source_unavailable'
      };
    }
    pageReadyAt ??= Date.now();
    if (Date.now() - pageReadyAt < PAGE_SETTLE_MS) {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    let dom: BilibiliNativeSearchDomSnapshot;
    try {
      dom = await captureBilibiliNativeSearchDom(input.workTab.tabId);
    } catch (error) {
      const code = safeErrorCode(error);
      return {
        kind: 'incomplete',
        dom: lastDom,
        errorCode: code === 'native_search_strategy_document_context_changed'
          ? 'bilibili_native_search_document_context_changed'
          : 'bilibili_native_search_dom_projection_failed',
        terminalReason: code === 'native_search_strategy_document_context_changed'
          ? 'document_context_changed'
          : 'dom_projection_failed'
      };
    }
    lastDom = dom;
    if (dom.risk.verificationRequired) {
      return { kind: 'stopped', dom, errorCode: 'bilibili_verification_required', terminalReason: 'verification_required' };
    }
    if (dom.risk.rateLimited) {
      return { kind: 'stopped', dom, errorCode: 'bilibili_rate_limited', terminalReason: 'rate_limited' };
    }
    if (dom.risk.sourceUnavailable) {
      return { kind: 'stopped', dom, errorCode: 'bilibili_source_unavailable', terminalReason: 'source_unavailable' };
    }
    if (dom.resultType !== 'comprehensive' || dom.sort !== 'relevance') {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    if (dom.searchInputVisible && dom.emptyStateVisible) return { kind: 'empty', dom };
    if (dom.searchInputVisible && dom.resultListVisible && dom.semanticResultCardCount > 0) return { kind: 'ready', dom };
    await delay(OBSERVATION_INTERVAL_MS);
  }
  return {
    kind: 'incomplete',
    dom: lastDom,
    errorCode: 'bilibili_native_search_dom_not_ready',
    terminalReason: Date.now() >= Date.parse(input.expiresAt) ? 'run_deadline_exceeded' : 'search_results_partial'
  };
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'extension_work_execution_failed';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
