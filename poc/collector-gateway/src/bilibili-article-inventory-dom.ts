import type { Locator, Page } from 'playwright';
import type { BilibiliArticleInventoryDomSnapshot } from './bilibili-article-contract';

const DOM_TIMEOUT_MS = 12_000;

export async function captureBilibiliArticleInventoryDom(
  page: Page
): Promise<BilibiliArticleInventoryDomSnapshot> {
  return page.evaluate(() => {
    const clean = (value: string | null | undefined, maximum = 5_000): string =>
      (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
    const visible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number(style.opacity || '1') > 0;
    };
    const pathMatch = location.hostname === 'space.bilibili.com'
      ? location.pathname.match(/^\/(\d{1,20})\/upload\/opus\/?$/)
      : null;
    const titleCandidates: Record<string, string[]> = {};
    const stableOpusIds: string[] = [];
    const seen = new Set<string>();
    for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      if (!visible(anchor)) continue;
      let url: URL;
      try {
        url = new URL(anchor.href, location.href);
      } catch {
        continue;
      }
      const match = url.hostname === 'www.bilibili.com' && url.pathname.match(/^\/opus\/(\d{1,20})\/?$/);
      if (!match) continue;
      const stableOpusId = match[1];
      const candidates = [
        anchor.getAttribute('title'),
        anchor.getAttribute('aria-label'),
        anchor.querySelector<HTMLImageElement>('img[alt]')?.alt,
        anchor.textContent
      ].map((value) => clean(value, 5_000)).filter((value) => value.length >= 1);
      const existing = new Set(titleCandidates[stableOpusId] ?? []);
      for (const candidate of candidates) existing.add(candidate);
      titleCandidates[stableOpusId] = [...existing];
      if (!seen.has(stableOpusId)) {
        seen.add(stableOpusId);
        stableOpusIds.push(stableOpusId);
      }
    }
    const facetLabels = new Set<string>();
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('main *'))) {
      if (!visible(element) || element.children.length > 0) continue;
      const text = clean(element.textContent, 40);
      if (/^(?:全部图文|专栏|动态)$/.test(text)) facetLabels.add(text);
    }
    const bodyText = clean(document.body?.innerText, 100_000);
    return {
      stableAccountId: pathMatch?.[1] ?? null,
      stableOpusIds,
      titleCandidates,
      visibleFacetLabels: [...facetLabels],
      risk: {
        verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
        rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
        sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
      }
    };
  });
}

export async function visibleArticleFacet(page: Page): Promise<Locator | null> {
  const candidates = page.locator('main').getByText('专栏', { exact: true });
  const visible: Locator[] = [];
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible().catch(() => false)) visible.push(candidate);
  }
  return visible.length === 1 ? visible[0] : null;
}

export async function waitForBilibiliArticleInventoryDomIds(
  page: Page,
  expectedStableOpusIds: readonly string[],
  timeoutMs = DOM_TIMEOUT_MS
): Promise<void> {
  await page.waitForFunction((expectedIds) => {
    const actualIds = new Set(Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).flatMap((anchor) => {
      if (anchor.getClientRects().length === 0) return [];
      try {
        const url = new URL(anchor.href, location.href);
        const match = url.hostname === 'www.bilibili.com' && url.pathname.match(/^\/opus\/(\d{1,20})\/?$/);
        return match ? [match[1]] : [];
      } catch {
        return [];
      }
    }));
    const identityMatch = actualIds.size === expectedIds.length && expectedIds.every((id) => actualIds.has(id));
    const text = document.body?.innerText ?? '';
    const stopped = /验证码|安全验证|异常访问|访问频繁|操作频繁|页面不存在|加载失败/.test(text);
    return identityMatch || stopped;
  }, [...expectedStableOpusIds], { timeout: timeoutMs });
}
