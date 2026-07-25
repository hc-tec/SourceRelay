export interface BilibiliAccountVideoInventoryDomCard {
  bvid: string | null;
  title: string | null;
  visibleText: string | null;
  thumbnailUrl: string | null;
}

export interface BilibiliAccountVideoInventoryDomSnapshot {
  stableAccountId: string | null;
  videoListVisible: boolean;
  cards: BilibiliAccountVideoInventoryDomCard[];
  loginOverlayVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

/**
 * Fixed first-page projection for `space.bilibili.com/<mid>/upload/video`.
 * Link query values are only discarded while extracting a pathname BVID; no
 * caller can ask this projector to read arbitrary links or DOM selectors.
 */
export async function captureBilibiliAccountVideoInventoryDom(
  tabId: number,
  documentId?: string
): Promise<BilibiliAccountVideoInventoryDomSnapshot> {
  let results: chrome.scripting.InjectionResult<BilibiliAccountVideoInventoryDomSnapshot>[];
  try {
    results = await chrome.scripting.executeScript({
      target: documentId ? { tabId, documentIds: [documentId] } : { tabId },
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
        const pathMatch = location.protocol === 'https:' && location.hostname === 'space.bilibili.com'
          ? location.pathname.match(/^\/(\d{1,20})\/upload\/video\/?$/)
          : null;
        const videoList = document.querySelector<HTMLElement>('.video-list');
        const cards = videoList
          ? Array.from(videoList.querySelectorAll<HTMLElement>('.bili-video-card__wrap')).filter(rendered).slice(0, 40)
            .map((card) => {
              const titleAnchor = card.querySelector<HTMLAnchorElement>('.bili-video-card__title a[href]');
              const fallbackAnchor = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]'))
                .find((anchor) => bvidFromLink(anchor) !== null) ?? null;
              return {
                bvid: bvidFromLink(titleAnchor) ?? bvidFromLink(fallbackAnchor),
                title: clean(titleAnchor?.innerText, 500),
                visibleText: clean(card.innerText, 2_000),
                thumbnailUrl: safeImageUrl(card.querySelector<HTMLImageElement>('img'))
              };
            })
          : [];
        const bodyText = clean(document.body?.innerText, 100_000) ?? '';
        const loginOverlayVisible = Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"], [class*="login" i], [class*="passport" i]')
        ).some((element) => rendered(element) &&
          element.getBoundingClientRect().width >= 160 && element.getBoundingClientRect().height >= 120);
        return {
          stableAccountId: pathMatch?.[1] ?? null,
          videoListVisible: rendered(videoList),
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
    throw new Error('account_video_inventory_strategy_document_context_changed');
  }
  const result = results[0]?.result;
  if (!result) throw new Error('account_video_inventory_strategy_document_context_changed');
  return result;
}
