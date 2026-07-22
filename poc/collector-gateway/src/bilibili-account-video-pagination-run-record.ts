import { createHash } from 'node:crypto';
import type {
  BilibiliAccountVideoPaginationAction,
  BilibiliAccountVideoPaginationPage,
  BilibiliAccountVideoPaginationRunRecord,
  BilibiliAccountVideoPaginationTerminalReason
} from './bilibili-account-video-pagination-contract';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createBilibiliAccountVideoPaginationRunRecord(input: {
  runId: string;
  collectorVersion: string;
  canonicalInventoryUrl: string;
  stableAccountId: string;
  startedAt: string;
  completedAt: string;
  requestedPages: number;
  state: BilibiliAccountVideoPaginationRunRecord['state'];
  errorCode: string | null;
  pages: BilibiliAccountVideoPaginationPage[];
  actions: BilibiliAccountVideoPaginationAction[];
  terminalReason: BilibiliAccountVideoPaginationTerminalReason;
  targetTabSelection: BilibiliAccountVideoPaginationRunRecord['safeguards']['targetTabSelection'];
  targetPage: BilibiliAccountVideoPaginationRunRecord['safeguards']['targetPage'];
}): BilibiliAccountVideoPaginationRunRecord {
  const pages = input.pages.map((page) => ({
    pageNumber: page.pageNumber,
    projection: structuredClone(page.projection),
    bvidSetDigest: page.bvidSetDigest
  }));
  const allBvids = pages.flatMap((page) => page.projection.items.map((item) => item.bvid));
  const uniqueBvidCount = new Set(allBvids).size;
  return {
    schemaVersion: 1,
    runId: input.runId,
    collectorVersion: input.collectorVersion,
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'account_video_inventory_pagination',
    targetUrlDigest: sha256(input.canonicalInventoryUrl),
    stableAccountId: input.stableAccountId,
    strategyCandidate: {
      strategyId: 'bilibili.account.video-inventory.pagination.dom.v2',
      version: '0.2.0',
      admissionEligible: false
    },
    state: input.state,
    errorCode: input.errorCode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    requestedPages: input.requestedPages,
    pages,
    actions: structuredClone(input.actions),
    coverage: {
      requestedPages: input.requestedPages,
      capturedPages: pages.length,
      capturedItems: allBvids.length,
      uniqueBvidCount,
      duplicateBvidCount: allBvids.length - uniqueBvidCount,
      unresolvedCardCount: pages.reduce((count, page) => count + page.projection.unresolvedCardCount, 0),
      loginOverlayVisible: pages.some((page) => page.projection.loginOverlayVisible),
      terminalReason: input.terminalReason
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'trusted_adjacent_page_click_plus_bounded_dom_projection',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'not_read',
      responseBodies: 'not_read',
      networkMetadata: 'route_method_status_only',
      pagination: 'direct_numeric_pages_one_through_seven_only',
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
