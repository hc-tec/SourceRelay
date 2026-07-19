import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserContext, Locator, Page } from 'playwright';
import { canonicalBilibiliVideoUrl } from '../../collector-extension/src/shared/bilibili-video-url';
import type { TranscriptInteractionOutcome } from '../../collector-extension/src/shared/protocol';

const POLL_MS = 100;

export interface TranscriptPageFailure {
  outcome: Extract<
    TranscriptInteractionOutcome,
    'page_unavailable' | 'context_changed' | 'network_unavailable' | 'risk_detected'
  >;
  errorCode: string;
}

export async function waitForBilibiliTranscriptPage(
  context: BrowserContext,
  canonicalUrl: string,
  timeoutMs: number
): Promise<Page | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    const page = context.pages().find((candidate) =>
      canonicalBilibiliVideoUrl(candidate.url(), 'observed_document') === canonicalUrl
    );
    if (page && !page.isClosed()) return page;
    await delay(POLL_MS);
  } while (Date.now() < deadline);
  return null;
}

export async function waitForVisible(locator: Locator, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await locator.isVisible().catch(() => false)) return true;
    await delay(POLL_MS);
  } while (Date.now() < deadline);
  return false;
}

export async function waitForAttached(locator: Locator, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await locator.count().catch(() => 0) > 0) return true;
    await delay(POLL_MS);
  } while (Date.now() < deadline);
  return false;
}

export async function waitForPlayerControlsRevealed(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    const revealed = await page.evaluate(() => {
      const controls = document.querySelector('.bpx-player-control-bottom');
      if (!controls) return false;
      const rect = controls.getBoundingClientRect();
      const style = getComputedStyle(controls);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number(style.opacity || 0) > 0.5;
    }).catch(() => false);
    if (revealed) return true;
    await delay(POLL_MS);
  } while (Date.now() < deadline);
  return false;
}

async function hardRiskCode(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    };
    const compact = (element: Element): string =>
      (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
    const riskText = Array.from(document.querySelectorAll(
      '[class*="captcha"],[class*="geetest"],[class*="risk-control"],' +
      '[class*="risk_control"],[id*="captcha"],iframe[src*="captcha"]'
    )).filter(visible).map(compact).join(' ');
    if (/访问频繁|操作频繁|请求过于频繁|rate.?limit/i.test(riskText)) {
      return 'transcript_validation_rate_limited';
    }
    if (/验证码|访问异常|风控|安全验证|人机验证|captcha|geetest/i.test(riskText)) {
      return 'transcript_validation_verification_required';
    }
    const headerLogin = Array.from(document.querySelectorAll(
      'header .header-login-entry,header a[href*="passport.bilibili.com/login"],' +
      '.bili-header .header-login-entry,.bili-header a[href*="passport.bilibili.com/login"]'
    )).some((element) => visible(element) && compact(element) === '登录');
    return headerLogin ? 'transcript_validation_authentication_lost' : null;
  }).catch(() => null);
}

export async function transcriptPageFailure(
  page: Page,
  canonicalUrl: string
): Promise<TranscriptPageFailure | null> {
  if (page.isClosed()) {
    return { outcome: 'page_unavailable', errorCode: 'transcript_validation_page_closed' };
  }
  if (canonicalBilibiliVideoUrl(page.url(), 'observed_document') !== canonicalUrl) {
    return { outcome: 'context_changed', errorCode: 'transcript_validation_context_changed' };
  }
  const online = await page.evaluate(() => navigator.onLine).catch(() => false);
  if (!online) {
    return { outcome: 'network_unavailable', errorCode: 'transcript_validation_network_offline' };
  }
  const riskCode = await hardRiskCode(page);
  return riskCode ? { outcome: 'risk_detected', errorCode: riskCode } : null;
}

async function visibleCaptionLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const labels = new Set<string>();
    const pattern = /^(?:字幕|关闭|字幕设置|中文|汉语|(?:中文|汉语).*(?:自动生成|AI).*)$/;
    for (const element of Array.from(document.querySelectorAll(
      '.bpx-player-ctrl-subtitle-language-item,.bpx-player-ctrl-subtitle [class*="item"],' +
      '.bpx-player-ctrl-subtitle,[aria-label="字幕"]'
    ))) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const text = (element.getAttribute('aria-label') || element.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (
        rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0 &&
        text.length <= 80 && pattern.test(text)
      ) labels.add(text);
    }
    return [...labels].slice(0, 40);
  }).catch(() => []);
}

export async function waitForCaptionMenu(
  page: Page,
  timeoutMs: number
): Promise<{ ready: boolean; labels: string[] }> {
  const option = page.locator('.bpx-player-ctrl-subtitle-language-item[data-lan="ai-zh"]').first();
  const deadline = Date.now() + timeoutMs;
  let labels: string[] = [];
  do {
    labels = await visibleCaptionLabels(page);
    if (await option.isVisible().catch(() => false)) return { ready: true, labels };
    await delay(POLL_MS);
  } while (Date.now() < deadline);
  return { ready: false, labels };
}

export async function captionOptionSelected(option: Locator): Promise<boolean> {
  return option.evaluate((element) => {
    const className = typeof element.className === 'string' ? element.className : '';
    return element.getAttribute('aria-selected') === 'true' ||
      element.getAttribute('aria-checked') === 'true' ||
      /(?:^|[-_\s])(?:active|selected|checked|current|on)(?:$|[-_\s])/i.test(className);
  }).catch(() => false);
}

export async function visibleSubtitlePanel(page: Page): Promise<boolean> {
  return page.locator('.bili-subtitle-x-subtitle-panel')
    .filter({ hasText: /\S/ })
    .first()
    .isVisible()
    .catch(() => false);
}

export function captionOptionLabel(value: string): string | null {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (/^中文/.test(compact)) return '中文';
  if (/^汉语/.test(compact)) return '汉语';
  return null;
}
