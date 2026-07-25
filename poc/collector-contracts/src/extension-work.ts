import {
  bilibiliNativeSearchUrl,
  canonicalBilibiliNativeSearchUrl,
  normaliseBilibiliNativeSearchRoute
} from './bilibili-native-search.js';
import {
  bilibiliAccountProfileIdFromUrl,
  bilibiliAccountVideoInventoryIdFromUrl,
  canonicalBilibiliAccountProfileUrl,
  canonicalBilibiliAccountVideoInventoryUrl
} from './bilibili-account-profile.js';
import { canonicalJson } from './ipc.js';

/**
 * The production Gateway-to-extension protocol is intentionally narrow. A
 * work item names one registered capability and its validated input; it is
 * never a carrier for an arbitrary URL, selector, script, CDP command, or
 * input coordinate.
 */
export const EXTENSION_WORK_SCHEMA_VERSION = 1 as const;
export const EXTENSION_WORK_PROTOCOL_VERSION = 1 as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{40,}$/;
const SAFE_ERROR_CODE = /^[a-z0-9_]{1,100}$/;
const BILIBILI_NATIVE_SEARCH_MAX_VISIBLE_CARDS = 20;
const BILIBILI_ACCOUNT_VIDEO_INVENTORY_MAX_VISIBLE_CARDS = 40;

export type ExtensionWorkCapability =
  | 'bilibili.video_detail'
  | 'bilibili.native_search'
  | 'bilibili.account_profile'
  | 'bilibili.account_inventory';
export type ExtensionWorkExecutionTarget = 'collector_work_tab' | 'user_selected_tab';
export type ExtensionWorkState = 'queued' | 'claimed' | 'completed' | 'partial' | 'stopped' | 'failed';

interface ExtensionWorkEnvelope {
  schemaVersion: typeof EXTENSION_WORK_SCHEMA_VERSION;
  protocolVersion: typeof EXTENSION_WORK_PROTOCOL_VERSION;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili';
  executionTarget: 'collector_work_tab';
  issuedAt: string;
  expiresAt: string;
  /** P-256 / SHA-256 signature over `extensionWorkSigningPayload(item)`. */
  gatewaySignature: string;
}

export interface BilibiliVideoDetailWorkInput {
  canonicalVideoUrl: string;
  bvid: string;
}

/**
 * These are ceilings, not caller-configurable knobs. The first direct-mode
 * detail capability has exactly one navigation and zero semantic page input.
 */
export interface BilibiliVideoDetailWorkBudget {
  maximumPlatformNavigations: 1;
  maximumSemanticActions: 0;
  maximumResponseObservations: 0;
  maximumPayloadBytes: 98_304;
}

export interface BilibiliVideoDetailWorkItem extends ExtensionWorkEnvelope {
  capability: 'bilibili.video_detail';
  input: BilibiliVideoDetailWorkInput;
  budget: BilibiliVideoDetailWorkBudget;
}

/**
 * Search is deliberately the fixed public "综合" first page. The caller can
 * provide a query, but cannot select a URL, result type, sort order, page,
 * selector, or interaction plan.
 */
export interface BilibiliNativeSearchWorkInput {
  query: string;
  canonicalSearchUrl: string;
  resultType: 'comprehensive';
  sort: 'relevance';
  page: 1;
}

export interface BilibiliNativeSearchWorkBudget {
  maximumPlatformNavigations: 1;
  maximumSemanticActions: 0;
  maximumResponseObservations: 0;
  maximumPayloadBytes: 98_304;
}

export interface BilibiliNativeSearchWorkItem extends ExtensionWorkEnvelope {
  capability: 'bilibili.native_search';
  input: BilibiliNativeSearchWorkInput;
  budget: BilibiliNativeSearchWorkBudget;
}

/**
 * The caller names one public profile identity.  The signed work item keeps
 * both its canonical URL and MID so neither the extension nor a later result
 * can silently drift to another account page.
 */
export interface BilibiliAccountProfileWorkInput {
  canonicalProfileUrl: string;
  stableAccountId: string;
}

export interface BilibiliAccountProfileWorkBudget {
  maximumPlatformNavigations: 1;
  maximumSemanticActions: 0;
  maximumResponseObservations: 0;
  maximumPayloadBytes: 98_304;
}

export interface BilibiliAccountProfileWorkItem extends ExtensionWorkEnvelope {
  capability: 'bilibili.account_profile';
  input: BilibiliAccountProfileWorkInput;
  budget: BilibiliAccountProfileWorkBudget;
}

