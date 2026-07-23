import {
  canonicalBilibiliProfileUrl,
  safeBilibiliPublicImageUrl,
  stableAccountIdFromProfileUrl
} from './bilibili-account-archive-contract';
import type { ResponseSchemaPath } from './interaction-reconnaissance-contract';

export const BILIBILI_DYNAMIC_FEED_PATH = '/x/polymer/web-dynamic/v1/feed/space' as const;
export const BILIBILI_DYNAMIC_MAX_PAGES = 20;
export const BILIBILI_DYNAMIC_MAX_ITEMS_PER_PAGE = 50;
export const BILIBILI_DYNAMIC_RESPONSE_LIMIT = 3 * 1024 * 1024;

export interface BilibiliDynamicInput {
  canonicalProfileUrl: string;
  maxPages: number;
}

export interface BilibiliDynamicPrimaryIdentity {
  kind: 'video' | 'opus' | 'article' | 'live' | 'url' | 'dynamic';
  stableId: string;
  canonicalUrl: string;
}

export interface BilibiliDynamicResponseItem {
  stableDynamicId: string;
  dynamicType: string;
  stableAccountId: string;
  displayName: string;
  publishedAction: string | null;
  publishedVisibleText: string | null;
  publishedAt: string | null;
  visibleText: string | null;
  majorType: string | null;
  majorTitle: string | null;
  reservationTitle: string | null;
  additionalGoodsHeadText: string | null;
  additionalUpowerLotteryTitle: string | null;
  primaryIdentity: BilibiliDynamicPrimaryIdentity;
  responseVisible: boolean | null;
  accessState: 'public' | 'restricted_placeholder';
  isPinned: boolean;
  publicMetrics: {
    comments: number | null;
    forwards: number | null;
    likes: number | null;
  };
  forwardedSource: {
    stableDynamicId: string;
    dynamicType: string | null;
    stableAccountId: string | null;
    displayName: string | null;
    visibleText: string | null;
    primaryIdentity: BilibiliDynamicPrimaryIdentity | null;
  } | null;
  forwardedSourceState: 'not_forward' | 'captured' | 'unavailable';
  pageNumber: number;
  positionOnPage: number;
}

export interface BilibiliDynamicPageCandidate {
  pageNumber: number;
  items: BilibiliDynamicResponseItem[];
  hasMore: boolean;
  nextOffset: string;
  totalHint: string | null;
}

export interface BilibiliDynamicDomCardObservation {
  position: number;
  outerAuthor: string;
  publishedVisibleText: string | null;
  visibleText: string;
  links: Array<{ text: string; url: string }>;
  images: Array<{ alt: string; url: string }>;
  identityAttributeCandidates: Array<{ name: string; value: string }>;
  kind: 'video' | 'opus' | 'blocked' | 'other';
  blockedPlaceholder: boolean;
  reservation: boolean;
  forwarded: boolean;
}

