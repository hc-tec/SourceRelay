import type { Page } from 'playwright';
import type {
  BilibiliDynamicDomCardObservation,
  BilibiliDynamicDomSnapshot
} from './bilibili-dynamic-contract';

const DOM_TIMEOUT_MS = 12_000;

export async function captureBilibiliDynamicDom(page: Page): Promise<BilibiliDynamicDomSnapshot> {
  return page.evaluate(() => {
    const clean = (value: string | null | undefined, maximum = 50_000): string =>
      (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
    const rendered = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number(style.opacity || '1') > 0;
    };
    const pathMatch = location.hostname === 'space.bilibili.com'
      ? location.pathname.match(/^\/(\d{1,20})\/dynamic\/?$/)
      : null;
    const filterItems = Array.from(document.querySelectorAll<HTMLElement>('.side-nav__item')).filter(rendered);
    const visibleFilterLabels = filterItems.map((item) => clean(item.textContent, 40)).filter(Boolean);
    const activeFilter = filterItems.find((item) => /(?:^|\s)active(?:\s|$)/.test(String(item.className)));
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.bili-dyn-list__item'))
      .filter(rendered)
      .map((card, index): BilibiliDynamicDomCardObservation => {
        const blockedPlaceholder = Boolean(card.querySelector('.dyn-blocked-mask'));
        const reservation = Boolean(card.querySelector('.bili-dyn-card-reserve'));
        const forwarded = Boolean(card.querySelector(
          '.bili-dyn-content__forw__desc, .bili-dyn-content__orig__author'
        ));
        const kind: BilibiliDynamicDomCardObservation['kind'] = blockedPlaceholder
          ? 'blocked'
          : card.querySelector('a.bili-dyn-card-video[href]')
            ? 'video'
            : card.querySelector('.dyn-card-opus')
              ? 'opus'
              : 'other';
        const links = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]'))
          .filter(rendered)
          .slice(0, 100)
          .map((anchor) => ({
            text: clean(
              anchor.innerText || anchor.getAttribute('aria-label') ||
              anchor.querySelector<HTMLImageElement>('img[alt]')?.alt || '',
              5_000
            ),
            url: anchor.href
          }));
        const images = Array.from(card.querySelectorAll<HTMLImageElement>('img[src]'))
          .filter(rendered)
          .slice(0, 100)
          .map((image) => ({
            alt: clean(image.alt, 1_000),
            url: image.currentSrc || image.src
          }));
        return {
          position: index + 1,
          outerAuthor: clean(card.querySelector<HTMLElement>('.bili-dyn-title__text')?.innerText, 200),
          publishedVisibleText: clean(
            card.querySelector<HTMLElement>('.bili-dyn-item__desc')?.innerText,
            200
          ) || null,
          visibleText: clean(card.innerText, 50_000),
          links,
          images,
          kind,
          blockedPlaceholder,
          reservation,
          forwarded
        };
      });
    const bodyText = clean(document.body?.innerText, 200_000);
    return {
      stableAccountId: pathMatch?.[1] ?? null,
      visibleFilterLabels: [...new Set(visibleFilterLabels)],
      activeFilterLabel: activeFilter ? clean(activeFilter.textContent, 40) || null : null,
      cards,
      risk: {
        verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
        rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
        sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
      }
    };
  });
}

export async function waitForBilibiliDynamicDomCardCount(
  page: Page,
  expectedCount: number,
  timeoutMs = DOM_TIMEOUT_MS
): Promise<void> {
  await page.waitForFunction((expected) => {
    const count = Array.from(document.querySelectorAll<HTMLElement>('.bili-dyn-list__item')).filter((card) => {
      const rect = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).length;
    const text = document.body?.innerText ?? '';
    const stopped = /验证码|安全验证|异常访问|访问频繁|操作频繁|页面不存在|加载失败/.test(text);
    return count === expected || stopped;
  }, expectedCount, { timeout: timeoutMs });
}
