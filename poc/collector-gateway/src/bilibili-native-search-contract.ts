import {
  bilibiliNativeSearchUrl,
  normaliseBilibiliNativeSearchQuery,
  type StrategyBindingDiagnostics
} from '@intelligence/collector-contracts';

export const BILIBILI_NATIVE_SEARCH_MAX_RESULTS = 20;

export interface BilibiliNativeSearchInput {
  query: string;
}

export interface BilibiliNativeSearchDomCard {
  bvid: string | null;
  title: string | null;
  visibleText: string | null;
  thumbnailUrl: string | null;
}

export interface BilibiliNativeSearchDomSnapshot {
  searchInputVisible: boolean;
  resultListVisible: boolean;
  emptyStateVisible: boolean;
  cards: BilibiliNativeSearchDomCard[];
  loginOverlayVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

export interface BilibiliNativeSearchItem {
  rank: number;
  bvid: string;
  canonicalVideoUrl: string;
  title: string;
  visibleText: string;
  thumbnailUrl: string | null;
}

export interface BilibiliNativeSearchProjection {
  schemaVersion: 1;
  resultState: 'video_results' | 'no_video_results';
  items: BilibiliNativeSearchItem[];
  visibleVideoCardCount: number;
  unresolvedCardCount: number;
  loginOverlayVisible: boolean;
  risk: BilibiliNativeSearchDomSnapshot['risk'];
  capturedAt: string;
}

export interface BilibiliNativeSearchVisualEvidence {
  phase: 'baseline';
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

export interface BilibiliNativeSearchAction {
  actionId: string;
  kind: 'navigation';
  intent: 'Open the canonical first-party Bilibili search page exactly once.';
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
  errorCode: string | null;
}

export type BilibiliNativeSearchTerminalReason =
  | 'search_ready'
  | 'search_empty'
  | 'search_results_partial'
  | 'authentication_required'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'dom_projection_failed'
  | 'document_context_changed'
  | 'run_deadline_exceeded';

export interface BilibiliNativeSearchRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'native_search';
  queryDigest: string;
  targetUrlDigest: string;
  strategyCandidate: {
    strategyId: 'bilibili.search.breadth.dom.v2';
    version: '0.1.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  results: BilibiliNativeSearchProjection | null;
  visualEvidence: BilibiliNativeSearchVisualEvidence | null;
  bindingDiagnostics?: StrategyBindingDiagnostics;
  actions: BilibiliNativeSearchAction[];
  coverage: {
    capturedPages: 0 | 1;
    visibleVideoCardCount: number;
    capturedItems: number;
    unresolvedCardCount: number;
    resultState: BilibiliNativeSearchProjection['resultState'] | null;
    loginOverlayVisible: boolean;
    terminalReason: BilibiliNativeSearchTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'trusted_navigation_plus_bounded_dom_projection';
    query: 'sha256_only_in_persisted_artifacts';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    networkQueryAndFragmentValues: 'not_read';
    responseBodies: 'not_read';
    sortAndFilter: 'default_comprehensive_only_separate_capability';
    pagination: 'excluded_separate_capability';
    detailNavigation: 'excluded_separate_capability';
    mixedResultTypes: 'excluded_non_video_objects';
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

function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean && clean.length <= maximum && !/[\u0000-\u001f\u007f]/.test(clean) ? clean : null;
}

function stableBvid(value: unknown): string | null {
  return typeof value === 'string' && /^BV[0-9A-Za-z]{10}$/.test(value) ? value : null;
}

function safePublicImageUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function bilibiliNativeSearchInput(value: unknown): BilibiliNativeSearchInput {
  const candidate = record(value);
  if (!candidate || Object.keys(candidate).length !== 1 || typeof candidate.query !== 'string') {
    throw new Error('bilibili_native_search_input_invalid');
  }
  const query = normaliseBilibiliNativeSearchQuery(candidate.query);
  if (!query) throw new Error('bilibili_native_search_input_invalid');
  return { query };
}

/** This URL is a transient navigation/binding value and must not be persisted. */
export function canonicalBilibiliNativeSearchUrlForQuery(query: string): string {
  return bilibiliNativeSearchUrl(query);
}

export function projectBilibiliNativeSearchDom(
  dom: BilibiliNativeSearchDomSnapshot,
  capturedAt: string
): BilibiliNativeSearchProjection | null {
  if (
    !dom.searchInputVisible ||
    (!dom.resultListVisible && !dom.emptyStateVisible) ||
    !Array.isArray(dom.cards) ||
    dom.cards.length > BILIBILI_NATIVE_SEARCH_MAX_RESULTS ||
    typeof dom.loginOverlayVisible !== 'boolean' ||
    !dom.risk ||
    typeof dom.risk.verificationRequired !== 'boolean' ||
    typeof dom.risk.rateLimited !== 'boolean' ||
    typeof dom.risk.sourceUnavailable !== 'boolean'
  ) return null;
  const items: BilibiliNativeSearchItem[] = [];
  const seenBvids = new Set<string>();
  let unresolvedCardCount = 0;
  for (const rawCard of dom.cards) {
    const card = record(rawCard);
    const bvid = stableBvid(card?.bvid);
    const title = cleanText(card?.title, 500);
    const visibleText = cleanText(card?.visibleText, 2_000);
    const thumbnailUrl = safePublicImageUrl(card?.thumbnailUrl);
    if (!bvid || !title || !visibleText || seenBvids.has(bvid) ||
      (card?.thumbnailUrl !== null && thumbnailUrl === null)) {
      unresolvedCardCount += 1;
      continue;
    }
    seenBvids.add(bvid);
    items.push({
      rank: items.length + 1,
      bvid,
      canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
      title,
      visibleText,
      thumbnailUrl
    });
  }
  return {
    schemaVersion: 1,
    resultState: items.length > 0 ? 'video_results' : 'no_video_results',
    items,
    visibleVideoCardCount: dom.cards.length,
    unresolvedCardCount,
    loginOverlayVisible: dom.loginOverlayVisible,
    risk: { ...dom.risk },
    capturedAt
  };
}
