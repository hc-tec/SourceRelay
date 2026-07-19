import type { Page } from 'playwright';
import type { BilibiliCollectionSeriesDomSnapshot } from './bilibili-collection-series-contract';

export async function captureBilibiliCollectionSeriesOverviewDom(
  page: Page
): Promise<BilibiliCollectionSeriesDomSnapshot> {
  return page.evaluate(() => {
    const clean = (value: string | null | undefined, maximum = 20_000): string =>
      (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
    const visible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number(style.opacity || '1') > 0;
    };
    const pathMatch = location.hostname === 'space.bilibili.com'
      ? location.pathname.match(/^\/(\d{1,20})\/lists\/?$/)
      : null;
    const navigationCountElement = Array.from(document.querySelectorAll<HTMLElement>('.nav-tab__item'))
      .find((item) => visible(item) &&
        clean(item.querySelector<HTMLElement>('.nav-tab__item-text')?.textContent, 40) === '合集和系列');
    const navigationCountText = clean(
      navigationCountElement?.querySelector<HTMLElement>('.nav-tab__item-num')?.textContent,
      40
    );
    const declaredNavigationCount = /^\d+$/.test(navigationCountText)
      ? Number(navigationCountText)
      : null;

    const items: BilibiliCollectionSeriesDomSnapshot['items'] = [];
    const seen = new Set<string>();
    const headings = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((element) =>
      visible(element) &&
      element.children.length === 0 &&
      /^(?:系列|合集)\s*[·・]\s*\S+/.test(clean(element.textContent, 500))
    );
    for (const heading of headings) {
      const headingText = clean(heading.textContent, 500);
      const match = headingText.match(/^(系列|合集)\s*[·・]\s*(.+)$/);
      if (!match) continue;
      const listType = match[1] === '系列' ? 'series' : 'season';
      const title = clean(match[2], 500);
      const identity = `${listType}\n${title}`;
      if (!title || seen.has(identity)) continue;

      const directSection = heading.closest<HTMLElement>('.video-list');
      let section: HTMLElement | null = visible(directSection) ? directSection : heading.parentElement;
      const headingAncestorClasses: string[] = [];
      for (let ancestor = heading.parentElement, depth = 0; ancestor && depth < 8;
        ancestor = ancestor.parentElement, depth += 1) {
        headingAncestorClasses.push(clean(ancestor.className, 200));
      }
      for (let depth = 0; section && !directSection && depth < 8; depth += 1) {
        const hasViewMore = Array.from(section.querySelectorAll<HTMLElement>('button,a')).some((element) =>
          visible(element) && /查看更多/.test(clean(element.textContent, 80))
        );
        const hasVideo = Boolean(section.querySelector('a[href*="/video/BV"]'));
        if (hasViewMore && hasVideo) break;
        section = section.parentElement;
      }
      if (!section) continue;

      const header = heading.closest<HTMLElement>('.video-list__header') ?? heading.parentElement;
      const headerRemainder = clean(header?.innerText, 2_000).replace(headingText, ' ');
      const nearbyNumberCandidates = [...headerRemainder.matchAll(/(?:^|\D)(\d{1,10})(?=\D|$)/g)]
        .map((match) => Number(match[1]))
        .filter((value) => Number.isSafeInteger(value));
      const declaredItemCount = nearbyNumberCandidates[0] ?? null;

      const visiblePreviewBvids: string[] = [];
      const visiblePreviewTitles: Record<string, string[]> = {};
      const seenBvids = new Set<string>();
      for (const anchor of Array.from(section.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        if (!visible(anchor)) continue;
        let url: URL;
        try {
          url = new URL(anchor.href, location.href);
        } catch {
          continue;
        }
        const videoMatch = url.hostname === 'www.bilibili.com' && url.pathname.match(
          /^\/video\/(BV[0-9A-Za-z]{10})\/?$/
        );
        if (!videoMatch) continue;
        const bvid = videoMatch[1];
        const titles = [
          anchor.getAttribute('title'),
          anchor.getAttribute('aria-label'),
          anchor.querySelector<HTMLImageElement>('img[alt]')?.alt,
          anchor.textContent
        ].map((value) => clean(value, 500)).filter((value) => value.length >= 2);
        const existing = new Set(visiblePreviewTitles[bvid] ?? []);
        for (const candidate of titles) existing.add(candidate);
        visiblePreviewTitles[bvid] = [...existing];
        if (!seenBvids.has(bvid)) {
          seenBvids.add(bvid);
          visiblePreviewBvids.push(bvid);
        }
      }
      seen.add(identity);
      items.push({
        listType,
        title,
        declaredItemCount,
        visiblePreviewBvids,
        visiblePreviewTitles,
        structure: {
          sectionClassName: clean(section.className, 200),
          headingAncestorClasses,
          nearbyNumberCandidates
        }
      });
    }

    const bodyText = clean(document.body?.innerText, 100_000);
    return {
      stableAccountId: pathMatch?.[1] ?? null,
      declaredNavigationCount,
      items,
      risk: {
        verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
        rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
        sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
      }
    };
  });
}
