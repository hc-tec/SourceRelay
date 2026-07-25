import {
  canonicalBilibiliProfileUrl,
  safeBilibiliPublicImageUrl,
  stableAccountIdFromProfileUrl
} from './bilibili-account-archive-contract';
import type { BilibiliCollectionSeriesSchemaPath } from './bilibili-collection-series-contract';

// The old /x/series/* routes are not used by the current space page.  Both
// metadata and page cards arrive from this one public response.  Keep the
// metadata/archives names as aliases so artifact code remains explicit about
// what it projects without reintroducing the retired routes.
export const BILIBILI_SERIES_DETAIL_PATH = '/x/polymer/web-space/seasons_archives_list' as const;
export const BILIBILI_SERIES_METADATA_PATH = BILIBILI_SERIES_DETAIL_PATH;
export const BILIBILI_SERIES_ARCHIVES_PATH = BILIBILI_SERIES_DETAIL_PATH;
export const BILIBILI_SERIES_MAX_PAGES = 20;
export const BILIBILI_SERIES_MAX_ITEMS_PER_PAGE = 50;
export const BILIBILI_SERIES_RESPONSE_LIMIT = 2 * 1024 * 1024;

export interface BilibiliSeriesDetailInput {
  canonicalProfileUrl: string;
  stableSeriesId: string;
  listType: 'series' | 'season';
  maxPages: number;
}

export interface BilibiliSeriesMetadataProjection {
  stableSeriesId: string;
  listType: 'series' | 'season';
  stableAccountId: string;
  canonicalPath: string;
  title: string;
  visibleDescription: string | null;
  coverUrl: string | null;
  declaredItemCount: number;
  lastUpdatedAt: string | null;
}

export interface BilibiliSeriesItemProjection {
  bvid: string;
  canonicalUrl: string;
  title: string;
  coverUrl: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  visibleMetrics: {
    views: number | null;
    danmaku: number | null;
  };
  pageNumber: number;
  positionOnPage: number;
}

