import {
  bilibiliTranscriptResearchRouteIds,
  type NetworkCaptureObservation
} from '../shared/network-capture';
import {
  BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID,
  type BilibiliTranscriptDocumentProjection
} from '../shared/transcript-capture';
import type { BilibiliVideoDetailDomObservation, ExtensionWorkItem } from '@intelligence/collector-contracts';
import type { ExtensionWorkTabLease } from './extension-work-tabs';
import {
  armNetworkCapture,
  clearNetworkCaptureObservations,
  getActiveNetworkCaptureArm,
  readNetworkCaptures
} from './network-capture-runtime';

const DEBUGGER_PROTOCOL_VERSION = '1.3';
const CONTROL_REVEAL_TIMEOUT_MS = 2_500;
const MENU_REVEAL_TIMEOUT_MS = 2_500;
const SELECTION_SETTLE_TIMEOUT_MS = 4_000;
const RESPONSE_TIMEOUT_MS = 10_000;
const PROBE_INTERVAL_MS = 200;
const MOUSE_MOVE_SETTLE_MS = 100;
const CLICK_HOLD_MS = 100;
const POST_CLICK_SETTLE_MS = 150;

export interface SubtitleCaptureResult {
  available: boolean;
  language: string | null;
  panelVisible: boolean;
  segmentCount: number;
  partial: boolean;
  segments: Array<{ from: number; to: number; text: string }>;
}

interface PlayerProbe {
  playerAreaPresent: boolean;
  captionControlAttached: boolean;
  captionControlVisuallyExposed: boolean;
  chineseOptionVisible: boolean;
  chineseOptionActive: boolean;
  chineseOptionLanguage: string | null;
  subtitlePanelVisible: boolean;
  videoArea: { x: number; y: number } | null;
  captionControl: { x: number; y: number } | null;
  chineseOption: { x: number; y: number } | null;
}

type DetailItem = Extract<ExtensionWorkItem, { capability: 'bilibili.video_detail' }>;

export async function armBilibiliSubtitleCapture(
  workTab: ExtensionWorkTabLease,
  item: DetailItem
): Promise<void> {
  const contentScriptId = `collector-transcript-${item.workId.replace(/-/g, '')}`;
  await chrome.scripting.unregisterContentScripts({ ids: [contentScriptId] }).catch(() => undefined);
  await chrome.scripting.registerContentScripts([{
    id: contentScriptId,
    matches: ['https://www.bilibili.com/video/*'],
    js: ['network-capture-bridge.js'],
    runAt: 'document_start',
    allFrames: false,
    persistAcrossSessions: false,
    world: 'ISOLATED'
  }]);
  await armNetworkCapture({
    tabId: workTab.tabId,
    platform: 'bilibili',
    purpose: 'bilibili_transcript_strategy',
    runId: item.operationId,
    navigationUrl: item.input.canonicalVideoUrl,
    routeIds: bilibiliTranscriptResearchRouteIds(),
    maximumObservations: item.budget.maximumResponseObservations,
    expiresAt: Date.parse(item.expiresAt),
    observerBindingId: item.workId,
    contentScriptId
  });
}

export async function captureBilibiliSubtitle(
  workTab: ExtensionWorkTabLease,
  item: DetailItem,
  base: BilibiliVideoDetailDomObservation
): Promise<BilibiliVideoDetailDomObservation> {
  const arm = await getActiveNetworkCaptureArm(workTab.tabId);
  if (!arm) return withSubtitle(base, { ...emptySubtitle(), available: base.subtitle.available });
  let probe = await waitForPlayerProbe(workTab, Math.min(Date.parse(item.expiresAt), Date.now() + 8_000));
  if (!probe.playerAreaPresent || !probe.captionControlAttached) {
    return withSubtitle(base, { ...emptySubtitle(), available: probe.captionControlAttached || base.subtitle.available });
  }
  let debuggee: chrome.debugger.Debuggee | null = { tabId: workTab.tabId };
  try {
    await chrome.debugger.attach(debuggee, DEBUGGER_PROTOCOL_VERSION);
    if (!probe.captionControlVisuallyExposed && probe.videoArea) {
      await mouseMove(debuggee, probe.videoArea);
      probe = await waitForPlayerProbe(workTab, CONTROL_REVEAL_TIMEOUT_MS);
    }
    if (!probe.chineseOptionVisible && probe.captionControl) {
      await mouseMove(debuggee, probe.captionControl);
      probe = await waitForPlayerProbe(workTab, MENU_REVEAL_TIMEOUT_MS);
    }
    if ((!probe.chineseOptionActive || !probe.subtitlePanelVisible) && probe.chineseOption) {
      await mouseClick(debuggee, probe.chineseOption);
      probe = await waitForPlayerProbe(workTab, SELECTION_SETTLE_TIMEOUT_MS);
    }
    const language = probe.chineseOptionActive ? probe.chineseOptionLanguage ?? 'ai-zh' : null;
    const segments = await readTranscriptSegments(workTab, arm, item);
    return withSubtitle(base, {
      available: probe.captionControlAttached || segments.length > 0 || base.subtitle.available,
      language,
      panelVisible: probe.subtitlePanelVisible,
      segmentCount: segments.length,
      partial: segments.length > 0 && probe.subtitlePanelVisible !== true,
      segments
    });
  } catch {
    return withSubtitle(base, {
      ...emptySubtitle(),
      available: probe.captionControlAttached || base.subtitle.available,
      panelVisible: probe.subtitlePanelVisible
    });
  } finally {
    if (debuggee) {
      try { await chrome.debugger.detach(debuggee); } catch { /* already detached */ }
    }
    await clearNetworkCaptureObservations(workTab.tabId).catch(() => undefined);
  }
}

