import {
  canonicalBilibiliProfileUrl,
  safeBilibiliPublicImageUrl,
  stableAccountIdFromProfileUrl
} from './bilibili-account-archive-contract';

export const BILIBILI_COLLECTION_SERIES_OVERVIEW_PATH =
  '/x/polymer/web-space/seasons_series_list' as const;
export const BILIBILI_COLLECTION_SERIES_RESPONSE_LIMIT = 2 * 1024 * 1024;

export interface BilibiliCollectionSeriesInput {
  canonicalProfileUrl: string;
}

export interface BilibiliCollectionSeriesPreviewItem {
  bvid: string;
  canonicalUrl: string;
  title: string;
  coverUrl: string | null;
  position: number;
}

export interface BilibiliCollectionSeriesOverviewItem {
  listType: 'series' | 'season';
  stableListId: string;
  canonicalPath: string;
  title: string;
  visibleDescription: string | null;
  coverUrl: string | null;
  declaredItemCount: number;
  previews: BilibiliCollectionSeriesPreviewItem[];
}

export interface BilibiliCollectionSeriesDomItem {
  listType: 'series' | 'season';
  title: string;
  declaredItemCount: number | null;
  visiblePreviewBvids: string[];
  visiblePreviewTitles: Record<string, string[]>;
  structure: {
    sectionClassName: string;
    headingAncestorClasses: string[];
    nearbyNumberCandidates: number[];
  };
}

