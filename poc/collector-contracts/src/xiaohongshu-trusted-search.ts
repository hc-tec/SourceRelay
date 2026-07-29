import type { PageVisualEvidence } from './page-visual-evidence.js';

export const XIAOHONGSHU_TRUSTED_SEARCH_SCHEMA_VERSION = 1 as const;

/**
 * A temporary, query-free response shape used only by the live reconnaissance
 * command.  It deliberately keeps field names and array sizes, never the
 * response URL, headers, credentials, or body content.
 */
export interface XiaohongshuTrustedSearchResponseShape {
  host: string;
  path: string;
  status: number;
  mime: string;
  bodyBytes: number;
  topLevelKeys: string[];
  dataKeys: string[];
  firstArrayPath: string | null;
  firstArrayLength: number;
  firstItemKeys: string[];
}

/**
 * One narrow, source-specific in-page search action. No URL, selector,
 * script, coordinate, tab ID or document ID can be supplied by the caller.
 */
export interface XiaohongshuTrustedSearchRequest {
  schemaVersion: typeof XIAOHONGSHU_TRUSTED_SEARCH_SCHEMA_VERSION;
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  runId: string;
  expectedRecordVersion: number;
  expectedDocumentGeneration: number;
  actionId: string;
  query: string;
  timeoutMs: number;
}

export interface XiaohongshuTrustedSearchResult {
  schemaVersion: typeof XIAOHONGSHU_TRUSTED_SEARCH_SCHEMA_VERSION;
  pageAlias: string;
  actionId: string;
  recordVersion: number;
  documentGeneration: number;
  routeGeneration: number;
  completedAt: string;
  inputAttempted: true;
  enterAttempted: true;
  before: {
    targetKind: 'visible_search_input';
    targetBounds: { x: number; y: number; width: number; height: number };
    pointerHitTarget: true;
    visualEvidence: PageVisualEvidence;
  };
  after: {
    queryEchoed: true;
    publicSurface: 'search';
    renderedCardCount: number;
    visualEvidence: PageVisualEvidence;
  };
  network: {
    responseCount: number;
    successfulResponseCount: number;
    jsonResponseCount: number;
    responseBodiesRead: boolean;
    /** Present only for the Host's live recon command; absent in production. */
    responseShapes?: readonly XiaohongshuTrustedSearchResponseShape[];
  };
  risk: {
    loginRequired: boolean;
    verificationRequired: false;
    rateLimited: false;
    sourceUnavailable: false;
  };
}

export function isXiaohongshuTrustedSearchRequest(value: unknown): value is XiaohongshuTrustedSearchRequest {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'profileId', 'pageAlias', 'pageLeaseId', 'runId',
    'expectedRecordVersion', 'expectedDocumentGeneration', 'actionId', 'query', 'timeoutMs'
  ])) return false;
  return value.schemaVersion === XIAOHONGSHU_TRUSTED_SEARCH_SCHEMA_VERSION &&
    identifier(value.profileId) && identifier(value.pageAlias) && identifier(value.pageLeaseId) &&
    identifier(value.runId) && identifier(value.actionId) &&
    Number.isSafeInteger(value.expectedRecordVersion) && Number(value.expectedRecordVersion) > 0 &&
    Number.isSafeInteger(value.expectedDocumentGeneration) && Number(value.expectedDocumentGeneration) > 0 &&
    typeof value.query === 'string' && value.query === value.query.trim() && value.query.length >= 1 &&
    value.query.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value.query) &&
    Number.isSafeInteger(value.timeoutMs) && Number(value.timeoutMs) >= 5_000 && Number(value.timeoutMs) <= 30_000;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 180 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
