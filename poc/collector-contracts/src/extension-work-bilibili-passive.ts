import {
  bilibiliAccountProfileIdFromUrl,
  canonicalBilibiliAccountProfileUrl
} from './bilibili-account-profile.js';

/**
 * Extra direct-mode Bilibili work contracts that only navigate to a signed,
 * fixed public page and project visible DOM.  They deliberately live outside
 * `extension-work.ts` so the original four-capability contract remains
 * readable while the user-owned-browser lane grows.
 */
export type BilibiliPassiveExtensionWorkCapability =
  | 'bilibili.dynamic'
  | 'bilibili.collection_series.overview'
  | 'bilibili.collection_series.detail'
  | 'bilibili.danmaku';

export type BilibiliPassiveWorkState = 'completed' | 'partial' | 'stopped' | 'failed';

export interface BilibiliPassiveWorkRisk {
  verificationRequired: boolean;
  rateLimited: boolean;
  sourceUnavailable: boolean;
}

interface PassiveWorkEnvelope {
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

export interface BilibiliDynamicWorkInput {
  canonicalProfileUrl: string;
  canonicalDynamicUrl: string;
  stableAccountId: string;
}

export interface BilibiliPassiveOneNavigationBudget {
  maximumPlatformNavigations: 1;
  maximumSemanticActions: 0;
  maximumResponseObservations: 0;
  maximumPayloadBytes: 98_304;
}

export interface BilibiliDynamicWorkItem extends PassiveWorkEnvelope {
  capability: 'bilibili.dynamic';
  input: BilibiliDynamicWorkInput;
  budget: BilibiliPassiveOneNavigationBudget;
}

export interface BilibiliCollectionSeriesOverviewWorkInput {
  canonicalProfileUrl: string;
  canonicalOverviewUrl: string;
  stableAccountId: string;
}

export interface BilibiliCollectionSeriesOverviewWorkItem extends PassiveWorkEnvelope {
  capability: 'bilibili.collection_series.overview';
  input: BilibiliCollectionSeriesOverviewWorkInput;
  budget: BilibiliPassiveOneNavigationBudget;
}

/**
 * A detail work item accepts only a numeric list identity and a reviewed
 * list type.  The target URL is derived by the Gateway; an application can
 * never smuggle an arbitrary space path or page query through this type.
 */
export interface BilibiliCollectionSeriesDetailWorkInput {
  canonicalProfileUrl: string;
  canonicalDetailUrl: string;
  stableAccountId: string;
  stableSeriesId: string;
  listType: 'series' | 'season';
  pageBudget: 1;
}

export interface BilibiliCollectionSeriesDetailWorkItem extends PassiveWorkEnvelope {
  capability: 'bilibili.collection_series.detail';
  input: BilibiliCollectionSeriesDetailWorkInput;
  budget: BilibiliPassiveOneNavigationBudget;
}

export interface BilibiliDanmakuWorkInput {
  canonicalVideoUrl: string;
  bvid: string;
}

export interface BilibiliDanmakuWorkItem extends PassiveWorkEnvelope {
  capability: 'bilibili.danmaku';
  input: BilibiliDanmakuWorkInput;
  budget: BilibiliPassiveOneNavigationBudget;
}

export type BilibiliPassiveExtensionWorkItem =
  | BilibiliDynamicWorkItem
  | BilibiliCollectionSeriesOverviewWorkItem
  | BilibiliCollectionSeriesDetailWorkItem
  | BilibiliDanmakuWorkItem;

export type UnsignedBilibiliPassiveExtensionWorkItem =
  | Omit<BilibiliDynamicWorkItem, 'gatewaySignature'>
  | Omit<BilibiliCollectionSeriesOverviewWorkItem, 'gatewaySignature'>
  | Omit<BilibiliCollectionSeriesDetailWorkItem, 'gatewaySignature'>
  | Omit<BilibiliDanmakuWorkItem, 'gatewaySignature'>;

export interface BilibiliDynamicDomCard {
  author: string | null;
  publishedVisibleText: string | null;
  visibleText: string | null;
  links: Array<{ text: string; url: string }>;
  imageUrls: string[];
  kind: 'video' | 'opus' | 'blocked' | 'other';
  blockedPlaceholder: boolean;
  reservation: boolean;
  forwarded: boolean;
}

export interface BilibiliDynamicDomObservation {
  stableAccountId: string | null;
  feedVisible: boolean;
  activeFilterLabel: string | null;
  cards: BilibiliDynamicDomCard[];
  loginOverlayVisible: boolean;
  risk: BilibiliPassiveWorkRisk;
}

export interface BilibiliCollectionSeriesOverviewDomItem {
  listType: 'series' | 'season';
  stableSeriesId: string | null;
  title: string;
  declaredItemCount: number | null;
  previewBvids: string[];
}

export interface BilibiliCollectionSeriesOverviewDomObservation {
  stableAccountId: string | null;
  listVisible: boolean;
  items: BilibiliCollectionSeriesOverviewDomItem[];
  loginOverlayVisible: boolean;
  risk: BilibiliPassiveWorkRisk;
}

export interface BilibiliCollectionSeriesDetailDomCard {
  bvid: string;
  title: string | null;
}

export interface BilibiliCollectionSeriesDetailDomObservation {
  stableAccountId: string | null;
  stableSeriesId: string | null;
  listType: 'series' | 'season' | null;
  detailVisible: boolean;
  visibleTitle: string | null;
  declaredItemCount: number | null;
  activePageNumber: number | null;
  cards: BilibiliCollectionSeriesDetailDomCard[];
  loginOverlayVisible: boolean;
  risk: BilibiliPassiveWorkRisk;
}

export interface BilibiliDanmakuDomItem {
  text: string;
  top: number | null;
  color: string | null;
  fontSize: number | null;
}

/** Passive player projection: no player click, menu open, scroll or binary stream read. */
export interface BilibiliDanmakuDomObservation {
  bvid: string | null;
  playerVisible: boolean;
  danmakuOverlayVisible: boolean;
  danmakuEnabled: boolean | null;
  overlayItems: BilibiliDanmakuDomItem[];
  listControlVisible: boolean;
  listOpen: boolean;
  listRowCount: number;
  listTotalEstimate: number | null;
  loginOverlayVisible: boolean;
  risk: BilibiliPassiveWorkRisk;
}

export type BilibiliPassiveExtensionWorkTerminalReason =
  | 'dynamic_ready'
  | 'dynamic_empty'
  | 'dynamic_partial'
  | 'collection_series_overview_ready'
  | 'collection_series_overview_empty'
  | 'collection_series_overview_partial'
  | 'collection_series_detail_ready'
  | 'collection_series_detail_partial'
  | 'danmaku_ready'
  | 'danmaku_partial'
  | PassiveSharedTerminalReason;

export type PassiveSharedTerminalReason =
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

interface PassiveWorkResultEnvelope {
  schemaVersion: 1;
  protocolVersion: 1;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili';
  executionTarget: 'collector_work_tab';
  state: BilibiliPassiveWorkState;
  errorCode: string | null;
  completedAt: string;
  navigation: { attempted: boolean; attemptCount: 0 | 1 };
  workTabAcquisition: 'created' | 'reused' | 'not_acquired';
  workTabDisposition: 'idle_reusable' | 'retained_not_reusable' | 'user_taken_over' | 'closed_or_missing';
}

export interface BilibiliDynamicWorkResult extends PassiveWorkResultEnvelope {
  capability: 'bilibili.dynamic';
  terminalReason: BilibiliPassiveExtensionWorkTerminalReason;
  observation: BilibiliDynamicDomObservation | null;
}

export interface BilibiliCollectionSeriesOverviewWorkResult extends PassiveWorkResultEnvelope {
  capability: 'bilibili.collection_series.overview';
  terminalReason: BilibiliPassiveExtensionWorkTerminalReason;
  observation: BilibiliCollectionSeriesOverviewDomObservation | null;
}

export interface BilibiliCollectionSeriesDetailWorkResult extends PassiveWorkResultEnvelope {
  capability: 'bilibili.collection_series.detail';
  terminalReason: BilibiliPassiveExtensionWorkTerminalReason;
  observation: BilibiliCollectionSeriesDetailDomObservation | null;
}

export interface BilibiliDanmakuWorkResult extends PassiveWorkResultEnvelope {
  capability: 'bilibili.danmaku';
  terminalReason: BilibiliPassiveExtensionWorkTerminalReason;
  observation: BilibiliDanmakuDomObservation | null;
}

export type BilibiliPassiveExtensionWorkResult =
  | BilibiliDynamicWorkResult
  | BilibiliCollectionSeriesOverviewWorkResult
  | BilibiliCollectionSeriesDetailWorkResult
  | BilibiliDanmakuWorkResult;

export function canonicalBilibiliDynamicWorkUrl(value: string, mode: 'strict_input' | 'observed_document' = 'strict_input'): string | null {
  try {
    const url = new URL(value);
    const match = url.protocol === 'https:' && url.hostname === 'space.bilibili.com'
      ? url.pathname.match(/^\/(\d{1,20})\/dynamic\/?$/)
      : null;
    if (!match || url.username || url.password || url.hash || (mode === 'strict_input' && url.search)) return null;
    return `https://space.bilibili.com/${match[1]}/dynamic`;
  } catch {
    return null;
  }
}

export function canonicalBilibiliCollectionSeriesOverviewWorkUrl(
  value: string,
  mode: 'strict_input' | 'observed_document' = 'strict_input'
): string | null {
  try {
    const url = new URL(value);
    const match = url.protocol === 'https:' && url.hostname === 'space.bilibili.com'
      ? url.pathname.match(/^\/(\d{1,20})\/lists\/?$/)
      : null;
    if (!match || url.username || url.password || url.hash || (mode === 'strict_input' && url.search)) return null;
    return `https://space.bilibili.com/${match[1]}/lists`;
  } catch {
    return null;
  }
}

export function canonicalBilibiliCollectionSeriesDetailWorkUrl(
  value: string,
  mode: 'strict_input' | 'observed_document' = 'strict_input'
): string | null {
  try {
    const url = new URL(value);
    const match = url.protocol === 'https:' && url.hostname === 'space.bilibili.com'
      ? url.pathname.match(/^\/(\d{1,20})\/lists\/(\d{1,20})\/?$/)
      : null;
    const type = url.searchParams.get('type');
    if (!match || !['series', 'season'].includes(type ?? '') || url.searchParams.getAll('type').length !== 1 ||
      [...url.searchParams.keys()].some((key) => key !== 'type') || url.username || url.password || url.hash) return null;
    const canonical = `https://space.bilibili.com/${match[1]}/lists/${match[2]}?type=${type}`;
    return mode === 'strict_input' && url.href !== canonical ? null : canonical;
  } catch {
    return null;
  }
}

/**
 * Signed input remains query-free.  A reached Bilibili document can append
 * transient attribution/navigation query values, which are discarded only
 * after the public video identity has been checked and are never persisted.
 */
export function canonicalBilibiliPassiveVideoWorkUrl(
  value: string,
  mode: 'strict_input' | 'observed_document' = 'strict_input'
): string | null {
  try {
    const url = new URL(value);
    const bvid = url.protocol === 'https:' && url.hostname === 'www.bilibili.com'
      ? url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null
      : null;
    if (!bvid || url.username || url.password || url.hash || (mode === 'strict_input' && url.search)) return null;
    return `https://www.bilibili.com/video/${bvid}`;
  } catch {
    return null;
  }
}

export function bilibiliPassiveExtensionWorkTargetUrl(item: BilibiliPassiveExtensionWorkItem): string {
  switch (item.capability) {
    case 'bilibili.dynamic':
      return item.input.canonicalDynamicUrl;
    case 'bilibili.collection_series.overview':
      return item.input.canonicalOverviewUrl;
    case 'bilibili.collection_series.detail':
      return item.input.canonicalDetailUrl;
    case 'bilibili.danmaku':
      return item.input.canonicalVideoUrl;
  }
}

export function isBilibiliPassiveExtensionWorkItem(value: unknown): value is BilibiliPassiveExtensionWorkItem {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'issuedAt', 'expiresAt', 'input', 'budget', 'gatewaySignature'
  ]) || value.schemaVersion !== 1 || value.protocolVersion !== 1 || !isUuid(value.workId) ||
    !isUuid(value.operationId) || !isUuid(value.browserBindingId) || value.platform !== 'bilibili' ||
    value.executionTarget !== 'collector_work_tab' || !isTimestamp(value.issuedAt) || !isTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) || !isSignature(value.gatewaySignature) ||
    !isBilibiliPassiveOneNavigationBudget(value.budget)
  ) return false;
  if (value.capability === 'bilibili.dynamic') return isDynamicInput(value.input);
  if (value.capability === 'bilibili.collection_series.overview') return isOverviewInput(value.input);
  if (value.capability === 'bilibili.collection_series.detail') return isDetailInput(value.input);
  if (value.capability === 'bilibili.danmaku') return isDanmakuInput(value.input);
  return false;
}

