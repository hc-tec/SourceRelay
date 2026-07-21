export type BilibiliAccountVideoInventoryUrlMode = 'strict_input' | 'observed_document';

/**
 * Input never accepts a query/hash. A browser-observed document may carry a
 * platform-added query, but that value is discarded while the MID/path identity
 * is checked. No query value crosses this helper's return boundary.
 */
export function canonicalBilibiliAccountVideoInventoryUrl(
  value: string,
  mode: BilibiliAccountVideoInventoryUrlMode = 'strict_input'
): string | null {
  try {
    const url = new URL(value);
    const match = url.protocol === 'https:' && url.hostname === 'space.bilibili.com'
      ? url.pathname.match(/^\/(\d{1,20})\/upload\/video\/?$/)
      : null;
    if (
      !match ||
      url.username ||
      url.password ||
      // Platform-added query parameters do not change the document identity,
      // but a fragment is never part of this page role and must be rejected.
      url.hash ||
      (mode === 'strict_input' && url.search)
    ) return null;
    return `https://space.bilibili.com/${match[1]}/upload/video`;
  } catch {
    return null;
  }
}
