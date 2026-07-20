import type {
  SupportedPlatform,
  VisibleCollectionResult,
  VisibleDetailCollectionResult,
  VisiblePageState,
  VisibleSearchCollectionResult,
  VisibleSearchItem
} from '../shared/protocol';
import { nativeSearchPlatform } from '../shared/native-search';
import {
  resolveDetailStrategy,
  resolveNativeSearchStrategy,
  strategyProvenance
} from '../shared/strategy-registry';

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

function pageState(document: Document, contentVisible: boolean): VisiblePageState {
  if (contentVisible) return 'results_visible';
  const visibleText = cleanText(document.body?.innerText, 20_000);
  if (/验证码|安全验证|完成验证|请进行验证|异常访问/.test(visibleText)) return 'verification_required';
  if (/请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(visibleText)) return 'rate_limited';
  if (/登录后查看更多|请先登录|登录后查看|登录后搜索/.test(visibleText)) return 'authentication_required';
  if (/没有找到|暂无相关|未找到相关|搜索结果为空/.test(visibleText)) return 'no_results_visible';
  if (/页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(visibleText)) return 'source_unavailable';
  return 'layout_unrecognized';
}

function visibleElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function visibleText(document: Document, selectors: readonly string[], maximum: number): string {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!visibleElement(element)) continue;
    const text = cleanText(element.getAttribute('title') || element.innerText, maximum);
    if (text) return text;
  }
  return '';
}

function canonicalBilibiliVideo(location: Location): { contentId: string; url: string } | null {
  if (location.hostname !== 'www.bilibili.com') return null;
  const match = location.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
  const contentId = match?.[1];
  return contentId
    ? { contentId, url: `https://www.bilibili.com/video/${contentId}` }
    : null;
}

function collectBilibiliVideoDetail(
  document: Document,
  location: Location
): VisibleDetailCollectionResult {
  const canonical = canonicalBilibiliVideo(location);
  const strategy = strategyProvenance(resolveDetailStrategy('bilibili'));
  const title = visibleText(document, [
    'h1.video-title[title]',
    'h1.video-title',
    '.video-info-title-inner[title]',
    '.video-info-title-inner'
  ], 500);
  const creatorLink = Array.from(document.querySelectorAll<HTMLAnchorElement>(
    '.up-info-container a.up-name[href], .up-info-container a[href*="space.bilibili.com/"]'
  )).find((anchor) => visibleElement(anchor) && /space\.bilibili\.com\/\d+/.test(anchor.href));
  const creatorMatch = creatorLink?.href.match(/^https:\/\/space\.bilibili\.com\/(\d+)/);
  const creatorName = cleanText(creatorLink?.innerText, 200);
  const description = visibleText(document, [
    '.video-desc-container .desc-info-text',
    '.video-desc-container .basic-desc-info',
    '.video-desc-container'
  ], 5_000);
  const publishedText = visibleText(document, [
    '.video-info-meta .pubdate-ip-text',
    '.video-info-detail-list .pubdate-ip-text'
  ], 200);
  const metricSelectors: readonly [string, string][] = [
    ['views', '.video-info-meta .view-text'],
    ['danmaku', '.video-info-meta .dm-text'],
    ['likes', '.video-toolbar-left .video-like-info'],
    ['coins', '.video-toolbar-left .video-coin-info'],
    ['favorites', '.video-toolbar-left .video-fav-info'],
    ['shares', '.video-toolbar-left .video-share-wrap > span']
  ];
  const visibleMetrics = metricSelectors.flatMap(([label, selector]) => {
    const value = visibleText(document, [selector], 100);
    return value ? [{ label, value }] : [];
  });
  const tags = [...new Set(Array.from(document.querySelectorAll<HTMLAnchorElement>('.tag-link[href]'))
    .filter(visibleElement)
    .map((anchor) => cleanText(anchor.innerText, 100))
    .filter(Boolean))].slice(0, 20);
  const detail = canonical && title
    ? {
        contentId: canonical.contentId,
        contentType: 'video' as const,
        canonicalUrl: canonical.url,
        title,
        creator: creatorMatch && creatorName
          ? {
              displayName: creatorName,
              canonicalProfileUrl: `https://space.bilibili.com/${creatorMatch[1]}/`,
              visibleDescription: visibleText(document, ['.up-info-container .up-description'], 1_000) || null
            }
          : null,
        description: description || null,
        publishedText: publishedText || null,
        visibleMetrics,
        tags
      }
    : null;

  return {
    schemaVersion: 1,
    platform: 'bilibili',
    operation: 'detail_read',
    strategy,
    sourceUrl: canonical?.url ?? safePageUrl(location),
    pageState: detail
      ? 'results_visible'
      : canonical && title
        ? 'layout_unrecognized'
        : pageState(document, false),
    partial: true,
    itemCount: detail ? 1 : 0,
    detail,
    warnings: [
      'Visible detail DOM only; no comment text, recommendation card, browser credential, storage, request, or response data is read.',
      'No page interaction is performed; metrics are stored as the labels and values visibly rendered at capture time.',
      'Creator and description fields reflect only what this page variant visibly rendered; either field may be absent.'
    ]
  };
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
): VisibleSearchCollectionResult {
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
    pageState: pageState(document, items.length > 0),
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

export function collectVisiblePageResult(
  document: Document,
  location: Location
): VisibleCollectionResult {
  if (canonicalBilibiliVideo(location)) return collectBilibiliVideoDetail(document, location);
  return collectVisibleSearchResults(document, location);
}
