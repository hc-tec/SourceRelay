import {
  TRANSCRIPT_CONTENT_READY,
  TRANSCRIPT_INTERACTION_RESULT,
  type TranscriptInteractionAction,
  type TranscriptInteractionActionResult,
  type TranscriptInteractionResult
} from '../shared/protocol';
import { canonicalBilibiliVideoUrl } from '../shared/bilibili-video-url';

const CONTROL_WAIT_MS = 10_000;
const MENU_READY_MS = 2_500;
const ACTION_TAIL_MS = 3_000;
const POLL_MS = 100;
const marker = 'collectorTranscriptValidationStarted';

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function visible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none' && element.getClientRects().length > 0;
}

function compactText(element: Element): string {
  return (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function allVisibleElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll('button,[role="button"],[role="menuitem"],[aria-label],[title],span,div'))
    .filter(visible);
}

function relevantLabels(pattern: RegExp): string[] {
  return [...new Set(allVisibleElements().map(compactText).filter((label) => pattern.test(label)))].slice(0, 40);
}

function smallestVisibleExact(label: string): HTMLElement | null {
  return allVisibleElements()
    .filter((element) => compactText(element) === label)
    .sort((left, right) => left.getBoundingClientRect().width * left.getBoundingClientRect().height -
      right.getBoundingClientRect().width * right.getBoundingClientRect().height)[0] ?? null;
}

function captionControl(): HTMLElement | null {
  const candidates = [
    document.querySelector('.bpx-player-ctrl-subtitle'),
    ...Array.from(document.querySelectorAll('[aria-label*="字幕"],[title*="字幕"]'))
  ];
  return candidates.filter((element): element is HTMLElement => Boolean(element) && visible(element!))[0] ??
    smallestVisibleExact('字幕');
}

function chineseSubtitleOption(): HTMLElement | null {
  const exact = Array.from(document.querySelectorAll<HTMLElement>(
    '.bpx-player-ctrl-subtitle-language-item[data-lan="ai-zh"]'
  )).find(visible);
  if (exact) return exact;
  return Array.from(document.querySelectorAll<HTMLElement>('.bpx-player-ctrl-subtitle-language-item'))
    .filter(visible)
    .find((element) => /^(?:中文|汉语)(?:[（(].{1,30}[）)])?$/.test(compactText(element))) ?? null;
}

function subtitleOptionSelected(option: HTMLElement): boolean {
  const className = typeof option.className === 'string' ? option.className : '';
  const panel = document.querySelector('.bili-subtitle-x-subtitle-panel');
  return option.getAttribute('aria-selected') === 'true' ||
    option.getAttribute('aria-checked') === 'true' ||
    /(?:^|[-_\s])(?:active|selected|checked|current|on)(?:$|[-_\s])/i.test(className) ||
    Boolean(panel && visible(panel) && compactText(panel).length > 0);
}

function pageRiskDetected(): boolean {
  const candidates = Array.from(document.querySelectorAll(
    '[class*="captcha"],[class*="geetest"],[class*="risk-control"],[class*="risk_control"],[id*="captcha"]'
  )).filter(visible);
  return candidates.some((element) => /验证码|访问异常|风控|安全验证|操作频繁/.test(compactText(element)));
}

async function waitForControl(): Promise<HTMLElement | null> {
  const deadline = Date.now() + CONTROL_WAIT_MS;
  while (Date.now() < deadline) {
    if (pageRiskDetected()) return null;
    const control = captionControl();
    if (control) return control;
    await delay(POLL_MS);
  }
  return null;
}

async function waitForMenu(): Promise<{ ready: boolean; labels: string[] }> {
  const pattern = /^(?:关闭|字幕设置|字幕大小(?: .*)?|字幕颜色(?: .*)?|(?:中文|汉语)(?:[（(].{1,30}[）)])?|(?:中文|汉语).*(?:自动生成|AI).*)$/;
  const deadline = Date.now() + MENU_READY_MS;
  let labels: string[] = [];
  while (Date.now() < deadline) {
    if (pageRiskDetected()) return { ready: false, labels: [] };
    labels = relevantLabels(pattern);
    if (labels.some((label) => /^(?:关闭|字幕设置|中文|汉语)/.test(label))) return { ready: true, labels };
    await delay(POLL_MS);
  }
  return { ready: false, labels };
}

function action(
  actionName: TranscriptInteractionAction,
  attempted: boolean,
  outcome: TranscriptInteractionActionResult['outcome'],
  input: Partial<Pick<TranscriptInteractionActionResult, 'visibleLabels' | 'selectedLabel' | 'postconditionAcknowledged'>> = {}
): TranscriptInteractionActionResult {
  return {
    action: actionName,
    attempted,
    outcome,
    visibleLabels: input.visibleLabels ?? [],
    selectedLabel: input.selectedLabel ?? null,
    postconditionAcknowledged: input.postconditionAcknowledged ?? null
  };
}

