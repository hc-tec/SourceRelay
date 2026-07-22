/**
 * Canonical identity for Bilibili's first-party web search page.
 *
 * The search phrase is intentionally limited to the short-lived navigation
 * and observer-binding boundary. Callers that persist results must keep only
 * a digest of the normalized phrase, never this URL or its query value.
 */
export const BILIBILI_NATIVE_SEARCH_QUERY_MAX_LENGTH = 160;

export type BilibiliNativeSearchUrlMode = 'strict_input' | 'observed_document';

export function normaliseBilibiliNativeSearchQuery(value: string): string | null {
  const query = value.replace(/\s+/g, ' ').trim();
  return query && query.length <= BILIBILI_NATIVE_SEARCH_QUERY_MAX_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(query)
    ? query
    : null;
}

export function bilibiliNativeSearchUrl(query: string): string {
  const normalised = normaliseBilibiliNativeSearchQuery(query);
  if (!normalised) throw new Error('bilibili_native_search_query_invalid');
  const url = new URL('https://search.bilibili.com/all');
  url.searchParams.set('keyword', normalised);
  return url.href;
}

/**
 * Strict inputs contain precisely the canonical `keyword` query. A browser
 * document may carry additional platform navigation parameters; those are
 * discarded while the normalized keyword identity remains checked.
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
      url.pathname !== '/all' ||
      url.username ||
      url.password ||
      url.hash
    ) return null;
    const keyword = url.searchParams.get('keyword');
    if (keyword === null) return null;
    const canonical = bilibiliNativeSearchUrl(keyword);
    return mode === 'strict_input' && url.href !== canonical ? null : canonical;
  } catch {
    return null;
  }
}
