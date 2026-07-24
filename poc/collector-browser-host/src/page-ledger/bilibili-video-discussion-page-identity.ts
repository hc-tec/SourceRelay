const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const VD_SOURCE_PATTERN = /^[0-9a-f]{32}$/i;
const SPM_ID_FROM_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;
const PART_NUMBER_PATTERN = /^[1-9][0-9]{0,5}$/;

/**
 * Bilibili may rewrite a video URL between the first document and the lazy
 * comment document (for example by adding the public `vd_source` marker, a
 * player `spm_id_from` marker, a multipart `p` number, or a trailing slash).
 * The discussion runner accepts only these observed public query shapes for
 * the same BVID; unknown query parameters and other paths remain rejected.
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
    if (new Set(entries.map(([key]) => key)).size !== entries.length) return false;
    return entries.every(([key, value]) =>
      (key === 'vd_source' && VD_SOURCE_PATTERN.test(value)) ||
      (key === 'spm_id_from' && SPM_ID_FROM_PATTERN.test(value)) ||
      (key === 'p' && PART_NUMBER_PATTERN.test(value))
    );
  } catch {
    return false;
  }
}
