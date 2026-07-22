export interface BilibiliAccountProfileDomBadgeImage {
  url: string | null;
  label: string | null;
}

export interface BilibiliAccountProfileDomField {
  label: string | null;
  value: string | null;
  href?: string | null;
}

export interface BilibiliAccountProfileDomHighlight {
  bvid: string | null;
  title: string | null;
}

export interface BilibiliAccountProfileDomSnapshot {
  stableAccountId: string | null;
  displayName: string | null;
  visibleDescription: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  textBadges: string[];
  imageBadges: BilibiliAccountProfileDomBadgeImage[];
  statistics: BilibiliAccountProfileDomField[];
  navigation: BilibiliAccountProfileDomField[];
  announcementText: string | null;
  chargeText: string | null;
  highlights: BilibiliAccountProfileDomHighlight[];
  profileHeaderVisible: boolean;
  loginOverlayVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

/**
 * Fixed visible-DOM projection for `space.bilibili.com/<mid>`. It purposely
 * scopes every read to the target account header/main content and never reads
 * Bilibili's global header, the current viewer's menu, or hidden app state.
 */
export async function captureBilibiliAccountProfileDom(
  tabId: number,
  documentId: string
): Promise<BilibiliAccountProfileDomSnapshot> {
  let results: chrome.scripting.InjectionResult<BilibiliAccountProfileDomSnapshot>[];
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [documentId] },
      world: 'ISOLATED',
      func: () => {
        const clean = (value: string | null | undefined, maximum: number): string | null => {
          const result = (value ?? '').replace(/\s+/g, ' ').trim();
          return result && result.length <= maximum && !/[\u0000-\u001f\u007f]/.test(result) ? result : null;
        };
        const rendered = (element: Element | null): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
            Number.parseFloat(style.opacity || '1') > 0.01;
        };
        const safeImageUrl = (value: string | null | undefined): string | null => {
          if (!value) return null;
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
        const bvidFromLink = (anchor: HTMLAnchorElement | null): string | null => {
          if (!anchor) return null;
          try {
            const url = new URL(anchor.href);
            return url.protocol === 'https:' && url.hostname === 'www.bilibili.com'
              ? url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null
              : null;
          } catch {
            return null;
          }
        };
        const backgroundImageUrl = (element: Element | null): string | null => {
          if (!(element instanceof HTMLElement)) return null;
          const candidates = [
            getComputedStyle(element).backgroundImage,
            getComputedStyle(element, '::before').backgroundImage,
            getComputedStyle(element, '::after').backgroundImage
          ];
          for (const value of candidates) {
            const match = value.match(/^url\(["']?(.*?)["']?\)$/);
            const image = safeImageUrl(match?.[1] ?? null);
            if (image) return image;
          }
          return null;
        };

        const pathMatch = location.protocol === 'https:' && location.hostname === 'space.bilibili.com'
          ? location.pathname.match(/^\/(\d{1,20})\/?$/)
          : null;
        const profileHeader = document.querySelector<HTMLElement>('.upinfo.header-upinfo');
        const profileMain = document.querySelector<HTMLElement>('main.space-main, .space-main');
        const detailTop = profileHeader?.querySelector<HTMLElement>('.upinfo-detail__top') ?? null;
        const description = profileHeader?.querySelector<HTMLElement>('.sign .pure-text, .sign.header-sign, .pure-text') ?? null;
        const avatar = profileHeader?.querySelector<HTMLImageElement>('.space-avatar img') ?? null;
        const bannerRoot = document.querySelector<HTMLElement>('.header.space-header, .header-toutu, .toutu.header-toutu');
        const bannerImage = bannerRoot
          ? Array.from(bannerRoot.querySelectorAll<HTMLImageElement>('img')).find((image) =>
            !image.closest('.space-avatar') && rendered(image)) ?? null
          : null;
        const bannerUrl = safeImageUrl(bannerImage?.currentSrc || bannerImage?.src) ?? backgroundImageUrl(bannerRoot);

        const textBadges = Array.from(profileHeader?.querySelectorAll<HTMLElement>(
          '[class*="level" i], [class*="badge" i], [class*="member" i]'
        ) ?? []).filter(rendered).map((element) =>
          clean(element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText, 80)
        ).filter((value): value is string => Boolean(value)).slice(0, 20);
        const imageBadges = Array.from(profileHeader?.querySelectorAll<HTMLImageElement>(
          '[class*="badge" i] img, [class*="member" i] img, [class*="level" i] img'
        ) ?? []).filter(rendered).map((image) => ({
          url: safeImageUrl(image.currentSrc || image.src),
          label: clean(image.getAttribute('alt') || image.getAttribute('title'), 80)
        })).slice(0, 20);

        const statistics = Array.from(document.querySelectorAll<HTMLElement>('.nav-statistics__item')).filter(rendered)
          .map((item) => ({
            label: clean(item.querySelector<HTMLElement>('.nav-statistics__item-text')?.innerText, 40),
            value: clean(item.querySelector<HTMLElement>('.nav-statistics__item-num')?.innerText, 100)
          })).slice(0, 12);
        const navigation = Array.from(document.querySelectorAll<HTMLAnchorElement>('.space-navbar .nav-tab__item')).filter(rendered)
          .map((item) => ({
            label: clean(item.querySelector<HTMLElement>('.nav-tab__item-text')?.innerText, 40),
            value: clean(item.querySelector<HTMLElement>('.nav-tab__item-num')?.innerText, 100),
            href: item.href || null
          })).slice(0, 12);
        const announcement = profileMain?.querySelector<HTMLElement>('.ann-section') ?? null;
        const charge = profileMain?.querySelector<HTMLElement>('.elec-section .elec-status, .elec-status') ?? null;
        const highlights = Array.from(profileMain?.querySelectorAll<HTMLElement>(
          '.masterpiece-block__card, .masterpiece-block .bili-video-card__wrap'
        ) ?? []).filter(rendered).slice(0, 12).map((card) => {
          const anchors = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(rendered);
          const videoAnchor = anchors.find((anchor) => bvidFromLink(anchor) !== null) ?? null;
          const titleElement = Array.from(card.querySelectorAll<HTMLElement>('h3, [class*="title" i]'))
            .find(rendered) ?? null;
          return { bvid: bvidFromLink(videoAnchor), title: clean(titleElement?.innerText, 500) };
        });
        const bodyText = clean(document.body?.innerText, 100_000) ?? '';
        const loginOverlayVisible = Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"], [class*="login" i], [class*="passport" i]')
        ).some((element) => rendered(element) &&
          element.getBoundingClientRect().width >= 160 && element.getBoundingClientRect().height >= 120);
        return {
          stableAccountId: pathMatch?.[1] ?? null,
          displayName: clean(detailTop?.innerText, 200),
          visibleDescription: clean(description?.innerText, 5_000),
          avatarUrl: safeImageUrl(avatar?.currentSrc || avatar?.src),
          bannerUrl,
          textBadges,
          imageBadges,
          statistics,
          navigation,
          announcementText: clean(announcement?.innerText, 20_000),
          chargeText: clean(charge?.innerText, 2_000),
          highlights,
          profileHeaderVisible: rendered(profileHeader) && rendered(profileMain),
          loginOverlayVisible,
          risk: {
            verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
            rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
            sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
          }
        };
      }
    });
  } catch {
    throw new Error('account_profile_strategy_document_context_changed');
  }
  const result = results[0]?.result;
  if (!result) throw new Error('account_profile_strategy_document_context_changed');
  return result;
}
