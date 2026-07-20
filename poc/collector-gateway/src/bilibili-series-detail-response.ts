import { createHash } from 'node:crypto';
import {
  BILIBILI_SERIES_ARCHIVES_PATH,
  BILIBILI_SERIES_METADATA_PATH,
  BILIBILI_SERIES_RESPONSE_LIMIT,
  projectBilibiliSeriesPageResponse,
  type BilibiliSeriesDomSnapshot,
  type BilibiliSeriesMetadataResponseEvidence,
  type BilibiliSeriesPageResponseEvidence,
  type BilibiliSeriesPageProjection
} from './bilibili-series-detail-contract';
import { responseSchema } from './interaction-response-projector';

interface ProjectableResponse {
  url(): string;
  status(): number;
  body(): Promise<Buffer>;
  request(): { method(): string };
}

interface BoundedSeriesResponse {
  value: unknown;
  status: number;
  bodyBytes: number;
  bodySha256: string;
  queryKeyNames: string[];
  schemaPaths: ReturnType<typeof responseSchema>['schemaPaths'];
  sensitiveFieldPathsOmitted: number;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeQueryKeyNames(url: URL): string[] {
  return [...new Set([...url.searchParams.keys()]
    .filter((key) => key.length > 0 && key.length <= 100)
    .map((key) => key.replace(/[^a-zA-Z0-9_.\-\[\]]/g, '_')))].sort();
}

export function isBilibiliSeriesMetadataResponse(response: ProjectableResponse, seriesId: string): boolean {
  try {
    const url = new URL(response.url());
    return response.request().method() === 'GET' &&
      url.origin === 'https://api.bilibili.com' &&
      url.pathname === BILIBILI_SERIES_METADATA_PATH &&
      url.searchParams.get('series_id') === seriesId;
  } catch {
    return false;
  }
}

export function isBilibiliSeriesArchivesResponse(
  response: ProjectableResponse,
  seriesId: string,
  pageNumber: number
): boolean {
  try {
    const url = new URL(response.url());
    return response.request().method() === 'GET' &&
      url.origin === 'https://api.bilibili.com' &&
      url.pathname === BILIBILI_SERIES_ARCHIVES_PATH &&
      url.searchParams.get('series_id') === seriesId &&
      url.searchParams.get('pn') === String(pageNumber);
  } catch {
    return false;
  }
}

export async function boundedBilibiliSeriesResponse(response: ProjectableResponse): Promise<BoundedSeriesResponse> {
  const body = await response.body();
  if (body.byteLength > BILIBILI_SERIES_RESPONSE_LIMIT) {
    throw new Error('bilibili_series_detail_response_too_large');
  }
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new Error('bilibili_series_detail_response_invalid_json');
  }
  const schema = responseSchema(value);
  return {
    value,
    status: response.status(),
    bodyBytes: body.byteLength,
    bodySha256: sha256(body),
    queryKeyNames: safeQueryKeyNames(new URL(response.url())),
    schemaPaths: schema.schemaPaths,
    sensitiveFieldPathsOmitted: schema.sensitiveFieldPathsOmitted
  };
}

export function seriesMetadataEvidence(
  response: BoundedSeriesResponse
): BilibiliSeriesMetadataResponseEvidence {
  return {
    pathname: BILIBILI_SERIES_METADATA_PATH,
    responseStatus: response.status,
    responseBodyBytes: response.bodyBytes,
    responseBodySha256: response.bodySha256,
    queryKeyNames: response.queryKeyNames,
    schemaPaths: response.schemaPaths,
    sensitiveFieldPathsOmitted: response.sensitiveFieldPathsOmitted
  };
}

export function seriesPageEvidence(
  response: BoundedSeriesResponse,
  pageNumber: number
): BilibiliSeriesPageResponseEvidence {
  return {
    pathname: BILIBILI_SERIES_ARCHIVES_PATH,
    pageNumber,
    responseStatus: response.status,
    responseBodyBytes: response.bodyBytes,
    responseBodySha256: response.bodySha256,
    queryKeyNames: response.queryKeyNames,
    schemaPaths: response.schemaPaths,
    sensitiveFieldPathsOmitted: response.sensitiveFieldPathsOmitted
  };
}

function normaliseTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function projectBilibiliSeriesPageWithDom(
  response: BoundedSeriesResponse,
  expectedAccountId: string,
  expectedPageNumber: number,
  dom: BilibiliSeriesDomSnapshot,
  capturedAt: string
): BilibiliSeriesPageProjection | null {
  const projected = projectBilibiliSeriesPageResponse(response.value, expectedAccountId, expectedPageNumber);
  if (!projected) return null;
  const responseIds = new Set(projected.items.map((item) => item.bvid));
  const domIds = new Set(dom.videoIds);
  const matched = projected.items.filter((item) => domIds.has(item.bvid));
  const titleMatches = matched.filter((item) =>
    (dom.titleCandidates[item.bvid] ?? []).some((candidate) => normaliseTitle(candidate) === item.title)
  );
  const responseOnly = projected.items.filter((item) => !domIds.has(item.bvid));
  const domOnly = dom.videoIds.filter((bvid) => !responseIds.has(bvid));
  const responseIdDigest = sha256([...responseIds].sort().join('\n'));
  const domIdDigest = sha256([...domIds].sort().join('\n'));
  const exactIdentityMatch = responseOnly.length === 0 && domOnly.length === 0 &&
    matched.length === projected.items.length && responseIdDigest === domIdDigest;
  return {
    schemaVersion: 1,
    pageNumber: projected.pageNumber,
    pageSize: projected.pageSize,
    declaredTotal: projected.declaredTotal,
    items: titleMatches,
    responseStatus: response.status,
    responseBodyBytes: response.bodyBytes,
    responseBodySha256: response.bodySha256,
    queryKeyNames: response.queryKeyNames,
    schemaPaths: response.schemaPaths,
    sensitiveFieldPathsOmitted: response.sensitiveFieldPathsOmitted,
    domCrossCheck: {
      activePageNumber: dom.activePageNumber,
      responseVideoIds: projected.items.length,
      domVideoIds: dom.videoIds.length,
      matchedVideoIds: matched.length,
      responseOnlyVideoIds: responseOnly.length,
      domOnlyVideoIds: domOnly.length,
      titleMatches: titleMatches.length,
      responseIdDigest,
      domIdDigest,
      exactIdentityMatch
    },
    capturedAt
  };
}
