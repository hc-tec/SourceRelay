import type { BilibiliDynamicDomObservation } from '@intelligence/collector-contracts';

/**
 * Passive, bounded projection for a public space dynamic page.  Network
 * response bodies, scrolling and feed-filter clicks are deliberately absent:
 * those are separate capabilities or future evidence layers.
 */
export async function captureBilibiliDynamicDom(tabId: number): Promise<BilibiliDynamicDomObservation> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: () => {
      const clean = (value: string | null | undefined, maximum: number): string | null => {
        const text = (value ?? '').replace(/\s+/g, ' ').trim();
        return text && text.length <= maximum && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
      };
      const rendered = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
          Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const safeDocumentUrl = (value: string): string | null => {
        try {
          const url = new URL(value, location.href);
          if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
          url.search = '';
          url.hash = '';
          return url.href.length <= 2_000 ? url.href : null;
        } catch {
          return null;
        }
      };
      const safeImageUrl = (value: string): string | null => {
        try {
          const url = new URL(value, location.href);
          if (url.protocol !== 'https:' || url.username || url.password) return null;
          url.search = '';
          url.hash = '';
          return url.href.length <= 2_000 ? url.href : null;
        } catch {
          return null;
        }
      };
      const path = location.hostname === 'space.bilibili.com'
        ? location.pathname.match(/^\/(\d{1,20})\/dynamic\/?$/)
        : null;
      const feedRoot = document.querySelector<HTMLElement>('.bili-dyn-list');
      const cards = Array.from(document.querySelectorAll<HTMLElement>('.bili-dyn-list__item'))
        .filter(rendered)
        .slice(0, 24)
        .map((card) => {
          const linkItems: Array<{ text: string; url: string }> = [];
          const seenLinks = new Set<string>();
          for (const anchor of Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(rendered).slice(0, 12)) {
            const url = safeDocumentUrl(anchor.href);
            const text = clean(anchor.innerText || anchor.getAttribute('aria-label'), 240);
            if (!url || !text || seenLinks.has(`${url}\n${text}`)) continue;
            seenLinks.add(`${url}\n${text}`);
            linkItems.push({ text, url });
          }
          const imageUrls: string[] = [];
          const seenImages = new Set<string>();
          for (const image of Array.from(card.querySelectorAll<HTMLImageElement>('img[src]')).filter(rendered).slice(0, 8)) {
            const url = safeImageUrl(image.currentSrc || image.src);
            if (!url || seenImages.has(url)) continue;
            seenImages.add(url);
            imageUrls.push(url);
          }
          return {
            author: clean(card.querySelector<HTMLElement>('.bili-dyn-title__text')?.innerText, 200),
            publishedVisibleText: clean(card.querySelector<HTMLElement>('.bili-dyn-item__desc')?.innerText, 200),
            visibleText: clean(card.innerText, 3_000),
            links: linkItems,
            imageUrls,
            kind: card.querySelector('.dyn-blocked-mask') ? 'blocked' as const
              : card.querySelector('a.bili-dyn-card-video[href]') ? 'video' as const
                : card.querySelector('.dyn-card-opus') ? 'opus' as const : 'other' as const,
            blockedPlaceholder: Boolean(card.querySelector('.dyn-blocked-mask')),
            reservation: Boolean(card.querySelector('.bili-dyn-card-reserve')),
            forwarded: Boolean(card.querySelector('.bili-dyn-content__forw__desc, .bili-dyn-content__orig__author'))
          };
        });
      const filters = Array.from(document.querySelectorAll<HTMLElement>('.side-nav__item')).filter(rendered);
      const active = filters.find((element) => /(?:^|\s)active(?:\s|$)/.test(String(element.className))) ?? null;
      const bodyText = clean(document.body?.innerText, 100_000) ?? '';
      const loginOverlayVisible = Array.from(document.querySelectorAll<HTMLElement>(
        '[role="dialog"], [aria-modal="true"], .bili-mini-mask, .bili-mini-login, .passport-login-container, [class*="login-modal" i], [class*="passport-layer" i]'
      )).some(rendered);
      return {
        stableAccountId: path?.[1] ?? null,
        feedVisible: rendered(feedRoot),
        activeFilterLabel: clean(active?.innerText, 80),
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
  const snapshot = results[0]?.result;
  if (!snapshot) throw new Error('bilibili_dynamic_dom_projection_missing');
  return snapshot as BilibiliDynamicDomObservation;
}
