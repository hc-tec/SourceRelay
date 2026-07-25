import { BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID } from '@intelligence/collector-contracts';
import { createHash } from 'node:crypto';
import type {
  BilibiliAccountVideoInventoryAction,
  BilibiliAccountVideoInventoryProjection,
  BilibiliAccountVideoInventoryRunRecord,
  BilibiliAccountVideoInventoryTerminalReason,
  BilibiliAccountVideoInventoryVisualEvidence
} from './bilibili-account-video-inventory-contract';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createBilibiliAccountVideoInventoryRunRecord(input: {
  runId: string;
  collectorVersion: string;
  canonicalInventoryUrl: string;
  stableAccountId: string;
  startedAt: string;
  completedAt: string;
  state: BilibiliAccountVideoInventoryRunRecord['state'];
  errorCode: string | null;
  page: BilibiliAccountVideoInventoryProjection | null;
  visualEvidence: BilibiliAccountVideoInventoryVisualEvidence | null;
  actions: BilibiliAccountVideoInventoryAction[];
  terminalReason: BilibiliAccountVideoInventoryTerminalReason;
  targetTabSelection: BilibiliAccountVideoInventoryRunRecord['safeguards']['targetTabSelection'];
  targetPage: BilibiliAccountVideoInventoryRunRecord['safeguards']['targetPage'];
  safeguards?: BilibiliAccountVideoInventoryRunRecord['safeguards'];
}): BilibiliAccountVideoInventoryRunRecord {
  const page = input.page;
  return {
    schemaVersion: 1,
    runId: input.runId,
    collectorVersion: input.collectorVersion,
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'account_video_inventory',
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
    page,
    visualEvidence: input.visualEvidence,
    actions: input.actions,
    coverage: {
      capturedPages: page ? 1 : 0,
      visibleCardCount: page?.visibleCardCount ?? 0,
      capturedItems: page?.items.length ?? 0,
      unresolvedCardCount: page?.unresolvedCardCount ?? 0,
      loginOverlayVisible: page?.loginOverlayVisible ?? false,
      terminalReason: input.terminalReason
    },
    safeguards: input.safeguards ?? {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'trusted_navigation_plus_bounded_dom_projection',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'not_read',
      responseBodies: 'not_read',
      pagination: 'excluded_separate_capability',
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
