const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;

/**
 * Bilibili may rewrite a video URL between the first document and the lazy
 * comment document (for example by adding the public `vd_source` marker or a
 * trailing slash). The discussion runner may accept only these exact URL
 * shapes for the same BVID; arbitrary query parameters and other paths remain
 * rejected.
 */
export function matchesBilibiliVideoDiscussionPageIdentity(urlValue: string, expectedBvid: string): boolean {
  if (!BVID_PATTERN.test(expectedBvid)) return false;
  try {
    const url = new URL(urlValue);
    if (url.protocol !== 'https:' || url.hostname !== 'www.bilibili.com' ||
      url.username || url.password || url.hash) return false;
    const observedBvid = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null;
    if (observedBvid !== expectedBvid) return false;
    const entries = [...url.searchParams.entries()];
    return entries.length === 0 ||
      (entries.length === 1 && entries[0]?.[0] === 'vd_source' && /^[0-9a-f]{32}$/i.test(entries[0][1]));
  } catch {
    return false;
  }
}
