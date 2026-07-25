export type BilibiliAccountProfileUrlMode = 'strict_input' | 'observed_document';
export type BilibiliAccountVideoInventoryUrlMode = 'strict_input' | 'observed_document';

/**
 * Canonical public account-home identity. Profile paths have no approved
 * query or fragment in caller input. The live page may add a query while it
 * is rendering; it is discarded only after the MID/path identity is checked.
 */
export function canonicalBilibiliAccountProfileUrl(
  value: string,
  mode: BilibiliAccountProfileUrlMode = 'strict_input'
): string | null {
  try {
    const url = new URL(value);
    const match = url.protocol === 'https:' && url.hostname === 'space.bilibili.com'
      ? url.pathname.match(/^\/(\d{1,20})\/?$/)
      : null;
    if (
      !match ||
      url.username ||
      url.password ||
      url.hash ||
      (mode === 'strict_input' && url.search)
    ) return null;
    return `https://space.bilibili.com/${match[1]}`;
  } catch {
    return null;
  }
}

export function bilibiliAccountProfileIdFromUrl(value: string): string | null {
  const canonical = canonicalBilibiliAccountProfileUrl(value, 'observed_document');
  return canonical?.match(/^https:\/\/space\.bilibili\.com\/(\d{1,20})$/)?.[1] ?? null;
}

/**
 * Canonical public "投稿视频" page identity for an account.  Keeping this
 * derivation in the shared contract means the Gateway, signed work item and
 * extension tab guard all agree on the one allowed inventory destination.
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
      url.hash ||
      (mode === 'strict_input' && url.search)
    ) return null;
    return `https://space.bilibili.com/${match[1]}/upload/video`;
  } catch {
    return null;
  }
}

export function bilibiliAccountVideoInventoryIdFromUrl(value: string): string | null {
  const canonical = canonicalBilibiliAccountVideoInventoryUrl(value, 'observed_document');
  return canonical?.match(/^https:\/\/space\.bilibili\.com\/(\d{1,20})\/upload\/video$/)?.[1] ?? null;
}