/**
 * Account inventory remains a separate one-page capability: the Gateway
 * derives `/upload/video` from the account identity, so callers cannot select
 * a page number, sort, filter, arbitrary URL or action plan.
 */
export interface BilibiliAccountInventoryWorkInput {
  canonicalProfileUrl: string;
  canonicalInventoryUrl: string;
  stableAccountId: string;
}

export interface BilibiliAccountInventoryWorkBudget {
  maximumPlatformNavigations: 1;
  maximumSemanticActions: 0;
  maximumResponseObservations: 0;
  maximumPayloadBytes: 98_304;
}

export interface BilibiliAccountInventoryWorkItem extends ExtensionWorkEnvelope {
  capability: 'bilibili.account_inventory';
  input: BilibiliAccountInventoryWorkInput;
  budget: BilibiliAccountInventoryWorkBudget;
}

export type ExtensionWorkItem =
  | BilibiliVideoDetailWorkItem
  | BilibiliNativeSearchWorkItem
  | BilibiliAccountProfileWorkItem
  | BilibiliAccountInventoryWorkItem;
export type UnsignedExtensionWorkItem =
  | Omit<BilibiliVideoDetailWorkItem, 'gatewaySignature'>
  | Omit<BilibiliNativeSearchWorkItem, 'gatewaySignature'>
  | Omit<BilibiliAccountProfileWorkItem, 'gatewaySignature'>
  | Omit<BilibiliAccountInventoryWorkItem, 'gatewaySignature'>;

export type SharedExtensionWorkTerminalReason =
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'dom_projection_failed'
  | 'document_context_changed'
  | 'run_deadline_exceeded'
  | 'work_tab_closed'
  | 'work_tab_user_taken_over'
  | 'navigation_outcome_unknown'
  | 'gateway_restarted_before_completion';

export type BilibiliVideoDetailWorkTerminalReason =
  | 'detail_ready'
  | SharedExtensionWorkTerminalReason;

export type BilibiliNativeSearchWorkTerminalReason =
  | 'search_ready'
  | 'search_empty'
  | 'search_results_partial'
  | SharedExtensionWorkTerminalReason;

export type BilibiliAccountProfileWorkTerminalReason =
  | 'profile_ready'
  | SharedExtensionWorkTerminalReason;

export type BilibiliAccountInventoryWorkTerminalReason =
  | 'inventory_ready'
  | 'inventory_partial'
  | SharedExtensionWorkTerminalReason;

export type ExtensionWorkTerminalReason =
  | BilibiliVideoDetailWorkTerminalReason
  | BilibiliNativeSearchWorkTerminalReason
  | BilibiliAccountProfileWorkTerminalReason
  | BilibiliAccountInventoryWorkTerminalReason;

export interface BilibiliVideoDetailDomObservation {
  bvid: string;
  title: string | null;
  metadataVisibleText: string | null;
  description: string | null;
  creator: {
    displayName: string | null;
    publicAccountId: string | null;
  } | null;
  tagTexts: string[];
  episodeSummaryText: string | null;
  titleVisible: boolean;
  playerVisible: boolean;
  chargeExclusiveTrialVisible: boolean;
  loginOverlayVisible: boolean;
  risk: BilibiliWorkRisk;
}

export interface BilibiliNativeSearchDomCard {
  bvid: string | null;
  title: string | null;
  visibleText: string | null;
  thumbnailUrl: string | null;
}

export interface BilibiliNativeSearchDomObservation {
  searchInputVisible: boolean;
  resultListVisible: boolean;
  emptyStateVisible: boolean;
  resultType: 'comprehensive';
  sort: 'relevance';
  page: 1;
  /** Semantic, visible card count before the fixed BV-card allow-list. */
  semanticResultCardCount: number;
  /** Only public, human-visible canonical BV video cards are included. */
  cards: BilibiliNativeSearchDomCard[];
  loginOverlayVisible: boolean;
  risk: BilibiliWorkRisk;
}

export interface BilibiliAccountProfileDomBadgeImage {
  url: string | null;
  label: string | null;
}

/**
 * The extension normalises the visible account-header projection before it
 * crosses the signed work boundary.  It includes no viewer identity, hidden
 * application state, request data or arbitrary page content.
 */
export interface BilibiliAccountProfileDomObservation {
  stableAccountId: string | null;
  displayName: string | null;
  visibleDescription: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  textBadges: string[];
  imageBadges: BilibiliAccountProfileDomBadgeImage[];
  statistics: Array<{ label: string | null; value: string | null; href: null }>;
  navigation: Array<{ label: string | null; value: string | null; href: string | null }>;
  announcementText: string | null;
  chargeText: string | null;
  highlights: Array<{ bvid: string | null; title: string | null }>;
  profileHeaderVisible: boolean;
  loginOverlayVisible: boolean;
  risk: BilibiliWorkRisk;
}

