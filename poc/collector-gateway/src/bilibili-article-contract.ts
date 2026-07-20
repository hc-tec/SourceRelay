import {
  canonicalBilibiliProfileUrl,
  safeBilibiliPublicImageUrl,
  stableAccountIdFromProfileUrl
} from './bilibili-account-archive-contract';
import type { BilibiliCollectionSeriesSchemaPath } from './bilibili-collection-series-contract';

export const BILIBILI_ARTICLE_FEED_PATH = '/x/polymer/web-dynamic/v1/opus/feed/space' as const;
// One navigation + one facet selection + at most 18 scroll actions stays within
// the account-safety registry's 20 semantic-action ceiling.
export const BILIBILI_ARTICLE_MAX_PAGES = 19;
export const BILIBILI_ARTICLE_MAX_ITEMS_PER_PAGE = 50;
export const BILIBILI_ARTICLE_RESPONSE_LIMIT = 2 * 1024 * 1024;
export const BILIBILI_ARTICLE_CONTENT_LIMIT = 2 * 1024 * 1024;

export interface BilibiliArticleInventoryInput {
  canonicalProfileUrl: string;
  maxPages: number;
}

export interface BilibiliArticleDetailInput {
  canonicalProfileUrl: string;
  canonicalOpusUrl: string;
  sourceInventoryArtifactId: string;
  sourceInventoryManifestSha256: string;
}

export interface BilibiliArticleDetailRequestInput {
  sourceInventoryArtifactId: string;
  stableOpusId: string;
}

export interface BilibiliArticleInventoryItem {
  stableOpusId: string;
  canonicalUrl: string;
  cardText: string;
  cover: {
    url: string;
    width: number | null;
    height: number | null;
  } | null;
  visibleLikes: string | null;
  pageNumber: number;
  positionOnPage: number;
}

export interface BilibiliArticleInventoryPageCandidate {
  pageNumber: number;
  items: BilibiliArticleInventoryItem[];
  hasMore: boolean;
  nextOffset: string;
  updateNumber: number | null;
}

