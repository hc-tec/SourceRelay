import type { Page } from 'playwright';
import type { BilibiliTranscriptInteractionDomState } from '@intelligence/collector-contracts';

export interface BilibiliTranscriptBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BilibiliTranscriptPointerTarget {
  bounds: BilibiliTranscriptBounds;
  pointer: {
    x: number;
    y: number;
  };
  pointerHitTarget: boolean;
}

export interface BilibiliTranscriptDomProbe {
  dom: BilibiliTranscriptInteractionDomState;
  videoArea: BilibiliTranscriptPointerTarget | null;
  captionControl: BilibiliTranscriptPointerTarget | null;
  chineseOption: BilibiliTranscriptPointerTarget | null;
}

interface RawPointerTarget extends BilibiliTranscriptPointerTarget {}

interface RawTranscriptProbe {
  dom: BilibiliTranscriptInteractionDomState;
  videoArea: RawPointerTarget | null;
  captionControl: RawPointerTarget | null;
  chineseOption: RawPointerTarget | null;
}

const MAXIMUM_VIEWPORT_BOUND = 20_000;

/**
 * Reads only the small, source-specific interaction surface needed for the
 * fixed Chinese-caption flow. It deliberately never reads page application
 * state, credentials, storage, request data, or response bodies.
 */
export async function readBilibiliTranscriptDomProbe(
  page: Page,
  timeoutMs: number
): Promise<BilibiliTranscriptDomProbe> {
  const value = await withinDeadline(page.evaluate(() => {
    const visible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        Number.parseFloat(style.opacity || '1') > 0.01;
    };
    const bound = (element: HTMLElement): BilibiliTranscriptBounds => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    const target = (element: HTMLElement | null, useVideoAreaPoint = false) => {
      if (!visible(element)) return null;
      const bounds = bound(element);
      const x = Math.floor(bounds.x + bounds.width / 2);
      const y = useVideoAreaPoint
        ? Math.max(bounds.y + 1, Math.floor(bounds.y + bounds.height - Math.min(16, bounds.height / 4)))
        : Math.floor(bounds.y + bounds.height / 2);
      const hit = document.elementFromPoint(x, y);
      return {
        bounds,
        pointer: { x, y },
        pointerHitTarget: Boolean(hit && (hit === element || element.contains(hit)))
      };
    };
    const playerArea = document.querySelector<HTMLElement>('.bpx-player-video-area');
    const controlBar = document.querySelector<HTMLElement>('.bpx-player-control-bottom');
    const captionControl = document.querySelector<HTMLElement>('.bpx-player-ctrl-subtitle');
    const chineseOption = document.querySelector<HTMLElement>(
      '.bpx-player-ctrl-subtitle-language-item[data-lan="ai-zh"]'
    );
    const subtitlePanel = document.querySelector<HTMLElement>('.bili-subtitle-x-subtitle-panel');
    const controlBarVisible = visible(controlBar) && Number.parseFloat(getComputedStyle(controlBar).opacity || '1') > 0.5;
    const loginRoots = Array.from(document.querySelectorAll<HTMLElement>(
      '.bili-mini-mask, .bili-mini-login, .passport-login-container, [role="dialog"]'
    ));
    const authenticationRequired = loginRoots.some((root) => {
      if (!visible(root)) return false;
      const text = (root.textContent ?? '').replace(/\s+/g, '');
      return /扫码登录|密码登录|短信登录/.test(text);
    });
    const visiblePageText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 100_000);
    return {
      dom: {
        authenticationRequired,
        verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(visiblePageText),
        rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(visiblePageText),
        sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(visiblePageText),
        playerAreaPresent: Boolean(playerArea && visible(playerArea)),
        captionControlAttached: Boolean(captionControl),
        captionControlVisuallyExposed: Boolean(captionControl && visible(captionControl) && controlBarVisible),
        chineseOptionVisible: Boolean(chineseOption && visible(chineseOption)),
        chineseOptionActive: Boolean(chineseOption && (
          chineseOption.classList.contains('bpx-state-active') ||
          chineseOption.getAttribute('aria-selected') === 'true' ||
          chineseOption.getAttribute('data-state') === 'active'
        )),
        subtitlePanelVisible: Boolean(subtitlePanel && visible(subtitlePanel))
      },
      videoArea: target(playerArea, true),
      captionControl: target(captionControl),
      chineseOption: target(chineseOption)
    };
  }), timeoutMs);
  return validateProbe(value);
}

function validateProbe(value: unknown): BilibiliTranscriptDomProbe {
  if (!value || typeof value !== 'object') throw new Error('bilibili_transcript_dom_probe_invalid');
  const candidate = value as Partial<RawTranscriptProbe>;
  const dom = candidate.dom;
  if (!dom || typeof dom !== 'object' ||
    ![
      dom.authenticationRequired,
      dom.verificationRequired,
      dom.rateLimited,
      dom.sourceUnavailable,
      dom.playerAreaPresent,
      dom.captionControlAttached,
      dom.captionControlVisuallyExposed,
      dom.chineseOptionVisible,
      dom.chineseOptionActive,
      dom.subtitlePanelVisible
    ].every((entry) => typeof entry === 'boolean')) {
    throw new Error('bilibili_transcript_dom_probe_invalid');
  }
  return {
    dom: {
      authenticationRequired: dom.authenticationRequired,
      verificationRequired: dom.verificationRequired,
      rateLimited: dom.rateLimited,
      sourceUnavailable: dom.sourceUnavailable,
      playerAreaPresent: dom.playerAreaPresent,
      captionControlAttached: dom.captionControlAttached,
      captionControlVisuallyExposed: dom.captionControlVisuallyExposed,
      chineseOptionVisible: dom.chineseOptionVisible,
      chineseOptionActive: dom.chineseOptionActive,
      subtitlePanelVisible: dom.subtitlePanelVisible
    },
    videoArea: validatePointerTarget(candidate.videoArea),
    captionControl: validatePointerTarget(candidate.captionControl),
    chineseOption: validatePointerTarget(candidate.chineseOption)
  };
}

function validatePointerTarget(value: unknown): BilibiliTranscriptPointerTarget | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new Error('bilibili_transcript_dom_probe_invalid');
  const candidate = value as Partial<BilibiliTranscriptPointerTarget>;
  const bounds = candidate.bounds;
  const pointer = candidate.pointer;
  if (!bounds || !pointer ||
    ![bounds.x, bounds.y, bounds.width, bounds.height, pointer.x, pointer.y].every(Number.isSafeInteger) ||
    bounds.width < 1 || bounds.height < 1 ||
    bounds.width > MAXIMUM_VIEWPORT_BOUND || bounds.height > MAXIMUM_VIEWPORT_BOUND ||
    pointer.x < 0 || pointer.y < 0 ||
    typeof candidate.pointerHitTarget !== 'boolean') {
    throw new Error('bilibili_transcript_dom_probe_invalid');
  }
  return {
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    pointer: { x: pointer.x, y: pointer.y },
    pointerHitTarget: candidate.pointerHitTarget
  };
}

async function withinDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('bilibili_transcript_dom_probe_deadline_exceeded')), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