export interface BilibiliCollectionSeriesDomSnapshot {
  stableAccountId: string | null;
  declaredNavigationCount: number | null;
  items: BilibiliCollectionSeriesDomItem[];
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

export interface BilibiliCollectionSeriesOverviewProjection {
  schemaVersion: 1;
  stableAccountId: string;
  canonicalProfileUrl: string;
  declaredListCount: number;
  items: BilibiliCollectionSeriesOverviewItem[];
  domCrossCheck: {
    responseItems: number;
    domItems: number;
    matchedTitles: number;
    matchedDeclaredCounts: number;
    matchedPreviewBvids: number;
    domPreviewBvids: number;
    exactItemIdentityMatch: boolean;
    itemChecks: Array<{
      listType: 'series' | 'season';
      stableListId: string;
      responseDeclaredItemCount: number;
      domDeclaredItemCount: number | null;
      responsePreviewBvids: number;
      domPreviewBvids: number;
      matchedPreviewBvids: number;
      sectionClassName: string;
      headingAncestorClasses: string[];
      nearbyNumberCandidates: number[];
    }>;
  };
  capturedAt: string;
}

export interface BilibiliCollectionSeriesSchemaPath {
  path: string;
  type: 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';
  arrayLength?: number;
}

export interface BilibiliCollectionSeriesResponseEvidence {
  pathname: typeof BILIBILI_COLLECTION_SERIES_OVERVIEW_PATH;
  responseStatus: number;
  responseBodyBytes: number;
  responseBodySha256: string;
  queryKeyNames: string[];
  schemaPaths: BilibiliCollectionSeriesSchemaPath[];
  sensitiveFieldPathsOmitted: number;
  projectionFailureCode: string | null;
}

export interface BilibiliCollectionSeriesAction {
  actionId: 'open_collection_series_overview';
  intent: string;
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
  errorCode: string | null;
}

export type BilibiliCollectionSeriesTerminalReason =
  | 'overview_captured'
  | 'verification_required'
  | 'rate_limited'
  | 'risk_controlled'
  | 'response_status_unavailable'
  | 'response_projection_failed'
  | 'dom_response_mismatch'
  | 'context_changed'
  | 'run_deadline_exceeded'
  | 'source_unavailable';

export interface BilibiliCollectionSeriesRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'collection_series_overview';
  targetUrlDigest: string;
  strategyCandidate: {
    strategyId: 'bilibili.collection-series.overview.response.v1';
    version: '1.0.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  overview: BilibiliCollectionSeriesOverviewProjection | null;
  responseEvidence: BilibiliCollectionSeriesResponseEvidence | null;
  actions: BilibiliCollectionSeriesAction[];
  coverage: {
    declaredListCount: number | null;
    capturedLists: number;
    seriesCount: number;
    seasonCount: number;
    previewItems: number;
    exactDomResponseMatch: boolean;
    terminalReason: BilibiliCollectionSeriesTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'trusted_navigation_plus_visible_dom_plus_current_overview_response_projection';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    networkQueryAndFragmentValues: 'discarded';
    responseProjection: 'public_collection_series_fields_allowlist';
    unknownResponseValues: 'not_persisted';
    semanticActionDelivery: 'at_most_once';
    runDeadlineMs: 60_000;
    targetTabSelection: 'reused_matching_managed_tab' | 'reused_retained_managed_tab' | 'created_new_managed_tab';
    targetPage: 'retained_after_run' | 'quarantined_on_uncertain_outcome';
    admissionEligible: false;
  };
}

interface OverviewResponseCandidate {
  declaredListCount: number;
  items: BilibiliCollectionSeriesOverviewItem[];
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

function positiveId(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value
      : '';
  return /^\d{1,20}$/.test(text) && text !== '0' ? text : null;
}

function previewItems(value: unknown): BilibiliCollectionSeriesPreviewItem[] | null {
  if (!Array.isArray(value)) return [];
  const previews: BilibiliCollectionSeriesPreviewItem[] = [];
  const seen = new Set<string>();
  for (const candidate of value.slice(0, 30)) {
    if (!isRecord(candidate)) return null;
    const bvid = typeof candidate.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(candidate.bvid)
      ? candidate.bvid
      : null;
    const title = cleanText(candidate.title, 500);
    if (!bvid || !title || seen.has(bvid)) continue;
    const coverValue = candidate.pic ?? candidate.cover;
    const coverUrl = coverValue === '' || coverValue === null || coverValue === undefined
      ? null
      : safeBilibiliPublicImageUrl(coverValue);
    if (coverValue && !coverUrl) return null;
    seen.add(bvid);
    previews.push({
      bvid,
      canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
      title,
      coverUrl,
      position: previews.length + 1
    });
  }
  return previews;
}

function overviewItem(
  value: unknown,
  listType: BilibiliCollectionSeriesOverviewItem['listType'],
  expectedAccountId: string
): BilibiliCollectionSeriesOverviewItem | null {
  if (!isRecord(value)) return null;
  const meta = isRecord(value.meta) ? value.meta : value;
  const id = positiveId(listType === 'series' ? meta.series_id : meta.season_id);
  const title = cleanText(meta.name ?? meta.title, 500);
  const declaredItemCount = nonNegativeInteger(meta.total);
  const mid = meta.mid === undefined || meta.mid === null ? expectedAccountId : String(meta.mid);
  const previews = previewItems(value.archives ?? value.items);
  if (!id || !title || declaredItemCount === null || mid !== expectedAccountId || !previews) return null;
  const coverValue = meta.cover;
  const coverUrl = coverValue === '' || coverValue === null || coverValue === undefined
    ? null
    : safeBilibiliPublicImageUrl(coverValue);
  if (coverValue && !coverUrl) return null;
  return {
    listType,
    stableListId: id,
    canonicalPath: `/${expectedAccountId}/lists/${id}`,
    title,
    visibleDescription: nullableText(meta.description ?? meta.intro, 5_000),
    coverUrl,
    declaredItemCount,
    previews
  };
}

export function bilibiliCollectionSeriesInput(value: unknown): BilibiliCollectionSeriesInput {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'canonicalProfileUrl')) {
    throw new Error('bilibili_collection_series_input_invalid');
  }
  const canonicalProfileUrl = typeof value.canonicalProfileUrl === 'string'
    ? canonicalBilibiliProfileUrl(value.canonicalProfileUrl)
    : null;
  if (!canonicalProfileUrl) throw new Error('bilibili_collection_series_input_invalid');
  return { canonicalProfileUrl };
}

