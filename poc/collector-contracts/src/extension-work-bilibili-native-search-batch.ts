import {
  bilibiliNativeSearchUrl,
  canonicalBilibiliNativeSearchUrl,
  normaliseBilibiliNativeSearchRoute
} from './bilibili-native-search.js';

/**
 * Direct batch search is intentionally a narrow two-page operation.  The
 * caller supplies only a phrase; the Gateway derives these two fixed routes
 * and signs them together.  This is not a generic pagination interface.
 */
export const BILIBILI_NATIVE_SEARCH_BATCH_DIRECT_PAGES = [1, 2] as const;
export const BILIBILI_NATIVE_SEARCH_BATCH_MAX_CARDS_PER_PAGE = 12 as const;
export const BILIBILI_NATIVE_SEARCH_BATCH_MAX_PAYLOAD_BYTES = 57_344 as const;

export type BilibiliNativeSearchBatchPageNumber = typeof BILIBILI_NATIVE_SEARCH_BATCH_DIRECT_PAGES[number];
export type BilibiliNativeSearchBatchWorkState = 'completed' | 'partial' | 'stopped' | 'failed';

interface BatchWorkEnvelope {
  schemaVersion: 1;
  protocolVersion: 1;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili';
  executionTarget: 'collector_work_tab';
  issuedAt: string;
  expiresAt: string;
  gatewaySignature: string;
}

export interface BilibiliNativeSearchBatchPageTarget {
  page: BilibiliNativeSearchBatchPageNumber;
  canonicalSearchUrl: string;
}

export interface BilibiliNativeSearchBatchWorkInput {
  query: string;
  resultType: 'comprehensive';
  sort: 'relevance';
  targets: [BilibiliNativeSearchBatchPageTarget, BilibiliNativeSearchBatchPageTarget];
}

export interface BilibiliNativeSearchBatchWorkBudget {
  maximumPlatformNavigations: 2;
  maximumSemanticActions: 0;
  maximumResponseObservations: 0;
  maximumPayloadBytes: typeof BILIBILI_NATIVE_SEARCH_BATCH_MAX_PAYLOAD_BYTES;
}

export interface BilibiliNativeSearchBatchWorkItem extends BatchWorkEnvelope {
  capability: 'bilibili.native_search_batch';
  input: BilibiliNativeSearchBatchWorkInput;
  budget: BilibiliNativeSearchBatchWorkBudget;
}

export type UnsignedBilibiliNativeSearchBatchWorkItem = Omit<
  BilibiliNativeSearchBatchWorkItem,
  'gatewaySignature'
>;

export interface BilibiliNativeSearchBatchDomCard {
  bvid: string | null;
  title: string | null;
  visibleText: string | null;
  thumbnailUrl: string | null;
}

export interface BilibiliNativeSearchBatchRisk {
  verificationRequired: boolean;
  rateLimited: boolean;
  sourceUnavailable: boolean;
}

/**
 * A compact page projection keeps two visible pages below the authenticated
 * extension-result body limit.  It contains only public card DOM, never a
 * response body, request metadata, Cookie, token or arbitrary page content.
 */
export interface BilibiliNativeSearchBatchPageObservation {
  page: BilibiliNativeSearchBatchPageNumber;
  searchInputVisible: boolean;
  resultListVisible: boolean;
  emptyStateVisible: boolean;
  resultType: 'comprehensive';
  sort: 'relevance';
  semanticResultCardCount: number;
  cards: BilibiliNativeSearchBatchDomCard[];
  loginOverlayVisible: boolean;
  risk: BilibiliNativeSearchBatchRisk;
}

export interface BilibiliNativeSearchBatchObservation {
  pages: BilibiliNativeSearchBatchPageObservation[];
}

export type BilibiliNativeSearchBatchWorkTerminalReason =
  | 'search_batch_ready'
  | 'search_batch_empty'
  | 'search_batch_page_partial'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'dom_projection_failed'
  | 'document_context_changed'
  | 'run_deadline_exceeded'
  | 'work_tab_closed'
  | 'work_tab_user_taken_over'
  | 'work_tab_foreground_unavailable'
  | 'navigation_outcome_unknown'
  | 'gateway_restarted_before_completion';

export interface BilibiliNativeSearchBatchWorkResult {
  schemaVersion: 1;
  protocolVersion: 1;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili';
  capability: 'bilibili.native_search_batch';
  executionTarget: 'collector_work_tab';
  state: BilibiliNativeSearchBatchWorkState;
  errorCode: string | null;
  terminalReason: BilibiliNativeSearchBatchWorkTerminalReason;
  completedAt: string;
  navigation: { attempted: boolean; attemptCount: 0 | 1 | 2 };
  workTabAcquisition: 'created' | 'reused' | 'not_acquired';
  workTabDisposition: 'idle_reusable' | 'retained_not_reusable' | 'user_taken_over' | 'closed_or_missing';
  observation: BilibiliNativeSearchBatchObservation | null;
}

