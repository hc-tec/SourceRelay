export interface BilibiliGateRisk {
  verificationRequired: boolean;
  rateLimited: boolean;
  sourceUnavailable: boolean;
}

export interface BilibiliGateRiskInput {
  gateText: string;
  /** The page's primary content surface rendered (cards / player / list). */
  hasPrimaryContent: boolean;
}

/**
 * Classify a bilibili page-level gate from GATE-SURFACE text only. The
 * historical implementation regex-matched the full page body text, so a video
 * description, a comment, or a recommended-video title that happened to
 * contain “风控” / “稍后再试” / “加载失败” stopped a fully healthy capture as
 * `rate_limited` / `source_unavailable` (observed in the field: a video with
 * title, player, description and seven tags captured, then stopped because
 * unrelated page text matched). Gate messages render in dialogs, masks,
 * captcha panels, login layers and error/empty containers — that is the only
 * text this evaluator reads, and a rendered primary content surface vetoes
 * the throttle/unavailable classes entirely.
 */
export function evaluateBilibiliGateRisk(input: BilibiliGateRiskInput): BilibiliGateRisk {
  const gateText = typeof input.gateText === 'string' ? input.gateText : '';
  return {
    verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(gateText),
    rateLimited: !input.hasPrimaryContent &&
      /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(gateText),
    sourceUnavailable: !input.hasPrimaryContent &&
      /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(gateText)
  };
}

/**
 * Collect gate-surface text from the current document. Passed to
 * `chrome.scripting.executeScript` as `func`, so it must stay fully
 * self-contained: no imports, no closures, no module state.
 */
export function collectBilibiliGateText(): string {
  const parts: string[] = [];
  const push = (value: unknown): void => {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (text.length >= 2 && text.length <= 600) parts.push(text);
  };
  const rendered = (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
      style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
  };
  const gateSelector = [
    '[role="dialog"]',
    '[aria-modal="true"]',
    '.bili-mini-mask',
    '.bili-mini-login',
    '.passport-login-container',
    '[class*="login-modal" i]',
    '[class*="passport-layer" i]',
    '[class*="captcha" i]',
    '[class*="geetest" i]',
    '.search-nodata-container',
    '[class*="nodata" i]',
    '[class*="no-data" i]',
    '[class*="no-result" i]'
  ].join(', ');
  for (const element of Array.from(document.querySelectorAll(gateSelector))) {
    if (rendered(element)) push(element.textContent);
  }
  return parts.join('\n').slice(0, 4_000);
}
