import { BrowserHostError, type AcquirePageResult } from '@intelligence/collector-contracts';
import type {
  BilibiliAccountVideoPaginationClickAction,
  BilibiliAccountVideoPaginationNavigationAction,
  BilibiliAccountVideoPaginationPage,
  BilibiliAccountVideoPaginationRunRecord,
  BilibiliAccountVideoPaginationTerminalReason
} from './bilibili-account-video-pagination-contract';
import type { BilibiliAccountVideoInventoryProjection } from './bilibili-account-video-inventory-contract';
import type { BilibiliAccountVideoInventoryStrategyObservation } from './bilibili-account-video-inventory-observation';

export function paginationNavigationAction(runId: string): BilibiliAccountVideoPaginationNavigationAction {
  return {
    actionId: `navigate_account_video_inventory_${runId.replace(/-/g, '_')}`,
    kind: 'navigation',
    intent: 'Open the canonical Bilibili account video inventory exactly once.',
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null,
    visualEvidence: null
  };
}

export function paginationClickAction(
  runId: string,
  expectedActivePage: number
): BilibiliAccountVideoPaginationClickAction {
  const targetPage = expectedActivePage + 1;
  return {
    actionId: `advance_account_video_page_${targetPage}_${runId.replace(/-/g, '_')}`,
    kind: 'pagination_click',
    intent: 'Advance the Bilibili account video inventory by exactly one adjacent page.',
    expectedActivePage,
    targetPage,
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null,
    scrollToControlAttempted: false,
    targetBounds: null,
    matchedRouteStatuses: [],
    visualEvidence: { before: null, after: null }
  };
}

export function paginationPageSelection(selection: AcquirePageResult['selection']):
  BilibiliAccountVideoPaginationRunRecord['safeguards']['targetTabSelection'] {
  if (selection === 'created_new_page') return 'created_new_managed_tab';
  return selection === 'reused_exact_target'
    ? 'reused_matching_managed_tab'
    : 'reused_retained_managed_tab';
}

export function paginationRiskOutcome(
  dom: BilibiliAccountVideoInventoryStrategyObservation['dom'],
  page: BilibiliAccountVideoInventoryProjection | null
): {
  state: BilibiliAccountVideoPaginationRunRecord['state'];
  terminalReason: BilibiliAccountVideoPaginationTerminalReason;
  errorCode: string;
} | null {
  if (dom.risk.verificationRequired) {
    return { state: 'partial', terminalReason: 'verification_required', errorCode: 'verification_required' };
  }
  if (dom.risk.rateLimited) {
    return { state: 'partial', terminalReason: 'rate_limited', errorCode: 'rate_limited' };
  }
  if (dom.risk.sourceUnavailable) {
    return { state: 'partial', terminalReason: 'source_unavailable', errorCode: 'source_unavailable' };
  }
  if (!page && dom.loginOverlayVisible) {
    return { state: 'partial', terminalReason: 'authentication_required', errorCode: 'authentication_required' };
  }
  return null;
}

export function paginationSafeErrorCode(error: unknown): string {
  const candidate = error instanceof BrowserHostError
    ? error.record.code
    : error instanceof Error
      ? error.message
      : '';
  return /^[a-z0-9_]{1,100}$/.test(candidate) ? candidate : 'account_video_pagination_runner_failed';
}

export function paginationFailure(error: unknown): {
  state: BilibiliAccountVideoPaginationRunRecord['state'];
  terminalReason: BilibiliAccountVideoPaginationTerminalReason;
  errorCode: string;
  uncertainPageOutcome: boolean;
} {
  const errorCode = paginationSafeErrorCode(error);
  if (
    errorCode === 'navigation_outcome_unknown' ||
    errorCode === 'bilibili_page_click_outcome_unknown' ||
    errorCode === 'browser_host_bilibili_page_click_response_invalid'
  ) return { state: 'failed', terminalReason: 'platform_action_outcome_unknown', errorCode, uncertainPageOutcome: true };
  if (
    errorCode === 'managed_page_document_generation_mismatch' ||
    errorCode === 'managed_page_record_version_mismatch' ||
    errorCode === 'managed_page_run_mismatch' ||
    errorCode === 'account_video_inventory_strategy_document_context_changed' ||
    errorCode === 'account_video_inventory_strategy_binding_context_rejected' ||
    errorCode === 'account_video_pagination_managed_page_context_changed'
  ) return { state: 'failed', terminalReason: 'document_context_changed', errorCode, uncertainPageOutcome: true };
  if (errorCode === 'run_deadline_exceeded') {
    return { state: 'failed', terminalReason: 'run_deadline_exceeded', errorCode, uncertainPageOutcome: true };
  }
  return { state: 'failed', terminalReason: 'dom_projection_failed', errorCode, uncertainPageOutcome: false };
}

export function hasCrossPageDuplicate(
  pages: readonly BilibiliAccountVideoPaginationPage[],
  candidate: BilibiliAccountVideoInventoryProjection
): boolean {
  const known = new Set(pages.flatMap((page) => page.projection.items.map((item) => item.bvid)));
  return candidate.items.some((item) => known.has(item.bvid));
}