export function isBilibiliPassiveExtensionWorkResult(value: unknown): value is BilibiliPassiveExtensionWorkResult {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'state', 'errorCode', 'terminalReason', 'completedAt', 'navigation',
    'workTabAcquisition', 'workTabDisposition', 'observation'
  ]) || value.schemaVersion !== 1 || value.protocolVersion !== 1 || !isUuid(value.workId) ||
    !isUuid(value.operationId) || !isUuid(value.browserBindingId) || value.platform !== 'bilibili' ||
    value.executionTarget !== 'collector_work_tab' || !isTerminalState(value.state) || !isSafeNullableErrorCode(value.errorCode) ||
    !isTimestamp(value.completedAt) || !isNavigation(value.navigation) || !isWorkTabAcquisition(value.workTabAcquisition) ||
    !isWorkTabDisposition(value.workTabDisposition) || !isPassiveTerminalReason(value.terminalReason)
  ) return false;
  if (value.capability === 'bilibili.dynamic') return value.observation === null || isDynamicObservation(value.observation);
  if (value.capability === 'bilibili.collection_series.overview') return value.observation === null || isOverviewObservation(value.observation);
  if (value.capability === 'bilibili.collection_series.detail') return value.observation === null || isDetailObservation(value.observation);
  if (value.capability === 'bilibili.danmaku') return value.observation === null || isDanmakuObservation(value.observation);
  return false;
}

