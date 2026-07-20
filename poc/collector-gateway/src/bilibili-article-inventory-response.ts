import { createHash } from 'node:crypto';
import type { Response } from 'playwright';
import {
  BILIBILI_ARTICLE_FEED_PATH,
  BILIBILI_ARTICLE_RESPONSE_LIMIT,
  projectBilibiliArticleFeedResponse,
  type BilibiliArticleFeedResponseEvidence,
  type BilibiliArticleInventoryDomSnapshot,
  type BilibiliArticleInventoryItem,
  type BilibiliArticleInventoryPageCandidate,
  type BilibiliArticleInventoryPageProjection
} from './bilibili-article-contract';
import { responseSchema } from './interaction-response-projector';

export interface BoundedBilibiliArticleFeedResponse {
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

export function isBilibiliArticleFeedResponse(
  response: Response,
  expectedAccountId: string,
  expectedPageNumber: number,
  expectedOffset: string,
  expectedType: 'all' | 'article'
): boolean {
  try {
    const url = new URL(response.url());
    return response.request().method() === 'GET' &&
      url.origin === 'https://api.bilibili.com' &&
      url.pathname === BILIBILI_ARTICLE_FEED_PATH &&
      url.searchParams.get('host_mid') === expectedAccountId &&
      url.searchParams.get('page') === String(expectedPageNumber) &&
      (url.searchParams.get('offset') ?? '') === expectedOffset &&
      url.searchParams.get('type') === expectedType;
  } catch {
    return false;
  }
}

export async function boundedBilibiliArticleFeedResponse(
  response: Response
): Promise<BoundedBilibiliArticleFeedResponse> {
  const body = await response.body();
  if (body.byteLength > BILIBILI_ARTICLE_RESPONSE_LIMIT) {
    throw new Error('bilibili_article_inventory_response_too_large');
  }
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new Error('bilibili_article_inventory_response_invalid_json');
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

export function articleFeedResponseEvidence(
  response: BoundedBilibiliArticleFeedResponse,
  pageNumber: number
): BilibiliArticleFeedResponseEvidence {
  return {
    pathname: BILIBILI_ARTICLE_FEED_PATH,
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

export function projectBilibiliArticleFeedPageWithDom(
  response: BoundedBilibiliArticleFeedResponse,
  expectedPageNumber: number,
  previousItems: readonly BilibiliArticleInventoryItem[],
  dom: BilibiliArticleInventoryDomSnapshot,
  capturedAt: string
): { projection: BilibiliArticleInventoryPageProjection; candidate: BilibiliArticleInventoryPageCandidate } | null {
  const candidate = projectBilibiliArticleFeedResponse(response.value, expectedPageNumber);
  if (!candidate) return null;
  const cumulativeItems = [...previousItems, ...candidate.items];
  const cumulativeIds = new Set(cumulativeItems.map((item) => item.stableOpusId));
  const domIds = new Set(dom.stableOpusIds);
  const responseOnly = [...cumulativeIds].filter((id) => !domIds.has(id));
  const domOnly = [...domIds].filter((id) => !cumulativeIds.has(id));
  const matched = [...cumulativeIds].filter((id) => domIds.has(id));
  const pageTitleMatches = candidate.items.filter((item) =>
    (dom.titleCandidates[item.stableOpusId] ?? []).some((title) => normaliseTitle(title) === item.cardText)
  );
  const responseCumulativeIdDigest = sha256([...cumulativeIds].sort().join('\n'));
  const domCumulativeIdDigest = sha256([...domIds].sort().join('\n'));
  const exactCumulativeIdentityMatch = responseOnly.length === 0 && domOnly.length === 0 &&
    cumulativeIds.size === cumulativeItems.length && responseCumulativeIdDigest === domCumulativeIdDigest;
  return {
    candidate,
    projection: {
      schemaVersion: 1,
      pageNumber: candidate.pageNumber,
      items: pageTitleMatches,
      hasMore: candidate.hasMore,
      nextOffsetPresent: candidate.nextOffset.length > 0,
      updateNumber: candidate.updateNumber,
      responseStatus: response.status,
      responseBodyBytes: response.bodyBytes,
      responseBodySha256: response.bodySha256,
      queryKeyNames: response.queryKeyNames,
      schemaPaths: response.schemaPaths,
      sensitiveFieldPathsOmitted: response.sensitiveFieldPathsOmitted,
      domCrossCheck: {
        responsePageItems: candidate.items.length,
        responseCumulativeItems: cumulativeItems.length,
        domCumulativeItems: dom.stableOpusIds.length,
        matchedCumulativeItems: matched.length,
        responseOnlyItems: responseOnly.length,
        domOnlyItems: domOnly.length,
        pageTitleMatches: pageTitleMatches.length,
        responseCumulativeIdDigest,
        domCumulativeIdDigest,
        exactCumulativeIdentityMatch
      },
      capturedAt
    }
  };
}