export function bilibiliNativeSearchBatchTargetUrl(
  item: BilibiliNativeSearchBatchWorkItem,
  page: BilibiliNativeSearchBatchPageNumber
): string {
  const target = item.input.targets.find((candidate) => candidate.page === page);
  if (!target) throw new Error('bilibili_native_search_batch_target_missing');
  return target.canonicalSearchUrl;
}

export function isBilibiliNativeSearchBatchWorkItem(value: unknown): value is BilibiliNativeSearchBatchWorkItem {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'issuedAt', 'expiresAt', 'input', 'budget', 'gatewaySignature'
  ]) || value.schemaVersion !== 1 || value.protocolVersion !== 1 || !isUuid(value.workId) ||
    !isUuid(value.operationId) || !isUuid(value.browserBindingId) || value.platform !== 'bilibili' ||
    value.capability !== 'bilibili.native_search_batch' || value.executionTarget !== 'collector_work_tab' ||
    !isTimestamp(value.issuedAt) || !isTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) || !isSignature(value.gatewaySignature)
  ) return false;
  return isInput(value.input) && isBudget(value.budget);
}

export function isBilibiliNativeSearchBatchWorkResult(value: unknown): value is BilibiliNativeSearchBatchWorkResult {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'state', 'errorCode', 'terminalReason', 'completedAt', 'navigation',
    'workTabAcquisition', 'workTabDisposition', 'observation'
  ]) || value.schemaVersion !== 1 || value.protocolVersion !== 1 || !isUuid(value.workId) ||
    !isUuid(value.operationId) || !isUuid(value.browserBindingId) || value.platform !== 'bilibili' ||
    value.capability !== 'bilibili.native_search_batch' || value.executionTarget !== 'collector_work_tab' ||
    !isState(value.state) || !isSafeNullableErrorCode(value.errorCode) ||
    !isTerminalReason(value.terminalReason) || !isTimestamp(value.completedAt) ||
    !isNavigation(value.navigation) || !isAcquisition(value.workTabAcquisition) ||
    !isDisposition(value.workTabDisposition)
  ) return false;
  return value.observation === null || isObservation(value.observation);
}

export function isBilibiliNativeSearchBatchWorkResultForItem(
  value: unknown,
  item: BilibiliNativeSearchBatchWorkItem
): value is BilibiliNativeSearchBatchWorkResult {
  if (!isBilibiliNativeSearchBatchWorkResult(value) || value.workId !== item.workId ||
    value.operationId !== item.operationId || value.browserBindingId !== item.browserBindingId ||
    Date.parse(value.completedAt) < Date.parse(item.issuedAt) ||
    value.navigation.attempted !== (value.navigation.attemptCount > 0)
  ) return false;
  if (value.state !== 'completed') return true;
  if (value.errorCode !== null || value.observation === null || value.workTabDisposition !== 'idle_reusable' ||
    value.observation.pages.some((page) => page.risk.verificationRequired || page.risk.rateLimited || page.risk.sourceUnavailable)
  ) return false;
  const pages = value.observation.pages;
  if (value.terminalReason === 'search_batch_empty') {
    return value.navigation.attemptCount >= 1 && pages.length >= 1 && pages[0]!.page === 1 &&
      pages.every((page) => page.emptyStateVisible && page.cards.length === 0);
  }
  return value.terminalReason === 'search_batch_ready' && value.navigation.attemptCount === 2 &&
    pages.length === 2 && pages[0]!.page === 1 && pages[1]!.page === 2 &&
    pages.some((page) => page.cards.length > 0);
}

function isInput(value: unknown): value is BilibiliNativeSearchBatchWorkInput {
  if (!isRecord(value) || !hasExactKeys(value, ['query', 'resultType', 'sort', 'targets']) ||
    typeof value.query !== 'string' || value.resultType !== 'comprehensive' || value.sort !== 'relevance' ||
    !Array.isArray(value.targets) || value.targets.length !== BILIBILI_NATIVE_SEARCH_BATCH_DIRECT_PAGES.length
  ) return false;
  const route = normaliseBilibiliNativeSearchRoute({
    query: value.query,
    resultType: 'comprehensive',
    sort: 'relevance',
    page: 1
  });
  if (!route) return false;
  return value.targets.every((target, index) => {
    const page = BILIBILI_NATIVE_SEARCH_BATCH_DIRECT_PAGES[index];
    if (!isTarget(target) || target.page !== page) return false;
    const expected = bilibiliNativeSearchUrl({ ...route, page });
    return target.canonicalSearchUrl === expected &&
      canonicalBilibiliNativeSearchUrl(target.canonicalSearchUrl, 'strict_input') === expected;
  });
}

function isTarget(value: unknown): value is BilibiliNativeSearchBatchPageTarget {
  return isRecord(value) && hasExactKeys(value, ['page', 'canonicalSearchUrl']) &&
    isPage(value.page) && typeof value.canonicalSearchUrl === 'string';
}