export function isBilibiliPassiveExtensionWorkResultForItem(
  value: unknown,
  item: BilibiliPassiveExtensionWorkItem
): value is BilibiliPassiveExtensionWorkResult {
  if (!isBilibiliPassiveExtensionWorkResult(value) || value.capability !== item.capability ||
    value.workId !== item.workId || value.operationId !== item.operationId ||
    value.browserBindingId !== item.browserBindingId || Date.parse(value.completedAt) < Date.parse(item.issuedAt) ||
    value.navigation.attemptCount !== (value.navigation.attempted ? 1 : 0)
  ) return false;
  if (value.state !== 'completed') return true;
  if (value.errorCode !== null || value.observation === null || value.navigation.attemptCount !== 1 ||
    value.workTabDisposition !== 'idle_reusable' || value.observation.risk.verificationRequired ||
    value.observation.risk.rateLimited || value.observation.risk.sourceUnavailable
  ) return false;
  if (item.capability === 'bilibili.dynamic' && value.capability === 'bilibili.dynamic') {
    if (value.observation.stableAccountId !== item.input.stableAccountId || !value.observation.feedVisible) return false;
    return value.terminalReason === 'dynamic_ready'
      ? value.observation.cards.length > 0
      : value.terminalReason === 'dynamic_empty' && value.observation.cards.length === 0;
  }
  if (item.capability === 'bilibili.collection_series.overview' && value.capability === 'bilibili.collection_series.overview') {
    if (value.observation.stableAccountId !== item.input.stableAccountId || !value.observation.listVisible) return false;
    return value.terminalReason === 'collection_series_overview_ready'
      ? value.observation.items.length > 0
      : value.terminalReason === 'collection_series_overview_empty' && value.observation.items.length === 0;
  }
  if (item.capability === 'bilibili.collection_series.detail' && value.capability === 'bilibili.collection_series.detail') {
    return value.terminalReason === 'collection_series_detail_ready' && value.observation.detailVisible &&
      value.observation.stableAccountId === item.input.stableAccountId &&
      value.observation.stableSeriesId === item.input.stableSeriesId &&
      value.observation.listType === item.input.listType;
  }
  if (item.capability === 'bilibili.danmaku' && value.capability === 'bilibili.danmaku') {
    return value.terminalReason === 'danmaku_ready' && value.observation.playerVisible &&
      value.observation.bvid === item.input.bvid;
  }
  return false;
}

