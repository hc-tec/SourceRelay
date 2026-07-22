import { BILIBILI_NATIVE_SEARCH_STRATEGY_ID } from '@intelligence/collector-contracts';
import { createHash } from 'node:crypto';
import type {
  BilibiliNativeSearchAction,
  BilibiliNativeSearchProjection,
  BilibiliNativeSearchRunRecord,
  BilibiliNativeSearchTerminalReason,
  BilibiliNativeSearchVisualEvidence
} from './bilibili-native-search-contract';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createBilibiliNativeSearchRunRecord(input: {
  runId: string;
  collectorVersion: string;
  query: string;
  canonicalSearchUrl: string;
  startedAt: string;
  completedAt: string;
  state: BilibiliNativeSearchRunRecord['state'];
  errorCode: string | null;
  results: BilibiliNativeSearchProjection | null;
  visualEvidence: BilibiliNativeSearchVisualEvidence | null;
  actions: BilibiliNativeSearchAction[];
  terminalReason: BilibiliNativeSearchTerminalReason;
  targetTabSelection: BilibiliNativeSearchRunRecord['safeguards']['targetTabSelection'];
  targetPage: BilibiliNativeSearchRunRecord['safeguards']['targetPage'];
}): BilibiliNativeSearchRunRecord {
  const results = input.results;
  return {
    schemaVersion: 1,
    runId: input.runId,
    collectorVersion: input.collectorVersion,
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'native_search',
    queryDigest: sha256(input.query),
    targetUrlDigest: sha256(input.canonicalSearchUrl),
    strategyCandidate: {
      strategyId: BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
      version: '0.1.0',
      admissionEligible: false
    },
    state: input.state,
    errorCode: input.errorCode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    results,
    visualEvidence: input.visualEvidence,
    actions: input.actions,
    coverage: {
      capturedPages: results ? 1 : 0,
      visibleVideoCardCount: results?.visibleVideoCardCount ?? 0,
      capturedItems: results?.items.length ?? 0,
      unresolvedCardCount: results?.unresolvedCardCount ?? 0,
      resultState: results?.resultState ?? null,
      loginOverlayVisible: results?.loginOverlayVisible ?? false,
      terminalReason: input.terminalReason
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'trusted_navigation_plus_bounded_dom_projection',
      query: 'sha256_only_in_persisted_artifacts',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'not_read',
      responseBodies: 'not_read',
      sortAndFilter: 'default_comprehensive_only_separate_capability',
      pagination: 'excluded_separate_capability',
      detailNavigation: 'excluded_separate_capability',
      mixedResultTypes: 'excluded_non_video_objects',
      semanticActionDelivery: 'at_most_once',
      runDeadlineMs: 60_000,
      targetTabSelection: input.targetTabSelection,
      targetPage: input.targetPage,
      admissionEligible: false
    }
  };
}
