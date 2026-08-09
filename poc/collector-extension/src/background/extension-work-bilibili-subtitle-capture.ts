import {
  bilibiliTranscriptResearchRouteIds,
  type NetworkCaptureObservation
} from '../shared/network-capture';
import {
  BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID,
  BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID,
  type BilibiliTranscriptDirectoryProjection,
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
// The player can publish an empty legacy directory before the language-menu
// click causes the current protobuf directory and CDN document to arrive.
// Never turn that first response into a final "no subtitles" answer.
const EMPTY_DIRECTORY_CONFIRMATION_GRACE_MS = 4_000;
const ARM_LIFETIME_MS = 60_000;
const PROBE_INTERVAL_MS = 200;
const MOUSE_MOVE_SETTLE_MS = 250;
const CLICK_HOLD_MS = 180;
const POST_CLICK_SETTLE_MS = 500;
const STEP_SETTLE_MS = 700;
const MENU_POINTER_SETTLE_MS = 350;
// A hover-owned menu closes if the pointer pauses in the hit-test gap between
// the trigger and the floating language list. Keep the path browser-level but
// continuous; only settle after the final target is reached.
const POINTER_TRAVEL_STEP_MS = 12;
const POINTER_TRAVEL_MAX_STEPS = 10;

export interface SubtitleCaptureResult {
  available: boolean;
  language: string | null;
  panelVisible: boolean;
  segmentCount: number;
  partial: boolean;
  segments: Array<{ from: number; to: number; text: string }>;
}

type TranscriptReadResult =
  | {
      state: 'confirmed_no_subtitle';
      segments: [];
      partial: false;
    }
  | {
      state: 'captured';
      segments: Array<{ from: number; to: number; text: string }>;
      partial: boolean;
    }
  | {
      state: 'unknown';
      segments: [];
      partial: true;
    };

interface PlayerProbe {
  playerAreaPresent: boolean;
  captionControlAttached: boolean;
  captionControlVisuallyExposed: boolean;
  chineseOptionVisible: boolean;
  chineseOptionHovered: boolean;
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
    expiresAt: Math.min(Date.parse(item.expiresAt), Date.now() + ARM_LIFETIME_MS),
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
  if (!arm) {
    return withSubtitle(base, {
      ...emptySubtitle(),
      captureStatus: 'no_arm',
      available: base.subtitle.available,
      partial: true
    });
  }
  // Real Bilibili pages can expose the title/video shell several seconds
  // before the player control tree is attached.  The live canary observed a
  // visible player but no caption control within the old 8-second window,
  // producing a false `player_unavailable`.  Keep the wait bounded by the
  // signed work deadline while allowing the proven delayed-mount range.
  let probe = await waitForPlayerProbe(workTab, remainingProbeBudget(item.expiresAt, 10_000));
  if (!probe.playerAreaPresent || !probe.captionControlAttached) {
    return withSubtitle(base, {
      ...emptySubtitle(),
      captureStatus: 'player_unavailable',
      available: probe.captionControlAttached || base.subtitle.available,
      partial: true
    });
  }
  let debuggee: chrome.debugger.Debuggee | null = { tabId: workTab.tabId };
  try {
    await chrome.debugger.attach(debuggee, DEBUGGER_PROTOCOL_VERSION);
    if (!probe.captionControlVisuallyExposed && probe.videoArea) {
      await mouseMove(debuggee, probe.videoArea);
      await delay(STEP_SETTLE_MS);
      probe = await waitForPlayerProbe(workTab, CONTROL_REVEAL_TIMEOUT_MS);
    }
    if (!probe.chineseOptionVisible && probe.captionControl) {
      // Bilibili reveals the language menu from a trusted hover. Clicking the
      // control is the bounded fallback for the logged-in desktop player:
      // current builds can flash the hover menu and immediately close it until
      // the subtitle control itself has been enabled once.
      await mouseMove(debuggee, probe.captionControl);
      await delay(STEP_SETTLE_MS);
      probe = await waitForMenuProbe(workTab, MENU_REVEAL_TIMEOUT_MS);
      if (!probe.chineseOptionVisible && !probe.subtitlePanelVisible && probe.captionControl) {
        await mouseClick(debuggee, probe.captionControl, true);
        probe = await waitForMenuProbe(workTab, MENU_REVEAL_TIMEOUT_MS);
      }
    }
    if (!probe.chineseOption && !probe.subtitlePanelVisible) {
      return withSubtitle(base, {
        ...emptySubtitle(),
        captureStatus: 'menu_unavailable',
        available: probe.captionControlAttached || base.subtitle.available,
        panelVisible: probe.subtitlePanelVisible
      });
    }
    if ((!probe.chineseOptionActive || !probe.subtitlePanelVisible) && probe.chineseOption) {
      // The language menu is hover-owned. A single CDP mouseMoved from the
      // button straight to the item can cross the menu's hit-test gap, causing
      // Bilibili to close the popup before the click arrives. Walk the pointer
      // through the real path and require the final parent node to remain
      // hovered before spending the one allowed click.
      if (probe.captionControl) {
        await mouseMoveAlongPath(debuggee, probe.captionControl, probe.chineseOption);
      } else {
        await mouseMove(debuggee, probe.chineseOption);
      }
      await delay(MENU_POINTER_SETTLE_MS);
      probe = await readPlayerProbe(workTab.tabId);
      if (!probe.chineseOptionVisible || !probe.chineseOptionHovered || !probe.chineseOption) {
        return withSubtitle(base, {
          ...emptySubtitle(),
          captureStatus: 'menu_unavailable',
          available: probe.captionControlAttached || base.subtitle.available,
          panelVisible: probe.subtitlePanelVisible,
          partial: true
        });
      }
      await mouseClick(debuggee, probe.chineseOption, true);
      await delay(STEP_SETTLE_MS);
      probe = await waitForSelectionProbe(workTab, SELECTION_SETTLE_TIMEOUT_MS);
      if (!probe.chineseOptionActive || !probe.subtitlePanelVisible) {
        return withSubtitle(base, {
          ...emptySubtitle(),
          captureStatus: 'menu_unavailable',
          available: probe.captionControlAttached || base.subtitle.available,
          panelVisible: probe.subtitlePanelVisible,
          language: probe.chineseOptionLanguage
        });
      }
    }
    const language = probe.chineseOptionActive ? probe.chineseOptionLanguage ?? 'ai-zh' : null;
    const transcript = await readTranscriptSegments(workTab, arm, item);
    if (transcript.state === 'confirmed_no_subtitle') {
      return withSubtitle(base, {
        ...emptySubtitle(),
        captureStatus: 'confirmed_no_subtitle',
        available: false,
        language,
        panelVisible: probe.subtitlePanelVisible
      });
    }
    return withSubtitle(base, {
      captureStatus: transcript.state === 'captured' ? 'captured' : 'transcript_timeout',
      available: probe.captionControlAttached || transcript.segments.length > 0 || base.subtitle.available,
      language,
      panelVisible: probe.subtitlePanelVisible,
      segmentCount: transcript.segments.length,
      partial: transcript.partial,
      segments: transcript.segments
    });
  } catch {
    return withSubtitle(base, {
      ...emptySubtitle(),
      captureStatus: 'capture_failed',
      available: probe.captionControlAttached || base.subtitle.available,
      panelVisible: probe.subtitlePanelVisible,
      partial: true
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
  const deadline = Date.now() + Math.max(0, deadlineMs);
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
    chineseOptionHovered: false,
    chineseOptionActive: false,
    chineseOptionLanguage: null,
    subtitlePanelVisible: false,
    videoArea: null,
    captionControl: null,
    chineseOption: null
  };
}

async function waitForMenuProbe(workTab: ExtensionWorkTabLease, deadlineMs: number): Promise<PlayerProbe> {
  const deadline = Date.now() + Math.max(0, deadlineMs);
  let latest: PlayerProbe | null = null;
  while (Date.now() < deadline) {
    latest = await readPlayerProbe(workTab.tabId);
    if (latest.chineseOptionVisible || latest.subtitlePanelVisible) return latest;
    await delay(PROBE_INTERVAL_MS);
  }
  return latest ?? waitProbeFallback();
}

async function waitForSelectionProbe(workTab: ExtensionWorkTabLease, deadlineMs: number): Promise<PlayerProbe> {
  const deadline = Date.now() + Math.max(0, deadlineMs);
  let latest: PlayerProbe | null = null;
  while (Date.now() < deadline) {
    latest = await readPlayerProbe(workTab.tabId);
    if (latest.chineseOptionActive && latest.subtitlePanelVisible) return latest;
    await delay(PROBE_INTERVAL_MS);
  }
  return latest ?? waitProbeFallback();
}

function waitProbeFallback(): PlayerProbe {
  return {
    playerAreaPresent: false,
    captionControlAttached: false,
    captionControlVisuallyExposed: false,
    chineseOptionVisible: false,
    chineseOptionHovered: false,
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
      // Keep the target inside Bilibili's language-menu subtree. A global
      // `[data-lan]`/subtitle-item query also matches style-setting controls
      // and can turn a visible parent label into a false Chinese option.
      const languageOptions = Array.from(document.querySelectorAll<HTMLElement>(
        '.bpx-player-ctrl-subtitle-language-item, .bpx-player-ctrl-subtitle-language [data-lan]'
      ));
      const chineseOption = languageOptions.find((element) => {
        if (!visible(element)) return false;
        const lan = element.getAttribute('data-lan') ?? '';
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
        return lan === 'ai-zh' || /^(?:中文|汉语|AI\s*字幕)(?:[（(][^）)]{1,30}[）)])?$/.test(text);
      }) ?? null;
      const subtitlePanel = document.querySelector<HTMLElement>('.bili-subtitle-x-subtitle-panel');
      const controlBarVisible = visible(controlBar) &&
        Number.parseFloat(getComputedStyle(controlBar).opacity || '1') > 0.5;
      return {
        playerAreaPresent: Boolean(playerArea && visible(playerArea)),
        captionControlAttached: Boolean(captionControl),
        captionControlVisuallyExposed: Boolean(captionControl && visible(captionControl) && controlBarVisible),
        chineseOptionVisible: Boolean(chineseOption && visible(chineseOption)),
        chineseOptionHovered: Boolean(chineseOption && visible(chineseOption) && chineseOption.matches(':hover')),
        chineseOptionActive: Boolean(chineseOption && (
          chineseOption.classList.contains('bpx-state-active') ||
          chineseOption.getAttribute('aria-selected') === 'true' ||
          chineseOption.getAttribute('data-state') === 'active'
        )),
        chineseOptionLanguage: chineseOption
          ? chineseOption.getAttribute('data-lan') ?? 'ai-zh'
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

function remainingProbeBudget(expiresAt: string, maximumMs: number): number {
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline)) return 0;
  return Math.max(0, Math.min(maximumMs, deadline - Date.now()));
}

async function readTranscriptSegments(
  workTab: ExtensionWorkTabLease,
  arm: NonNullable<Awaited<ReturnType<typeof getActiveNetworkCaptureArm>>>,
  item: DetailItem
): Promise<TranscriptReadResult> {
  const deadline = Math.min(Date.parse(item.expiresAt), Date.now() + RESPONSE_TIMEOUT_MS);
  let latest: NetworkCaptureObservation[] = [];
  let emptyDirectorySeenAt: number | null = null;
  while (Date.now() < deadline) {
    latest = await readNetworkCaptures(workTab.tabId, arm);
    const directory = latest.find((entry) =>
      entry.status === 'captured' && entry.routeId === BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID
    );
    if (directory?.body) {
      const projection = directory.body as unknown as BilibiliTranscriptDirectoryProjection;
      if (projection.artifactKind === 'bilibili_transcript_track_directory' &&
        projection.sourceTrackCount === 0 && projection.storedTrackCount === 0) {
        emptyDirectorySeenAt ??= Date.now();
      } else if (projection.artifactKind === 'bilibili_transcript_track_directory' &&
        projection.sourceTrackCount > 0) {
        emptyDirectorySeenAt = null;
      }
    }
    const document = latest.find((entry) =>
      entry.status === 'captured' && entry.routeId === BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID
    );
    if (document?.body) {
      const projection = document.body as unknown as BilibiliTranscriptDocumentProjection;
      return {
        state: 'captured',
        partial: projection.partial,
        segments: projection.segments.map((segment) => ({
          from: segment.from,
          to: segment.to,
          text: segment.content
        }))
      };
    }
    if (emptyDirectorySeenAt !== null && Date.now() - emptyDirectorySeenAt >= EMPTY_DIRECTORY_CONFIRMATION_GRACE_MS) {
      return { state: 'confirmed_no_subtitle', segments: [], partial: false };
    }
    await delay(250);
  }
  const directory = latest.find((entry) =>
    entry.status === 'captured' && entry.routeId === BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID
  )?.body as unknown as BilibiliTranscriptDirectoryProjection | undefined;
  if (directory?.artifactKind === 'bilibili_transcript_track_directory' &&
    directory.sourceTrackCount === 0 && directory.storedTrackCount === 0) {
    return { state: 'confirmed_no_subtitle', segments: [], partial: false };
  }
  return { state: 'unknown', segments: [], partial: true };
}

async function mouseMove(debuggee: chrome.debugger.Debuggee, point: { x: number; y: number }): Promise<void> {
  await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x, y: point.y
  });
  await delay(MOUSE_MOVE_SETTLE_MS);
}

async function mouseMoveAlongPath(
  debuggee: chrome.debugger.Debuggee,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<void> {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(4, Math.min(POINTER_TRAVEL_MAX_STEPS, Math.ceil(distance / 36)));
  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + (to.x - from.x) * progress),
      y: Math.round(from.y + (to.y - from.y) * progress)
    });
    await delay(POINTER_TRAVEL_STEP_MS);
  }
  await delay(MOUSE_MOVE_SETTLE_MS);
}

async function mouseClick(
  debuggee: chrome.debugger.Debuggee,
  point: { x: number; y: number },
  pointerAlreadyAtTarget = false
): Promise<void> {
  if (!pointerAlreadyAtTarget) await mouseMove(debuggee, point);
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