export function isBilibiliPassiveOneNavigationBudget(value: unknown): value is BilibiliPassiveOneNavigationBudget {
  return isRecord(value) && hasExactKeys(value, [
    'maximumPlatformNavigations', 'maximumSemanticActions', 'maximumResponseObservations', 'maximumPayloadBytes'
  ]) && value.maximumPlatformNavigations === 1 && value.maximumSemanticActions === 0 &&
    value.maximumResponseObservations === 0 && value.maximumPayloadBytes === 98_304;
}

function isDynamicInput(value: unknown): value is BilibiliDynamicWorkInput {
  if (!isRecord(value) || !hasExactKeys(value, ['canonicalProfileUrl', 'canonicalDynamicUrl', 'stableAccountId']) ||
    typeof value.canonicalProfileUrl !== 'string' || typeof value.canonicalDynamicUrl !== 'string' || !isAccountId(value.stableAccountId)
  ) return false;
  return canonicalBilibiliAccountProfileUrl(value.canonicalProfileUrl, 'strict_input') === value.canonicalProfileUrl &&
    bilibiliAccountProfileIdFromUrl(value.canonicalProfileUrl) === value.stableAccountId &&
    canonicalBilibiliDynamicWorkUrl(value.canonicalDynamicUrl, 'strict_input') === value.canonicalDynamicUrl &&
    value.canonicalDynamicUrl === `${value.canonicalProfileUrl}/dynamic`;
}