function isBudget(value: unknown): value is BilibiliNativeSearchBatchWorkBudget {
  return isRecord(value) && hasExactKeys(value, [
    'maximumPlatformNavigations', 'maximumSemanticActions', 'maximumResponseObservations', 'maximumPayloadBytes'
  ]) && value.maximumPlatformNavigations === 2 && value.maximumSemanticActions === 0 &&
    value.maximumResponseObservations === 0 && value.maximumPayloadBytes === BILIBILI_NATIVE_SEARCH_BATCH_MAX_PAYLOAD_BYTES;
}

function isObservation(value: unknown): value is BilibiliNativeSearchBatchObservation {
  return isRecord(value) && hasExactKeys(value, ['pages']) && Array.isArray(value.pages) &&
    value.pages.length >= 1 && value.pages.length <= BILIBILI_NATIVE_SEARCH_BATCH_DIRECT_PAGES.length &&
    value.pages.every(isPageObservation) && value.pages.every((page, index) => page.page === index + 1);
}

function isPageObservation(value: unknown): value is BilibiliNativeSearchBatchPageObservation {
  return isRecord(value) && hasExactKeys(value, [
    'page', 'searchInputVisible', 'resultListVisible', 'emptyStateVisible', 'resultType', 'sort',
    'semanticResultCardCount', 'cards', 'loginOverlayVisible', 'risk'
  ]) && isPage(value.page) && typeof value.searchInputVisible === 'boolean' &&
    typeof value.resultListVisible === 'boolean' && typeof value.emptyStateVisible === 'boolean' &&
    value.resultType === 'comprehensive' && value.sort === 'relevance' &&
    isNonNegativeInteger(value.semanticResultCardCount) && value.semanticResultCardCount <= 60 &&
    Array.isArray(value.cards) && value.cards.length <= BILIBILI_NATIVE_SEARCH_BATCH_MAX_CARDS_PER_PAGE &&
    value.cards.every(isCard) && typeof value.loginOverlayVisible === 'boolean' && isRisk(value.risk);
}

function isCard(value: unknown): value is BilibiliNativeSearchBatchDomCard {
  return isRecord(value) && hasExactKeys(value, ['bvid', 'title', 'visibleText', 'thumbnailUrl']) &&
    (value.bvid === null || isBvid(value.bvid)) && isNullableText(value.title, 180) &&
    isNullableText(value.visibleText, 240) && isNullablePublicImageUrl(value.thumbnailUrl, 512);
}

function isRisk(value: unknown): value is BilibiliNativeSearchBatchRisk {
  return isRecord(value) && hasExactKeys(value, ['verificationRequired', 'rateLimited', 'sourceUnavailable']) &&
    typeof value.verificationRequired === 'boolean' && typeof value.rateLimited === 'boolean' &&
    typeof value.sourceUnavailable === 'boolean';
}

function isPage(value: unknown): value is BilibiliNativeSearchBatchPageNumber {
  return value === 1 || value === 2;
}

function isNavigation(value: unknown): value is BilibiliNativeSearchBatchWorkResult['navigation'] {
  return isRecord(value) && hasExactKeys(value, ['attempted', 'attemptCount']) && typeof value.attempted === 'boolean' &&
    (value.attemptCount === 0 || value.attemptCount === 1 || value.attemptCount === 2) &&
    value.attempted === (value.attemptCount > 0);
}

function isState(value: unknown): value is BilibiliNativeSearchBatchWorkState {
  return value === 'completed' || value === 'partial' || value === 'stopped' || value === 'failed';
}

function isTerminalReason(value: unknown): value is BilibiliNativeSearchBatchWorkTerminalReason {
  return value === 'search_batch_ready' || value === 'search_batch_empty' || value === 'search_batch_page_partial' ||
    value === 'verification_required' || value === 'rate_limited' || value === 'source_unavailable' ||
    value === 'dom_projection_failed' || value === 'document_context_changed' ||
    value === 'run_deadline_exceeded' || value === 'work_tab_closed' ||
    value === 'work_tab_user_taken_over' || value === 'work_tab_foreground_unavailable' ||
    value === 'navigation_outcome_unknown' || value === 'gateway_restarted_before_completion';
}

function isAcquisition(value: unknown): boolean {
  return value === 'created' || value === 'reused' || value === 'not_acquired';
}

function isDisposition(value: unknown): boolean {
  return value === 'idle_reusable' || value === 'retained_not_reusable' ||
    value === 'user_taken_over' || value === 'closed_or_missing';
}

function isNullableText(value: unknown, maximum: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value));
}

function isNullablePublicImageUrl(value: unknown, maximum: number): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function isBvid(value: unknown): value is string {
  return typeof value === 'string' && /^BV[0-9A-Za-z]{10}$/.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSafeNullableErrorCode(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && /^[a-z0-9_]{1,100}$/.test(value));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isSignature(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{40,}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