export interface BilibiliDynamicDomSnapshot {
  stableAccountId: string | null;
  visibleFilterLabels: string[];
  activeFilterLabel: string | null;
  cards: BilibiliDynamicDomCardObservation[];
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

export interface BilibiliDynamicItemProjection extends BilibiliDynamicResponseItem {
  card: {
    outerAuthor: string;
    publishedVisibleText: string | null;
    visibleText: string;
    links: Array<{ text: string; url: string }>;
    mediaRefs: Array<{ alt: string; url: string }>;
    kind: BilibiliDynamicDomCardObservation['kind'];
    blockedPlaceholder: boolean;
    reservation: boolean;
    forwarded: boolean;
  };
  domEvidence: BilibiliDynamicCardEvidenceCheck;
}

/**
 * The non-identifying facts used to prove that a response page and the
 * rendered dynamic-card sequence describe the same public page.  It is kept
 * separate from item/card projections so a rejected page can still be
 * diagnosed without persisting its public text or response-derived records.
 */
export interface BilibiliDynamicDomResponseCrossCheck {
  responsePageItems: number;
  responseCumulativeItems: number;
  domCumulativeCards: number;
  matchedPageCards: number;
  cardEvidenceMatches: number;
  accessStateMatches: number;
  forwardedStateMatches: number;
  crossCheckablePrimaryIdentities: number;
  primaryIdentityMatches: number;
  textMatches: number;
  authorMatches: number;
  publicationMatches: number;
  exactCumulativeCardCount: boolean;
  responsePageDynamicIdDigest: string;
  responseCumulativeDynamicIdDigest: string;
}

/**
 * Per-card booleans calculated by the same strict evidence rule used for the
 * aggregate page gate.  It deliberately carries no response or DOM text.
 */
export interface BilibiliDynamicCardEvidenceCheck {
  authorMatch: boolean;
  publicationMatch: boolean;
  primaryIdentityCrossCheckable: boolean;
  primaryIdentityMatch: boolean;
  textMatch: boolean;
  accessStateMatch: boolean;
  forwardedStateMatch: boolean;
  cardEvidenceMatch: boolean;
}

/**
 * A redacted explanation for one response/DOM card pair.  Positions are local
 * to a single observed page; stable dynamic IDs, text, URLs, and author names
 * must not be added here.
 */
export interface BilibiliDynamicCardCrossCheckDiagnostic {
  positionOnPage: number;
  cardKind: BilibiliDynamicDomCardObservation['kind'];
  domLinkCount: number;
  domMediaRefCount: number;
  domReservation: boolean;
  domBlockedPlaceholder: boolean;
  domForwarded: boolean;
  responsePrimaryIdentityKind: BilibiliDynamicPrimaryIdentity['kind'];
  responseAccessState: BilibiliDynamicResponseItem['accessState'];
  responseForwardedState: BilibiliDynamicResponseItem['forwardedSourceState'];
  responseTextCandidateCount: 0 | 1 | 2 | 3 | 4 | 5;
  checks: BilibiliDynamicCardEvidenceCheck;
}

export interface BilibiliDynamicPageProjection {
  schemaVersion: 1;
  pageNumber: number;
  items: BilibiliDynamicItemProjection[];
  hasMore: boolean;
  nextOffsetPresent: boolean;
  totalHint: string | null;
  responseStatus: number;
  responseBodyBytes: number;
  responseBodySha256: string;
  queryKeyNames: string[];
  schemaPaths: ResponseSchemaPath[];
  sensitiveFieldPathsOmitted: number;
  domCrossCheck: BilibiliDynamicDomResponseCrossCheck;
  capturedAt: string;
}

export type BilibiliDynamicCrossCheckFailure =
  | 'cumulative_card_count_mismatch'
  | 'page_card_alignment_mismatch'
  | 'card_evidence_mismatch'
  | 'author_mismatch'
  | 'access_state_mismatch'
  | 'forwarded_state_mismatch';

/**
 * Safe failure evidence for a strict DOM/response cross-check.  This must
 * never contain a dynamic ID, author/display name, visible text, URL query
 * value, response body, or DOM selector.
 */
export interface BilibiliDynamicCrossCheckDiagnostic {
  schemaVersion: 1;
  pageNumber: number;
  itemCount: number;
  domCrossCheck: BilibiliDynamicDomResponseCrossCheck;
  failedChecks: BilibiliDynamicCrossCheckFailure[];
  cards: BilibiliDynamicCardCrossCheckDiagnostic[];
}

/**
 * A value-free explanation of which public response text fields are actually
 * rendered by a reservation Opus card. It is research evidence only: dynamic
 * IDs, text, URLs, display names, and raw response values are intentionally
 * excluded.
 */
export interface BilibiliDynamicReservationOpusFieldDiagnostic {
  schemaVersion: 1;
  responseItemCount: number;
  domCardCount: number;
  exactCardCountAlignment: boolean;
  cards: Array<{
    positionOnPage: number;
    responsePrimaryIdentityKind: BilibiliDynamicPrimaryIdentity['kind'];
    responseMajorType: string | null;
    domCardKind: BilibiliDynamicDomCardObservation['kind'];
    domReservation: true;
    genericVisibleTextMatch: boolean;
    genericMajorTitleMatch: boolean;
    matchingFieldPaths: Array<
      | 'modules.module_dynamic.desc.text'
      | 'modules.module_dynamic.major.opus.title'
      | 'modules.module_dynamic.major.opus.desc'
      | 'modules.module_dynamic.major.opus.summary.text'
      | 'modules.module_dynamic.additional.reserve.title'
      | 'modules.module_dynamic.additional.reserve.desc1'
      | 'modules.module_dynamic.additional.reserve.desc2'
    >;
  }>;
}

/**
 * Value-free research evidence for ordinary Opus cards whose rendered text is
 * not covered by the current response candidate allowlist. Field paths are
 * generated only from a bounded scan under `modules.module_dynamic`; neither
 * response values nor DOM text are durable diagnostic fields.
 */
export interface BilibiliDynamicOpusFieldDiagnostic {
  schemaVersion: 1;
  pageNumber: number;
  responseItemCount: number;
  domCardCount: number;
  exactCardCountAlignment: boolean;
  cards: Array<{
    positionOnPage: number;
    responseMajorType: string | null;
    domCardKind: BilibiliDynamicDomCardObservation['kind'];
    domReservation: false;
    genericVisibleTextMatch: boolean;
    genericMajorTitleMatch: boolean;
    exactPrimaryIdentityLinkPresent: boolean;
    matchingStableDynamicIdAttributeNames: string[];
    candidateTextPathCount: number;
    matchingFieldPaths: string[];
  }>;
}

export interface BilibiliDynamicResponseEvidence {
  pathname: typeof BILIBILI_DYNAMIC_FEED_PATH;
  pageNumber: number;
  responseStatus: number;
  responseBodyBytes: number;
  responseBodySha256: string;
  queryKeyNames: string[];
  schemaPaths: ResponseSchemaPath[];
  sensitiveFieldPathsOmitted: number;
}

export type BilibiliDynamicVisualEvidencePhase = 'baseline' | 'after_trusted_scroll';

export interface BilibiliDynamicVisualEvidence {
  phase: BilibiliDynamicVisualEvidencePhase;
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

export interface BilibiliDynamicScrollEvidence {
  deltaY: number;
  beforeScrollY: number;
  afterScrollY: number;
  beforeScrollHeight: number;
  afterScrollHeight: number;
  viewportHeight: number;
}

export interface BilibiliDynamicAction {
  actionId: string;
  kind: 'navigation' | 'trusted_scroll';
  intent: string;
  expectedPageNumber: number;
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
  errorCode: string | null;
  scroll: BilibiliDynamicScrollEvidence | null;
}

export type BilibiliDynamicTerminalReason =
  | 'feed_terminal_reached'
  | 'budget_exhausted'
  | 'verification_required'
  | 'rate_limited'
  | 'risk_controlled'
  | 'response_status_unavailable'
  | 'response_projection_failed'
  | 'dom_response_mismatch'
  | 'duplicate_dynamic_id'
  | 'scroll_response_not_observed'
  | 'context_changed'
  | 'run_deadline_exceeded'
  | 'source_unavailable';

export interface BilibiliDynamicRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'dynamic_inventory';
  targetUrlDigest: string;
  strategyCandidate: {
    strategyId: 'bilibili.dynamic.account-feed.response-dom.v1';
    version: '1.2.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  stableAccountId: string;
  failedResponseEvidence: BilibiliDynamicResponseEvidence | null;
  crossCheckDiagnostic: BilibiliDynamicCrossCheckDiagnostic | null;
  reservationOpusFieldDiagnostic: BilibiliDynamicReservationOpusFieldDiagnostic | null;
  opusFieldDiagnostic: BilibiliDynamicOpusFieldDiagnostic | null;
  visualEvidence: BilibiliDynamicVisualEvidence[];
  pages: BilibiliDynamicPageProjection[];
  actions: BilibiliDynamicAction[];
  coverage: {
    plannedMaximumPages: number;
    capturedPages: number;
    capturedItems: number;
    uniqueItems: number;
    duplicateItems: number;
    unresolvedCardEvidenceItems: number;
    forwardedItems: number;
    restrictedPlaceholderItems: number;
    dynamicTypes: Array<{ type: string; count: number }>;
    majorTypes: Array<{ type: string; count: number }>;
    domCardKinds: Array<{ kind: BilibiliDynamicDomCardObservation['kind']; count: number }>;
    completeWithinAccountFeed: boolean;
    terminalReason: BilibiliDynamicTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'trusted_navigation_plus_dom_response_projection';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    networkQueryAndFragmentValues: 'discarded';
    cursorValue: 'used_in_memory_not_persisted';
    responseProjection: 'public_dynamic_identity_author_text_relation_and_metrics_allowlist';
    cardProjection: 'bounded_visible_text_links_and_public_media';
    restrictedContent: 'public_visible_placeholders_only_no_unlock_attempts';
    discussion: 'excluded_separate_capability';
    unknownResponseValues: 'not_persisted';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  // The MV3 network boundary uses this marker when a nested response value
  // exceeds its redaction depth budget. It is an implementation sentinel,
  // never public platform content, and must not become a durable field or a
  // false DOM/response mismatch.
  if (!clean || clean === '[truncated: depth limit]' || clean.length > maximum || /[\u0000-\u001f\u007f]/.test(clean)) return null;
  return clean;
}

function stablePositiveId(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value
      : '';
  return /^\d{1,20}$/.test(text) && text !== '0' ? text : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function timestamp(value: unknown): string | null {
  const seconds = typeof value === 'string' && /^\d{1,12}$/.test(value)
    ? Number(value)
    : nonNegativeInteger(value);
  if (seconds === null || !Number.isSafeInteger(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1_000);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

function canonicalBvidUrl(value: unknown): BilibiliDynamicPrimaryIdentity | null {
  if (typeof value !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(value)) return null;
  return { kind: 'video', stableId: value, canonicalUrl: `https://www.bilibili.com/video/${value}` };
}

function canonicalPublicIdentityUrl(value: unknown): BilibiliDynamicPrimaryIdentity | null {
  if (typeof value !== 'string' || value.length > 2_000) return null;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value, 'https://www.bilibili.com/');
    const platformOwned = url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com') ||
      url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com') || url.hostname === 'b23.tv';
    if (url.protocol === 'http:' && platformOwned) url.protocol = 'https:';
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.local') ||
      /^\[.*\]$/.test(url.hostname) ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname)
    ) return null;
    const video = url.hostname === 'www.bilibili.com'
      ? url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)
      : null;
    if (video?.[1]) return canonicalBvidUrl(video[1]);
    const opus = url.hostname === 'www.bilibili.com'
      ? url.pathname.match(/^\/opus\/(\d{1,20})\/?$/)
      : null;
    if (opus?.[1]) return { kind: 'opus', stableId: opus[1], canonicalUrl: `https://www.bilibili.com/opus/${opus[1]}` };
    const article = url.hostname === 'www.bilibili.com'
      ? url.pathname.match(/^\/read\/cv(\d{1,20})\/?$/)
      : null;
    if (article?.[1]) return { kind: 'article', stableId: `cv${article[1]}`, canonicalUrl: `https://www.bilibili.com/read/cv${article[1]}` };
    const live = url.hostname === 'live.bilibili.com'
      ? url.pathname.match(/^\/(\d{1,20})\/?$/)
      : null;
    if (live?.[1]) return { kind: 'live', stableId: live[1], canonicalUrl: `https://live.bilibili.com/${live[1]}` };
    const dynamic = url.hostname === 't.bilibili.com' || url.hostname === 'www.bilibili.com'
      ? url.pathname.match(/^\/(?:dynamic\/)?(\d{1,20})\/?$/)
      : null;
    if (dynamic?.[1]) {
      return { kind: 'dynamic', stableId: dynamic[1], canonicalUrl: `https://t.bilibili.com/${dynamic[1]}` };
    }
    url.search = '';
    url.hash = '';
    const canonicalUrl = `${url.origin}${url.pathname}`;
    return { kind: 'url', stableId: canonicalUrl, canonicalUrl };
  } catch {
    return null;
  }
}

function primaryIdentityFromItem(value: Record<string, unknown>): BilibiliDynamicPrimaryIdentity | null {
  const modules = isRecord(value.modules) ? value.modules : {};
  const dynamic = isRecord(modules.module_dynamic) ? modules.module_dynamic : {};
  const major = isRecord(dynamic.major) ? dynamic.major : {};
  const archive = isRecord(major.archive) ? major.archive : {};
  const byBvid = canonicalBvidUrl(archive.bvid);
  if (byBvid) return byBvid;
  for (const childName of [
    'opus', 'article', 'draw', 'common', 'live_rcmd', 'pgc', 'courses', 'music', 'medialist'
  ]) {
    const child = isRecord(major[childName]) ? major[childName] as Record<string, unknown> : {};
    for (const field of ['jump_url', 'url']) {
      const identity = canonicalPublicIdentityUrl(child[field]);
      if (identity) return identity;
    }
  }
  const basic = isRecord(value.basic) ? value.basic : {};
  const basicIdentity = canonicalPublicIdentityUrl(basic.jump_url);
  if (
    basicIdentity &&
    !(basicIdentity.kind === 'url' && /^https:\/\/(?:www\.)?bilibili\.com\/$/.test(basicIdentity.canonicalUrl))
  ) return basicIdentity;
  const stableDynamicId = stablePositiveId(value.id_str);
  return stableDynamicId ? {
    kind: 'dynamic',
    stableId: stableDynamicId,
    canonicalUrl: `https://t.bilibili.com/${stableDynamicId}`
  } : null;
}

function majorTitleFromItem(value: Record<string, unknown>): string | null {
  const modules = isRecord(value.modules) ? value.modules : {};
  const dynamic = isRecord(modules.module_dynamic) ? modules.module_dynamic : {};
  const major = isRecord(dynamic.major) ? dynamic.major : {};
  for (const childName of [
    'archive', 'opus', 'article', 'draw', 'common', 'pgc', 'courses', 'music', 'medialist', 'blocked', 'none'
  ]) {
    const child = isRecord(major[childName]) ? major[childName] as Record<string, unknown> : {};
    for (const field of ['title', 'desc', 'message', 'hint_message', 'tips']) {
      const title = cleanText(child[field], field === 'title' ? 500 : 2_000);
      if (title) return title;
    }
    const summary = isRecord(child.summary) ? child.summary : {};
    const summaryText = cleanText(summary.text, 2_000);
    if (summaryText) return summaryText;
  }
  const additional = isRecord(dynamic.additional) ? dynamic.additional : {};
  for (const childName of ['reserve', 'common', 'match', 'ugc']) {
    const child = isRecord(additional[childName]) ? additional[childName] as Record<string, unknown> : {};
    for (const field of ['title', 'desc1', 'desc2']) {
      const title = cleanText(child[field], field === 'title' ? 500 : 2_000);
      if (title) return title;
    }
  }
  return null;
}

function reservationTitleFromItem(value: Record<string, unknown>): string | null {
  const modules = isRecord(value.modules) ? value.modules : {};
  const dynamic = isRecord(modules.module_dynamic) ? modules.module_dynamic : {};
  const additional = isRecord(dynamic.additional) ? dynamic.additional : {};
  const reserve = isRecord(additional.reserve) ? additional.reserve : {};
  return cleanText(reserve.title, 500);
}

/**
 * These are intentionally individual, observed response paths rather than a
 * generic `additional` traversal.  Ordinary Opus cards can render either of
 * them, while reservation cards retain their separately proven reserve path.
 */
function additionalGoodsHeadTextFromItem(value: Record<string, unknown>): string | null {
  const modules = isRecord(value.modules) ? value.modules : {};
  const dynamic = isRecord(modules.module_dynamic) ? modules.module_dynamic : {};
  const additional = isRecord(dynamic.additional) ? dynamic.additional : {};
  const goods = isRecord(additional.goods) ? additional.goods : {};
  return cleanText(goods.head_text, 500);
}

function additionalUpowerLotteryTitleFromItem(value: Record<string, unknown>): string | null {
  const modules = isRecord(value.modules) ? value.modules : {};
  const dynamic = isRecord(modules.module_dynamic) ? modules.module_dynamic : {};
  const additional = isRecord(dynamic.additional) ? dynamic.additional : {};
  const lottery = isRecord(additional.upower_lottery) ? additional.upower_lottery : {};
  return cleanText(lottery.title, 500);
}

function projectedForwardSource(value: unknown): BilibiliDynamicResponseItem['forwardedSource'] {
  if (!isRecord(value)) return null;
  const stableDynamicId = stablePositiveId(value.id_str);
  if (!stableDynamicId) return null;
  const modules = isRecord(value.modules) ? value.modules : {};
  const author = isRecord(modules.module_author) ? modules.module_author : {};
  const dynamic = isRecord(modules.module_dynamic) ? modules.module_dynamic : {};
  const desc = isRecord(dynamic.desc) ? dynamic.desc : {};
  return {
    stableDynamicId,
    dynamicType: cleanText(value.type, 100),
    stableAccountId: stablePositiveId(author.mid),
    displayName: cleanText(author.name, 200),
    visibleText: cleanText(desc.text, 20_000),
    primaryIdentity: primaryIdentityFromItem(value)
  };
}

function dynamicEnum(value: unknown, prefix: 'DYNAMIC_TYPE_' | 'MAJOR_TYPE_'): string | null {
  const text = cleanText(value, 100);
  return text && new RegExp(`^${prefix}[A-Z0-9_]{1,80}$`).test(text) ? text : null;
}

export function bilibiliDynamicInput(value: unknown): BilibiliDynamicInput {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'canonicalProfileUrl' && key !== 'maxPages')) {
    throw new Error('bilibili_dynamic_input_invalid');
  }
  const canonicalProfileUrl = typeof value.canonicalProfileUrl === 'string'
    ? canonicalBilibiliProfileUrl(value.canonicalProfileUrl)
    : null;
  const maxPages = value.maxPages === undefined ? BILIBILI_DYNAMIC_MAX_PAGES : value.maxPages;
  if (
    !canonicalProfileUrl ||
    typeof maxPages !== 'number' ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > BILIBILI_DYNAMIC_MAX_PAGES
  ) throw new Error('bilibili_dynamic_input_invalid');
  return { canonicalProfileUrl, maxPages };
}