function isOverviewInput(value: unknown): value is BilibiliCollectionSeriesOverviewWorkInput {
  if (!isRecord(value) || !hasExactKeys(value, ['canonicalProfileUrl', 'canonicalOverviewUrl', 'stableAccountId']) ||
    typeof value.canonicalProfileUrl !== 'string' || typeof value.canonicalOverviewUrl !== 'string' || !isAccountId(value.stableAccountId)
  ) return false;
  return canonicalBilibiliAccountProfileUrl(value.canonicalProfileUrl, 'strict_input') === value.canonicalProfileUrl &&
    bilibiliAccountProfileIdFromUrl(value.canonicalProfileUrl) === value.stableAccountId &&
    canonicalBilibiliCollectionSeriesOverviewWorkUrl(value.canonicalOverviewUrl, 'strict_input') === value.canonicalOverviewUrl &&
    value.canonicalOverviewUrl === `${value.canonicalProfileUrl}/lists`;
}

function isDetailInput(value: unknown): value is BilibiliCollectionSeriesDetailWorkInput {
  if (!isRecord(value) || !hasExactKeys(value, [
    'canonicalProfileUrl', 'canonicalDetailUrl', 'stableAccountId', 'stableSeriesId', 'listType', 'pageBudget'
  ]) || typeof value.canonicalProfileUrl !== 'string' || typeof value.canonicalDetailUrl !== 'string' ||
    !isAccountId(value.stableAccountId) || !isAccountId(value.stableSeriesId) ||
    (value.listType !== 'series' && value.listType !== 'season') || value.pageBudget !== 1
  ) return false;
  return canonicalBilibiliAccountProfileUrl(value.canonicalProfileUrl, 'strict_input') === value.canonicalProfileUrl &&
    bilibiliAccountProfileIdFromUrl(value.canonicalProfileUrl) === value.stableAccountId &&
    canonicalBilibiliCollectionSeriesDetailWorkUrl(value.canonicalDetailUrl, 'strict_input') === value.canonicalDetailUrl &&
    value.canonicalDetailUrl === `${value.canonicalProfileUrl}/lists/${value.stableSeriesId}?type=${value.listType}`;
}

function isDanmakuInput(value: unknown): value is BilibiliDanmakuWorkInput {
  if (!isRecord(value) || !hasExactKeys(value, ['canonicalVideoUrl', 'bvid']) ||
    typeof value.canonicalVideoUrl !== 'string' || !isBvid(value.bvid)
  ) return false;
  return canonicalBilibiliPassiveVideoWorkUrl(value.canonicalVideoUrl) === `https://www.bilibili.com/video/${value.bvid}`;
}

