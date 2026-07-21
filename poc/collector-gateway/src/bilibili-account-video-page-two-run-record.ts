import { BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID } from '@intelligence/collector-contracts';
import { createHash } from 'node:crypto';
import type {
  BilibiliAccountVideoPageTwoAction,
  BilibiliAccountVideoPageTwoRunRecord,
  BilibiliAccountVideoPageTwoTerminalReason,
  BilibiliAccountVideoPageTwoVisualEvidence
} from './bilibili-account-video-page-two-contract';
import type { BilibiliAccountVideoInventoryProjection } from './bilibili-account-video-inventory-contract';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createBilibiliAccountVideoPageTwoRunRecord(input: {
  runId: string;
  collectorVersion: string;
  canonicalInventoryUrl: string;
  stableAccountId: string;
  startedAt: string;
  completedAt: string;
  state: BilibiliAccountVideoPageTwoRunRecord['state'];
  errorCode: string | null;
  pageTwo: BilibiliAccountVideoInventoryProjection | null;
  beforeBvidSetDigest: string | null;
  afterBvidSetDigest: string | null;
  pagination: BilibiliAccountVideoPageTwoRunRecord['pagination'];
  visualEvidence: BilibiliAccountVideoPageTwoRunRecord['visualEvidence'];
  actions: BilibiliAccountVideoPageTwoAction[];
  terminalReason: BilibiliAccountVideoPageTwoTerminalReason;
  targetTabSelection: BilibiliAccountVideoPageTwoRunRecord['safeguards']['targetTabSelection'];
  targetPage: BilibiliAccountVideoPageTwoRunRecord['safeguards']['targetPage'];
}): BilibiliAccountVideoPageTwoRunRecord {
  const pageTwo = input.pageTwo;
  const bvidSetChanged = input.beforeBvidSetDigest !== null && input.afterBvidSetDigest !== null &&
    input.beforeBvidSetDigest !== input.afterBvidSetDigest;
  return {
    schemaVersion: 1,
    runId: input.runId,
    collectorVersion: input.collectorVersion,
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'account_video_inventory_page_two',
    targetUrlDigest: sha256(input.canonicalInventoryUrl),
    stableAccountId: input.stableAccountId,
    strategyCandidate: {
      strategyId: BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
      version: '0.1.0',
      admissionEligible: false
    },
    state: input.state,
    errorCode: input.errorCode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    pageTwo,
    beforeBvidSetDigest: input.beforeBvidSetDigest,
    afterBvidSetDigest: input.afterBvidSetDigest,
    pagination: input.pagination,
    visualEvidence: input.visualEvidence,
    actions: input.actions,
    coverage: {
      capturedPages: pageTwo ? 1 : 0,
      pageTwoVisibleCardCount: pageTwo?.visibleCardCount ?? 0,
      pageTwoCapturedItems: pageTwo?.items.length ?? 0,
      pageTwoUnresolvedCardCount: pageTwo?.unresolvedCardCount ?? 0,
      bvidSetChanged,
      terminalReason: input.terminalReason
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'trusted_page_two_click_plus_bounded_dom_projection',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'not_read',
      responseBodies: 'not_read',
      networkMetadata: 'route_method_status_only',
      pagination: 'page_two_only',
      sortAndFilter: 'excluded_separate_capability',
      articleAudioAndSeries: 'excluded_separate_capability',
      semanticActionDelivery: 'at_most_once',
      runDeadlineMs: 60_000,
      targetTabSelection: input.targetTabSelection,
      targetPage: input.targetPage,
      admissionEligible: false
    }
  };
}
