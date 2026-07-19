import { createHash } from 'node:crypto';
import type { Response } from 'playwright';
import {
  BILIBILI_ACCOUNT_ARCHIVE_PATH,
  BILIBILI_ACCOUNT_INFO_PATH,
  projectBilibiliArchivePageResponse,
  type BilibiliAccountArchivePageProjection,
  type BilibiliAccountArchiveTerminalReason
} from './bilibili-account-archive-contract';
import type { InventoryDomSnapshot } from './bilibili-account-archive-dom';

const RESPONSE_BODY_LIMIT = 512 * 1024;

export interface BoundedJsonResponse {
  httpStatus: number;
  bodyBytes: number;
  bodySha256: string;
  queryKeyNames: string[];
  value: unknown;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeQueryKeyNames(url: URL): string[] {
  return [...new Set([...url.searchParams.keys()]
    .filter((key) => key.length > 0 && key.length <= 100)
    .map((key) => key.replace(/[^a-zA-Z0-9_.\-\[\]]/g, '_')))].sort();
}

export function isArchiveResponse(response: Response, accountId: string, pageNumber?: number): boolean {
  try {
    const url = new URL(response.url());
    if (url.origin !== 'https://api.bilibili.com' || url.pathname !== BILIBILI_ACCOUNT_ARCHIVE_PATH) {
      return false;
    }
    if (url.searchParams.get('mid') !== accountId) return false;
    return pageNumber === undefined || url.searchParams.get('pn') === String(pageNumber);
  } catch {
    return false;
  }
}

export function isAccountInfoResponse(response: Response, accountId: string): boolean {
  try {
    const url = new URL(response.url());
    return url.origin === 'https://api.bilibili.com' &&
      url.pathname === BILIBILI_ACCOUNT_INFO_PATH &&
      url.searchParams.get('mid') === accountId;
  } catch {
    return false;
  }
}

export async function boundedJsonResponse(response: Response): Promise<BoundedJsonResponse> {
  const httpStatus = response.status();
  const url = new URL(response.url());
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new Error(`bilibili_account_archive_response_status_${httpStatus}`);
  }
  const body = await response.body();
  if (body.byteLength > RESPONSE_BODY_LIMIT) throw new Error('bilibili_account_archive_response_too_large');
  const text = body.toString('utf8');
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error('bilibili_account_archive_response_invalid_json');
  }
  return {
    httpStatus,
    bodyBytes: body.byteLength,
    bodySha256: sha256(body),
    queryKeyNames: safeQueryKeyNames(url),
    value
  };
}

export function terminalReasonFromHttpStatus(status: number): BilibiliAccountArchiveTerminalReason {
  if (status === 401 || status === 403) return 'authentication_required';
  if (status === 412) return 'risk_controlled';
  if (status === 429) return 'rate_limited';
  return 'response_status_unavailable';
}

function normaliseTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function pageProjection(
  response: BoundedJsonResponse,
  accountId: string,
  expectedPageNumber: number,
  dom: InventoryDomSnapshot,
  capturedAt: string
): BilibiliAccountArchivePageProjection | null {
  const projected = projectBilibiliArchivePageResponse(response.value, accountId, expectedPageNumber);
  if (!projected) return null;
  const domIds = new Set(dom.videoIds);
  const responseIds = new Set(projected.items.map((item) => item.bvid));
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
    responseStatus: response.httpStatus,
    responseBodyBytes: response.bodyBytes,
    responseBodySha256: response.bodySha256,
    queryKeyNames: response.queryKeyNames,
    // A response title is retained only when the same BVID and full title are
    // present in the rendered page. Hidden response-only records never enter
    // this page artifact.
    items: titleMatches,
    domCrossCheck: {
      activePageNumber: dom.activePageNumber,
      uniqueVideoIds: dom.videoIds.length,
      responseVideoIds: projected.items.length,
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