function isDynamicObservation(value: unknown): value is BilibiliDynamicDomObservation {
  return isRecord(value) && hasExactKeys(value, ['stableAccountId', 'feedVisible', 'activeFilterLabel', 'cards', 'loginOverlayVisible', 'risk']) &&
    isNullableAccountId(value.stableAccountId) && typeof value.feedVisible === 'boolean' && isNullableText(value.activeFilterLabel, 80) &&
    isArrayAtMost(value.cards, 24, isDynamicCard) && typeof value.loginOverlayVisible === 'boolean' && isRisk(value.risk);
}

function isOverviewObservation(value: unknown): value is BilibiliCollectionSeriesOverviewDomObservation {
  return isRecord(value) && hasExactKeys(value, ['stableAccountId', 'listVisible', 'items', 'loginOverlayVisible', 'risk']) &&
    isNullableAccountId(value.stableAccountId) && typeof value.listVisible === 'boolean' &&
    isArrayAtMost(value.items, 50, isOverviewItem) && typeof value.loginOverlayVisible === 'boolean' && isRisk(value.risk);
}

function isDetailObservation(value: unknown): value is BilibiliCollectionSeriesDetailDomObservation {
  return isRecord(value) && hasExactKeys(value, [
    'stableAccountId', 'stableSeriesId', 'listType', 'detailVisible', 'visibleTitle', 'declaredItemCount',
    'activePageNumber', 'cards', 'loginOverlayVisible', 'risk'
  ]) && isNullableAccountId(value.stableAccountId) && isNullableAccountId(value.stableSeriesId) &&
    (value.listType === null || value.listType === 'series' || value.listType === 'season') &&
    typeof value.detailVisible === 'boolean' && isNullableText(value.visibleTitle, 500) &&
    isNullableNonNegativeInteger(value.declaredItemCount) && isNullablePositiveInteger(value.activePageNumber) &&
    isArrayAtMost(value.cards, 50, isDetailCard) && typeof value.loginOverlayVisible === 'boolean' && isRisk(value.risk);
}

function isDanmakuObservation(value: unknown): value is BilibiliDanmakuDomObservation {
  return isRecord(value) && hasExactKeys(value, [
    'bvid', 'playerVisible', 'danmakuOverlayVisible', 'danmakuEnabled', 'overlayItems', 'listControlVisible',
    'listOpen', 'listRowCount', 'listTotalEstimate', 'loginOverlayVisible', 'risk'
  ]) && (value.bvid === null || isBvid(value.bvid)) && typeof value.playerVisible === 'boolean' &&
    typeof value.danmakuOverlayVisible === 'boolean' && (value.danmakuEnabled === null || typeof value.danmakuEnabled === 'boolean') &&
    isArrayAtMost(value.overlayItems, 32, isDanmakuItem) && typeof value.listControlVisible === 'boolean' &&
    typeof value.listOpen === 'boolean' && isNonNegativeInteger(value.listRowCount) &&
    isNullableNonNegativeInteger(value.listTotalEstimate) && typeof value.loginOverlayVisible === 'boolean' && isRisk(value.risk);
}

function isDynamicCard(value: unknown): value is BilibiliDynamicDomCard {
  return isRecord(value) && hasExactKeys(value, [
    'author', 'publishedVisibleText', 'visibleText', 'links', 'imageUrls', 'kind', 'blockedPlaceholder', 'reservation', 'forwarded'
  ]) && isNullableText(value.author, 200) && isNullableText(value.publishedVisibleText, 200) &&
    isNullableText(value.visibleText, 3_000) && isArrayAtMost(value.links, 12, isDynamicLink) &&
    isTextArray(value.imageUrls, 8, 2_000, isPublicImageUrl) &&
    (value.kind === 'video' || value.kind === 'opus' || value.kind === 'blocked' || value.kind === 'other') &&
    typeof value.blockedPlaceholder === 'boolean' && typeof value.reservation === 'boolean' && typeof value.forwarded === 'boolean';
}

function isDynamicLink(value: unknown): value is BilibiliDynamicDomCard['links'][number] {
  return isRecord(value) && hasExactKeys(value, ['text', 'url']) && isNullableText(value.text, 240) && isPublicDocumentUrl(value.url);
}

