import type { Page } from 'playwright';
import type { BilibiliArticleDetailDomObservation } from './bilibili-article-contract';

const DOM_TIMEOUT_MS = 15_000;

export async function waitForBilibiliArticleDetailDom(
  page: Page,
  timeoutMs = DOM_TIMEOUT_MS
): Promise<void> {
  await page.waitForFunction(() => {
    const title = document.querySelector('.opus-module-title__text');
    const content = document.querySelector<HTMLElement>('.opus-module-content.opus-paragraph-children');
    const text = document.body?.innerText ?? '';
    const stopped = /验证码|安全验证|异常访问|访问频繁|操作频繁|页面不存在|加载失败/.test(text);
    return Boolean(title?.textContent?.trim() && content?.innerText?.trim()) || stopped;
  }, null, { timeout: timeoutMs });
}

export async function captureBilibiliArticleDetailDom(
  page: Page
): Promise<BilibiliArticleDetailDomObservation> {
  return page.evaluate(() => {
    const clean = (value: string | null | undefined, maximum = 20_000): string =>
      (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
    const pathMatch = location.hostname === 'www.bilibili.com'
      ? location.pathname.match(/^\/opus\/(\d{1,20})\/?$/)
      : null;
    const title = document.querySelector<HTMLElement>('.opus-module-title__text');
    const author = document.querySelector<HTMLElement>('.opus-module-author');
    const authorAnchor = author ? Array.from(author.querySelectorAll<HTMLAnchorElement>('a[href]')).find((anchor) => {
      try {
        const url = new URL(anchor.href, location.href);
        return url.hostname === 'space.bilibili.com' && /^\/\d{1,20}\/?$/.test(url.pathname);
      } catch {
        return false;
      }
    }) : null;
    let stableAccountId: string | null = null;
    if (authorAnchor) {
      try {
        stableAccountId = new URL(authorAnchor.href, location.href).pathname.match(/^\/(\d{1,20})\/?$/)?.[1] ?? null;
      } catch {
        stableAccountId = null;
      }
    }
    const published = document.querySelector<HTMLElement>('.opus-module-author__pub__text');
    const authorName = author?.querySelector<HTMLElement>('.opus-module-author__name') ?? null;
    const copyright = document.querySelector<HTMLElement>('.opus-module-copyright');
    const content = document.querySelector<HTMLElement>('.opus-module-content.opus-paragraph-children');
    const blocks = content ? Array.from(content.children).slice(0, 1_000).map((element) => ({
      tagName: element.tagName,
      visibleText: (element instanceof HTMLElement ? element.innerText : element.textContent ?? '')
        .replace(/\r\n?/g, '\n').trim().slice(0, 250_000),
      images: Array.from(element.querySelectorAll<HTMLImageElement>('img')).slice(0, 200).map((image) => ({
        url: image.currentSrc || image.src || image.getAttribute('data-src') || '',
        alt: clean(image.alt, 500)
      })),
      links: Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href]')).slice(0, 200).map((link) => ({
        text: clean(link.textContent, 1_000),
        url: link.href
      })).filter((link) => Boolean(link.text && link.url))
    })) : [];
    const metric = (role: string): number | null => {
      const element = document.querySelector<HTMLElement>(
        `.side-toolbar__action.${role} .side-toolbar__action__text`
      );
      const text = clean(element?.textContent, 40);
      return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : null;
    };
    const tags = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).flatMap((anchor) => {
      try {
        const url = new URL(anchor.href, location.href);
        if (url.hostname !== 'search.bilibili.com' || url.pathname !== '/all' || !url.searchParams.has('keyword')) {
          return [];
        }
        const label = clean(anchor.textContent, 100);
        return label ? [label] : [];
      } catch {
        return [];
      }
    });
    const bodyText = clean(document.body?.innerText, 150_000);
    return {
      stableOpusId: pathMatch?.[1] ?? null,
      stableAccountId,
      displayName: clean(authorName?.textContent || authorAnchor?.textContent, 200) || null,
      title: clean(title?.textContent, 500) || null,
      publishedVisibleText: clean(published?.textContent, 100) || null,
      copyrightVisibleText: clean(copyright?.textContent, 500) || null,
      tags: [...new Set(tags)],
      content: content ? {
        visibleText: (content.innerText ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 2 * 1024 * 1024),
        blocks
      } : null,
      toolbarMetrics: {
        likes: metric('like'),
        coins: metric('coin'),
        favorites: metric('favorite'),
        forwards: metric('forward'),
        comments: metric('comment')
      },
      risk: {
        verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
        rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
        sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
      }
    };
  });
}
