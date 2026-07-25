export interface BilibiliVideoDetailDomSnapshot {
  bvid: string | null;
  title: string | null;
  metadataVisibleText: string | null;
  description: string | null;
  creator: {
    displayName: string | null;
    publicAccountId: string | null;
  } | null;
  tagTexts: string[];
  episodeSummaryText: string | null;
  titleVisible: boolean;
  playerVisible: boolean;
  chargeExclusiveTrialVisible: boolean;
  loginOverlayVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

/**
 * Fixed Bilibili first-screen projection. This source-specific function is
 * deliberately the only code that reads the video detail DOM; callers cannot
 * supply selectors or page JavaScript.
 */
export async function captureBilibiliVideoDetailDom(
  tabId: number,
  documentId?: string
): Promise<BilibiliVideoDetailDomSnapshot> {
  let results: chrome.scripting.InjectionResult<BilibiliVideoDetailDomSnapshot>[];
  try {
    results = await chrome.scripting.executeScript({
      target: documentId ? { tabId, documentIds: [documentId] } : { tabId },
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
        const canonicalBvid = location.protocol === 'https:' && location.hostname === 'www.bilibili.com'
          ? location.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null
          : null;
        const titleElement = Array.from(document.querySelectorAll<HTMLElement>('h1')).find(rendered) ?? null;
        const player = document.querySelector<HTMLElement>('[aria-label="哔哩哔哩播放器"]');
        // A charge-exclusive trial is a positive, visible access restriction.
        // It is intentionally not inferred from the creator's generic “充电”
        // entry, a black player, or the absence of a description. The current
        // desktop observation requires both the scoped player toast structure
        // and its human-visible “专属视频” / “试看中…充电” wording.
        const chargeTrialToast = document.querySelector<HTMLElement>('.bpx-player-trial-watch-charging-toast');
        const chargeTrialTitle = chargeTrialToast?.querySelector<HTMLElement>('.bpx-player-charging-toast-left-title') ?? null;
        const chargeTrialLevel = chargeTrialToast?.querySelector<HTMLElement>('.bpx-player-charging-toast-left-level') ?? null;
        const chargeTrialTitleText = clean(chargeTrialTitle?.innerText, 300) ?? '';
        const chargeTrialLevelText = clean(chargeTrialLevel?.innerText, 300) ?? '';
        const chargeExclusiveTrialVisible = rendered(chargeTrialToast) &&
          rendered(chargeTrialTitle) &&
          rendered(chargeTrialLevel) &&
          /专属视频/.test(chargeTrialTitleText) &&
          /(?:试看中|开通).{0,80}充电/.test(chargeTrialLevelText);
        // `#v_desc` is the legacy desktop container. Current pages commonly
        // expose the same public description below the title in
        // `.video-desc-container`; the candidates remain fixed and scoped to
        // this source-specific projection.
        const description = [
          document.querySelector<HTMLElement>('#v_desc'),
          document.querySelector<HTMLElement>('.video-desc-container .basic-desc-info'),
          document.querySelector<HTMLElement>('.video-desc-container .desc-info-text'),
          document.querySelector<HTMLElement>('.video-desc-container')
        ].find((element): element is HTMLElement => rendered(element)) ?? null;
        const upInfo = document.querySelector<HTMLElement>('.up-info-container') ??
          document.querySelector<HTMLElement>('.up-panel-container') ??
          document.querySelector<HTMLElement>('#v_upinfo');
        const creatorAnchors = upInfo
          ? [
            upInfo.querySelector<HTMLAnchorElement>('a.up-name[href]'),
            ...Array.from(upInfo.querySelectorAll<HTMLAnchorElement>('a[href]'))
          ]
          : [];
        const creatorAnchor = creatorAnchors.find((anchor): anchor is HTMLAnchorElement =>
          anchor !== null && rendered(anchor)
        ) ?? null;
        let creator: { displayName: string | null; publicAccountId: string | null } | null = null;
        if (creatorAnchor) {
          try {
            const url = new URL(creatorAnchor.href);
            const accountId = url.hostname === 'space.bilibili.com'
              ? url.pathname.match(/^\/(\d{1,20})\/?$/)?.[1] ?? null
              : null;
            creator = { displayName: clean(creatorAnchor.innerText, 200), publicAccountId: accountId };
          } catch {
            creator = { displayName: clean(creatorAnchor.innerText, 200), publicAccountId: null };
          }
        } else if (upInfo && rendered(upInfo)) {
          const creatorName = [
            upInfo.querySelector<HTMLElement>('.up-name'),
            upInfo.querySelector<HTMLElement>('.up-name__text')
          ].find((element): element is HTMLElement => rendered(element)) ?? null;
          const displayName = clean(creatorName?.innerText, 200);
          if (displayName) creator = { displayName, publicAccountId: null };
        }
        const tagTexts = [...new Set(Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(rendered)
          .map((anchor) => {
            try {
              const url = new URL(anchor.href);
              return url.hostname === 'search.bilibili.com' && url.pathname === '/all'
                ? clean(anchor.innerText, 100)
                : null;
            } catch {
              return null;
            }
          }).filter((value): value is string => value !== null))].slice(0, 20);
        const episodeHeading = Array.from(document.querySelectorAll<HTMLElement>('*')).find((element) =>
          rendered(element) && element.children.length === 0 && clean(element.textContent, 40) === '视频选集'
        ) ?? null;
        const episodeSummaryText = clean(episodeHeading?.parentElement?.textContent, 500);
        const bodyText = clean(document.body?.innerText, 100_000) ?? '';
        const loginOverlayVisible = Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"], [class*="login" i], [class*="passport" i]')
        ).some((element) => rendered(element) &&
          element.getBoundingClientRect().width >= 160 && element.getBoundingClientRect().height >= 120);
        return {
          bvid: canonicalBvid,
          title: clean(titleElement?.innerText, 500),
          metadataVisibleText: clean(titleElement?.parentElement?.textContent, 1_000),
          description: rendered(description) ? clean(description.innerText, 20_000) : null,
          creator,
          tagTexts,
          episodeSummaryText,
          titleVisible: rendered(titleElement),
          playerVisible: rendered(player),
          chargeExclusiveTrialVisible,
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
    throw new Error('video_detail_strategy_document_context_changed');
  }
  const result = results[0]?.result;
  if (!result) throw new Error('video_detail_strategy_document_context_changed');
  return result;
}
