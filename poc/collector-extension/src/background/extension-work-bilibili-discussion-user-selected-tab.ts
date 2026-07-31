import type {
  BilibiliVideoDiscussionUserSelectedTabDomObservation,
  BilibiliVideoDiscussionUserSelectedTabWorkItem,
  BilibiliVideoDiscussionUserSelectedTabWorkResult
} from '@intelligence/collector-contracts';
import { captureBilibiliVideoDiscussionDom } from './strategies/bilibili-video-discussion-dom-projection';
import {
  takeSelectedBilibiliVideoDiscussionTab,
  type TakenUserSelectedBilibiliVideoDiscussionTab
} from './user-selected-bilibili-video-discussion-tab';

const OBSERVATION_INTERVAL_MS = 350;
const MAX_OBSERVATION_WINDOW_MS = 15_000;
const PAGE_SETTLE_MS = 2_000;
const FOREGROUND_SETTLE_MS = 750;

/**
 * A zero-input public comments observation. The extension consumes only the
 * tab/document that the user explicitly chose after personally scrolling
 * comments into view. It performs no navigation, scroll, sort, reply
 * expansion, refresh, response-body read or Browser Host/CDP control action.
 * If the exact leased tab is no longer foreground, it may focus that one
 * leased tab once so Bilibili's lazy comment renderer can settle; it never
 * chooses another tab or exposes tab identifiers to the Gateway.
 */
