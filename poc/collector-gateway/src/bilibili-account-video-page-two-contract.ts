import type { BilibiliAccountVideoPageClickBounds } from '@intelligence/collector-contracts';
import { createHash } from 'node:crypto';
import {
  accountVideoInventoryUrl,
  bilibiliAccountVideoInventoryInput,
  stableAccountIdFromCanonicalBilibiliProfileUrl,
  type BilibiliAccountVideoInventoryProjection
} from './bilibili-account-video-inventory-contract';

export interface BilibiliAccountVideoPageTwoInput {
  canonicalProfileUrl: string;
}

export interface BilibiliAccountVideoPageTwoNavigationAction {
  actionId: string;
  kind: 'navigation';
  intent: 'Open the canonical Bilibili account video inventory exactly once.';
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
  errorCode: string | null;
}

export interface BilibiliAccountVideoPageTwoClickAction {
  actionId: string;
  kind: 'pagination_click';
  intent: 'Select page two of the Bilibili account video inventory exactly once.';
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
  errorCode: string | null;
  scrollToControlAttempted: boolean;
}

export type BilibiliAccountVideoPageTwoAction =
  | BilibiliAccountVideoPageTwoNavigationAction
  | BilibiliAccountVideoPageTwoClickAction;

export type BilibiliAccountVideoPageTwoTerminalReason =
  | 'page_two_ready'
  | 'page_two_selection_unconfirmed'
  | 'page_two_source_rejected'
  | 'page_two_cards_unchanged'
  | 'authentication_required'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'dom_projection_failed'
  | 'document_context_changed'
  | 'run_deadline_exceeded';

export interface BilibiliAccountVideoPageTwoVisualEvidence {
  phase: 'pagination_before' | 'pagination_after';
  actionId: string;
  evidenceId: string;
  capturedAt: string;
  viewport: {
    cssWidth: number;
    cssHeight: number;
    devicePixelRatio: number;
    scrollX: number;
    scrollY: number;
  };
  screenshot: {
    fileName: string;
    byteLength: number;
    sha256: string;
  };
}

export interface BilibiliAccountVideoPageTwoRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'account_video_inventory_page_two';
  targetUrlDigest: string;
  stableAccountId: string;
  strategyCandidate: {
    strategyId: 'bilibili.account.video-inventory.dom.v1';
    version: '0.1.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  pageTwo: BilibiliAccountVideoInventoryProjection | null;
  beforeBvidSetDigest: string | null;
  afterBvidSetDigest: string | null;
  pagination: {
    targetPage: 2;
    activePageBefore: number | null;
    activePageAfter: number | null;
    targetBounds: BilibiliAccountVideoPageClickBounds | null;
    scrollToControlAttempted: boolean;
    matchedRouteStatuses: number[];
  } | null;
  visualEvidence: {
    before: BilibiliAccountVideoPageTwoVisualEvidence | null;
    after: BilibiliAccountVideoPageTwoVisualEvidence | null;
  };
  actions: BilibiliAccountVideoPageTwoAction[];
  coverage: {
    capturedPages: 0 | 1;
    pageTwoVisibleCardCount: number;
    pageTwoCapturedItems: number;
    pageTwoUnresolvedCardCount: number;
    bvidSetChanged: boolean;
    terminalReason: BilibiliAccountVideoPageTwoTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'trusted_page_two_click_plus_bounded_dom_projection';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    networkQueryAndFragmentValues: 'not_read';
    responseBodies: 'not_read';
    networkMetadata: 'route_method_status_only';
    pagination: 'page_two_only';
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

export function bilibiliAccountVideoPageTwoInput(value: unknown): BilibiliAccountVideoPageTwoInput {
  return bilibiliAccountVideoInventoryInput(value);
}

export function pageTwoInventoryUrl(canonicalProfileUrl: string): string {
  return accountVideoInventoryUrl(canonicalProfileUrl);
}

export function pageTwoStableAccountId(canonicalProfileUrl: string): string {
  return stableAccountIdFromCanonicalBilibiliProfileUrl(canonicalProfileUrl);
}

export function bvidSetDigest(page: BilibiliAccountVideoInventoryProjection): string {
  const values = [...new Set(page.items.map((item) => item.bvid))].sort((left, right) => left.localeCompare(right, 'en'));
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
