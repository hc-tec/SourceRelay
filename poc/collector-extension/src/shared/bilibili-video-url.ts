export type BilibiliVideoUrlMode = 'strict_input' | 'observed_document';

function allowedObservedDocumentQuery(url: URL): boolean {
  if (!url.search) return true;
  let entryCount = 0;
  let allowed = true;
  url.searchParams.forEach((value, key) => {
    entryCount += 1;
    if (key !== 'vd_source' || !/^[0-9a-f]{32}$/i.test(value)) allowed = false;
  });
  return entryCount === 1 && allowed;
}

export function canonicalBilibiliVideoUrl(
  value: string,
  mode: BilibiliVideoUrlMode = 'strict_input'
): string | null {
  try {
    const url = new URL(value);
    const match = url.hostname === 'www.bilibili.com' &&
      url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
    if (
      url.protocol !== 'https:' ||
      !match ||
      url.username ||
      url.password ||
      url.hash ||
      (mode === 'strict_input' ? Boolean(url.search) : !allowedObservedDocumentQuery(url))
    ) return null;
    return `https://www.bilibili.com/video/${match[1]}`;
  } catch {
    return null;
  }
}