export interface BilibiliAccountInventoryDomCard {
  bvid: string | null;
  title: string | null;
  visibleText: string | null;
  thumbnailUrl: string | null;
}

/** Public first-screen card projection from `/upload/video`; no scroll or pagination. */
export interface BilibiliAccountInventoryDomObservation {
  stableAccountId: string | null;
  videoListVisible: boolean;
  cards: BilibiliAccountInventoryDomCard[];
  loginOverlayVisible: boolean;
  risk: BilibiliWorkRisk;
}

export interface BilibiliWorkRisk {
  verificationRequired: boolean;
  rateLimited: boolean;
  sourceUnavailable: boolean;
}

/**
 * The result has no tab ID, URL, browser Profile, request headers, response
 * body, Cookie, token, or page script. A Gateway validates the result again
 * against the claimed work item before it can become a local artifact.
 */
export interface BilibiliVideoDetailWorkResult {
  schemaVersion: typeof EXTENSION_WORK_SCHEMA_VERSION;
  protocolVersion: typeof EXTENSION_WORK_PROTOCOL_VERSION;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili';
  capability: 'bilibili.video_detail';
  executionTarget: 'collector_work_tab';
  state: Exclude<ExtensionWorkState, 'queued' | 'claimed'>;
  errorCode: string | null;
  terminalReason: BilibiliVideoDetailWorkTerminalReason;
  completedAt: string;
  navigation: ExtensionWorkNavigation;
  workTabAcquisition: ExtensionWorkTabAcquisition;
  workTabDisposition: ExtensionWorkTabDisposition;
  observation: BilibiliVideoDetailDomObservation | null;
}

export interface BilibiliNativeSearchWorkResult {
  schemaVersion: typeof EXTENSION_WORK_SCHEMA_VERSION;
  protocolVersion: typeof EXTENSION_WORK_PROTOCOL_VERSION;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili';
  capability: 'bilibili.native_search';
  executionTarget: 'collector_work_tab';
  state: Exclude<ExtensionWorkState, 'queued' | 'claimed'>;
  errorCode: string | null;
  terminalReason: BilibiliNativeSearchWorkTerminalReason;
  completedAt: string;
  navigation: ExtensionWorkNavigation;
  workTabAcquisition: ExtensionWorkTabAcquisition;
  workTabDisposition: ExtensionWorkTabDisposition;
  observation: BilibiliNativeSearchDomObservation | null;
}

export interface BilibiliAccountProfileWorkResult {
  schemaVersion: typeof EXTENSION_WORK_SCHEMA_VERSION;
  protocolVersion: typeof EXTENSION_WORK_PROTOCOL_VERSION;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili';
  capability: 'bilibili.account_profile';
  executionTarget: 'collector_work_tab';
  state: Exclude<ExtensionWorkState, 'queued' | 'claimed'>;
  errorCode: string | null;
  terminalReason: BilibiliAccountProfileWorkTerminalReason;
  completedAt: string;
  navigation: ExtensionWorkNavigation;
  workTabAcquisition: ExtensionWorkTabAcquisition;
  workTabDisposition: ExtensionWorkTabDisposition;
  observation: BilibiliAccountProfileDomObservation | null;
}

export interface BilibiliAccountInventoryWorkResult {
  schemaVersion: typeof EXTENSION_WORK_SCHEMA_VERSION;
  protocolVersion: typeof EXTENSION_WORK_PROTOCOL_VERSION;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili';
  capability: 'bilibili.account_inventory';
  executionTarget: 'collector_work_tab';
  state: Exclude<ExtensionWorkState, 'queued' | 'claimed'>;
  errorCode: string | null;
  terminalReason: BilibiliAccountInventoryWorkTerminalReason;
  completedAt: string;
  navigation: ExtensionWorkNavigation;
  workTabAcquisition: ExtensionWorkTabAcquisition;
  workTabDisposition: ExtensionWorkTabDisposition;
  observation: BilibiliAccountInventoryDomObservation | null;
}

export interface ExtensionWorkNavigation {
  attempted: boolean;
  attemptCount: 0 | 1;
}

export type ExtensionWorkTabDisposition =
  | 'idle_reusable'
  | 'retained_not_reusable'
  | 'user_taken_over'
  | 'closed_or_missing';

export type ExtensionWorkTabAcquisition = 'created' | 'reused' | 'not_acquired';

