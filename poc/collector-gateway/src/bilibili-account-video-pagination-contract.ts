import type {
  BilibiliAccountVideoPageClickBounds,
  BilibiliAccountVideoPageClickNetworkObservation,
  PageVisualEvidence
} from '@intelligence/collector-contracts';
import { createHash } from 'node:crypto';
import {
  accountVideoInventoryUrl,
  bilibiliAccountVideoInventoryInput,
  stableAccountIdFromCanonicalBilibiliProfileUrl,
  type BilibiliAccountVideoInventoryProjection
} from './bilibili-account-video-inventory-contract';

/**
 * The first production pagination slice deliberately stays within the seven
 * directly rendered numeric controls observed on the target account. A later
 * capability may add separately proven "next page" semantics; it must not
 * silently turn this bounded strategy into an unbounded crawler.
 */
export const BILIBILI_ACCOUNT_VIDEO_PAGINATION_MAX_PAGES = 7;

export interface BilibiliAccountVideoPaginationInput {
  canonicalProfileUrl: string;
  maxPages: number;
}

export interface BilibiliAccountVideoPaginationNavigationAction {
  actionId: string;
  kind: 'navigation';
  intent: 'Open the canonical Bilibili account video inventory exactly once.';
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
  errorCode: string | null;
  visualEvidence: PageVisualEvidence | null;
}

export interface BilibiliAccountVideoPaginationClickAction {
  actionId: string;
  kind: 'pagination_click';
  intent: 'Advance the Bilibili account video inventory by exactly one adjacent page.';
  expectedActivePage: number;
  targetPage: number;
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
  errorCode: string | null;
  scrollToControlAttempted: boolean;
  targetBounds: BilibiliAccountVideoPageClickBounds | null;
  matchedRouteStatuses: number[];
  visualEvidence: {
    before: PageVisualEvidence | null;
    after: PageVisualEvidence | null;
  };
}

export type BilibiliAccountVideoPaginationAction =
  | BilibiliAccountVideoPaginationNavigationAction
  | BilibiliAccountVideoPaginationClickAction;

export interface BilibiliAccountVideoPaginationPage {
  pageNumber: number;
  projection: BilibiliAccountVideoInventoryProjection;
  bvidSetDigest: string;
}

export type BilibiliAccountVideoPaginationTerminalReason =
  | 'requested_page_budget_reached'
  | 'authentication_required'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'pagination_precondition_unmet'
  | 'page_selection_unconfirmed'
  | 'page_source_rejected'
  | 'page_cards_unchanged'
  | 'duplicate_video_detected'
  | 'platform_action_outcome_unknown'
  | 'dom_projection_failed'
  | 'document_context_changed'
  | 'run_deadline_exceeded';

export interface BilibiliAccountVideoPaginationRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'account_video_inventory_pagination';
  targetUrlDigest: string;
  stableAccountId: string;
  strategyCandidate: {
    strategyId: 'bilibili.account.video-inventory.pagination.dom.v2';
    version: '0.2.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  requestedPages: number;
  pages: BilibiliAccountVideoPaginationPage[];
  actions: BilibiliAccountVideoPaginationAction[];
  coverage: {
    requestedPages: number;
    capturedPages: number;
    capturedItems: number;
    uniqueBvidCount: number;
    duplicateBvidCount: number;
    unresolvedCardCount: number;
    loginOverlayVisible: boolean;
    terminalReason: BilibiliAccountVideoPaginationTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'trusted_adjacent_page_click_plus_bounded_dom_projection';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    networkQueryAndFragmentValues: 'not_read';
    responseBodies: 'not_read';
    networkMetadata: 'route_method_status_only';
    pagination: 'direct_numeric_pages_one_through_seven_only';
    sortAndFilter: 'excluded_separate_capability';
    articleAudioAndSeries: 'excluded_separate_capability';
    semanticActionDelivery: 'at_most_once';
    runDeadlineMs: 60_000;
    targetTabSelection:
      | 'reused_matching_managed_tab'
      | 'reused_retained_managed_tab'
      | 'created_new_managed_tab'
      | 'not_acquired';
    targetPage: 'retained_after_run' | 'quarantined_on_uncertain_outcome' | 'not_acquired';
    admissionEligible: false;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function bilibiliAccountVideoPaginationInput(value: unknown): BilibiliAccountVideoPaginationInput {
  const candidate = record(value);
  const maxPages = candidate?.maxPages;
  if (
    !candidate ||
    Object.keys(candidate).length !== 2 ||
    typeof candidate.canonicalProfileUrl !== 'string' ||
    typeof maxPages !== 'number' ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > BILIBILI_ACCOUNT_VIDEO_PAGINATION_MAX_PAGES
  ) throw new Error('bilibili_account_video_pagination_input_invalid');
  const identity = bilibiliAccountVideoInventoryInput({ canonicalProfileUrl: candidate.canonicalProfileUrl });
  return { canonicalProfileUrl: identity.canonicalProfileUrl, maxPages };
}

export function paginationInventoryUrl(canonicalProfileUrl: string): string {
  return accountVideoInventoryUrl(canonicalProfileUrl);
}

export function paginationStableAccountId(canonicalProfileUrl: string): string {
  return stableAccountIdFromCanonicalBilibiliProfileUrl(canonicalProfileUrl);
}

export function bilibiliAccountVideoBvidSetDigest(page: BilibiliAccountVideoInventoryProjection): string {
  const bvids = [...new Set(page.items.map((item) => item.bvid))].sort((left, right) => left.localeCompare(right, 'en'));
  return createHash('sha256').update(JSON.stringify(bvids)).digest('hex');
}

export function pageClickNetworkStatuses(
  observations: readonly BilibiliAccountVideoPageClickNetworkObservation[]
): number[] {
  return observations.map((observation) => observation.status);
}