function withSubtitle(
  base: BilibiliVideoDetailDomObservation,
  subtitle: BilibiliVideoDetailDomObservation['subtitle']
): BilibiliVideoDetailDomObservation {
  return { ...base, subtitle };
}

function emptySubtitle(): BilibiliVideoDetailDomObservation['subtitle'] {
  return {
    available: false,
    language: null,
    panelVisible: false,
    segmentCount: 0,
    partial: false,
    segments: []
  };
}

async function waitForPlayerProbe(workTab: ExtensionWorkTabLease, deadlineMs: number): Promise<PlayerProbe> {
  const deadline = Date.now() + deadlineMs;
  let latest: PlayerProbe | null = null;
  while (Date.now() < deadline) {
    latest = await readPlayerProbe(workTab.tabId);
    if (latest.captionControlAttached && (latest.captionControlVisuallyExposed || latest.chineseOptionVisible)) {
      return latest;
    }
    await delay(PROBE_INTERVAL_MS);
  }
  return latest ?? {
    playerAreaPresent: false,
    captionControlAttached: false,
    captionControlVisuallyExposed: false,
    chineseOptionVisible: false,
    chineseOptionActive: false,
    chineseOptionLanguage: null,
    subtitlePanelVisible: false,
    videoArea: null,
    captionControl: null,
    chineseOption: null
  };
}

async function readPlayerProbe(tabId: number): Promise<PlayerProbe> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const visible = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 &&
          style.display !== 'none' && style.visibility !== 'hidden' &&
          Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const point = (element: HTMLElement | null, videoArea = false) => {
        if (!visible(element)) return null;
        const rect = element.getBoundingClientRect();
        const x = Math.floor(rect.x + rect.width / 2);
        const y = videoArea
          ? Math.max(rect.y + 1, Math.floor(rect.y + rect.height - Math.min(16, rect.height / 4)))
          : Math.floor(rect.y + rect.height / 2);
        const hit = document.elementFromPoint(x, y);
        if (!hit || (hit !== element && !element.contains(hit))) return null;
        return { x, y };
      };
      const playerArea = document.querySelector<HTMLElement>('.bpx-player-video-area');
      const controlBar = document.querySelector<HTMLElement>('.bpx-player-control-bottom');
      const captionControl = document.querySelector<HTMLElement>('.bpx-player-ctrl-subtitle');
      const chineseOption = document.querySelector<HTMLElement>(
        '.bpx-player-ctrl-subtitle-language-item[data-lan="ai-zh"]'
      );
      const subtitlePanel = document.querySelector<HTMLElement>('.bili-subtitle-x-subtitle-panel');
      const controlBarVisible = visible(controlBar) &&
        Number.parseFloat(getComputedStyle(controlBar).opacity || '1') > 0.5;
      return {
        playerAreaPresent: Boolean(playerArea && visible(playerArea)),
        captionControlAttached: Boolean(captionControl),
        captionControlVisuallyExposed: Boolean(captionControl && visible(captionControl) && controlBarVisible),
        chineseOptionVisible: Boolean(chineseOption && visible(chineseOption)),
        chineseOptionActive: Boolean(chineseOption && (
          chineseOption.classList.contains('bpx-state-active') ||
          chineseOption.getAttribute('aria-selected') === 'true' ||
          chineseOption.getAttribute('data-state') === 'active'
        )),
        chineseOptionLanguage: chineseOption && visible(chineseOption)
          ? chineseOption.getAttribute('data-lan')
          : null,
        subtitlePanelVisible: Boolean(subtitlePanel && visible(subtitlePanel)),
        videoArea: point(playerArea, true),
        captionControl: point(captionControl),
        chineseOption: point(chineseOption)
      };
    }
  });
  const value = results[0]?.result as PlayerProbe | undefined;
  if (!value || typeof value.playerAreaPresent !== 'boolean') {
    throw new Error('bilibili_subtitle_player_probe_invalid');
  }
  return value;
}

async function readTranscriptSegments(
  workTab: ExtensionWorkTabLease,
  arm: NonNullable<Awaited<ReturnType<typeof getActiveNetworkCaptureArm>>>,
  item: DetailItem
): Promise<Array<{ from: number; to: number; text: string }>> {
  const deadline = Math.min(Date.parse(item.expiresAt), Date.now() + RESPONSE_TIMEOUT_MS);
  let latest: NetworkCaptureObservation[] = [];
  while (Date.now() < deadline) {
    latest = await readNetworkCaptures(workTab.tabId, arm);
    const document = latest.find((entry) =>
      entry.status === 'captured' && entry.routeId === BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID
    );
    if (document?.body) {
      const projection = document.body as BilibiliTranscriptDocumentProjection;
      return projection.segments.map((segment) => ({
        from: segment.from,
        to: segment.to,
        text: segment.content
      }));
    }
    await delay(250);
  }
  return [];
}

async function mouseMove(debuggee: chrome.debugger.Debuggee, point: { x: number; y: number }): Promise<void> {
  await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x, y: point.y
  });
  await delay(MOUSE_MOVE_SETTLE_MS);
}

async function mouseClick(debuggee: chrome.debugger.Debuggee, point: { x: number; y: number }): Promise<void> {
  await mouseMove(debuggee, point);
  await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1
  });
  await delay(CLICK_HOLD_MS);
  await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1
  });
  await delay(POST_CLICK_SETTLE_MS);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
