import type {
  SupportedPlatform,
  VisibleCollectionResult,
  VisiblePageState,
  VisibleSearchItem
} from '../shared/protocol';
import { nativeSearchPlatform } from '../shared/native-search';
import { resolveNativeSearchStrategy, strategyProvenance } from '../shared/strategy-registry';

const MAX_ITEMS = 20;

function cleanText(value: string | null | undefined, maximum = 500): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function safePageUrl(location: Location): string {
  const url = new URL(location.href);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.href;
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

function platformFromPage(location: Location): SupportedPlatform | 'unsupported' {
  return nativeSearchPlatform(new URL(location.href));
}

function anchors(document: Document): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((anchor) => {
    const style = getComputedStyle(anchor);
    return style.display !== 'none' && style.visibility !== 'hidden' && anchor.getClientRects().length > 0;
  });
}

function pageState(document: Document, items: readonly VisibleSearchItem[]): VisiblePageState {
  if (items.length > 0) return 'results_visible';
  const visibleText = cleanText(document.body?.innerText, 20_000);
  if (/验证码|安全验证|完成验证|请进行验证|异常访问/.test(visibleText)) return 'verification_required';
  if (/请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(visibleText)) return 'rate_limited';
  if (/登录后查看更多|请先登录|登录后查看|登录后搜索/.test(visibleText)) return 'authentication_required';
  if (/没有找到|暂无相关|未找到相关|搜索结果为空/.test(visibleText)) return 'no_results_visible';
  if (/页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(visibleText)) return 'source_unavailable';
  return 'layout_unrecognized';
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

function usefulBilibiliTitle(value: string): boolean {
  const semanticText = value
    .replace(/稍后再看/g, '')
    .replace(/[\p{N}\p{P}\p{S}\p{Z}]/gu, '');
  return semanticText.length >= 2;
}

function collectBilibili(document: Document, location: Location): VisibleSearchItem[] {
  const byUrl = new Map<string, { title: string; score: number }>();
  for (const anchor of anchors(document)) {
    const url = canonicalUrl(anchor.href, location.href);
    const match = url?.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
    if (!url || !match) continue;
    const heading = anchor.closest('h3');
    const titleCandidates = [
      { value: cleanText(heading?.getAttribute('title')), score: 4 },
      { value: cleanText(anchor.getAttribute('title')), score: 3 },
      { value: cleanText(anchor.getAttribute('aria-label')), score: 3 },
      { value: cleanText(heading?.textContent), score: 2 },
      { value: cleanText(anchor.textContent), score: 1 }
    ].filter((candidate) => candidate.value && usefulBilibiliTitle(candidate.value));
    const best = titleCandidates.sort((left, right) => right.score - left.score)[0];
    if (!best) continue;
    const canonical = `https://www.bilibili.com/video/${match[1]}`;
    const current = byUrl.get(canonical);
    if (!current || best.score > current.score) {
      byUrl.set(canonical, { title: best.value, score: best.score });
    }
  }
  return uniqueItems([...byUrl.entries()].map(([url, candidate]) => ({
    title: candidate.title,
    url,
    contentType: 'video' as const
  })));
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
  const platform = platformFromPage(location);
  const collectors: Record<SupportedPlatform, () => VisibleSearchItem[]> = {
    bilibili: () => collectBilibili(document, location),
    zhihu: () => collectZhihu(document, location),
    weibo: () => collectWeibo(document, location),
    xiaohongshu: () => collectXiaohongshu(document, location)
  };
  const items = platform === 'unsupported' ? [] : collectors[platform]();
  const strategy = platform === 'unsupported'
    ? null
    : strategyProvenance(resolveNativeSearchStrategy(platform));

  return {
    schemaVersion: 1,
    platform,
    operation: 'breadth_search',
    strategy,
    sourceUrl: safePageUrl(location),
    pageState: pageState(document, items),
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
