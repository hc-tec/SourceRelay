import { USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION } from '@intelligence/collector-contracts';

export const ZHIHU_OFFICIAL_SEARCH_CAPABILITY = 'zhihu.search.public_content.v1' as const;
export const ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY = 'zhihu.hot_list.public_content.v1' as const;
export const ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY = 'web.search.global.zhihu_provider.v1' as const;

export type ZhihuOfficialCapability =
  | typeof ZHIHU_OFFICIAL_SEARCH_CAPABILITY
  | typeof ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY
  | typeof ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY;

interface ZhihuOfficialRequestBase {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  clientRequestId: string;
  executionTarget: 'official_api';
}

export interface ZhihuOfficialSearchCollectorServiceRequest extends ZhihuOfficialRequestBase {
  platform: 'zhihu';
  capability: typeof ZHIHU_OFFICIAL_SEARCH_CAPABILITY;
  input: { query: string; count: number };
}

export interface ZhihuOfficialHotListCollectorServiceRequest extends ZhihuOfficialRequestBase {
  platform: 'zhihu';
  capability: typeof ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY;
  input: { limit: number };
}

export interface ZhihuOfficialGlobalSearchCollectorServiceRequest extends ZhihuOfficialRequestBase {
  platform: 'web';
  capability: typeof ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY;
  input: {
    query: string;
    count: number;
    searchDatabase: 'all' | 'realtime' | 'static';
    site?: string;
    publishedAfter?: string;
  };
}

export type ZhihuOfficialCollectorServiceRequest =
  | ZhihuOfficialSearchCollectorServiceRequest
  | ZhihuOfficialHotListCollectorServiceRequest
  | ZhihuOfficialGlobalSearchCollectorServiceRequest;

export interface ZhihuOfficialCommentInfo {
  Content: string;
  [key: string]: unknown;
}

export interface ZhihuOfficialSearchItem {
  Title: string;
  ContentType: string;
  ContentID: string;
  ContentText: string;
  Url: string;
  CommentCount: number;
  VoteUpCount: number;
  AuthorName: string;
  AuthorAvatar: string;
  AuthorBadge: string;
  AuthorBadgeText: string;
  EditTime: number;
  CommentInfoList?: ZhihuOfficialCommentInfo[];
  AuthorityLevel: string;
  RankingScore?: number;
  [key: string]: unknown;
}