export type ExtensionWorkResult =
  | BilibiliVideoDetailWorkResult
  | BilibiliNativeSearchWorkResult
  | BilibiliAccountProfileWorkResult
  | BilibiliAccountInventoryWorkResult;

export function canonicalBilibiliVideoWorkUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const bvid = url.protocol === 'https:' && url.hostname === 'www.bilibili.com'
      ? url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null
      : null;
    if (!bvid || url.username || url.password || url.search || url.hash) return null;
    return `https://www.bilibili.com/video/${bvid}`;
  } catch {
    return null;
  }
}

export function canonicalBilibiliNativeSearchWorkUrl(value: string): string | null {
  return canonicalBilibiliNativeSearchUrl(value, 'strict_input');
}

/** Return only a target derived from a validated registered work capability. */
export function extensionWorkTargetUrl(item: ExtensionWorkItem): string {
  switch (item.capability) {
    case 'bilibili.video_detail':
      return item.input.canonicalVideoUrl;
    case 'bilibili.native_search':
      return item.input.canonicalSearchUrl;
    case 'bilibili.account_profile':
      return item.input.canonicalProfileUrl;
    case 'bilibili.account_inventory':
      return item.input.canonicalInventoryUrl;
  }
}

export function extensionWorkSigningPayload(item: ExtensionWorkItem | UnsignedExtensionWorkItem): string {
  const { gatewaySignature: _gatewaySignature, ...unsigned } = item as ExtensionWorkItem;
  return canonicalJson(unsigned);
}

export function isExtensionWorkItem(value: unknown): value is ExtensionWorkItem {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'issuedAt', 'expiresAt', 'input', 'budget', 'gatewaySignature'
  ]) ||
    value.schemaVersion !== EXTENSION_WORK_SCHEMA_VERSION ||
    value.protocolVersion !== EXTENSION_WORK_PROTOCOL_VERSION ||
    !isUuid(value.workId) || !isUuid(value.operationId) || !isUuid(value.browserBindingId) ||
    value.platform !== 'bilibili' || value.executionTarget !== 'collector_work_tab' ||
    !isTimestamp(value.issuedAt) || !isTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) ||
    !BASE64URL_PATTERN.test(stringValue(value.gatewaySignature))
  ) return false;
  if (value.capability === 'bilibili.video_detail') {
    return isBilibiliVideoDetailWorkInput(value.input) && isBilibiliVideoDetailWorkBudget(value.budget);
  }
  if (value.capability === 'bilibili.native_search') {
    return isBilibiliNativeSearchWorkInput(value.input) && isBilibiliNativeSearchWorkBudget(value.budget);
  }
  if (value.capability === 'bilibili.account_profile') {
    return isBilibiliAccountProfileWorkInput(value.input) && isBilibiliAccountProfileWorkBudget(value.budget);
  }
  if (value.capability === 'bilibili.account_inventory') {
    return isBilibiliAccountInventoryWorkInput(value.input) && isBilibiliAccountInventoryWorkBudget(value.budget);
  }
  return false;
}

export function isExtensionWorkResult(value: unknown): value is ExtensionWorkResult {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'state', 'errorCode', 'terminalReason', 'completedAt', 'navigation',
    'workTabAcquisition', 'workTabDisposition', 'observation'
  ]) ||
    value.schemaVersion !== EXTENSION_WORK_SCHEMA_VERSION ||
    value.protocolVersion !== EXTENSION_WORK_PROTOCOL_VERSION ||
    !isUuid(value.workId) || !isUuid(value.operationId) || !isUuid(value.browserBindingId) ||
    value.platform !== 'bilibili' || value.executionTarget !== 'collector_work_tab' ||
    !isTerminalWorkState(value.state) || !isSafeNullableErrorCode(value.errorCode) ||
    !isTimestamp(value.completedAt) || !isNavigation(value.navigation) ||
    !isWorkTabAcquisition(value.workTabAcquisition) || !isWorkTabDisposition(value.workTabDisposition)
  ) return false;
  if (value.capability === 'bilibili.video_detail') {
    return isBilibiliVideoDetailTerminalReason(value.terminalReason) &&
      (value.observation === null || isBilibiliVideoDetailDomObservation(value.observation));
  }
  if (value.capability === 'bilibili.native_search') {
    return isBilibiliNativeSearchTerminalReason(value.terminalReason) &&
      (value.observation === null || isBilibiliNativeSearchDomObservation(value.observation));
  }
  if (value.capability === 'bilibili.account_profile') {
    return isBilibiliAccountProfileTerminalReason(value.terminalReason) &&
      (value.observation === null || isBilibiliAccountProfileDomObservation(value.observation));
  }
  if (value.capability === 'bilibili.account_inventory') {
    return isBilibiliAccountInventoryTerminalReason(value.terminalReason) &&
      (value.observation === null || isBilibiliAccountInventoryDomObservation(value.observation));
  }
  return false;
}