export interface BilibiliSeriesDomSnapshot {
  stableAccountId: string | null;
  stableSeriesId: string | null;
  visibleTitle: string | null;
  declaredItemCount: number | null;
  activePageNumber: number | null;
  videoIds: string[];
  titleCandidates: Record<string, string[]>;
  sortLabels: string[];
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

export interface BilibiliSeriesPageProjection {
  schemaVersion: 1;
  pageNumber: number;
  pageSize: number;
  declaredTotal: number;
  items: BilibiliSeriesItemProjection[];
  responseStatus: number;
  responseBodyBytes: number;
  responseBodySha256: string;
  queryKeyNames: string[];
  schemaPaths: BilibiliCollectionSeriesSchemaPath[];
  sensitiveFieldPathsOmitted: number;
  domCrossCheck: {
    activePageNumber: number | null;
    responseVideoIds: number;
    domVideoIds: number;
    matchedVideoIds: number;
    responseOnlyVideoIds: number;
    domOnlyVideoIds: number;
    titleMatches: number;
    responseIdDigest: string;
    domIdDigest: string;
    exactIdentityMatch: boolean;
  };
  capturedAt: string;
}

export interface BilibiliSeriesMetadataResponseEvidence {
  pathname: typeof BILIBILI_SERIES_METADATA_PATH;
  responseStatus: number;
  responseBodyBytes: number;
  responseBodySha256: string;
  queryKeyNames: string[];
  schemaPaths: BilibiliCollectionSeriesSchemaPath[];
  sensitiveFieldPathsOmitted: number;
}

export interface BilibiliSeriesPageResponseEvidence {
  pathname: typeof BILIBILI_SERIES_ARCHIVES_PATH;
  pageNumber: number;
  responseStatus: number;
  responseBodyBytes: number;
  responseBodySha256: string;
  queryKeyNames: string[];
  schemaPaths: BilibiliCollectionSeriesSchemaPath[];
  sensitiveFieldPathsOmitted: number;
}

export interface BilibiliSeriesAction {
  actionId: string;
  intent: string;
  expectedPageNumber: number;
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
  errorCode: string | null;
  observedPageNumber: number | null;
}

export type BilibiliSeriesTerminalReason =
  | 'declared_terminal_reached'
  | 'budget_exhausted'
  | 'verification_required'
  | 'rate_limited'
  | 'risk_controlled'
  | 'response_status_unavailable'
  | 'metadata_projection_failed'
  | 'page_projection_failed'
  | 'dom_response_mismatch'
  | 'pagination_control_missing'
  | 'context_changed'
  | 'run_deadline_exceeded'
  | 'source_unavailable';

export interface BilibiliSeriesDetailRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'series_detail';
  targetUrlDigest: string;
  strategyCandidate: {
    strategyId: 'bilibili.collection-series.series-detail.response.v1';
    version: '1.0.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  metadata: BilibiliSeriesMetadataProjection | null;
  metadataResponseEvidence: BilibiliSeriesMetadataResponseEvidence | null;
  failedPageResponseEvidence: BilibiliSeriesPageResponseEvidence | null;
  pages: BilibiliSeriesPageProjection[];
  actions: BilibiliSeriesAction[];
  coverage: {
    declaredTotal: number | null;
    declaredPages: number | null;
    plannedMaximumPages: number;
    capturedPages: number;
    capturedItems: number;
    uniqueItems: number;
    duplicateItems: number;
    completeWithinDeclaredSeries: boolean;
    terminalReason: BilibiliSeriesTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'trusted_series_navigation_and_pagination_plus_dom_response_projection';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    networkQueryAndFragmentValues: 'discarded';
    canonicalPageQuery: 'stable_type_series_or_season';
    responseProjection: 'public_series_metadata_and_card_fields_allowlist';
    unknownResponseValues: 'not_persisted';
    sortRole: 'platform_default';
    semanticActionDelivery: 'at_most_once';
    runDeadlineMs: 60_000;
    targetTabSelection: 'reused_matching_managed_tab' | 'created_new_managed_tab';
    targetPage: 'not_acquired' | 'retained_after_run' | 'quarantined_on_uncertain_outcome';
    admissionEligible: false;
  };
}

interface SeriesPageCandidate {
  pageNumber: number;
  pageSize: number;
  declaredTotal: number;
  items: BilibiliSeriesItemProjection[];
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

function nullableText(value: unknown, maximum: number): string | null {
  if (value === null || value === '') return null;
  return cleanText(value, maximum);
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  const number = nonNegativeInteger(value);
  return number !== null && number > 0 ? number : null;
}

function positiveId(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value
      : '';
  return /^\d{1,20}$/.test(text) && text !== '0' ? text : null;
}

function timestamp(value: unknown): string | null {
  const seconds = nonNegativeInteger(value);
  if (seconds === null || seconds === 0) return null;
  const date = new Date(seconds * 1_000);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

export function bilibiliSeriesDetailInput(value: unknown): BilibiliSeriesDetailInput {
  if (!isRecord(value) || Object.keys(value).some((key) =>
    !['canonicalProfileUrl', 'stableSeriesId', 'listType', 'maxPages'].includes(key)
  )) throw new Error('bilibili_series_detail_input_invalid');
  const canonicalProfileUrl = typeof value.canonicalProfileUrl === 'string'
    ? canonicalBilibiliProfileUrl(value.canonicalProfileUrl)
    : null;
  const stableSeriesId = positiveId(value.stableSeriesId);
  const listType = value.listType === undefined ? 'series' : value.listType;
  const maxPages = value.maxPages === undefined ? BILIBILI_SERIES_MAX_PAGES : value.maxPages;
  if (
    !canonicalProfileUrl ||
    !stableSeriesId ||
    (listType !== 'series' && listType !== 'season') ||
    typeof maxPages !== 'number' ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > BILIBILI_SERIES_MAX_PAGES
  ) throw new Error('bilibili_series_detail_input_invalid');
  return { canonicalProfileUrl, stableSeriesId, listType, maxPages };
}

export function canonicalBilibiliSeriesDetailUrl(
  canonicalProfileUrl: string,
  stableSeriesId: string,
  listType: 'series' | 'season' = 'series'
): string {
  const canonical = canonicalBilibiliProfileUrl(canonicalProfileUrl);
  const seriesId = positiveId(stableSeriesId);
  if (!canonical || !seriesId) throw new Error('bilibili_series_detail_url_invalid');
  if (listType !== 'series' && listType !== 'season') throw new Error('bilibili_series_detail_list_type_invalid');
  return `${canonical}/lists/${seriesId}?type=${listType}`;
}

export function projectBilibiliSeriesMetadataResponse(
  value: unknown,
  expectedAccountId: string,
  expectedSeriesId: string,
  expectedListType: 'series' | 'season' = 'series'
): BilibiliSeriesMetadataProjection | null {
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) return null;
  const meta = isRecord(value.data.meta) ? value.data.meta : value.data;
  const seriesId = positiveId(meta[expectedListType === 'season' ? 'season_id' : 'series_id']);
  const mid = String(meta.mid ?? '');
  const title = cleanText(meta.name ?? meta.title, 500);
  const declaredItemCount = nonNegativeInteger(meta.total);
  if (seriesId !== expectedSeriesId || mid !== expectedAccountId || !title || declaredItemCount === null) {
    return null;
  }
  const coverValue = meta.cover;
  const coverUrl = coverValue === '' || coverValue === null || coverValue === undefined
    ? null
    : safeBilibiliPublicImageUrl(coverValue);
  if (coverValue && !coverUrl) return null;
  return {
    stableSeriesId: seriesId,
    listType: expectedListType,
    stableAccountId: expectedAccountId,
    canonicalPath: `/${expectedAccountId}/lists/${seriesId}`,
    title,
    visibleDescription: nullableText(meta.description ?? meta.intro, 5_000),
    coverUrl,
    declaredItemCount,
    lastUpdatedAt: timestamp(meta.last_update_ts ?? meta.mtime)
  };
}

export function projectBilibiliSeriesPageResponse(
  value: unknown,
  expectedAccountId: string,
  expectedPageNumber: number
): SeriesPageCandidate | null {
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) return null;
  const page = value.data.page;
  const archives = value.data.archives;
  if (!isRecord(page) || !Array.isArray(archives)) return null;
  const pageNumber = positiveInteger(page.page_num ?? page.num ?? page.pn);
  const pageSize = positiveInteger(page.page_size ?? page.size ?? page.ps);
  const declaredTotal = nonNegativeInteger(page.total ?? page.count);
  if (
    pageNumber !== expectedPageNumber ||
    pageSize === null ||
    pageSize > BILIBILI_SERIES_MAX_ITEMS_PER_PAGE ||
    declaredTotal === null ||
    archives.length > pageSize
  ) return null;
  const items: BilibiliSeriesItemProjection[] = [];
  const seen = new Set<string>();
  for (const [index, rawItem] of archives.entries()) {
    if (!isRecord(rawItem)) return null;
    const bvid = typeof rawItem.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(rawItem.bvid)
      ? rawItem.bvid
      : null;
    const owner = isRecord(rawItem.owner) ? rawItem.owner : null;
    const mid = rawItem.mid === undefined && owner ? owner.mid : rawItem.mid;
    const title = cleanText(rawItem.title, 500);
    if (!bvid || String(mid ?? expectedAccountId) !== expectedAccountId || !title || seen.has(bvid)) return null;
    const coverValue = rawItem.pic ?? rawItem.cover;
    const coverUrl = coverValue === '' || coverValue === null || coverValue === undefined
      ? null
      : safeBilibiliPublicImageUrl(coverValue);
    if (coverValue && !coverUrl) return null;
    const stat = isRecord(rawItem.stat) ? rawItem.stat : {};
    const durationSeconds = nonNegativeInteger(rawItem.duration);
    seen.add(bvid);
    items.push({
      bvid,
      canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
      title,
      coverUrl,
      durationSeconds,
      publishedAt: timestamp(rawItem.pubdate),
      visibleMetrics: {
        views: nonNegativeInteger(stat.view),
        danmaku: nonNegativeInteger(stat.danmaku)
      },
      pageNumber,
      positionOnPage: index + 1
    });
  }
  return { pageNumber, pageSize, declaredTotal, items };
}

export function stableAccountIdForSeries(canonicalProfileUrl: string): string {
  return stableAccountIdFromProfileUrl(canonicalProfileUrl);
}

export function safeBilibiliSeriesDetailErrorCode(value: unknown): string {
  const code = value instanceof Error ? value.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'bilibili_series_detail_failed';
}