export function collectionSeriesOverviewUrl(canonicalProfileUrl: string): string {
  return `${canonicalBilibiliProfileUrl(canonicalProfileUrl)}/lists`;
}

export function projectBilibiliCollectionSeriesOverviewResponse(
  value: unknown,
  expectedAccountId: string
): OverviewResponseCandidate | null {
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) return null;
  const lists = isRecord(value.data.items_lists) ? value.data.items_lists : value.data;
  const seriesValues = Array.isArray(lists.series_list) ? lists.series_list : [];
  const seasonValues = Array.isArray(lists.seasons_list)
    ? lists.seasons_list
    : Array.isArray(lists.season_list)
      ? lists.season_list
      : [];
  if (!Array.isArray(lists.series_list) && !Array.isArray(lists.seasons_list) && !Array.isArray(lists.season_list)) {
    return null;
  }
  const items: BilibiliCollectionSeriesOverviewItem[] = [];
  for (const [type, rawItems] of [
    ['series', seriesValues],
    ['season', seasonValues]
  ] as const) {
    for (const rawItem of rawItems) {
      const projected = overviewItem(rawItem, type, expectedAccountId);
      if (!projected) return null;
      items.push(projected);
    }
  }
  const identities = new Set(items.map((item) => `${item.listType}\n${item.stableListId}`));
  if (identities.size !== items.length) return null;
  const page = isRecord(lists.page) ? lists.page : null;
  const pageTotal = page ? nonNegativeInteger(page.total) : null;
  const declaredListCount = pageTotal ?? items.length;
  if (declaredListCount < items.length) return null;
  return { declaredListCount, items };
}

export function diagnoseBilibiliCollectionSeriesOverviewResponse(
  value: unknown,
  expectedAccountId: string
): string {
  if (!isRecord(value)) return 'root_not_object';
  if (value.code !== 0) return 'response_code_not_zero';
  if (!isRecord(value.data)) return 'data_not_object';
  const lists = isRecord(value.data.items_lists) ? value.data.items_lists : value.data;
  const sources: Array<{
    type: BilibiliCollectionSeriesOverviewItem['listType'];
    value: unknown;
  }> = [];
  if (Array.isArray(lists.series_list)) {
    lists.series_list.forEach((item) => sources.push({ type: 'series', value: item }));
  }
  const seasons = Array.isArray(lists.seasons_list)
    ? lists.seasons_list
    : Array.isArray(lists.season_list)
      ? lists.season_list
      : null;
  if (seasons) seasons.forEach((item) => sources.push({ type: 'season', value: item }));
  if (!Array.isArray(lists.series_list) && !seasons) return 'list_arrays_missing';
  for (const [index, source] of sources.entries()) {
    if (!isRecord(source.value)) return `item_${index}_not_object`;
    const meta = isRecord(source.value.meta) ? source.value.meta : source.value;
    const id = positiveId(source.type === 'series' ? meta.series_id : meta.season_id);
    if (!id) return `item_${index}_id_invalid`;
    if (!cleanText(meta.name ?? meta.title, 500)) return `item_${index}_title_invalid`;
    if (nonNegativeInteger(meta.total) === null) return `item_${index}_total_invalid`;
    if (meta.mid !== undefined && meta.mid !== null && String(meta.mid) !== expectedAccountId) {
      return `item_${index}_mid_mismatch`;
    }
    const coverValue = meta.cover;
    if (coverValue && !safeBilibiliPublicImageUrl(coverValue)) return `item_${index}_cover_invalid`;
    const previews = source.value.archives ?? source.value.items;
    if (previews !== undefined && !Array.isArray(previews)) return `item_${index}_previews_not_array`;
    if (Array.isArray(previews)) {
      for (const [previewIndex, preview] of previews.slice(0, 30).entries()) {
        if (!isRecord(preview)) return `item_${index}_preview_${previewIndex}_not_object`;
        if (typeof preview.bvid !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(preview.bvid)) {
          return `item_${index}_preview_${previewIndex}_bvid_invalid`;
        }
        if (!cleanText(preview.title, 500)) return `item_${index}_preview_${previewIndex}_title_invalid`;
        const previewCover = preview.pic ?? preview.cover;
        if (previewCover && !safeBilibiliPublicImageUrl(previewCover)) {
          return `item_${index}_preview_${previewIndex}_cover_invalid`;
        }
      }
    }
  }
  const projected = projectBilibiliCollectionSeriesOverviewResponse(value, expectedAccountId);
  return projected ? 'none' : 'post_projection_invariant_failed';
}

