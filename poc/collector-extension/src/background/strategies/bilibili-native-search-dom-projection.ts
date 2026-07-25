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
  resultType: 'comprehensive' | 'video' | 'unknown';
  sort: 'relevance' | 'newest' | 'unknown';
  semanticResultCardCount: number;
  cards: BilibiliNativeSearchDomCard[];
  loginOverlayVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

/**
 * B 站 currently renders an empty search as `.search-nodata-container` /
 * `.no-data`, not as a class containing `empty` or `no-result`. Keep this
 * classifier independent from the page so the real DOM contract can be unit
 * tested without inventing a fake page.
 */
export function isBilibiliNativeSearchEmptyStateElement(
  className: string | null,
  text: string | null,
  visible: boolean
): boolean {
  if (!visible || !text?.trim()) return false;
  const classes = (className ?? '').split(/\s+/).filter(Boolean).map((value) => value.toLowerCase());
  return classes.some((value) => value === 'no-data' || value.includes('nodata') ||
    value.includes('no-result') || value.includes('empty'));
}

/**
 * The anonymous header's `.login-panel-popover` is a non-blocking tooltip. It
 * must not turn a public search empty state into `authentication_required`.
 * Only modal/mask semantics count as a blocking login surface.
 */
export function isBilibiliNativeSearchBlockingLoginElement(input: {
  className: string | null;
  role: string | null;
  ariaModal: string | null;
  visible: boolean;
  width: number;
  height: number;
}): boolean {
  if (!input.visible || input.width < 160 || input.height < 120) return false;
  if (input.role === 'dialog' || input.ariaModal === 'true') return true;
  const classes = (input.className ?? '').split(/\s+/).filter(Boolean).map((value) => value.toLowerCase());
  return classes.some((value) => value === 'bili-mini-mask' || value === 'bili-mini-login' ||
    value === 'passport-login-container' || value.includes('login-modal') || value.includes('passport-layer'));
}

/**
 * Fixed projection for the default Bilibili "综合" search page. It only emits
 * visible canonical BV video cards; ads, courses, live rooms, films and other
 * mixed search object types are intentionally excluded by construction.
 */
export async function captureBilibiliNativeSearchDom(
  tabId: number,
  documentId?: string
): Promise<BilibiliNativeSearchDomSnapshot> {
  let results: chrome.scripting.InjectionResult<BilibiliNativeSearchDomSnapshot>[];
  try {
    results = await chrome.scripting.executeScript({
      // A direct work tab is a single, extension-owned top-level document and
      // has no observer binding/document ID. Existing observer paths still
      // pass their exact document ID to avoid crossing a document boundary.
      target: documentId ? { tabId, documentIds: [documentId] } : { tabId },
      world: 'ISOLATED',
      func: () => {
        const clean = (value: string | null | undefined, maximum: number): string | null => {
          const result = (value ?? '').replace(/\s+/g, ' ').trim();
          return result && result.length <= maximum && !/[\u0000-\u001f\u007f]/.test(result) ? result : null;
        };
        const isEmptyStateElement = (className: string | null, text: string | null, visible: boolean): boolean => {
          if (!visible || !text?.trim()) return false;
          const classes = (className ?? '').split(/\s+/).filter(Boolean).map((value) => value.toLowerCase());
          return classes.some((value) => value === 'no-data' || value.includes('nodata') ||
            value.includes('no-result') || value.includes('empty'));
        };
        const isBlockingLoginElement = (input: {
          className: string | null;
          role: string | null;
          ariaModal: string | null;
          visible: boolean;
          width: number;
          height: number;
        }): boolean => {
          if (!input.visible || input.width < 160 || input.height < 120) return false;
          if (input.role === 'dialog' || input.ariaModal === 'true') return true;
          const classes = (input.className ?? '').split(/\s+/).filter(Boolean).map((value) => value.toLowerCase());
          return classes.some((value) => value === 'bili-mini-mask' || value === 'bili-mini-login' ||
            value === 'passport-login-container' || value.includes('login-modal') || value.includes('passport-layer'));
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
        const resultType: BilibiliNativeSearchDomSnapshot['resultType'] = location.pathname === '/all'
          ? 'comprehensive'
          : location.pathname === '/video'
            ? 'video'
            : 'unknown';
        const activeSortButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.search-condition-row button'))
          .find((button) => rendered(button) && /vui_button--active|selected/.test(button.className)) ?? null;
        const activeSortLabel = clean(activeSortButton?.innerText, 80);
        const sort: BilibiliNativeSearchDomSnapshot['sort'] = activeSortLabel === '综合排序'
          ? 'relevance'
          : activeSortLabel === '最新发布'
            ? 'newest'
            : 'unknown';
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
        const semanticCards = candidateCards.map((card) => {
          const titleElement = Array.from(card.querySelectorAll<HTMLElement>('h3')).find(rendered) ?? null;
          const title = clean(titleElement?.innerText, 500);
          const visibleText = clean(card.innerText, 2_000);
          return { card, titleElement, title, visibleText };
        }).filter((candidate) => Boolean(candidate.titleElement && candidate.title && candidate.visibleText));
        const cards: Array<{
          bvid: string | null;
          title: string | null;
          visibleText: string | null;
          thumbnailUrl: string | null;
        }> = [];
        const seenBvids = new Set<string>();
        for (const candidate of semanticCards) {
          if (cards.length >= 20) break;
          const { card, titleElement, title, visibleText } = candidate;
          const anchors = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(rendered);
          const videoAnchor = anchors.find((anchor) => bvidFromLink(anchor) !== null) ?? null;
          const bvid = bvidFromLink(videoAnchor);
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
          document.querySelectorAll<HTMLElement>(
            '.search-nodata-container, .no-data, [class*="nodata" i], [class*="no-result" i], [class*="empty" i]'
          )
        ).some((element) => isEmptyStateElement(
          element.getAttribute('class'),
          clean(element.innerText, 500),
          rendered(element)
        ));
        const bodyText = clean(document.body?.innerText, 100_000) ?? '';
        const loginOverlayVisible = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="dialog"], [aria-modal="true"], .bili-mini-mask, .bili-mini-login, .passport-login-container, [class*="login-modal" i], [class*="passport-layer" i]'
          )
        ).some((element) => {
          const rect = element.getBoundingClientRect();
          return isBlockingLoginElement({
            className: element.getAttribute('class'),
            role: element.getAttribute('role'),
            ariaModal: element.getAttribute('aria-modal'),
            visible: rendered(element),
            width: rect.width,
            height: rect.height
          });
        });
        return {
          searchInputVisible: rendered(searchInput),
          resultListVisible: rendered(resultRoot),
          emptyStateVisible,
          resultType,
          sort,
          semanticResultCardCount: semanticCards.length,
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