async function run(): Promise<TranscriptInteractionResult> {
  const canonicalUrl = canonicalBilibiliVideoUrl(window.location.href, 'observed_document');
  if (!canonicalUrl) throw new Error('transcript_validation_url_invalid');
  const actions: TranscriptInteractionActionResult[] = [];
  const requiredActions: TranscriptInteractionAction[] = ['open_caption_menu', 'select_caption_language'];
  if (pageRiskDetected()) {
    actions.push(action('open_caption_menu', false, 'risk_detected'));
  } else {
    const control = await waitForControl();
    if (!control) {
      actions.push(action('open_caption_menu', false, pageRiskDetected() ? 'risk_detected' : 'control_missing'));
    } else {
      // The real player exposes this menu on a trusted pointer hover. Content
      // scripts cannot synthesize CSS :hover state, so activating the verified
      // tabindex control is the bounded extension equivalent.
      control.click();
      const menu = await waitForMenu();
      actions.push(action(
        'open_caption_menu',
        true,
        menu.ready ? 'completed' : 'postcondition_unmet',
        { visibleLabels: menu.labels, postconditionAcknowledged: menu.ready }
      ));
      if (!menu.ready) {
        actions.push(action('select_caption_language', false, 'prerequisite_unmet'));
      } else {
        const labels = relevantLabels(/^(?:中文|汉语)(?:[（(].{1,30}[）)])?$/)
          .sort((left, right) => left.length - right.length);
        const option = chineseSubtitleOption();
        const selectedLabel = option ? compactText(option) : labels[0] ?? null;
        if (!selectedLabel || !option) {
          actions.push(action('select_caption_language', false, 'option_unavailable', {
            visibleLabels: labels,
            selectedLabel
          }));
        } else if (subtitleOptionSelected(option)) {
          actions.push(action('select_caption_language', false, 'completed', {
            visibleLabels: labels,
            selectedLabel,
            postconditionAcknowledged: true
          }));
        } else {
          option.click();
          await delay(ACTION_TAIL_MS);
          const acknowledged = subtitleOptionSelected(option);
          actions.push(action(
            'select_caption_language',
            true,
            acknowledged ? 'completed' : 'postcondition_unmet',
            { visibleLabels: labels, selectedLabel, postconditionAcknowledged: acknowledged }
          ));
        }
      }
    }
  }
  const completedActions = actions.filter((candidate) => candidate.outcome === 'completed').map((candidate) => candidate.action);
  const objectiveStatus = completedActions.length === requiredActions.length
    ? 'satisfied'
    : completedActions.length > 0
      ? 'partial'
      : 'not_satisfied';
  return {
    schemaVersion: 1,
    canonicalUrl,
    state: objectiveStatus === 'satisfied' ? 'completed' : 'inconclusive',
    objective: { status: objectiveStatus, requiredActions, completedActions },
    actions,
    errorCode: null,
    completedAt: new Date().toISOString()
  };
}

async function start(): Promise<void> {
  let response: { ok?: boolean; armed?: boolean } | undefined;
  const readinessDeadline = Date.now() + 2_000;
  while (Date.now() < readinessDeadline) {
    response = await chrome.runtime.sendMessage({ type: TRANSCRIPT_CONTENT_READY }).catch(() => undefined);
    if (response?.ok && response.armed === true) break;
    await delay(POLL_MS);
  }
  if (!response?.ok || response.armed !== true) return;
  let result: TranscriptInteractionResult;
  try {
    result = await run();
  } catch (error) {
    result = {
      schemaVersion: 1,
      canonicalUrl: canonicalBilibiliVideoUrl(window.location.href, 'observed_document') ??
        'https://www.bilibili.com/',
      state: 'failed',
      objective: {
        status: 'not_satisfied',
        requiredActions: ['open_caption_menu', 'select_caption_language'],
        completedActions: []
      },
      actions: [],
      errorCode: error instanceof Error && /^[a-z0-9_]{1,100}$/.test(error.message)
        ? error.message
        : 'transcript_validation_interaction_failed',
      completedAt: new Date().toISOString()
    };
  }
  await chrome.runtime.sendMessage({ type: TRANSCRIPT_INTERACTION_RESULT, result }).catch(() => undefined);
}

if (document.documentElement.dataset[marker] !== 'true') {
  document.documentElement.dataset[marker] = 'true';
  void start().catch(() => undefined);
}

void TRANSCRIPT_CONTENT_READY;
void TRANSCRIPT_INTERACTION_RESULT;
