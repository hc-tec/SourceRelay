import {
  bilibiliNativeSearchUrl,
  normaliseBilibiliNativeSearchRoute,
  type BilibiliNativeSearchResultType,
  type BilibiliNativeSearchRoute,
  type BilibiliNativeSearchSort,
  type StrategyBindingDiagnostics
} from '@intelligence/collector-contracts';

export const BILIBILI_NATIVE_SEARCH_MAX_RESULTS = 20;

export interface BilibiliNativeSearchInput {
  query: string;
  resultType: BilibiliNativeSearchResultType;
  sort: BilibiliNativeSearchSort;
  page: number;
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
  resultType: BilibiliNativeSearchResultType | 'unknown';
  sort: BilibiliNativeSearchSort | 'unknown';
  /** Visible cards with non-empty human-readable content, before BV filtering. */
  semanticResultCardCount: number;
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
  resultType: BilibiliNativeSearchResultType;
  sort: BilibiliNativeSearchSort;
  page: number;
  resultState: 'video_results' | 'no_video_results';
  items: BilibiliNativeSearchItem[];
  semanticResultCardCount: number;
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
  | 'run_deadline_exceeded'
  // Direct user-browser work has no Profile runner. Preserve its exact
  // terminal semantics in the raw-first artifact rather than mapping an
  // interrupted or user-taken-over extension tab to a misleading legacy code.
  | 'work_tab_closed'
  | 'work_tab_user_taken_over'
  | 'work_tab_foreground_unavailable'
  | 'navigation_outcome_unknown'
  | 'gateway_restarted_before_completion';

export interface BilibiliNativeSearchRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'native_search';
  search: {
    resultType: BilibiliNativeSearchResultType;
    sort: BilibiliNativeSearchSort;
    page: number;
  };
  queryDigest: string;
  targetUrlDigest: string;
  strategyCandidate: {
    strategyId: 'bilibili.search.breadth.dom.v2';
    version: '0.2.0';
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
    environment: 'local_user_controlled_collection_profile' | 'user_owned_browser_extension';
    browser: 'visible_playwright_chromium' | 'user_owned_chromium_tab';
    acquisition: 'trusted_navigation_plus_bounded_dom_projection' | 'extension_owned_tab_navigation_plus_bounded_dom_projection';
    query: 'sha256_only_in_persisted_artifacts';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    networkQueryAndFragmentValues: 'not_read';
    responseBodies: 'not_read';
    sortAndFilter: 'reviewed_type_and_sort_via_native_url_filters_excluded' | 'fixed_comprehensive_first_page_no_input';
    pagination: 'single_reviewed_page_via_native_navigation' | 'fixed_first_page_no_input';
    detailNavigation: 'excluded_separate_capability';
    mixedResultTypes: 'excluded_non_video_objects';
    semanticActionDelivery: 'at_most_once';
    runDeadlineMs: 60_000;
    targetTabSelection:
      | 'reused_matching_managed_tab'
      | 'reused_retained_managed_tab'
      | 'created_new_managed_tab'
      | 'created_extension_work_tab'
      | 'reused_extension_work_tab'
      | 'not_acquired';
    targetPage:
      | 'retained_after_run'
      | 'quarantined_on_uncertain_outcome'
      | 'idle_reusable'
      | 'retained_not_reusable'
      | 'user_taken_over'
      | 'closed_or_missing'
      | 'not_acquired';
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
  if (
    !candidate ||
    Object.keys(candidate).some((key) => !['query', 'resultType', 'sort', 'page'].includes(key)) ||
    typeof candidate.query !== 'string'
  ) {
    throw new Error('bilibili_native_search_input_invalid');
  }
  const route = normaliseBilibiliNativeSearchRoute({
    query: candidate.query,
    ...(candidate.resultType === undefined ? {} : { resultType: candidate.resultType }),
    ...(candidate.sort === undefined ? {} : { sort: candidate.sort }),
    ...(candidate.page === undefined ? {} : { page: candidate.page })
  });
  if (!route) throw new Error('bilibili_native_search_input_invalid');
  return route;
}

/** This URL is a transient navigation/binding value and must not be persisted. */
export function canonicalBilibiliNativeSearchUrlForInput(route: BilibiliNativeSearchInput): string {
  return bilibiliNativeSearchUrl(route);
}

/** Convenience for the existing default comprehensive first-page call site. */
export function canonicalBilibiliNativeSearchUrlForQuery(query: string): string {
  const route = normaliseBilibiliNativeSearchRoute({ query });
  if (!route) throw new Error('bilibili_native_search_input_invalid');
  return canonicalBilibiliNativeSearchUrlForInput(route);
}

export function projectBilibiliNativeSearchDom(
  dom: BilibiliNativeSearchDomSnapshot,
  capturedAt: string,
  route: Pick<BilibiliNativeSearchRoute, 'resultType' | 'sort' | 'page'>
): BilibiliNativeSearchProjection | null {
  if (
    !dom.searchInputVisible ||
    (!dom.resultListVisible && !dom.emptyStateVisible) ||
    dom.resultType !== route.resultType ||
    dom.sort !== route.sort ||
    !Number.isSafeInteger(dom.semanticResultCardCount) ||
    dom.semanticResultCardCount < 0 || dom.semanticResultCardCount > 60 ||
    !Array.isArray(dom.cards) ||
    dom.cards.length > BILIBILI_NATIVE_SEARCH_MAX_RESULTS ||
    dom.cards.length > dom.semanticResultCardCount ||
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
    resultType: route.resultType,
    sort: route.sort,
    page: route.page,
    resultState: items.length > 0 ? 'video_results' : 'no_video_results',
    items,
    semanticResultCardCount: dom.semanticResultCardCount,
    visibleVideoCardCount: dom.cards.length,
    unresolvedCardCount,
    loginOverlayVisible: dom.loginOverlayVisible,
    risk: { ...dom.risk },
    capturedAt
  };
}