export interface BilibiliArticleInventoryDomSnapshot {
  stableAccountId: string | null;
  stableOpusIds: string[];
  titleCandidates: Record<string, string[]>;
  visibleFacetLabels: string[];
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

export interface BilibiliArticleInventoryPageProjection {
  schemaVersion: 1;
  pageNumber: number;
  items: BilibiliArticleInventoryItem[];
  hasMore: boolean;
  nextOffsetPresent: boolean;
  updateNumber: number | null;
  responseStatus: number;
  responseBodyBytes: number;
  responseBodySha256: string;
  queryKeyNames: string[];
  schemaPaths: BilibiliCollectionSeriesSchemaPath[];
  sensitiveFieldPathsOmitted: number;
  domCrossCheck: {
    responsePageItems: number;
    responseCumulativeItems: number;
    domCumulativeItems: number;
    matchedCumulativeItems: number;
    responseOnlyItems: number;
    domOnlyItems: number;
    pageTitleMatches: number;
    responseCumulativeIdDigest: string;
    domCumulativeIdDigest: string;
    exactCumulativeIdentityMatch: boolean;
  };
  capturedAt: string;
}

export interface BilibiliArticleFeedResponseEvidence {
  pathname: typeof BILIBILI_ARTICLE_FEED_PATH;
  pageNumber: number;
  responseStatus: number;
  responseBodyBytes: number;
  responseBodySha256: string;
  queryKeyNames: string[];
  schemaPaths: BilibiliCollectionSeriesSchemaPath[];
  sensitiveFieldPathsOmitted: number;
}

export interface BilibiliArticleInventoryAction {
  actionId: string;
  intent: string;
  expectedPageNumber: number;
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
  errorCode: string | null;
}

export type BilibiliArticleInventoryTerminalReason =
  | 'feed_terminal_reached'
  | 'budget_exhausted'
  | 'verification_required'
  | 'rate_limited'
  | 'risk_controlled'
  | 'response_status_unavailable'
  | 'response_projection_failed'
  | 'dom_response_mismatch'
  | 'article_facet_missing'
  | 'pagination_postcondition_unmet'
  | 'context_changed'
  | 'run_deadline_exceeded'
  | 'source_unavailable';

export interface BilibiliArticleInventoryRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'article_inventory';
  targetUrlDigest: string;
  strategyCandidate: {
    strategyId: 'bilibili.article.inventory.opus-feed.v1';
    version: '1.0.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  stableAccountId: string;
  failedResponseEvidence: BilibiliArticleFeedResponseEvidence | null;
  pages: BilibiliArticleInventoryPageProjection[];
  actions: BilibiliArticleInventoryAction[];
  coverage: {
    plannedMaximumPages: number;
    capturedPages: number;
    capturedItems: number;
    uniqueItems: number;
    duplicateItems: number;
    completeWithinArticleFacet: boolean;
    terminalReason: BilibiliArticleInventoryTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'trusted_navigation_facet_selection_and_scroll_plus_dom_response_projection';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    networkQueryAndFragmentValues: 'discarded';
    cursorValue: 'used_in_memory_not_persisted';
    responseProjection: 'public_article_inventory_fields_allowlist';
    unknownResponseValues: 'not_persisted';
    semanticActionDelivery: 'at_most_once';
    runDeadlineMs: 60_000;
    targetTabSelection: 'reused_matching_managed_tab' | 'created_new_managed_tab';
    targetPage: 'retained_after_run';
    admissionEligible: false;
  };
}

export interface BilibiliArticleDetailDomObservation {
  stableOpusId: string | null;
  stableAccountId: string | null;
  displayName: string | null;
  title: string | null;
  publishedVisibleText: string | null;
  copyrightVisibleText: string | null;
  tags: string[];
  content: {
    visibleText: string;
    blocks: Array<{
      tagName: string;
      visibleText: string;
      images: Array<{ url: string; alt: string }>;
      links: Array<{ text: string; url: string }>;
    }>;
  } | null;
  toolbarMetrics: {
    likes: number | null;
    coins: number | null;
    favorites: number | null;
    forwards: number | null;
    comments: number | null;
  };
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

export interface BilibiliArticleDetailSnapshot {
  schemaVersion: 1;
  stableOpusId: string;
  canonicalUrl: string;
  stableAccountId: string;
  displayName: string;
  title: string;
  publishedVisibleText: string;
  legacyArticleId: string | null;
  tags: string[];
  publicMetrics: {
    likes: number;
    coins: number;
    favorites: number;
    forwards: number;
    comments: number;
  };
  content: {
    visibleText: string;
    blocks: Array<{
      position: number;
      tagName: string;
      visibleText: string;
      mediaIndexes: number[];
      linkIndexes: number[];
    }>;
    mediaRefs: Array<{ url: string; alt: string }>;
    linkRefs: Array<{ text: string; url: string }>;
  };
  capturedAt: string;
}

export interface BilibiliArticleDetailAction {
  actionId: 'open_article_detail';
  intent: string;
  attempted: boolean;
  attemptCount: 1;
  outcome: 'completed' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
  errorCode: string | null;
}

export type BilibiliArticleDetailTerminalReason =
  | 'article_captured'
  | 'verification_required'
  | 'rate_limited'
  | 'risk_controlled'
  | 'dom_projection_failed'
  | 'context_changed'
  | 'run_deadline_exceeded'
  | 'source_unavailable';

export interface BilibiliArticleDetailRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'article_detail';
  targetUrlDigest: string;
  strategyCandidate: {
    strategyId: 'bilibili.article.detail.dom-raw.v1';
    version: '1.0.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  sourceInventory: {
    artifactId: string;
    manifestSha256: string;
  };
  snapshot: BilibiliArticleDetailSnapshot | null;
  actions: BilibiliArticleDetailAction[];
  coverage: {
    titleCaptured: boolean;
    authorCaptured: boolean;
    publishedTimeCaptured: boolean;
    contentCharacters: number;
    contentBlocks: number;
    mediaRefs: number;
    linkRefs: number;
    publicMetricsCaptured: boolean;
    terminalReason: BilibiliArticleDetailTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'trusted_navigation_plus_bounded_public_article_dom';
    responseBody: 'not_read';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    currentViewerIdentity: 'excluded';
    discussion: 'excluded_separate_capability';
    authorAccountBinding: 'verified_article_inventory_artifact';
    semanticActionDelivery: 'at_most_once';
    runDeadlineMs: 60_000;
    targetTabSelection:
      | 'reused_matching_managed_tab'
      | 'reused_related_article_inventory_tab'
      | 'created_new_managed_tab';
    targetPage: 'retained_after_run';
    admissionEligible: false;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > maximum || /[\u0000-\u001f\u007f]/.test(clean)) return null;
  return clean;
}

function cleanContentText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\r\n?/g, '\n').replace(/[\t ]+\n/g, '\n').trim();
  if (!clean || clean.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)) {
    return null;
  }
  return clean;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function stablePositiveId(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value
      : '';
  return /^\d{1,20}$/.test(text) && text !== '0' ? text : null;
}

function canonicalOpusIdFromUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_000) return null;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    const match = url.hostname === 'www.bilibili.com' && url.pathname.match(/^\/opus\/(\d{1,20})\/?$/);
    return url.protocol === 'https:' && !url.username && !url.password && match ? match[1] : null;
  } catch {
    return null;
  }
}

function safePublicContentLinkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function bilibiliArticleInventoryInput(value: unknown): BilibiliArticleInventoryInput {
  if (!isRecord(value) || Object.keys(value).some((key) =>
    key !== 'canonicalProfileUrl' && key !== 'maxPages'
  )) throw new Error('bilibili_article_inventory_input_invalid');
  const canonicalProfileUrl = typeof value.canonicalProfileUrl === 'string'
    ? canonicalBilibiliProfileUrl(value.canonicalProfileUrl)
    : null;
  const maxPages = value.maxPages === undefined ? BILIBILI_ARTICLE_MAX_PAGES : value.maxPages;
  if (
    !canonicalProfileUrl ||
    typeof maxPages !== 'number' ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > BILIBILI_ARTICLE_MAX_PAGES
  ) throw new Error('bilibili_article_inventory_input_invalid');
  return { canonicalProfileUrl, maxPages };
}

export function bilibiliArticleDetailRequestInput(value: unknown): BilibiliArticleDetailRequestInput {
  if (!isRecord(value) || Object.keys(value).some((key) =>
    key !== 'sourceInventoryArtifactId' && key !== 'stableOpusId'
  )) throw new Error('bilibili_article_detail_input_invalid');
  const sourceInventoryArtifactId = typeof value.sourceInventoryArtifactId === 'string'
    ? value.sourceInventoryArtifactId
    : '';
  const stableOpusId = stablePositiveId(value.stableOpusId);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      sourceInventoryArtifactId
    ) ||
    !stableOpusId
  ) throw new Error('bilibili_article_detail_input_invalid');
  return { sourceInventoryArtifactId, stableOpusId };
}

export function resolvedBilibiliArticleDetailInput(value: BilibiliArticleDetailInput): BilibiliArticleDetailInput {
  const canonicalProfileUrl = canonicalBilibiliProfileUrl(value.canonicalProfileUrl);
  const canonicalOpusUrl = canonicalBilibiliOpusUrl(value.canonicalOpusUrl);
  if (
    !canonicalProfileUrl ||
    !canonicalOpusUrl ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.sourceInventoryArtifactId
    ) ||
    !/^[0-9a-f]{64}$/.test(value.sourceInventoryManifestSha256)
  ) throw new Error('bilibili_article_detail_input_invalid');
  return {
    canonicalProfileUrl,
    canonicalOpusUrl,
    sourceInventoryArtifactId: value.sourceInventoryArtifactId,
    sourceInventoryManifestSha256: value.sourceInventoryManifestSha256
  };
}