export function crossCheckBilibiliCollectionSeriesOverview(
  response: OverviewResponseCandidate,
  dom: BilibiliCollectionSeriesDomSnapshot,
  canonicalProfileUrl: string,
  capturedAt: string
): BilibiliCollectionSeriesOverviewProjection | null {
  const expectedAccountId = stableAccountIdFromProfileUrl(canonicalProfileUrl);
  if (dom.stableAccountId !== expectedAccountId) return null;
  const comparableTitle = (value: string): string => value.replace(/^(?:合集|系列)·/, '').trim();
  const domByIdentity = new Map(dom.items.map((item) => [
    `${item.listType}\n${comparableTitle(item.title)}`,
    item
  ]));
  let matchedTitles = 0;
  let matchedDeclaredCounts = 0;
  let matchedPreviewBvids = 0;
  let domPreviewBvids = 0;
  const itemChecks: BilibiliCollectionSeriesOverviewProjection['domCrossCheck']['itemChecks'] = [];
  for (const item of response.items) {
    const domItem = domByIdentity.get(`${item.listType}\n${comparableTitle(item.title)}`);
    if (!domItem) continue;
    matchedTitles += 1;
    if (domItem.declaredItemCount === item.declaredItemCount) matchedDeclaredCounts += 1;
    const responsePreviewIds = new Set(item.previews.map((preview) => preview.bvid));
    domPreviewBvids += domItem.visiblePreviewBvids.length;
    const matchedItemPreviewBvids = domItem.visiblePreviewBvids.filter((bvid) => responsePreviewIds.has(bvid)).length;
    matchedPreviewBvids += matchedItemPreviewBvids;
    itemChecks.push({
      listType: item.listType,
      stableListId: item.stableListId,
      responseDeclaredItemCount: item.declaredItemCount,
      domDeclaredItemCount: domItem.declaredItemCount,
      responsePreviewBvids: responsePreviewIds.size,
      domPreviewBvids: domItem.visiblePreviewBvids.length,
      matchedPreviewBvids: matchedItemPreviewBvids,
      sectionClassName: domItem.structure.sectionClassName,
      headingAncestorClasses: domItem.structure.headingAncestorClasses,
      nearbyNumberCandidates: domItem.structure.nearbyNumberCandidates
    });
  }
  const exactItemIdentityMatch = matchedTitles === response.items.length &&
    matchedTitles === dom.items.length &&
    matchedDeclaredCounts === response.items.length &&
    matchedPreviewBvids === domPreviewBvids &&
    (dom.declaredNavigationCount === null || dom.declaredNavigationCount === response.declaredListCount);
  return {
    schemaVersion: 1,
    stableAccountId: expectedAccountId,
    canonicalProfileUrl,
    declaredListCount: response.declaredListCount,
    items: response.items,
    domCrossCheck: {
      responseItems: response.items.length,
      domItems: dom.items.length,
      matchedTitles,
      matchedDeclaredCounts,
      matchedPreviewBvids,
      domPreviewBvids,
      exactItemIdentityMatch,
      itemChecks
    },
    capturedAt
  };
}

export function safeBilibiliCollectionSeriesErrorCode(value: unknown): string {
  const code = value instanceof Error ? value.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'bilibili_collection_series_failed';
}