export function bilibiliDynamicUrl(canonicalProfileUrl: string): string {
  const canonical = canonicalBilibiliProfileUrl(canonicalProfileUrl);
  if (!canonical) throw new Error('bilibili_dynamic_profile_url_invalid');
  return `${canonical}/dynamic`;
}

export function stableDynamicAccountId(canonicalProfileUrl: string): string {
  return stableAccountIdFromProfileUrl(canonicalProfileUrl);
}

export function safeBilibiliDynamicLink(value: unknown): string | null {
  return canonicalPublicIdentityUrl(value)?.canonicalUrl ?? null;
}

export function projectBilibiliDynamicFeedResponse(
  value: unknown,
  expectedAccountId: string,
  expectedPageNumber: number
): BilibiliDynamicPageCandidate | null {
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) return null;
  const itemsValue = value.data.items;
  const hasMore = value.data.has_more;
  const nextOffset = value.data.offset;
  if (
    !Array.isArray(itemsValue) ||
    itemsValue.length > BILIBILI_DYNAMIC_MAX_ITEMS_PER_PAGE ||
    typeof hasMore !== 'boolean' ||
    typeof nextOffset !== 'string' ||
    nextOffset.length > 1_000 ||
    (hasMore && nextOffset.length === 0)
  ) return null;
  const items: BilibiliDynamicResponseItem[] = [];
  const seen = new Set<string>();
  for (const [index, rawItem] of itemsValue.entries()) {
    if (!isRecord(rawItem)) return null;
    const stableDynamicId = stablePositiveId(rawItem.id_str);
    const dynamicType = dynamicEnum(rawItem.type, 'DYNAMIC_TYPE_');
    const modules = isRecord(rawItem.modules) ? rawItem.modules : {};
    const author = isRecord(modules.module_author) ? modules.module_author : {};
    const stableAccountId = stablePositiveId(author.mid);
    const displayName = cleanText(author.name, 200);
    const dynamic = isRecord(modules.module_dynamic) ? modules.module_dynamic : {};
    const desc = isRecord(dynamic.desc) ? dynamic.desc : {};
    const major = isRecord(dynamic.major) ? dynamic.major : {};
    const stat = isRecord(modules.module_stat) ? modules.module_stat : {};
    const comment = isRecord(stat.comment) ? stat.comment : {};
    const forward = isRecord(stat.forward) ? stat.forward : {};
    const like = isRecord(stat.like) ? stat.like : {};
    const primaryIdentity = primaryIdentityFromItem(rawItem);
    if (
      !stableDynamicId ||
      !dynamicType ||
      stableAccountId !== expectedAccountId ||
      !displayName ||
      !primaryIdentity ||
      seen.has(stableDynamicId)
    ) return null;
    const visibleValue = rawItem.visible;
    if (visibleValue !== undefined && visibleValue !== null && typeof visibleValue !== 'boolean') return null;
    const moduleTag = isRecord(modules.module_tag) ? modules.module_tag : {};
    const tagText = cleanText(moduleTag.text, 100);
    const rawMajorType = major.type === undefined || major.type === null
      ? null
      : dynamicEnum(major.type, 'MAJOR_TYPE_');
    if (major.type !== undefined && major.type !== null && !rawMajorType) return null;
    const majorType = rawMajorType;
    const forwardedSource = projectedForwardSource(rawItem.orig);
    const isForward = dynamicType === 'DYNAMIC_TYPE_FORWARD';
    const forwardedSourceState = !isForward
      ? 'not_forward'
      : forwardedSource
        ? 'captured'
        : 'unavailable';
    const accessState = visibleValue === false || majorType === 'MAJOR_TYPE_BLOCKED' || isRecord(major.blocked)
      ? 'restricted_placeholder'
      : 'public';
    seen.add(stableDynamicId);
    items.push({
      stableDynamicId,
      dynamicType,
      stableAccountId,
      displayName,
      publishedAction: cleanText(author.pub_action, 200),
      publishedVisibleText: cleanText(author.pub_time, 100),
      publishedAt: timestamp(author.pub_ts),
      visibleText: cleanText(desc.text, 20_000),
      majorType,
      majorTitle: majorTitleFromItem(rawItem),
      reservationTitle: reservationTitleFromItem(rawItem),
      additionalGoodsHeadText: additionalGoodsHeadTextFromItem(rawItem),
      additionalUpowerLotteryTitle: additionalUpowerLotteryTitleFromItem(rawItem),
      primaryIdentity,
      responseVisible: typeof visibleValue === 'boolean' ? visibleValue : null,
      accessState,
      isPinned: Boolean(tagText && /置顶|top/i.test(tagText)),
      publicMetrics: {
        comments: nonNegativeInteger(comment.count),
        forwards: nonNegativeInteger(forward.count),
        likes: nonNegativeInteger(like.count)
      },
      forwardedSource,
      forwardedSourceState,
      pageNumber: expectedPageNumber,
      positionOnPage: index + 1
    });
  }
  const totalValue = value.data.total;
  const totalHint = totalValue === undefined || totalValue === null || totalValue === ''
    ? null
    : cleanText(String(totalValue), 100);
  if (totalValue && !totalHint) return null;
  return { pageNumber: expectedPageNumber, items, hasMore, nextOffset, totalHint };
}

