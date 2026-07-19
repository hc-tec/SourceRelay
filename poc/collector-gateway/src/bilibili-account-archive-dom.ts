import type { Locator, Page } from 'playwright';
import {
  normaliseBilibiliPublicImagePathname,
  type BilibiliAccountArchiveTerminalReason,
  type BilibiliAccountProfileProjection,
  type BilibiliAccountPublicField
} from './bilibili-account-archive-contract';

const DOM_TIMEOUT_MS = 12_000;

export interface InventoryDomSnapshot {
  path: string;
  activePageNumber: number | null;
  declaredPages: number | null;
  declaredTotal: number | null;
  videoIds: string[];
  titleCandidates: Record<string, string[]>;
  publicFields: BilibiliAccountPublicField[];
  risk: {
    authenticationRequired: boolean;
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
    contradictoryEmptyState: boolean;
  };
}

export async function captureInventoryDom(page: Page): Promise<InventoryDomSnapshot> {
  return page.evaluate(() => {
    const clean = (value: string | null | undefined, maximum = 500): string =>
      (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number(style.opacity || '1') > 0;
    };

    const titlesById = new Map<string, Set<string>>();
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
      const candidates = [
        anchor.getAttribute('title'),
        anchor.getAttribute('aria-label'),
        anchor.querySelector<HTMLImageElement>('img[alt]')?.alt,
        anchor.textContent
      ].map((candidate) => clean(candidate)).filter((candidate) => candidate.length >= 2);
      const existing = titlesById.get(match[1]) ?? new Set<string>();
      for (const candidate of candidates) existing.add(candidate);
      titlesById.set(match[1], existing);
    }

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    const activePage = buttons.find((button) =>
      visible(button) &&
      /^\d+$/.test(clean(button.textContent, 10)) &&
      /(?:^|\s)vui_button--active(?:\s|$)/.test(String(button.className)) &&
      /pagenation/.test(String(button.className))
    );
    const activePageNumber = activePage ? Number(clean(activePage.textContent, 10)) : null;

    const bodyText = clean(document.body?.innerText, 100_000);
    const declaredMatch = bodyText.match(/共\s*(\d+)\s*页\s*\/\s*(\d+)\s*个/);
    const labels = ['关注数', '粉丝数', '获赞数', '播放数', '投稿', '合集和系列', '视频', '图文', '音频'];
    const publicFields: { label: string; value: string }[] = [];
    for (const label of labels) {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((element) =>
        visible(element) && element.children.length === 0 && clean(element.textContent, 100) === label
      );
      let value = '';
      for (const labelElement of candidates) {
        let container: HTMLElement | null = labelElement.parentElement;
        for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
          const leafTexts = Array.from(container.querySelectorAll<HTMLElement>('*'))
            .filter((element) => visible(element) && element.children.length === 0)
            .map((element) => clean(element.textContent, 100))
            .filter((text) => text && text !== label && /\d/.test(text));
          if (leafTexts.length > 0 && clean(container.innerText, 200).length <= 120) {
            value = leafTexts[0];
            break;
          }
        }
        if (value) break;
      }
      if (value) publicFields.push({ label, value });
    }

    return {
      path: location.pathname,
      activePageNumber: Number.isSafeInteger(activePageNumber) ? activePageNumber : null,
      declaredPages: declaredMatch ? Number(declaredMatch[1]) : null,
      declaredTotal: declaredMatch ? Number(declaredMatch[2]) : null,
      videoIds: [...titlesById.keys()],
      titleCandidates: Object.fromEntries(
        [...titlesById.entries()].map(([bvid, titles]) => [bvid, [...titles]])
      ),
      publicFields,
      risk: {
        authenticationRequired: /登录后查看更多|请先登录|登录后查看|立即登录/.test(bodyText),
        verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
        rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
        sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText),
        contradictoryEmptyState: /空间主人还没投过视频/.test(bodyText) && /视频\s*[1-9]\d*/.test(bodyText)
      }
    };
  });
}

export async function waitForInventoryDomIdentity(
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
      const match = anchor.href.match(/\/video\/(BV[0-9A-Za-z]{10})/);
      return match ? [match[1]] : [];
    }));
    const identityMatch = actualIds.size === expectedIds.length && expectedIds.every((bvid) => actualIds.has(bvid));
    const text = document.body?.innerText ?? '';
    const stopped = /验证码|安全验证|异常访问|访问频繁|操作频繁|空间主人还没投过视频/.test(text);
    return (active && identityMatch) || stopped;
  }, { expected: expectedPageNumber, expectedIds: [...expectedVideoIds] }, { timeout: timeoutMs });
}

export async function accountProfileCrossCheck(
  page: Page,
  profile: Omit<BilibiliAccountProfileProjection, 'publicFields' | 'domCrossCheck'>
): Promise<BilibiliAccountProfileProjection['domCrossCheck']> {
  const expectedAvatarPath = profile.avatarUrl
    ? normaliseBilibiliPublicImagePathname(new URL(profile.avatarUrl).pathname)
    : null;
  return page.evaluate(({ candidate, expectedPath }) => {
    const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
    let avatarVisible: boolean | null = null;
    if (candidate.avatarUrl && expectedPath) {
      const normalisePath = (pathname: string): string => pathname.replace(
        /(\.(?:jpe?g|png|gif|webp|avif))@[A-Za-z0-9_.!,~*-]{1,240}$/i,
        '$1'
      );
      avatarVisible = Array.from(document.images).some((image) => {
        try {
          const actual = new URL(image.currentSrc || image.src, location.href);
          const hostname = actual.hostname.toLowerCase();
          return (hostname === 'hdslb.com' || hostname.endsWith('.hdslb.com')) &&
            normalisePath(actual.pathname) === expectedPath &&
            image.getClientRects().length > 0;
        } catch {
          return false;
        }
      });
    } else if (candidate.avatarUrl) {
      avatarVisible = false;
    }
    return {
      displayNameVisible: text.includes(candidate.displayName),
      descriptionVisible: candidate.visibleDescription === null ? null : text.includes(candidate.visibleDescription),
      avatarVisible
    };
  }, { candidate: profile, expectedPath: expectedAvatarPath });
}

export function terminalReasonFromDom(
  dom: InventoryDomSnapshot
): BilibiliAccountArchiveTerminalReason | null {
  if (dom.risk.verificationRequired) return 'verification_required';
  if (dom.risk.rateLimited) return 'rate_limited';
  if (dom.risk.authenticationRequired) return 'authentication_required';
  if (dom.risk.sourceUnavailable) return 'source_unavailable';
  if (dom.risk.contradictoryEmptyState) return 'risk_controlled';
  return null;
}

export function exactPageButton(page: Page, pageNumber: number): Locator {
  return page.locator('button.vui_pagenation--btn-num').filter({
    hasText: new RegExp(`^\\s*${pageNumber}\\s*$`)
  });
}
