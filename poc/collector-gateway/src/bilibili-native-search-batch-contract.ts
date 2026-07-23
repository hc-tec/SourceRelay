import {
  BILIBILI_NATIVE_SEARCH_MAX_PAGE,
  BILIBILI_NATIVE_SEARCH_RESULT_TYPES,
  BILIBILI_NATIVE_SEARCH_SORTS,
  type BilibiliNativeSearchResultType,
  type BilibiliNativeSearchSort
} from '@intelligence/collector-contracts';
import {
  bilibiliNativeSearchInput,
  type BilibiliNativeSearchItem,
  type BilibiliNativeSearchRunRecord
} from './bilibili-native-search-contract';

export const BILIBILI_NATIVE_SEARCH_BATCH_MAX_PAGES = 2 as const;

export interface BilibiliNativeSearchBatchInput {
  profileId: string;
  query: string;
  resultType: BilibiliNativeSearchResultType;
  sort: BilibiliNativeSearchSort;
  pages: number[];
}

export type BilibiliNativeSearchBatchTerminalReason =
  | 'search_batch_ready'
  | 'search_batch_duplicates'
  | 'search_batch_page_partial'
  | 'search_batch_page_failed'
  | 'search_batch_run_failed';

export interface BilibiliNativeSearchBatchPageRun {
  page: number;
  runId: string;
  artifactId: string;
  state: BilibiliNativeSearchRunRecord['state'];
  terminalReason: BilibiliNativeSearchRunRecord['coverage']['terminalReason'];
  capturedItems: number;
  unresolvedCardCount: number;
}

export interface BilibiliNativeSearchBatchRunRecord {
  schemaVersion: 1;
  batchId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'native_search_batch';
  search: {
    resultType: BilibiliNativeSearchResultType;
    sort: BilibiliNativeSearchSort;
    pages: number[];
  };
  queryDigest: string;
  strategyCandidate: {
    strategyId: 'bilibili.search.breadth.dom.v2';
    version: '0.2.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  pageRuns: BilibiliNativeSearchBatchPageRun[];
  mergedItems: BilibiliNativeSearchItem[];
  coverage: {
    requestedPages: number;
    capturedPages: number;
    uniqueItems: number;
    duplicateBvids: string[];
    duplicateCount: number;
    unresolvedCardCount: number;
    partial: boolean;
    terminalReason: BilibiliNativeSearchBatchTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'bounded_sequential_native_search_runs';
    query: 'sha256_only_in_persisted_artifacts';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    responseBodies: 'not_read';
    pageBudget: 2;
    semanticActionDelivery: 'at_most_once_per_page';
    admissionEligible: false;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pages(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > BILIBILI_NATIVE_SEARCH_BATCH_MAX_PAGES) return null;
  const result = value.map((page) => typeof page === 'number' && Number.isSafeInteger(page) ? page : null);
  if (result.some((page) => page === null) || result.some((page) => page! < 1 || page! > BILIBILI_NATIVE_SEARCH_MAX_PAGE)) return null;
  const unique = [...new Set(result as number[])].sort((left, right) => left - right);
  return unique.length === result.length ? unique : null;
}

export function bilibiliNativeSearchBatchInput(value: unknown): BilibiliNativeSearchBatchInput {
  const candidate = record(value);
  if (!candidate || Object.keys(candidate).some((key) => !['profileId', 'query', 'resultType', 'sort', 'pages'].includes(key)) ||
    typeof candidate.profileId !== 'string' || !candidate.profileId ||
    typeof candidate.query !== 'string') {
    throw new Error('bilibili_native_search_batch_input_invalid');
  }
  const requestedPages = pages(candidate.pages);
  if (!requestedPages) throw new Error('bilibili_native_search_batch_input_invalid');
  const single = bilibiliNativeSearchInput({
    query: candidate.query,
    ...(candidate.resultType === undefined ? {} : { resultType: candidate.resultType }),
    ...(candidate.sort === undefined ? {} : { sort: candidate.sort }),
    page: requestedPages[0]
  });
  if (!BILIBILI_NATIVE_SEARCH_RESULT_TYPES.includes(single.resultType) ||
    !BILIBILI_NATIVE_SEARCH_SORTS.includes(single.sort)) {
    throw new Error('bilibili_native_search_batch_input_invalid');
  }
  return {
    profileId: candidate.profileId,
    query: single.query,
    resultType: single.resultType,
    sort: single.sort,
    pages: requestedPages
  };
}