export function projectBilibiliDynamicDomCard(
  card: BilibiliDynamicDomCardObservation
): BilibiliDynamicItemProjection['card'] | null {
  const visibleText = cleanText(card.visibleText, 50_000);
  const outerAuthor = cleanText(card.outerAuthor, 200);
  const publishedVisibleText = card.publishedVisibleText === null
    ? null
    : cleanText(card.publishedVisibleText, 200);
  if (
    !visibleText ||
    !outerAuthor ||
    (card.publishedVisibleText !== null && !publishedVisibleText) ||
    !['video', 'opus', 'blocked', 'other'].includes(card.kind) ||
    typeof card.blockedPlaceholder !== 'boolean' ||
    typeof card.reservation !== 'boolean' ||
    typeof card.forwarded !== 'boolean'
  ) return null;
  const links: Array<{ text: string; url: string }> = [];
  const linkKeys = new Set<string>();
  for (const rawLink of card.links.slice(0, 100)) {
    const url = safeBilibiliDynamicLink(rawLink.url);
    if (typeof rawLink.text !== 'string' || rawLink.text.length > 5_000) continue;
    const text = rawLink.text.replace(/\s+/g, ' ').trim();
    if (!url || /[\u0000-\u001f\u007f]/.test(text)) continue;
    const key = `${url}\n${text}`;
    if (!linkKeys.has(key)) {
      linkKeys.add(key);
      links.push({ text, url });
    }
  }
  const mediaRefs: Array<{ alt: string; url: string }> = [];
  const mediaKeys = new Set<string>();
  for (const rawImage of card.images.slice(0, 100)) {
    const url = safeBilibiliPublicImageUrl(rawImage.url);
    if (!url) continue;
    const alt = rawImage.alt === '' ? '' : cleanText(rawImage.alt, 1_000);
    if (rawImage.alt !== '' && !alt) continue;
    const key = `${url}\n${alt ?? ''}`;
    if (!mediaKeys.has(key)) {
      mediaKeys.add(key);
      mediaRefs.push({ alt: alt ?? '', url });
    }
  }
  return {
    outerAuthor,
    publishedVisibleText,
    visibleText,
    links,
    mediaRefs,
    kind: card.kind,
    blockedPlaceholder: card.blockedPlaceholder,
    reservation: card.reservation,
    forwarded: card.forwarded
  };
}

export function safeBilibiliDynamicErrorCode(value: unknown): string {
  const code = value instanceof Error ? value.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'bilibili_dynamic_failed';
}
