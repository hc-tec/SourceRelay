export interface BilibiliCollectionSeriesDomSnapshot {
  stableAccountId: string | null;
  listVisible: boolean;
  loginOverlayVisible: boolean;
  declaredNavigationCount: number | null;
  items: Array<{
    listType: 'series' | 'season';
    stableSeriesId: string | null;
    title: string;
    declaredItemCount: number | null;
    visiblePreviewBvids: string[];
    visiblePreviewTitles: Record<string, string[]>;
    structure: {
      sectionClassName: string;
      headingAncestorClasses: string[];
      nearbyNumberCandidates: number[];
    };
  }>;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

export async function captureBilibiliCollectionSeriesDom(
  tabId: number,
  documentId?: string
): Promise<BilibiliCollectionSeriesDomSnapshot> {
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
        const parsed = Number(match[0]);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
      };
      const bvidFromHref = (value: string): string | null => {
        try {
          const url = new URL(value, location.href);
          const match = url.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})\/?$/);
          return match?.[1] ?? null;
        } catch {
          return null;
        }
      };
      const seriesIdFromHref = (value: string): string | null => {
        try {
          const url = new URL(value, location.href);
          const match = url.hostname === 'space.bilibili.com'
            ? url.pathname.match(/^\/\d{1,20}\/lists\/(\d{1,20})\/?$/)
            : null;
          const type = url.searchParams.get('type');
          return match && (type === 'series' || type === 'season') ? match[1] ?? null : null;
        } catch {
          return null;
        }
      };
      const pathMatch = location.hostname === 'space.bilibili.com'
        ? location.pathname.match(/^\/(\d{1,20})\/lists\/?$/)
        : null;
      const bodyText = clean(document.body?.innerText, 120_000);
      const listRoot = document.querySelector<HTMLElement>('.space-lists');
      const items = Array.from(document.querySelectorAll<HTMLElement>('.space-lists .video-list'))
        .filter(rendered)
        .slice(0, 50)
        .map((section) => {
          const title = clean(section.querySelector<HTMLElement>('.video-list__title')?.innerText, 500);
          const descText = clean(section.querySelector<HTMLElement>('.video-list__desc')?.innerText, 80);
          const listType: 'series' | 'season' = title.startsWith('系列·') ? 'series' : 'season';
          const listLink = Array.from(section.querySelectorAll<HTMLAnchorElement>('a[href]'))
            .find((anchor) => seriesIdFromHref(anchor.href) !== null) ?? null;
          const links = Array.from(section.querySelectorAll<HTMLAnchorElement>('.video-list__content a[href]'))
            .filter(rendered)
            .slice(0, 30);
          const visiblePreviewBvids: string[] = [];
          const visiblePreviewTitles: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
          for (const link of links) {
            const bvid = bvidFromHref(link.href);
            if (!bvid || visiblePreviewBvids.includes(bvid)) continue;
            visiblePreviewBvids.push(bvid);
            const titleCandidates = [
              clean(link.querySelector<HTMLImageElement>('img')?.alt, 500),
              clean(link.querySelector<HTMLElement>('.bili-video-card__title')?.innerText, 500),
              clean(link.getAttribute('title'), 500)
            ].filter(Boolean);
            visiblePreviewTitles[bvid] = [...new Set(titleCandidates)];
          }
          const heading = section.querySelector<HTMLElement>('.video-list__header');
          const headingAncestorClasses = heading
            ? Array.from({ length: 3 }, (_, index) => {
                let current: HTMLElement | null = heading;
                for (let step = 0; step <= index && current; step += 1) current = current.parentElement;
                return current?.className && typeof current.className === 'string' ? current.className.slice(0, 160) : '';
              }).filter(Boolean)
            : [];
          const nearbyNumberCandidates = [descText, clean(section.innerText, 500)]
            .flatMap((text) => [...text.replace(/,/g, '').matchAll(/\d{1,9}/g)].map((match) => Number(match[0])))
            .filter((value) => Number.isSafeInteger(value) && value >= 0)
            .slice(0, 8);
          return {
            listType,
            stableSeriesId: listLink ? seriesIdFromHref(listLink.href) : null,
            title,
            declaredItemCount: positiveCount(descText),
            visiblePreviewBvids,
            visiblePreviewTitles,
            structure: {
              sectionClassName: String(section.className).slice(0, 160),
              headingAncestorClasses,
              nearbyNumberCandidates
            }
          };
        })
        .filter((item) => item.title.length > 0);
      return {
        stableAccountId: pathMatch?.[1] ?? null,
        listVisible: rendered(listRoot) || items.length > 0,
        loginOverlayVisible: Array.from(document.querySelectorAll<HTMLElement>(
          '[role="dialog"], [aria-modal="true"], .bili-mini-mask, .bili-mini-login, .passport-login-container, [class*="login-modal" i], [class*="passport-layer" i]'
        )).some(rendered),
        declaredNavigationCount: null,
        items,
        risk: {
          verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
          rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
          sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
        }
      };
    }
  });
  const result = results[0]?.result;
  if (!result) throw new Error('collection_series_strategy_dom_projection_missing');
  return result as BilibiliCollectionSeriesDomSnapshot;
}