export function bilibiliArticleInventoryUrl(canonicalProfileUrl: string): string {
  const canonical = canonicalBilibiliProfileUrl(canonicalProfileUrl);
  if (!canonical) throw new Error('bilibili_article_profile_url_invalid');
  return `${canonical}/upload/opus`;
}

export function canonicalBilibiliOpusUrl(value: string): string | null {
  const stableOpusId = canonicalOpusIdFromUrl(value);
  return stableOpusId ? `https://www.bilibili.com/opus/${stableOpusId}` : null;
}

export function stableOpusIdFromUrl(canonicalOpusUrl: string): string {
  const stableOpusId = canonicalOpusIdFromUrl(canonicalOpusUrl);
  if (!stableOpusId) throw new Error('bilibili_article_opus_url_invalid');
  return stableOpusId;
}

export function stableArticleAccountId(canonicalProfileUrl: string): string {
  return stableAccountIdFromProfileUrl(canonicalProfileUrl);
}

export function projectBilibiliArticleFeedResponse(
  value: unknown,
  expectedPageNumber: number
): BilibiliArticleInventoryPageCandidate | null {
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) return null;
  const itemsValue = value.data.items;
  const hasMore = value.data.has_more;
  const nextOffset = value.data.offset;
  if (
    !Array.isArray(itemsValue) ||
    itemsValue.length > BILIBILI_ARTICLE_MAX_ITEMS_PER_PAGE ||
    typeof hasMore !== 'boolean' ||
    typeof nextOffset !== 'string' ||
    nextOffset.length > 1_000 ||
    (hasMore && nextOffset.length === 0)
  ) return null;
  const items: BilibiliArticleInventoryItem[] = [];
  const seen = new Set<string>();
  for (const [index, rawItem] of itemsValue.entries()) {
    if (!isRecord(rawItem)) return null;
    const stableOpusId = stablePositiveId(rawItem.opus_id);
    const jumpOpusId = canonicalOpusIdFromUrl(rawItem.jump_url);
    const cardText = cleanText(rawItem.content, 5_000);
    if (!stableOpusId || jumpOpusId !== stableOpusId || !cardText || seen.has(stableOpusId)) return null;
    const coverValue = rawItem.cover;
    let cover: BilibiliArticleInventoryItem['cover'] = null;
    if (coverValue !== null && coverValue !== undefined) {
      if (!isRecord(coverValue)) return null;
      const url = safeBilibiliPublicImageUrl(coverValue.url);
      if (!url) return null;
      cover = {
        url,
        width: nonNegativeInteger(coverValue.width),
        height: nonNegativeInteger(coverValue.height)
      };
    }
    const stat = isRecord(rawItem.stat) ? rawItem.stat : {};
    const visibleLikesValue = stat.like;
    const visibleLikes = visibleLikesValue === undefined || visibleLikesValue === null || visibleLikesValue === ''
      ? null
      : cleanText(String(visibleLikesValue), 40);
    if (visibleLikesValue && !visibleLikes) return null;
    seen.add(stableOpusId);
    items.push({
      stableOpusId,
      canonicalUrl: `https://www.bilibili.com/opus/${stableOpusId}`,
      cardText,
      cover,
      visibleLikes,
      pageNumber: expectedPageNumber,
      positionOnPage: index + 1
    });
  }
  const updateNumberValue = value.data.update_num;
  const updateNumber = updateNumberValue === undefined || updateNumberValue === null
    ? null
    : nonNegativeInteger(updateNumberValue);
  if (updateNumberValue !== undefined && updateNumberValue !== null && updateNumber === null) return null;
  return { pageNumber: expectedPageNumber, items, hasMore, nextOffset, updateNumber };
}