export function isExtensionWorkResultForItem(
  value: unknown,
  item: ExtensionWorkItem
): value is ExtensionWorkResult {
  if (!isExtensionWorkResult(value) || value.capability !== item.capability ||
    value.workId !== item.workId || value.operationId !== item.operationId ||
    value.browserBindingId !== item.browserBindingId || Date.parse(value.completedAt) < Date.parse(item.issuedAt) ||
    value.navigation.attemptCount !== (value.navigation.attempted ? 1 : 0)
  ) return false;
  if (item.capability === 'bilibili.video_detail' && value.capability === 'bilibili.video_detail') {
    if (value.observation && value.observation.bvid !== item.input.bvid) return false;
    if (value.state === 'completed') {
      return value.errorCode === null && value.terminalReason === 'detail_ready' && value.observation !== null &&
        value.observation.title !== null && value.observation.titleVisible && value.observation.playerVisible &&
        value.navigation.attemptCount === 1 && value.workTabDisposition === 'idle_reusable';
    }
    return true;
  }
  if (item.capability === 'bilibili.native_search' && value.capability === 'bilibili.native_search') {
    if (value.observation && (
      value.observation.resultType !== item.input.resultType || value.observation.sort !== item.input.sort ||
      value.observation.page !== item.input.page
    )) return false;
    if (value.state !== 'completed') return true;
    if (value.errorCode !== null || value.observation === null || value.navigation.attemptCount !== 1 ||
      value.workTabDisposition !== 'idle_reusable' || value.observation.risk.verificationRequired ||
      value.observation.risk.rateLimited || value.observation.risk.sourceUnavailable ||
      !value.observation.searchInputVisible
    ) return false;
    return value.terminalReason === 'search_empty'
      ? value.observation.emptyStateVisible
      : value.terminalReason === 'search_ready'
        ? value.observation.resultListVisible && value.observation.semanticResultCardCount > 0
        : false;
  }
  if (item.capability === 'bilibili.account_profile' && value.capability === 'bilibili.account_profile') {
    if (value.observation && value.observation.stableAccountId !== item.input.stableAccountId) return false;
    if (value.state !== 'completed') return true;
    return value.errorCode === null && value.terminalReason === 'profile_ready' && value.observation !== null &&
      value.observation.profileHeaderVisible && value.observation.displayName !== null &&
      !value.observation.risk.verificationRequired && !value.observation.risk.rateLimited &&
      !value.observation.risk.sourceUnavailable && value.navigation.attemptCount === 1 &&
      value.workTabDisposition === 'idle_reusable';
  }
  if (item.capability === 'bilibili.account_inventory' && value.capability === 'bilibili.account_inventory') {
    if (value.observation && value.observation.stableAccountId !== item.input.stableAccountId) return false;
    if (value.state !== 'completed') return true;
    return value.errorCode === null && value.terminalReason === 'inventory_ready' && value.observation !== null &&
      value.observation.videoListVisible && value.observation.cards.some(isResolvedAccountInventoryCard) &&
      !value.observation.risk.verificationRequired && !value.observation.risk.rateLimited &&
      !value.observation.risk.sourceUnavailable && value.navigation.attemptCount === 1 &&
      value.workTabDisposition === 'idle_reusable';
  }
  return false;
}

export function isBilibiliVideoDetailDomObservation(value: unknown): value is BilibiliVideoDetailDomObservation {
  if (!isRecord(value) || !hasExactKeys(value, [
    'bvid', 'title', 'metadataVisibleText', 'description', 'creator', 'tagTexts', 'episodeSummaryText',
    'titleVisible', 'playerVisible', 'chargeExclusiveTrialVisible', 'loginOverlayVisible', 'risk'
  ]) || !isBvid(value.bvid) ||
    !isNullableText(value.title, 500) || !isNullableText(value.metadataVisibleText, 1_000) ||
    !isNullableText(value.description, 20_000) || !isNullableText(value.episodeSummaryText, 500) ||
    !isTextArray(value.tagTexts, 20, 100) || !isNullableCreator(value.creator) ||
    typeof value.titleVisible !== 'boolean' || typeof value.playerVisible !== 'boolean' ||
    typeof value.chargeExclusiveTrialVisible !== 'boolean' || typeof value.loginOverlayVisible !== 'boolean' ||
    !isBilibiliWorkRisk(value.risk)
  ) return false;
  return true;
}

