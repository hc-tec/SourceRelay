import type { Locator, Page } from 'playwright';
import type { BilibiliSeriesDomSnapshot } from './bilibili-series-detail-contract';

const DOM_TIMEOUT_MS = 12_000;

export async function captureBilibiliSeriesDetailDom(page: Page): Promise<BilibiliSeriesDomSnapshot> {
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
      ? location.pathname.match(/^\/(\d{1,20})\/lists\/(\d{1,20})\/?$/)
      : null;
    const titleElement = Array.from(document.querySelectorAll<HTMLElement>('*')).find((element) =>
      visible(element) && element.children.length === 0 && /^(?:系列|合集)\s*[·・]\s*\S+/.test(
        clean(element.textContent, 500)
      )
    );
    const titleMatch = clean(titleElement?.textContent, 500).match(/^(?:系列|合集)\s*[·・]\s*(.+)$/);
    const bodyText = clean(document.body?.innerText, 100_000);
    const declaredMatch = bodyText.match(/(\d+)\s*个视频/);
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter((button) =>
      visible(button)
    );
    const activePage = buttons.find((button) =>
      /^\d+$/.test(clean(button.textContent, 20)) &&
      /(?:^|\s)vui_button--active(?:\s|$)/.test(String(button.className)) &&
      /pagenation/.test(String(button.className))
    );

    const titleCandidates: Record<string, string[]> = {};
    const videoIds: string[] = [];
    const seen = new Set<string>();
    for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      if (!visible(anchor)) continue;
      let url: URL;
      try {
        url = new URL(anchor.href, location.href);
      } catch {
        continue;
      }
      const match = url.hostname === 'www.bilibili.com' && url.pathname.match(
        /^\/video\/(BV[0-9A-Za-z]{10})\/?$/
      );
      if (!match) continue;
      const bvid = match[1];
      const candidates = [
        anchor.getAttribute('title'),
        anchor.getAttribute('aria-label'),
        anchor.querySelector<HTMLImageElement>('img[alt]')?.alt,
        anchor.textContent
      ].map((value) => clean(value, 500)).filter((value) => value.length >= 2);
      const existing = new Set(titleCandidates[bvid] ?? []);
      for (const candidate of candidates) existing.add(candidate);
      titleCandidates[bvid] = [...existing];
      if (!seen.has(bvid)) {
        seen.add(bvid);
        videoIds.push(bvid);
      }
    }
    const sortLabels = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((element) =>
      visible(element) && element.children.length === 0 && /^(?:默认排序|倒序排序)$/.test(
        clean(element.textContent, 40)
      )
    ).map((element) => clean(element.textContent, 40));
    return {
      stableAccountId: pathMatch?.[1] ?? null,
      stableSeriesId: pathMatch?.[2] ?? null,
      visibleTitle: titleMatch?.[1] ? clean(titleMatch[1], 500) : null,
      declaredItemCount: declaredMatch ? Number(declaredMatch[1]) : null,
      activePageNumber: activePage ? Number(clean(activePage.textContent, 20)) : null,
      videoIds,
      titleCandidates,
      sortLabels: [...new Set(sortLabels)],
      risk: {
        verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
        rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
        sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
      }
    };
  });
}

export async function waitForBilibiliSeriesDomIdentity(
  page: Page,
  expectedPageNumber: number,
  expectedVideoIds: readonly string[],
  timeoutMs = DOM_TIMEOUT_MS
): Promise<void> {
  await page.waitForFunction(({ expected, expectedIds }) => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    const active = buttons.some((button) =>
      (button.textContent ?? '').replace(/\s+/g, '').trim() === String(expected) &&
      /(?:^|\s)vui_button--active(?:\s|$)/.test(String(button.className)) &&
      /pagenation/.test(String(button.className))
    );
    const actualIds = new Set(Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).flatMap((anchor) => {
      if (anchor.getClientRects().length === 0) return [];
      try {
        const url = new URL(anchor.href, location.href);
        const match = url.hostname === 'www.bilibili.com' && url.pathname.match(
          /^\/video\/(BV[0-9A-Za-z]{10})\/?$/
        );
        return match ? [match[1]] : [];
      } catch {
        return [];
      }
    }));
    const identityMatch = actualIds.size === expectedIds.length && expectedIds.every((bvid) => actualIds.has(bvid));
    const text = document.body?.innerText ?? '';
    const stopped = /验证码|安全验证|异常访问|访问频繁|操作频繁|页面不存在|加载失败/.test(text);
    return ((active || expectedIds.length === 0) && identityMatch) || stopped;
  }, { expected: expectedPageNumber, expectedIds: [...expectedVideoIds] }, { timeout: timeoutMs });
}

export function exactBilibiliSeriesPageButton(page: Page, pageNumber: number): Locator {
  return page.locator('button.vui_pagenation--btn-num').filter({
    hasText: new RegExp(`^\\s*${pageNumber}\\s*$`)
  });
}