export interface ZhihuOfficialSearchResponse {
  Code: 0;
  Message: string;
  Data: {
    HasMore: boolean;
    Items: ZhihuOfficialSearchItem[];
    SearchHashId?: string;
    EmptyReason?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ZhihuOfficialHotListItem {
  Title: string;
  Url: string;
  ThumbnailUrl: string;
  Summary: string;
  [key: string]: unknown;
}

export interface ZhihuOfficialHotListResponse {
  Code: 0;
  Message: string;
  Data: {
    Total: number;
    Items: ZhihuOfficialHotListItem[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type ZhihuOfficialSuccessfulResponse =
  | ZhihuOfficialSearchResponse
  | ZhihuOfficialHotListResponse;

export function parseZhihuOfficialResponse(
  capability: ZhihuOfficialCapability,
  value: unknown,
  maximumItems: number
): ZhihuOfficialSuccessfulResponse {
  const envelope = responseEnvelope(value);
  if (envelope.Code !== 0) throw new Error(officialErrorCode(envelope.Code));
  if (capability === ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY) {
    return hotListResponse(envelope, maximumItems);
  }
  return searchResponse(envelope, maximumItems, capability === ZHIHU_OFFICIAL_SEARCH_CAPABILITY);
}

export function officialErrorCode(code: number): string {
  switch (code) {
    case 10001: return 'zhihu_official_api_parameter_rejected';
    case 20001: return 'zhihu_official_api_authentication_failed';
    case 30001: return 'zhihu_official_api_rate_limited';
    case 30002: return 'zhihu_official_api_quota_exhausted';
    case 90001: return 'zhihu_official_api_server_error';
    default: return 'zhihu_official_api_error';
  }
}

function responseEnvelope(value: unknown): Record<string, unknown> & {
  Code: number;
  Message: string;
  Data: unknown;
} {
  if (!record(value) || !Number.isSafeInteger(value.Code) ||
    typeof value.Message !== 'string' || value.Message.length > 1_000 ||
    !Object.hasOwn(value, 'Data')) {
    throw new Error('zhihu_official_api_response_invalid');
  }
  return value as Record<string, unknown> & { Code: number; Message: string; Data: unknown };
}

function searchResponse(
  envelope: ReturnType<typeof responseEnvelope>,
  maximumItems: number,
  requireRankingScore: boolean
): ZhihuOfficialSearchResponse {
  if (!record(envelope.Data) || typeof envelope.Data.HasMore !== 'boolean' ||
    !Array.isArray(envelope.Data.Items) || envelope.Data.Items.length > maximumItems ||
    (envelope.Data.SearchHashId !== undefined &&
      (typeof envelope.Data.SearchHashId !== 'string' || envelope.Data.SearchHashId.length > 512)) ||
    (envelope.Data.EmptyReason !== undefined &&
      (typeof envelope.Data.EmptyReason !== 'string' || envelope.Data.EmptyReason.length > 2_000))) {
    throw new Error('zhihu_official_api_response_invalid');
  }
  for (const item of envelope.Data.Items) validateSearchItem(item, requireRankingScore);
  return envelope as unknown as ZhihuOfficialSearchResponse;
}

function hotListResponse(
  envelope: ReturnType<typeof responseEnvelope>,
  maximumItems: number
): ZhihuOfficialHotListResponse {
  if (!record(envelope.Data) || !nonNegativeInteger(envelope.Data.Total) ||
    !Array.isArray(envelope.Data.Items) || envelope.Data.Items.length > maximumItems) {
    throw new Error('zhihu_official_api_response_invalid');
  }
  for (const item of envelope.Data.Items) {
    if (!record(item) || !boundedString(item.Title, 20_000) ||
      !publicUrl(item.Url) || !boundedString(item.ThumbnailUrl, 8_192) ||
      (item.ThumbnailUrl !== '' && !publicUrl(item.ThumbnailUrl)) ||
      !boundedString(item.Summary, 200_000)) {
      throw new Error('zhihu_official_api_response_invalid');
    }
  }
  return envelope as unknown as ZhihuOfficialHotListResponse;
}

function validateSearchItem(value: unknown, requireRankingScore: boolean): void {
  if (!record(value) || !boundedString(value.Title, 20_000) ||
    !boundedString(value.ContentType, 200) || !boundedString(value.ContentID, 1_000) ||
    !boundedString(value.ContentText, 2_000_000) || !publicUrl(value.Url) ||
    !nonNegativeInteger(value.CommentCount) || !nonNegativeInteger(value.VoteUpCount) ||
    !boundedString(value.AuthorName, 10_000) || !boundedString(value.AuthorAvatar, 8_192) ||
    (value.AuthorAvatar !== '' && !publicUrl(value.AuthorAvatar)) ||
    !boundedString(value.AuthorBadge, 8_192) ||
    (value.AuthorBadge !== '' && !publicUrl(value.AuthorBadge)) ||
    !boundedString(value.AuthorBadgeText, 10_000) || !nonNegativeInteger(value.EditTime) ||
    !boundedString(value.AuthorityLevel, 100) ||
    (requireRankingScore && !finiteNumber(value.RankingScore)) ||
    (!requireRankingScore && value.RankingScore !== undefined && !finiteNumber(value.RankingScore))) {
    throw new Error('zhihu_official_api_response_invalid');
  }
  if (value.CommentInfoList !== undefined) {
    if (!Array.isArray(value.CommentInfoList) || value.CommentInfoList.length > 1_000) {
      throw new Error('zhihu_official_api_response_invalid');
    }
    for (const comment of value.CommentInfoList) {
      if (!record(comment) || !boundedString(comment.Content, 200_000)) {
        throw new Error('zhihu_official_api_response_invalid');
      }
    }
  }
}

function publicUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 8_192) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function record(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