export function projectBilibiliArticleDetailDom(
  observation: BilibiliArticleDetailDomObservation,
  input: BilibiliArticleDetailInput,
  capturedAt: string
): BilibiliArticleDetailSnapshot | null {
  const expectedAccountId = stableArticleAccountId(input.canonicalProfileUrl);
  const expectedOpusId = stableOpusIdFromUrl(input.canonicalOpusUrl);
  const title = cleanText(observation.title, 500);
  const displayName = cleanText(observation.displayName, 200);
  const publishedVisibleText = cleanText(observation.publishedVisibleText, 100);
  const visibleText = observation.content
    ? cleanContentText(observation.content.visibleText, BILIBILI_ARTICLE_CONTENT_LIMIT)
    : null;
  if (
    (observation.stableAccountId !== null && observation.stableAccountId !== expectedAccountId) ||
    observation.stableOpusId !== expectedOpusId ||
    !title ||
    !displayName ||
    !publishedVisibleText ||
    !visibleText ||
    !observation.content ||
    observation.content.blocks.length > 1_000
  ) return null;
  const metrics = observation.toolbarMetrics;
  if (Object.values(metrics).some((metric) => metric === null)) return null;

  const mediaRefs: BilibiliArticleDetailSnapshot['content']['mediaRefs'] = [];
  const mediaIndexes = new Map<string, number>();
  const linkRefs: BilibiliArticleDetailSnapshot['content']['linkRefs'] = [];
  const linkIndexes = new Map<string, number>();
  const blocks: BilibiliArticleDetailSnapshot['content']['blocks'] = [];
  for (const [index, block] of observation.content.blocks.entries()) {
    const blockText = block.visibleText === '' ? '' : cleanContentText(block.visibleText, 250_000);
    if (block.visibleText !== '' && !blockText) return null;
    const blockMediaIndexes: number[] = [];
    for (const rawMedia of block.images) {
      const url = safeBilibiliPublicImageUrl(rawMedia.url);
      if (!url) return null;
      const alt = rawMedia.alt === '' ? '' : cleanText(rawMedia.alt, 500);
      if (rawMedia.alt !== '' && !alt) return null;
      const key = `${url}\n${alt ?? ''}`;
      let mediaIndex = mediaIndexes.get(key);
      if (mediaIndex === undefined) {
        mediaIndex = mediaRefs.length;
        mediaIndexes.set(key, mediaIndex);
        mediaRefs.push({ url, alt: alt ?? '' });
      }
      if (!blockMediaIndexes.includes(mediaIndex)) blockMediaIndexes.push(mediaIndex);
    }
    const blockLinkIndexes: number[] = [];
    for (const rawLink of block.links) {
      const url = safePublicContentLinkUrl(rawLink.url);
      const text = cleanText(rawLink.text, 1_000);
      if (!url || !text) return null;
      const key = `${url}\n${text}`;
      let linkIndex = linkIndexes.get(key);
      if (linkIndex === undefined) {
        linkIndex = linkRefs.length;
        linkIndexes.set(key, linkIndex);
        linkRefs.push({ text, url });
      }
      if (!blockLinkIndexes.includes(linkIndex)) blockLinkIndexes.push(linkIndex);
    }
    blocks.push({
      position: index + 1,
      tagName: /^[A-Z][A-Z0-9]{0,20}$/.test(block.tagName) ? block.tagName : 'UNKNOWN',
      visibleText: blockText ?? '',
      mediaIndexes: blockMediaIndexes,
      linkIndexes: blockLinkIndexes
    });
  }
  const legacyMatch = observation.copyrightVisibleText?.match(/\bcv(\d{1,20})\b/i);
  return {
    schemaVersion: 1,
    stableOpusId: expectedOpusId,
    canonicalUrl: input.canonicalOpusUrl,
    stableAccountId: expectedAccountId,
    displayName,
    title,
    publishedVisibleText,
    legacyArticleId: legacyMatch ? `cv${legacyMatch[1]}` : null,
    tags: [...new Set(observation.tags.map((tag) => cleanText(tag, 100)).filter((tag): tag is string => Boolean(tag)))],
    publicMetrics: metrics as BilibiliArticleDetailSnapshot['publicMetrics'],
    content: { visibleText, blocks, mediaRefs, linkRefs },
    capturedAt
  };
}

export function safeBilibiliArticleErrorCode(value: unknown): string {
  const code = value instanceof Error ? value.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'bilibili_article_failed';
}