export function isBilibiliNativeSearchDomObservation(value: unknown): value is BilibiliNativeSearchDomObservation {
  if (!isRecord(value) || !hasExactKeys(value, [
    'searchInputVisible', 'resultListVisible', 'emptyStateVisible', 'resultType', 'sort', 'page',
    'semanticResultCardCount', 'cards', 'loginOverlayVisible', 'risk'
  ]) || typeof value.searchInputVisible !== 'boolean' || typeof value.resultListVisible !== 'boolean' ||
    typeof value.emptyStateVisible !== 'boolean' || value.resultType !== 'comprehensive' ||
    value.sort !== 'relevance' || value.page !== 1 ||
    typeof value.semanticResultCardCount !== 'number' || !Number.isSafeInteger(value.semanticResultCardCount) ||
    value.semanticResultCardCount < 0 ||
    value.semanticResultCardCount > 60 || !Array.isArray(value.cards) ||
    value.cards.length > BILIBILI_NATIVE_SEARCH_MAX_VISIBLE_CARDS ||
    !value.cards.every(isBilibiliNativeSearchDomCard) || typeof value.loginOverlayVisible !== 'boolean' ||
    !isBilibiliWorkRisk(value.risk)
  ) return false;
  return true;
}

export function isBilibiliAccountProfileDomObservation(value: unknown): value is BilibiliAccountProfileDomObservation {
  if (!isRecord(value) || !hasExactKeys(value, [
    'stableAccountId', 'displayName', 'visibleDescription', 'avatarUrl', 'bannerUrl', 'textBadges', 'imageBadges',
    'statistics', 'navigation', 'announcementText', 'chargeText', 'highlights', 'profileHeaderVisible',
    'loginOverlayVisible', 'risk'
  ]) || !isNullableAccountId(value.stableAccountId) || !isNullableText(value.displayName, 200) ||
    !isNullableText(value.visibleDescription, 5_000) || !isNullablePublicImageUrl(value.avatarUrl) ||
    !isNullablePublicImageUrl(value.bannerUrl) || !isTextArray(value.textBadges, 20, 80) ||
    !isArrayAtMost(value.imageBadges, 20, isBilibiliAccountProfileDomBadgeImage) ||
    !isArrayAtMost(value.statistics, 12, isBilibiliAccountProfileStatistic) ||
    !isArrayAtMost(value.navigation, 12, isBilibiliAccountProfileNavigation) ||
    !isNullableText(value.announcementText, 20_000) || !isNullableText(value.chargeText, 2_000) ||
    !isArrayAtMost(value.highlights, 12, isBilibiliAccountProfileHighlight) ||
    typeof value.profileHeaderVisible !== 'boolean' || typeof value.loginOverlayVisible !== 'boolean' ||
    !isBilibiliWorkRisk(value.risk)
  ) return false;
  return true;
}

export function isBilibiliAccountInventoryDomObservation(value: unknown): value is BilibiliAccountInventoryDomObservation {
  return isRecord(value) && hasExactKeys(value, [
    'stableAccountId', 'videoListVisible', 'cards', 'loginOverlayVisible', 'risk'
  ]) && isNullableAccountId(value.stableAccountId) && typeof value.videoListVisible === 'boolean' &&
    isArrayAtMost(value.cards, BILIBILI_ACCOUNT_VIDEO_INVENTORY_MAX_VISIBLE_CARDS, isBilibiliAccountInventoryDomCard) &&
    typeof value.loginOverlayVisible === 'boolean' && isBilibiliWorkRisk(value.risk);
}

function isBilibiliVideoDetailWorkInput(value: unknown): value is BilibiliVideoDetailWorkInput {
  if (!isRecord(value) || Object.keys(value).length !== 2 || typeof value.canonicalVideoUrl !== 'string' || !isBvid(value.bvid)) {
    return false;
  }
  return canonicalBilibiliVideoWorkUrl(value.canonicalVideoUrl) === `https://www.bilibili.com/video/${value.bvid}`;
}

function isBilibiliNativeSearchWorkInput(value: unknown): value is BilibiliNativeSearchWorkInput {
  if (!isRecord(value) || !hasExactKeys(value, ['query', 'canonicalSearchUrl', 'resultType', 'sort', 'page']) ||
    typeof value.query !== 'string' || typeof value.canonicalSearchUrl !== 'string' ||
    value.resultType !== 'comprehensive' || value.sort !== 'relevance' || value.page !== 1
  ) return false;
  const route = normaliseBilibiliNativeSearchRoute({
    query: value.query,
    resultType: value.resultType,
    sort: value.sort,
    page: value.page
  });
  return route !== null && value.canonicalSearchUrl === bilibiliNativeSearchUrl(route) &&
    canonicalBilibiliNativeSearchWorkUrl(value.canonicalSearchUrl) === value.canonicalSearchUrl;
}