function isOverviewItem(value: unknown): value is BilibiliCollectionSeriesOverviewDomItem {
  return isRecord(value) && hasExactKeys(value, ['listType', 'stableSeriesId', 'title', 'declaredItemCount', 'previewBvids']) &&
    (value.listType === 'series' || value.listType === 'season') && isNullableAccountId(value.stableSeriesId) &&
    isText(value.title, 500) && isNullableNonNegativeInteger(value.declaredItemCount) && isTextArray(value.previewBvids, 30, 12, isBvid);
}

function isDetailCard(value: unknown): value is BilibiliCollectionSeriesDetailDomCard {
  return isRecord(value) && hasExactKeys(value, ['bvid', 'title']) && isBvid(value.bvid) && isNullableText(value.title, 500);
}

function isDanmakuItem(value: unknown): value is BilibiliDanmakuDomItem {
  return isRecord(value) && hasExactKeys(value, ['text', 'top', 'color', 'fontSize']) && isText(value.text, 4_000) &&
    isNullableFinite(value.top) && isNullableText(value.color, 100) && isNullableFinite(value.fontSize);
}

function isRisk(value: unknown): value is BilibiliPassiveWorkRisk {
  return isRecord(value) && hasExactKeys(value, ['verificationRequired', 'rateLimited', 'sourceUnavailable']) &&
    typeof value.verificationRequired === 'boolean' && typeof value.rateLimited === 'boolean' &&
    typeof value.sourceUnavailable === 'boolean';
}

function isPassiveTerminalReason(value: unknown): value is BilibiliPassiveExtensionWorkTerminalReason {
  return value === 'dynamic_ready' || value === 'dynamic_empty' || value === 'dynamic_partial' ||
    value === 'collection_series_overview_ready' || value === 'collection_series_overview_empty' ||
    value === 'collection_series_overview_partial' || value === 'collection_series_detail_ready' ||
    value === 'collection_series_detail_partial' || value === 'danmaku_ready' || value === 'danmaku_partial' ||
    isSharedTerminalReason(value);
}

function isSharedTerminalReason(value: unknown): value is PassiveSharedTerminalReason {
  return value === 'verification_required' || value === 'rate_limited' || value === 'source_unavailable' ||
    value === 'dom_projection_failed' || value === 'document_context_changed' || value === 'run_deadline_exceeded' ||
    value === 'work_tab_closed' || value === 'work_tab_user_taken_over' || value === 'navigation_outcome_unknown' ||
    value === 'gateway_restarted_before_completion';
}

function isTerminalState(value: unknown): value is BilibiliPassiveWorkState {
  return value === 'completed' || value === 'partial' || value === 'stopped' || value === 'failed';
}

function isNavigation(value: unknown): value is PassiveWorkResultEnvelope['navigation'] {
  return isRecord(value) && hasExactKeys(value, ['attempted', 'attemptCount']) && typeof value.attempted === 'boolean' &&
    (value.attemptCount === 0 || value.attemptCount === 1);
}

function isWorkTabAcquisition(value: unknown): boolean {
  return value === 'created' || value === 'reused' || value === 'not_acquired';
}

function isWorkTabDisposition(value: unknown): boolean {
  return value === 'idle_reusable' || value === 'retained_not_reusable' || value === 'user_taken_over' || value === 'closed_or_missing';
}

function isNullableAccountId(value: unknown): value is string | null {
  return value === null || isAccountId(value);
}

function isAccountId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,20}$/.test(value) && value !== '0';
}

function isBvid(value: unknown): value is string {
  return typeof value === 'string' && /^BV[0-9A-Za-z]{10}$/.test(value);
}

function isNullableText(value: unknown, maximum: number): value is string | null {
  return value === null || isText(value, maximum);
}

function isText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim().length > 0 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function isTextArray(value: unknown, maximumItems: number, maximumLength: number, predicate: (item: unknown) => boolean = () => true): value is string[] {
  return Array.isArray(value) && value.length <= maximumItems && value.every((item) => isText(item, maximumLength) && predicate(item));
}

function isArrayAtMost<T>(value: unknown, maximumItems: number, predicate: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.length <= maximumItems && value.every(predicate);
}

function isPublicDocumentUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_000) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isPublicImageUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

function isNullablePositiveInteger(value: unknown): value is number | null {
  return value === null || (isNonNegativeInteger(value) && value > 0);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNullableFinite(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
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