export async function executeBilibiliDiscussionUserSelectedTabExtensionWork(
  item: BilibiliVideoDiscussionUserSelectedTabWorkItem
): Promise<BilibiliVideoDiscussionUserSelectedTabWorkResult> {
  if (Date.parse(item.expiresAt) <= Date.now()) {
    return result(item, {
      state: 'stopped',
      errorCode: 'extension_work_expired',
      terminalReason: 'run_deadline_exceeded',
      disposition: 'selection_unavailable',
      observation: null
    });
  }

  const selected = await takeSelectedBilibiliVideoDiscussionTab(item.input.canonicalVideoUrl);
  if (selected.kind === 'stopped') {
    return result(item, {
      state: 'stopped',
      errorCode: selected.errorCode,
      terminalReason: selected.errorCode,
      disposition: selected.disposition,
      observation: null
    });
  }

  const deadline = Math.min(Date.parse(item.expiresAt), Date.now() + MAX_OBSERVATION_WINDOW_MS);
  let firstCompleteAt: number | null = null;
  let foregroundActivationAttempted = false;
  let foregroundActivatedAt: number | null = null;
  let lastObservation: BilibiliVideoDiscussionUserSelectedTabDomObservation | null = null;
  while (Date.now() < deadline) {
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(selected.lease.tabId);
    } catch {
      return result(item, {
        state: 'stopped',
        errorCode: 'user_selected_tab_closed',
        terminalReason: 'user_selected_tab_closed',
        disposition: 'closed_or_missing',
        observation: lastObservation
      });
    }
    const foreground = await ensureDiscussionTabForeground(selected.lease, tab, foregroundActivationAttempted);
    foregroundActivationAttempted = foreground.attempted;
    if (!foreground.ready) {
      return result(item, {
        state: 'stopped',
        errorCode: 'user_selected_tab_foreground_unavailable',
        terminalReason: 'user_selected_tab_foreground_unavailable',
        disposition: 'foreground_unavailable',
        observation: lastObservation
      });
    }
    if (foreground.activated) {
      foregroundActivatedAt ??= Date.now();
    }
    if (foregroundActivatedAt !== null && Date.now() - foregroundActivatedAt < FOREGROUND_SETTLE_MS) {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    if (tab.windowId !== selected.lease.windowId || tab.status !== 'complete') {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    firstCompleteAt ??= Date.now();
    if (Date.now() - firstCompleteAt < PAGE_SETTLE_MS) {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }

    let dom: Awaited<ReturnType<typeof captureBilibiliVideoDiscussionDom>>;
    try {
      dom = await captureBilibiliVideoDiscussionDom(selected.lease.tabId, selected.lease.documentId);
    } catch {
      return result(item, {
        state: 'stopped',
        errorCode: 'user_selected_tab_document_changed',
        terminalReason: 'user_selected_tab_document_changed',
        disposition: 'document_changed',
        observation: lastObservation
      });
    }
    const observation = toObservation(dom);
    lastObservation = observation;
    if (observation.bvid !== item.input.bvid) {
      return result(item, {
        state: 'stopped',
        errorCode: 'user_selected_tab_target_mismatch',
        terminalReason: 'user_selected_tab_target_mismatch',
        disposition: 'target_mismatch',
        observation
      });
    }
    if (observation.loginGateVisible) {
      return result(item, {
        state: 'stopped',
        errorCode: 'bilibili_login_required',
        terminalReason: 'login_required',
        disposition: 'observed',
        observation
      });
    }
    if (observation.risk.verificationRequired) {
      return result(item, {
        state: 'stopped',
        errorCode: 'bilibili_verification_required',
        terminalReason: 'verification_required',
        disposition: 'observed',
        observation
      });
    }
    if (observation.risk.rateLimited) {
      return result(item, {
        state: 'stopped',
        errorCode: 'bilibili_rate_limited',
        terminalReason: 'rate_limited',
        disposition: 'observed',
        observation
      });
    }
    if (observation.risk.sourceUnavailable) {
      return result(item, {
        state: 'stopped',
        errorCode: 'bilibili_source_unavailable',
        terminalReason: 'source_unavailable',
        disposition: 'observed',
        observation
      });
    }
    if (observation.commentContentState === 'ready' && observation.rootCommentTexts.length > 0 &&
      observation.commentHostPresent && observation.commentHostVisible && observation.commentHostInViewport
    ) {
      return result(item, {
        state: 'completed',
        errorCode: null,
        terminalReason: 'discussion_ready',
        disposition: 'observed',
        observation
      });
    }
    if (observation.commentContentState === 'empty' && observation.rootCommentTexts.length === 0 &&
      observation.commentHostPresent && observation.commentHostVisible && observation.commentHostInViewport
    ) {
      return result(item, {
        state: 'completed',
        errorCode: null,
        terminalReason: 'discussion_empty',
        disposition: 'observed',
        observation
      });
    }
    await delay(OBSERVATION_INTERVAL_MS);
  }

  return result(item, {
    state: 'partial',
    errorCode: 'bilibili_video_discussion_dom_not_ready',
    terminalReason: Date.now() >= Date.parse(item.expiresAt) ? 'run_deadline_exceeded' : 'discussion_partial',
    disposition: 'observed',
    observation: lastObservation
  });
}

export function discussionTabNeedsForeground(
  tab: Pick<chrome.tabs.Tab, 'active'>,
  window: Pick<chrome.windows.Window, 'focused'> | null
): boolean {
  return tab.active !== true || window?.focused !== true;
}

async function ensureDiscussionTabForeground(
  lease: Extract<TakenUserSelectedBilibiliVideoDiscussionTab, { kind: 'ready' }>['lease'],
  tab: chrome.tabs.Tab,
  activationAttempted: boolean
): Promise<{ ready: boolean; attempted: boolean; activated: boolean }> {
  const window = await chrome.windows.get(lease.windowId).catch(() => null);
  if (!discussionTabNeedsForeground(tab, window)) {
    return { ready: true, attempted: activationAttempted, activated: false };
  }
  if (activationAttempted) {
    return { ready: false, attempted: true, activated: false };
  }
  try {
    if (window?.focused !== true) {
      await chrome.windows.update(lease.windowId, { focused: true });
    }
    if (tab.active !== true) {
      await chrome.tabs.update(lease.tabId, { active: true });
    }
  } catch {
    return { ready: false, attempted: true, activated: false };
  }
  const [focusedWindow, activeTab] = await Promise.all([
    chrome.windows.get(lease.windowId).catch(() => null),
    chrome.tabs.get(lease.tabId).catch(() => null)
  ]);
  const ready = activeTab !== null && discussionTabNeedsForeground(activeTab, focusedWindow) === false;
  return { ready, attempted: true, activated: ready };
}

function toObservation(
  dom: Awaited<ReturnType<typeof captureBilibiliVideoDiscussionDom>>
): BilibiliVideoDiscussionUserSelectedTabDomObservation {
  return {
    bvid: dom.bvid,
    commentHostPresent: dom.commentHostPresent,
    commentHostVisible: dom.commentHostVisible,
    commentHostInViewport: dom.commentHostInViewport,
    commentContentState: dom.commentContentState,
    rootCommentTexts: dom.rootCommentTexts.map((entry) => entry.slice(0, 2_000)),
    sortControls: { ...dom.sortControls },
    loginGateVisible: dom.loginGateVisible,
    risk: { ...dom.risk }
  };
}

function result(
  item: BilibiliVideoDiscussionUserSelectedTabWorkItem,
  input: {
    state: BilibiliVideoDiscussionUserSelectedTabWorkResult['state'];
    errorCode: string | null;
    terminalReason: BilibiliVideoDiscussionUserSelectedTabWorkResult['terminalReason'];
    disposition: BilibiliVideoDiscussionUserSelectedTabWorkResult['userSelectedTabDisposition'];
    observation: BilibiliVideoDiscussionUserSelectedTabDomObservation | null;
  }
): BilibiliVideoDiscussionUserSelectedTabWorkResult {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.discussion',
    executionTarget: 'user_selected_tab',
    state: input.state,
    errorCode: input.errorCode,
    terminalReason: input.terminalReason,
    completedAt: new Date().toISOString(),
    navigation: { attempted: false, attemptCount: 0 },
    userSelectedTabDisposition: input.disposition,
    observation: input.observation
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
