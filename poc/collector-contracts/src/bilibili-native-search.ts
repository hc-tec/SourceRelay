/**
 * Canonical identity for Bilibili's first-party desktop search routes.
 *
 * The search phrase is deliberately confined to navigation and the short-lived
 * observer binding. Persisted artifacts keep only its digest. Result type,
 * sort and page are small, reviewed enums and therefore may be structured
 * coverage fields.
 */
export const BILIBILI_NATIVE_SEARCH_QUERY_MAX_LENGTH = 160;
export const BILIBILI_NATIVE_SEARCH_MAX_PAGE = 2;

export const BILIBILI_NATIVE_SEARCH_RESULT_TYPES = ['comprehensive', 'video'] as const;
export type BilibiliNativeSearchResultType = typeof BILIBILI_NATIVE_SEARCH_RESULT_TYPES[number];

export const BILIBILI_NATIVE_SEARCH_SORTS = ['relevance', 'newest'] as const;
export type BilibiliNativeSearchSort = typeof BILIBILI_NATIVE_SEARCH_SORTS[number];

export interface BilibiliNativeSearchRoute {
  query: string;
  resultType: BilibiliNativeSearchResultType;
  sort: BilibiliNativeSearchSort;
  page: number;
}

export type BilibiliNativeSearchUrlMode = 'strict_input' | 'observed_document';

export function normaliseBilibiliNativeSearchQuery(value: string): string | null {
  const query = value.replace(/\s+/g, ' ').trim();
  return query && query.length <= BILIBILI_NATIVE_SEARCH_QUERY_MAX_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(query)
    ? query
    : null;
}

export function normaliseBilibiliNativeSearchRoute(value: {
  query: string;
  resultType?: unknown;
  sort?: unknown;
  page?: unknown;
}): BilibiliNativeSearchRoute | null {
  const query = normaliseBilibiliNativeSearchQuery(value.query);
  const resultType = value.resultType === undefined ? 'comprehensive' : value.resultType;
  const sort = value.sort === undefined ? 'relevance' : value.sort;
  const page = value.page === undefined ? 1 : value.page;
  if (!query ||
    !BILIBILI_NATIVE_SEARCH_RESULT_TYPES.includes(resultType as BilibiliNativeSearchResultType) ||
    !BILIBILI_NATIVE_SEARCH_SORTS.includes(sort as BilibiliNativeSearchSort) ||
    typeof page !== 'number' ||
    !Number.isSafeInteger(page) || page < 1 || page > BILIBILI_NATIVE_SEARCH_MAX_PAGE) return null;
  if (resultType === 'comprehensive' && sort !== 'relevance') return null;
  return {
    query,
    resultType: resultType as BilibiliNativeSearchResultType,
    sort: sort as BilibiliNativeSearchSort,
    page
  };
}

/** This URL is transient and must never be persisted with its keyword. */
export function bilibiliNativeSearchUrl(route: BilibiliNativeSearchRoute): string {
  const canonical = normaliseBilibiliNativeSearchRoute(route);
  if (!canonical) throw new Error('bilibili_native_search_route_invalid');
  const url = new URL(canonical.resultType === 'video'
    ? 'https://search.bilibili.com/video'
    : 'https://search.bilibili.com/all');
  url.searchParams.set('keyword', canonical.query);
  if (canonical.sort === 'newest') url.searchParams.set('order', 'pubdate');
  if (canonical.page > 1) url.searchParams.set('page', String(canonical.page));
  return url.href;
}

/**
 * A strict input has exactly the reviewed canonical keys. Observed Bilibili
 * documents are allowed to carry the two currently proven volatile navigation
 * keys (`o`, `vt`); both are ignored before exact semantic canonicalization.
 */
export function canonicalBilibiliNativeSearchUrl(
  value: string,
  mode: BilibiliNativeSearchUrlMode = 'strict_input'
): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'search.bilibili.com' ||
      !['/all', '/video'].includes(url.pathname) ||
      url.username ||
      url.password ||
      url.hash
    ) return null;
    const allowedKeys = mode === 'strict_input'
      ? new Set(['keyword', 'order', 'page'])
      : new Set(['keyword', 'order', 'page', 'o', 'vt']);
    if ([...url.searchParams.keys()].some((key) => !allowedKeys.has(key))) return null;
    const keyword = url.searchParams.get('keyword');
    if (keyword === null || url.searchParams.getAll('keyword').length !== 1) return null;
    const resultType: BilibiliNativeSearchResultType = url.pathname === '/video' ? 'video' : 'comprehensive';
    const order = url.searchParams.get('order');
    if (order !== null && order !== 'pubdate') return null;
    const sort: BilibiliNativeSearchSort = order === 'pubdate' ? 'newest' : 'relevance';
    const rawPage = url.searchParams.get('page');
    if (rawPage !== null && (!/^\d+$/.test(rawPage) || url.searchParams.getAll('page').length !== 1)) return null;
    const page = rawPage === null ? 1 : Number(rawPage);
    const route = normaliseBilibiliNativeSearchRoute({ query: keyword, resultType, sort, page });
    if (!route) return null;
    const canonical = bilibiliNativeSearchUrl(route);
    return mode === 'strict_input' && url.href !== canonical ? null : canonical;
  } catch {
    return null;
  }
}
