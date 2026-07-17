import type { SupportedPlatform, VisibleCollectionResult, VisibleSearchItem } from '../shared/protocol';
import { nativeSearchPlatform } from '../shared/native-search';

const MAX_ITEMS = 20;

function cleanText(value: string | null | undefined, maximum = 500): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function canonicalUrl(rawHref: string, baseUrl: string): URL | null {
  try {
    const url = new URL(rawHref, baseUrl);
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function platformFromPage(document: Document, location: Location): SupportedPlatform | 'unsupported' {
  if (location.hostname === '127.0.0.1') {
    const candidate = document.documentElement.dataset.collectorPlatform;
    if (candidate === 'bilibili' || candidate === 'zhihu' || candidate === 'weibo' || candidate === 'xiaohongshu') {
      return candidate;
    }
  }
  return nativeSearchPlatform(new URL(location.href));
}

function anchors(document: Document): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
}

function uniqueItems(candidates: Array<Omit<VisibleSearchItem, 'rank'>>): VisibleSearchItem[] {
  const seen = new Set<string>();
  const items: VisibleSearchItem[] = [];
  for (const candidate of candidates) {
    if (!candidate.title || !candidate.url || seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    items.push({ ...candidate, rank: items.length + 1 });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

function collectBilibili(document: Document, location: Location): VisibleSearchItem[] {
  const candidates = anchors(document).flatMap((anchor) => {
    const url = canonicalUrl(anchor.href, location.href);
    const match = url?.pathname.match(/^\/video\/(BV[0-9A-Za-z]+)$/);
    if (!url || !match) return [];
    return [{
      title: cleanText(anchor.getAttribute('title') || anchor.textContent),
      url: `https://www.bilibili.com/video/${match[1]}`,
      contentType: 'video' as const
    }];
  });
  return uniqueItems(candidates);
}

function collectZhihu(document: Document, location: Location): VisibleSearchItem[] {
  const candidates = anchors(document).flatMap((anchor) => {
    const url = canonicalUrl(anchor.href, location.href);
    if (!url) return [];
    const isQuestion = url.hostname === 'www.zhihu.com' && /^\/question\/\d+(?:\/answer\/\d+)?$/.test(url.pathname);
    const isArticle = url.hostname === 'zhuanlan.zhihu.com' && /^\/p\/\d+$/.test(url.pathname);
    if (!isQuestion && !isArticle) return [];
    return [{
      title: cleanText(anchor.getAttribute('title') || anchor.textContent),
      url: `${url.origin}${url.pathname}`,
      contentType: isArticle ? ('article' as const) : ('answer_or_question' as const)
    }];
  });
  return uniqueItems(candidates);
}

function collectWeibo(document: Document, location: Location): VisibleSearchItem[] {
  const candidates = anchors(document).flatMap((anchor) => {
    const url = canonicalUrl(anchor.href, location.href);
    if (!url) return [];
    const isDesktopPost = url.hostname === 'weibo.com' && /^\/\d{5,}\/[^/?#]+$/.test(url.pathname);
    const isMobilePost = url.hostname === 'm.weibo.cn' && /^\/status\/[^/?#]+$/.test(url.pathname);
    if (!isDesktopPost && !isMobilePost) return [];
    return [{
      title: cleanText(anchor.getAttribute('title') || anchor.textContent),
      url: `${url.origin}${url.pathname}`,
      contentType: 'post' as const
    }];
  });
  return uniqueItems(candidates);
}

function collectXiaohongshu(document: Document, location: Location): VisibleSearchItem[] {
  const candidates = anchors(document).flatMap((anchor) => {
    const url = canonicalUrl(anchor.href, location.href);
    const match = url?.hostname === 'www.xiaohongshu.com' && url.pathname.match(/^\/explore\/([A-Za-z0-9]+)$/);
    if (!url || !match) return [];
    return [{
      title: cleanText(anchor.getAttribute('title') || anchor.textContent),
      url: `https://www.xiaohongshu.com/explore/${match[1]}`,
      contentType: 'note' as const
    }];
  });
  return uniqueItems(candidates);
}

export function collectVisibleSearchResults(
  document: Document,
  location: Location
): VisibleCollectionResult {
  const platform = platformFromPage(document, location);
  const collectors: Record<SupportedPlatform, () => VisibleSearchItem[]> = {
    bilibili: () => collectBilibili(document, location),
    zhihu: () => collectZhihu(document, location),
    weibo: () => collectWeibo(document, location),
    xiaohongshu: () => collectXiaohongshu(document, location)
  };
  const items = platform === 'unsupported' ? [] : collectors[platform]();

  return {
    schemaVersion: 1,
    platform,
    operation: 'keyword_search',
    sourceUrl: location.href,
    partial: true,
    itemCount: items.length,
    items,
    warnings: [
      'Visible DOM only; no browser credential, storage, network request, or network response data is read.',
      'First rendered page only; no pagination, result expansion, comment collection, or write action is performed.',
      ...(platform === 'unsupported' ? ['This page is not a recognized platform-native keyword-search route.'] : [])
    ]
  };
}