function isBilibiliAccountProfileWorkInput(value: unknown): value is BilibiliAccountProfileWorkInput {
  if (!isRecord(value) || !hasExactKeys(value, ['canonicalProfileUrl', 'stableAccountId']) ||
    typeof value.canonicalProfileUrl !== 'string' || !isAccountId(value.stableAccountId)
  ) return false;
  return canonicalBilibiliAccountProfileUrl(value.canonicalProfileUrl, 'strict_input') === value.canonicalProfileUrl &&
    bilibiliAccountProfileIdFromUrl(value.canonicalProfileUrl) === value.stableAccountId;
}

function isBilibiliAccountInventoryWorkInput(value: unknown): value is BilibiliAccountInventoryWorkInput {
  if (!isRecord(value) || !hasExactKeys(value, ['canonicalProfileUrl', 'canonicalInventoryUrl', 'stableAccountId']) ||
    typeof value.canonicalProfileUrl !== 'string' || typeof value.canonicalInventoryUrl !== 'string' ||
    !isAccountId(value.stableAccountId)
  ) return false;
  const canonicalProfile = canonicalBilibiliAccountProfileUrl(value.canonicalProfileUrl, 'strict_input');
  const canonicalInventory = canonicalBilibiliAccountVideoInventoryUrl(value.canonicalInventoryUrl, 'strict_input');
  if (!canonicalProfile || !canonicalInventory) return false;
  return canonicalProfile === value.canonicalProfileUrl && canonicalInventory === value.canonicalInventoryUrl &&
    bilibiliAccountProfileIdFromUrl(canonicalProfile) === value.stableAccountId &&
    bilibiliAccountVideoInventoryIdFromUrl(canonicalInventory) === value.stableAccountId &&
    canonicalInventory === `${canonicalProfile}/upload/video`;
}

function isBilibiliVideoDetailWorkBudget(value: unknown): value is BilibiliVideoDetailWorkBudget {
  return isFixedDirectWorkBudget(value);
}

function isBilibiliNativeSearchWorkBudget(value: unknown): value is BilibiliNativeSearchWorkBudget {
  return isFixedDirectWorkBudget(value);
}

function isBilibiliAccountProfileWorkBudget(value: unknown): value is BilibiliAccountProfileWorkBudget {
  return isFixedDirectWorkBudget(value);
}

function isBilibiliAccountInventoryWorkBudget(value: unknown): value is BilibiliAccountInventoryWorkBudget {
  return isFixedDirectWorkBudget(value);
}

function isFixedDirectWorkBudget(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 4 &&
    value.maximumPlatformNavigations === 1 && value.maximumSemanticActions === 0 &&
    value.maximumResponseObservations === 0 && value.maximumPayloadBytes === 98_304;
}

function isBilibiliNativeSearchDomCard(value: unknown): value is BilibiliNativeSearchDomCard {
  return isRecord(value) && hasExactKeys(value, ['bvid', 'title', 'visibleText', 'thumbnailUrl']) &&
    (value.bvid === null || isBvid(value.bvid)) && isNullableText(value.title, 500) &&
    isNullableText(value.visibleText, 2_000) && isNullablePublicImageUrl(value.thumbnailUrl);
}

function isBilibiliAccountProfileDomBadgeImage(value: unknown): value is BilibiliAccountProfileDomBadgeImage {
  return isRecord(value) && hasExactKeys(value, ['url', 'label']) &&
    isNullablePublicImageUrl(value.url) && isNullableText(value.label, 80);
}

function isBilibiliAccountProfileStatistic(
  value: unknown
): value is BilibiliAccountProfileDomObservation['statistics'][number] {
  return isRecord(value) && hasExactKeys(value, ['label', 'value', 'href']) && value.href === null &&
    isNullableText(value.label, 40) && isNullableText(value.value, 100);
}

function isBilibiliAccountProfileNavigation(
  value: unknown
): value is BilibiliAccountProfileDomObservation['navigation'][number] {
  return isRecord(value) && hasExactKeys(value, ['label', 'value', 'href']) &&
    isNullableText(value.label, 40) && isNullableText(value.value, 100) && isNullablePublicDocumentUrl(value.href);
}

function isBilibiliAccountProfileHighlight(
  value: unknown
): value is BilibiliAccountProfileDomObservation['highlights'][number] {
  return isRecord(value) && hasExactKeys(value, ['bvid', 'title']) &&
    (value.bvid === null || isBvid(value.bvid)) && isNullableText(value.title, 500);
}

