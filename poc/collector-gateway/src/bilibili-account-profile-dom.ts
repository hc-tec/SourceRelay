import type { Page } from 'playwright';
import type { RawBilibiliAccountProfileDom } from './bilibili-account-profile-contract';

export async function captureBilibiliAccountProfileDom(
  page: Page
): Promise<RawBilibiliAccountProfileDom> {
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
      ? location.pathname.match(/^\/(\d{1,20})\/?$/)
      : null;
    const nickname = document.querySelector<HTMLElement>('.nickname');
    let accountHeader: HTMLElement | null = visible(nickname) ? nickname.parentElement : null;
    for (let depth = 0; accountHeader && depth < 6; depth += 1) {
      const rect = accountHeader.getBoundingClientRect();
      if (rect.width >= 500 && rect.height >= 80 && rect.top < 320) break;
      accountHeader = accountHeader.parentElement;
    }
    if (!visible(accountHeader)) accountHeader = null;

    const description = accountHeader?.querySelector<HTMLElement>('.pure-text') ??
      document.querySelector<HTMLElement>('.pure-text');
    const nicknameRect = nickname?.getBoundingClientRect() ?? null;
    const headerImages = Array.from(accountHeader?.querySelectorAll<HTMLImageElement>('img') ?? [])
      .filter((image) => visible(image));
    const avatar = headerImages.map((image) => {
      const rect = image.getBoundingClientRect();
      const distance = nicknameRect
        ? Math.abs(rect.right - nicknameRect.left) + Math.abs(rect.top - nicknameRect.top)
        : Number.POSITIVE_INFINITY;
      return { image, rect, distance };
    }).filter(({ rect }) =>
      rect.width >= 40 && rect.width <= 180 && rect.height >= 40 && rect.height <= 180
    ).sort((left, right) => left.distance - right.distance)[0]?.image ?? null;

    let bannerUrl: string | null = null;
    let bannerArea = 0;
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const rect = element.getBoundingClientRect();
      if (rect.top < -100 || rect.top > 320 || rect.width < 500 || rect.height < 80 || rect.height > 400) continue;
      for (const pseudo of [null, '::before', '::after'] as const) {
        const backgroundImage = getComputedStyle(element, pseudo).backgroundImage;
        const match = backgroundImage.match(/url\(["']?((?:https?:)?\/\/[^"')]+)["']?\)/i);
        if (!match) continue;
        let candidate: URL;
        try {
          candidate = new URL(match[1], location.href);
        } catch {
          continue;
        }
        if (!(candidate.hostname === 'hdslb.com' || candidate.hostname.endsWith('.hdslb.com'))) continue;
        const area = rect.width * rect.height;
        if (area > bannerArea) {
          bannerArea = area;
          bannerUrl = candidate.href;
        }
      }
    }

    const textBadges = accountHeader
      ? Array.from(accountHeader.querySelectorAll<HTMLElement>('*')).filter((element) =>
        visible(element) &&
        element.children.length === 0 &&
        !element.closest('.pure-text') &&
        !element.closest('button,a') &&
        /(?:Lv\s*\d+|大会员|认证|官方|UP主)/i.test(clean(element.textContent, 80))
      ).map((element) => clean(element.textContent, 80)).filter(Boolean)
      : [];
    const imageBadges = headerImages.filter((image) => image !== avatar).map((image) => {
      const rect = image.getBoundingClientRect();
      return {
        rect,
        url: image.currentSrc || image.src,
        label: clean(image.alt || image.title, 80) || null
      };
    }).filter(({ rect }) => rect.height > 0 && rect.height <= 48 && rect.width > 0 && rect.width <= 240)
      .map(({ url, label }) => ({ url, label }));

    const statistics = Array.from(document.querySelectorAll<HTMLElement>('.nav-statistics__item'))
      .filter((item) => visible(item)).map((item) => ({
        label: clean(item.querySelector<HTMLElement>('.nav-statistics__item-text')?.textContent, 40),
        value: clean(item.querySelector<HTMLElement>('.nav-statistics__item-num')?.textContent, 100)
      })).filter((item) => item.label);
    const navigation = Array.from(document.querySelectorAll<HTMLElement>('.nav-tab__item'))
      .filter((item) => visible(item)).map((item) => {
        const anchor = item instanceof HTMLAnchorElement ? item : item.closest<HTMLAnchorElement>('a[href]');
        return {
          label: clean(item.querySelector<HTMLElement>('.nav-tab__item-text')?.textContent, 40),
          value: clean(item.querySelector<HTMLElement>('.nav-tab__item-num')?.textContent, 100) || null,
          href: anchor?.href ?? null
        };
      }).filter((item) => item.label);

    const announcement = document.querySelector<HTMLElement>('.ann-section');
    let charge = Array.from(document.querySelectorAll<HTMLElement>('[class*=charge]')).find((element) =>
      visible(element) && /充电/.test(clean(element.innerText, 2_000)) && clean(element.innerText, 2_000).length <= 2_000
    ) ?? null;
    if (!charge) {
      const chargeSignal = Array.from(document.querySelectorAll<HTMLElement>('*')).find((element) =>
        visible(element) && element.children.length === 0 && /^(?:充电|\d+\s*人充电)$/.test(clean(element.textContent, 100))
      );
      charge = chargeSignal?.parentElement ?? null;
      for (let depth = 0; charge && depth < 5; depth += 1) {
        const text = clean(charge.innerText, 2_000);
        if (/充电/.test(text) && /\d+\s*人充电/.test(text) && text.length <= 2_000) break;
        charge = charge.parentElement;
      }
    }
    const representativeTitle = Array.from(document.querySelectorAll<HTMLElement>('*')).find((element) =>
      visible(element) && element.children.length === 0 && clean(element.textContent, 40) === '代表作'
    );
    let representativeSection: HTMLElement | null = representativeTitle?.parentElement ?? null;
    for (let depth = 0; representativeSection && depth < 6; depth += 1) {
      if (representativeSection.querySelector('a[href*="/video/BV"]')) break;
      representativeSection = representativeSection.parentElement;
    }
    const highlights: Array<{ bvid: string; title: string }> = [];
    const seenHighlights = new Set<string>();
    for (const anchor of Array.from(
      representativeSection?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []
    )) {
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
      if (!match || seenHighlights.has(match[1])) continue;
      const title = [
        anchor.getAttribute('title'),
        anchor.getAttribute('aria-label'),
        anchor.querySelector<HTMLImageElement>('img[alt]')?.alt,
        anchor.textContent
      ].map((value) => clean(value, 500)).find((value) => value.length >= 2) ?? '';
      if (!title) continue;
      seenHighlights.add(match[1]);
      highlights.push({ bvid: match[1], title });
    }

    const bodyText = clean(document.body?.innerText, 100_000);
    return {
      stableAccountId: pathMatch?.[1] ?? null,
      displayName: visible(nickname) ? clean(nickname.textContent, 200) : null,
      visibleDescription: visible(description) ? clean(description.textContent, 5_000) : null,
      avatarUrl: avatar ? avatar.currentSrc || avatar.src : null,
      bannerUrl,
      textBadges,
      imageBadges,
      statistics,
      navigation,
      announcementText: visible(announcement) ? clean(announcement.innerText, 20_000) : null,
      chargeText: visible(charge) ? clean(charge.innerText, 2_000) : null,
      highlights,
      risk: {
        verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
        rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
        sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
      }
    };
  });
}
