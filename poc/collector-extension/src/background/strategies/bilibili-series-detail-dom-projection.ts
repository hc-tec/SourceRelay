export interface BilibiliCollectionSeriesDetailDomSnapshot {
  stableAccountId: string | null;
  stableSeriesId: string | null;
  listType: 'series' | 'season' | null;
  detailVisible: boolean;
  loginOverlayVisible: boolean;
  visibleTitle: string | null;
  declaredItemCount: number | null;
  activePageNumber: number | null;
  videoIds: string[];
  titleCandidates: Record<string, string[]>;
  sortLabels: string[];
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

export async function captureBilibiliCollectionSeriesDetailDom(
  tabId: number,
  documentId?: string
): Promise<BilibiliCollectionSeriesDetailDomSnapshot> {
  const results = await chrome.scripting.executeScript({
    target: documentId ? { tabId, documentIds: [documentId] } : { tabId },
    world: 'ISOLATED',
    func: () => {
      const clean = (value: string | null | undefined, maximum: number): string =>
        (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
      const rendered = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const positiveCount = (value: string): number | null => {
        const match = value.replace(/,/g, '').match(/\d{1,9}/);
        if (!match) return null;
        const number = Number(match[0]);
        return Number.isSafeInteger(number) && number >= 0 ? number : null;
      };
      const bvidFromHref = (value: string): string | null => {
        try {
          const url = new URL(value, location.href);
          return url.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null;
        } catch {
          return null;
        }
      };
      const pathMatch = location.hostname === 'space.bilibili.com'
        ? location.pathname.match(/^\/(\d{1,20})\/lists\/(\d{1,20})\/?$/)
        : null;
      const typeParam = new URL(location.href).searchParams.get('type');
      const listType: 'series' | 'season' | null = typeParam === 'series' || typeParam === 'season' ? typeParam : null;
      const bodyText = clean(document.body?.innerText, 120_000);
      const title = clean(document.querySelector<HTMLElement>('.title')?.innerText, 500) ||
        clean(document.querySelector<HTMLElement>('h1')?.innerText, 500) || null;
      const subtitle = clean(document.querySelector<HTMLElement>('.subtitle')?.innerText, 500);
      const videos: string[] = [];
      const titleCandidates: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
      // The detail page keeps a few card shells outside the viewport while
      // the list is settling.  They are still public DOM evidence and carry
      // the stable BVID; filtering them by rendered geometry would turn a
      // 30-item response into a misleading 25-item DOM sample.
      const cards = Array.from(document.querySelectorAll<HTMLElement>('.list-video-item, .bili-video-card__wrap'))
        .slice(0, 50);
      for (const card of cards) {
        const link = card.matches('a[href]') ? card as HTMLAnchorElement : card.querySelector<HTMLAnchorElement>('a[href]');
        const bvid = link ? bvidFromHref(link.href) : null;
        if (!bvid || videos.includes(bvid)) continue;
        videos.push(bvid);
        const candidates = [
          clean(card.querySelector<HTMLElement>('.bili-video-card__title')?.innerText, 500),
          clean(card.querySelector<HTMLImageElement>('img')?.alt, 500),
          clean(link?.getAttribute('title'), 500)
        ].filter(Boolean);
        titleCandidates[bvid] = [...new Set(candidates)];
      }
      const active = Array.from(document.querySelectorAll<HTMLElement>('.vui_pagenation--btn-num, .vui_button--active'))
        .find((element) => rendered(element) && element.classList.contains('vui_button--active'));
      const activePageNumber = active && /^\d{1,3}$/.test(clean(active.innerText, 10))
        ? Number(clean(active.innerText, 10)) : null;
      const sortLabels = Array.from(document.querySelectorAll<HTMLElement>('[class*="sort" i] button, [class*="sort" i] [role="button"]'))
        .filter(rendered).map((element) => clean(element.innerText, 100)).filter(Boolean).slice(0, 10);
      return {
        stableAccountId: pathMatch?.[1] ?? null,
        stableSeriesId: pathMatch?.[2] ?? null,
        listType,
        detailVisible: Boolean(title) || videos.length > 0,
        loginOverlayVisible: Array.from(document.querySelectorAll<HTMLElement>(
          '[role="dialog"], [aria-modal="true"], .bili-mini-mask, .bili-mini-login, .passport-login-container, [class*="login-modal" i], [class*="passport-layer" i]'
        )).some(rendered),
        visibleTitle: title,
        declaredItemCount: positiveCount(subtitle) ?? positiveCount(clean(document.body?.innerText, 2_000)),
        activePageNumber,
        videoIds: videos,
        titleCandidates,
        sortLabels: [...new Set(sortLabels)],
        risk: {
          verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
          rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
          sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
        }
      };
    }
  });
  const result = results[0]?.result;
  if (!result) throw new Error('collection_series_detail_strategy_dom_projection_missing');
  return result as BilibiliCollectionSeriesDetailDomSnapshot;
}