function isBilibiliAccountInventoryDomCard(value: unknown): value is BilibiliAccountInventoryDomCard {
  return isRecord(value) && hasExactKeys(value, ['bvid', 'title', 'visibleText', 'thumbnailUrl']) &&
    (value.bvid === null || isBvid(value.bvid)) && isNullableText(value.title, 500) &&
    isNullableText(value.visibleText, 2_000) && isNullablePublicImageUrl(value.thumbnailUrl);
}

function isResolvedAccountInventoryCard(card: BilibiliAccountInventoryDomCard): boolean {
  return card.bvid !== null && card.title !== null && card.visibleText !== null;
}

function isNullablePublicImageUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function isNullablePublicDocumentUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_000) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isArrayAtMost<T>(value: unknown, maximumItems: number, predicate: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.length <= maximumItems && value.every(predicate);
}

function isBilibiliWorkRisk(value: unknown): value is BilibiliWorkRisk {
  return isRecord(value) && hasExactKeys(value, ['verificationRequired', 'rateLimited', 'sourceUnavailable']) &&
    typeof value.verificationRequired === 'boolean' && typeof value.rateLimited === 'boolean' &&
    typeof value.sourceUnavailable === 'boolean';
}

function isTerminalWorkState(value: unknown): value is BilibiliVideoDetailWorkResult['state'] {
  return value === 'completed' || value === 'partial' || value === 'stopped' || value === 'failed';
}

function isBilibiliVideoDetailTerminalReason(value: unknown): value is BilibiliVideoDetailWorkTerminalReason {
  return value === 'detail_ready' || isSharedTerminalReason(value);
}

function isBilibiliNativeSearchTerminalReason(value: unknown): value is BilibiliNativeSearchWorkTerminalReason {
  return value === 'search_ready' || value === 'search_empty' || value === 'search_results_partial' ||
    isSharedTerminalReason(value);
}

function isBilibiliAccountProfileTerminalReason(value: unknown): value is BilibiliAccountProfileWorkTerminalReason {
  return value === 'profile_ready' || isSharedTerminalReason(value);
}

function isBilibiliAccountInventoryTerminalReason(value: unknown): value is BilibiliAccountInventoryWorkTerminalReason {
  return value === 'inventory_ready' || value === 'inventory_partial' || isSharedTerminalReason(value);
}

function isSharedTerminalReason(value: unknown): value is SharedExtensionWorkTerminalReason {
  return value === 'verification_required' || value === 'rate_limited' || value === 'source_unavailable' ||
    value === 'dom_projection_failed' || value === 'document_context_changed' ||
    value === 'run_deadline_exceeded' || value === 'work_tab_closed' ||
    value === 'work_tab_user_taken_over' || value === 'navigation_outcome_unknown' ||
    value === 'gateway_restarted_before_completion';
}

function isNavigation(value: unknown): value is ExtensionWorkNavigation {
  return isRecord(value) && Object.keys(value).length === 2 && typeof value.attempted === 'boolean' &&
    (value.attemptCount === 0 || value.attemptCount === 1);
}

function isWorkTabDisposition(value: unknown): value is ExtensionWorkTabDisposition {
  return value === 'idle_reusable' || value === 'retained_not_reusable' ||
    value === 'user_taken_over' || value === 'closed_or_missing';
}

function isWorkTabAcquisition(value: unknown): value is ExtensionWorkTabAcquisition {
  return value === 'created' || value === 'reused' || value === 'not_acquired';
}

function isNullableCreator(value: unknown): value is BilibiliVideoDetailDomObservation['creator'] {
  return value === null || (isRecord(value) && Object.keys(value).length === 2 &&
    isNullableText(value.displayName, 200) && isNullableAccountId(value.publicAccountId));
}

function isNullableAccountId(value: unknown): value is string | null {
  return value === null || isAccountId(value);
}

function isAccountId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,20}$/.test(value) && value !== '0';
}

function isTextArray(value: unknown, maximumItems: number, maximumLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maximumItems && value.every((item) => isText(item, maximumLength));
}

function isNullableText(value: unknown, maximumLength: number): value is string | null {
  return value === null || isText(value, maximumLength);
}

function isText(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/.test(value) && value.trim().length > 0;
}

function isSafeNullableErrorCode(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && SAFE_ERROR_CODE.test(value));
}

function isBvid(value: unknown): value is string {
  return typeof value === 'string' && /^BV[0-9A-Za-z]{10}$/.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
