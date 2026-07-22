export interface BilibiliNativeSearchDomCard {
  bvid: string | null;
  title: string | null;
  visibleText: string | null;
  thumbnailUrl: string | null;
}

export interface BilibiliNativeSearchDomSnapshot {
  searchInputVisible: boolean;
  resultListVisible: boolean;
  emptyStateVisible: boolean;
  cards: BilibiliNativeSearchDomCard[];
  loginOverlayVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

/**
 * Fixed projection for the default Bilibili "综合" search page. It only emits
 * visible canonical BV video cards; ads, courses, live rooms, films and other
 * mixed search object types are intentionally excluded by construction.
 */
export async function captureBilibiliNativeSearchDom(
  tabId: number,
  documentId: string
): Promise<BilibiliNativeSearchDomSnapshot> {
  let results: chrome.scripting.InjectionResult<BilibiliNativeSearchDomSnapshot>[];
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [documentId] },
      world: 'ISOLATED',
      func: () => {
        const clean = (value: string | null | undefined, maximum: number): string | null => {
          const result = (value ?? '').replace(/\s+/g, ' ').trim();
          return result && result.length <= maximum && !/[\u0000-\u001f\u007f]/.test(result) ? result : null;
        };
        const rendered = (element: Element | null): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
            Number.parseFloat(style.opacity || '1') > 0.01;
        };
        const bvidFromLink = (anchor: HTMLAnchorElement | null): string | null => {
          if (!anchor) return null;
          try {
            const url = new URL(anchor.href);
            return url.protocol === 'https:' && url.hostname === 'www.bilibili.com'
              ? url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null
              : null;
          } catch {
            return null;
          }
        };
        const safeImageUrl = (image: HTMLImageElement | null): string | null => {
          if (!image) return null;
          try {
            const url = new URL(image.currentSrc || image.src);
            if (url.protocol !== 'https:' || url.username || url.password) return null;
            url.search = '';
            url.hash = '';
            return url.href.length <= 2_000 ? url.href : null;
          } catch {
            return null;
          }
        };
        const searchInput = document.querySelector<HTMLInputElement>('input[placeholder="输入关键字搜索"]');
        // On the current desktop page `.search-all-list` is a structural,
        // zero-size wrapper around the actual rendered `.video-list`. Prefer
        // the visibly rendered list, while retaining the wrapper only as a
        // source-compatible fallback for a future page layout.
        const resultRoot = [
          document.querySelector<HTMLElement>('.search-page .video-list'),
          document.querySelector<HTMLElement>('.video-list'),
          document.querySelector<HTMLElement>('.search-all-list')
        ].find(rendered) ?? null;
        const wrappedCards = resultRoot
          ? Array.from(resultRoot.querySelectorAll<HTMLElement>('.bili-video-card__wrap')).filter(rendered)
          : [];
        const candidateCards = (wrappedCards.length > 0
          ? wrappedCards
          : resultRoot
            ? Array.from(resultRoot.querySelectorAll<HTMLElement>('.bili-video-card')).filter(rendered)
            : [])
          // The page presents mixed object types in one visible grid. Inspect
          // a bounded prefix wide enough to skip ads/courses/live cards before
          // applying the public-video result budget below.
          .slice(0, 60);
        const cards: Array<{
          bvid: string | null;
          title: string | null;
          visibleText: string | null;
          thumbnailUrl: string | null;
        }> = [];
        const seenBvids = new Set<string>();
        for (const card of candidateCards) {
          if (cards.length >= 20) break;
          const anchors = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(rendered);
          const videoAnchor = anchors.find((anchor) => bvidFromLink(anchor) !== null) ?? null;
          const titleElement = Array.from(card.querySelectorAll<HTMLElement>('h3')).find(rendered) ?? null;
          const bvid = bvidFromLink(videoAnchor);
          const title = clean(titleElement?.innerText, 500);
          const visibleText = clean(card.innerText, 2_000);
          // Only canonical, human-visible BV video cards enter this Strategy.
          // Other mixed result types have no stable BV identity and are not
          // "unresolved" videos; they are intentionally outside its scope.
          if (!bvid || !titleElement || !title || !visibleText || seenBvids.has(bvid)) continue;
          seenBvids.add(bvid);
          cards.push({
            bvid,
            title,
            visibleText,
            thumbnailUrl: safeImageUrl(card.querySelector<HTMLImageElement>('img'))
          });
        }
        const emptyStateVisible = Array.from(
          document.querySelectorAll<HTMLElement>('[class*="empty" i], [class*="no-result" i]')
        ).some((element) => rendered(element) && /未找到|没有找到|暂无/.test(clean(element.innerText, 500) ?? ''));
        const bodyText = clean(document.body?.innerText, 100_000) ?? '';
        const loginOverlayVisible = Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"], [class*="login" i], [class*="passport" i]')
        ).some((element) => rendered(element) &&
          element.getBoundingClientRect().width >= 160 && element.getBoundingClientRect().height >= 120);
        return {
          searchInputVisible: rendered(searchInput),
          resultListVisible: rendered(resultRoot),
          emptyStateVisible,
          cards,
          loginOverlayVisible,
          risk: {
            verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
            rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
            sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
          }
        };
      }
    });
  } catch {
    throw new Error('native_search_strategy_document_context_changed');
  }
  const result = results[0]?.result;
  if (!result) throw new Error('native_search_strategy_document_context_changed');
  return result;
}
