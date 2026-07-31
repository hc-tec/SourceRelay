import {
  canonicalBilibiliPassiveVideoWorkUrl,
  type BilibiliVideoDiscussionUserSelectedTabDomObservation,
  type BilibiliVideoDiscussionUserSelectedTabWorkItem,
  type BilibiliVideoDiscussionUserSelectedTabWorkResult,
  type ExtensionWorkItem,
  type ExtensionWorkResult
} from '@intelligence/collector-contracts';
import {
  captureBilibiliVideoDiscussionDom,
  scrollBilibiliVideoDiscussionIntoView
} from './strategies/bilibili-video-discussion-dom-projection';
import {
  abandonExtensionWorkTab,
  acquireExtensionWorkTab,
  navigateExtensionWorkTabOnce,
  readExtensionWorkTab,
  releaseExtensionWorkTab,
  type ExtensionWorkTabLease,
  type WorkTabAcquisition,
  type WorkTabDisposition
} from './extension-work-tabs';

const PAGE_SETTLE_MS = 2_000;
const SCROLL_SETTLE_MS = 750;
const MAX_OBSERVATION_WINDOW_MS = 30_000;
const OBSERVATION_INTERVAL_MS = 350;

/**
 * Automatic Bilibili discussion collection. The Gateway supplies only the
 * canonical video URL. The extension reuses or creates its managed work tab,
 * navigates once, foregrounds it through the work-tab lifecycle, and performs
 * one fixed scroll to the comment host before projecting visible root comments.
 * No popup selection, caller selector, arbitrary script, refresh or retry is
 * involved.
 */
export async function executeBilibiliDiscussionUserSelectedTabExtensionWork(
  item: BilibiliVideoDiscussionUserSelectedTabWorkItem,
  lifecycle: {
    onWorkTabAcquired?(acquisition: WorkTabAcquisition): Promise<void>;
    onNavigationIntent?(): Promise<void>;
  } = {}
): Promise<BilibiliVideoDiscussionUserSelectedTabWorkResult> {
  let workTab: ExtensionWorkTabLease | null = null;
  let acquisition: WorkTabAcquisition | 'not_acquired' = 'not_acquired';
  let navigationAttempted = false;
  let observation: BilibiliVideoDiscussionUserSelectedTabDomObservation | null = null;
  if (Date.parse(item.expiresAt) <= Date.now()) {
    return result(item, {
      state: 'stopped',
      errorCode: 'extension_work_expired',
      terminalReason: 'run_deadline_exceeded',
      navigationAttempted: false,
      acquisition: 'not_acquired',
      disposition: 'closed_or_missing',
      observation: null
    });
  }
  try {
    workTab = await acquireExtensionWorkTab();
    acquisition = workTab.acquisition;
    await lifecycle.onWorkTabAcquired?.(acquisition);
    await navigateExtensionWorkTabOnce(workTab, item as ExtensionWorkItem, async () => {
      navigationAttempted = true;
      await lifecycle.onNavigationIntent?.();
    });
    const observed = await observeDiscussion(workTab, item.input.bvid, item.expiresAt);
    observation = observed.observation;
    const disposition = observed.kind === 'ready' || observed.kind === 'empty' ||
      observed.terminalReason === 'source_unavailable'
      ? releaseExtensionWorkTab(workTab)
      : abandonExtensionWorkTab(workTab);
    workTab = null;
    if (observed.kind === 'ready' || observed.kind === 'empty') {
      return result(item, {
        state: 'completed',
        errorCode: null,
        terminalReason: observed.terminalReason,
        navigationAttempted,
        acquisition,
        disposition,
        observation
      });
    }
    return result(item, {
      state: observed.kind === 'partial' ? 'partial' : 'stopped',
      errorCode: observed.errorCode,
      terminalReason: observed.terminalReason,
      navigationAttempted,
      acquisition,
      disposition,
      observation
    });
  } catch (error) {
    const disposition = workTab
      ? navigationAttempted
        ? abandonExtensionWorkTab(workTab)
        : releaseExtensionWorkTab(workTab)
      : acquisition === 'not_acquired'
        ? 'closed_or_missing'
        : 'user_taken_over';
    const code = safeErrorCode(error);
    return result(item, {
      state: 'failed',
      errorCode: code,
      terminalReason: terminalReasonForError(code, navigationAttempted),
      navigationAttempted,
      acquisition,
      disposition,
      observation
    });
  }
}

/** Kept as a pure foreground predicate for the extension-domain test suite. */
export function discussionTabNeedsForeground(
  tab: Pick<chrome.tabs.Tab, 'active'>,
  window: Pick<chrome.windows.Window, 'focused'> | null
): boolean {
  return tab.active !== true || window?.focused !== true;
}

async function observeDiscussion(
  workTab: ExtensionWorkTabLease,
  expectedBvid: string,
  expiresAt: string
): Promise<
  | { kind: 'ready'; observation: BilibiliVideoDiscussionUserSelectedTabDomObservation; terminalReason: 'discussion_ready'; errorCode: null }
  | { kind: 'empty'; observation: BilibiliVideoDiscussionUserSelectedTabDomObservation; terminalReason: 'discussion_empty'; errorCode: null }
  | { kind: 'stopped'; observation: BilibiliVideoDiscussionUserSelectedTabDomObservation | null; terminalReason: BilibiliVideoDiscussionUserSelectedTabWorkResult['terminalReason']; errorCode: string }
  | { kind: 'partial'; observation: BilibiliVideoDiscussionUserSelectedTabDomObservation | null; terminalReason: 'discussion_partial' | 'run_deadline_exceeded' | 'dom_projection_failed'; errorCode: string }
> {
  const deadline = Math.min(Date.parse(expiresAt), Date.now() + MAX_OBSERVATION_WINDOW_MS);
  const expectedCanonicalUrl = `https://www.bilibili.com/video/${expectedBvid}`;
  let pageReadyAt: number | null = null;
  let lastObservation: BilibiliVideoDiscussionUserSelectedTabDomObservation | null = null;
  let documentId: string | null = null;
  let scrollAttempted = false;
  let scrollSettledAt: number | null = null;
  while (Date.now() < deadline) {
    const tab = await readExtensionWorkTab(workTab);
    if (tab.status !== 'complete') {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    if (canonicalBilibiliPassiveVideoWorkUrl(tab.url ?? '', 'observed_document') !== expectedCanonicalUrl) {
      return { kind: 'stopped', observation: null, errorCode: 'bilibili_discussion_target_not_reached', terminalReason: 'source_unavailable' };
    }
    const frame = await chrome.webNavigation.getFrame({ tabId: workTab.tabId, frameId: 0 }).catch(() => null);
    if (!frame?.documentId) {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    documentId ??= frame.documentId;
    if (frame.documentId !== documentId) {
      return { kind: 'stopped', observation: lastObservation, errorCode: 'video_discussion_document_context_changed', terminalReason: 'document_context_changed' };
    }
    pageReadyAt ??= Date.now();
    if (Date.now() - pageReadyAt < PAGE_SETTLE_MS) {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    let dom: Awaited<ReturnType<typeof captureBilibiliVideoDiscussionDom>>;
    try {
      dom = await captureBilibiliVideoDiscussionDom(workTab.tabId, documentId);
    } catch {
      return { kind: 'partial', observation: lastObservation, errorCode: 'bilibili_video_discussion_dom_projection_failed', terminalReason: 'dom_projection_failed' };
    }
    const current = toObservation(dom);
    lastObservation = current;
    if (current.bvid !== expectedBvid) {
      return { kind: 'stopped', observation: current, errorCode: 'bilibili_discussion_target_mismatch', terminalReason: 'document_context_changed' };
    }
    if (current.loginGateVisible) {
      return { kind: 'stopped', observation: current, errorCode: 'bilibili_login_required', terminalReason: 'login_required' };
    }
    if (current.risk.verificationRequired) {
      return { kind: 'stopped', observation: current, errorCode: 'bilibili_verification_required', terminalReason: 'verification_required' };
    }
    if (current.risk.rateLimited) {
      return { kind: 'stopped', observation: current, errorCode: 'bilibili_rate_limited', terminalReason: 'rate_limited' };
    }
    if (current.risk.sourceUnavailable) {
      return { kind: 'stopped', observation: current, errorCode: 'bilibili_source_unavailable', terminalReason: 'source_unavailable' };
    }
    if (current.commentHostPresent && !current.commentHostInViewport && !scrollAttempted) {
      scrollAttempted = true;
      try {
        const scroll = await scrollBilibiliVideoDiscussionIntoView(workTab.tabId, documentId);
        if (!scroll.found) {
          await delay(OBSERVATION_INTERVAL_MS);
          continue;
        }
        scrollSettledAt = Date.now();
      } catch (error) {
        const errorCode = safeErrorCode(error);
        return {
          kind: 'partial',
          observation: current,
          errorCode: errorCode.startsWith('bilibili_video_discussion_scroll_debugger_')
            ? errorCode
            : 'bilibili_video_discussion_scroll_failed',
          terminalReason: 'dom_projection_failed'
        };
      }
      continue;
    }
    if (scrollSettledAt !== null && Date.now() - scrollSettledAt < SCROLL_SETTLE_MS) {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    if (current.commentContentState === 'ready' && current.rootCommentTexts.length > 0 &&
      current.commentHostPresent && current.commentHostVisible && current.commentHostInViewport) {
      return { kind: 'ready', observation: current, terminalReason: 'discussion_ready', errorCode: null };
    }
    if (current.commentContentState === 'empty' && current.rootCommentTexts.length === 0 &&
      current.commentHostPresent && current.commentHostVisible && current.commentHostInViewport) {
      return { kind: 'empty', observation: current, terminalReason: 'discussion_empty', errorCode: null };
    }
    await delay(OBSERVATION_INTERVAL_MS);
  }
  return {
    kind: 'partial',
    observation: lastObservation,
    errorCode: 'bilibili_video_discussion_dom_not_ready',
    terminalReason: Date.now() >= Date.parse(expiresAt) ? 'run_deadline_exceeded' : 'discussion_partial'
  };
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
    navigationAttempted: boolean;
    acquisition: WorkTabAcquisition | 'not_acquired';
    disposition: WorkTabDisposition;
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
    executionTarget: 'collector_work_tab',
    state: input.state,
    errorCode: input.errorCode,
    terminalReason: input.terminalReason,
    completedAt: new Date().toISOString(),
    navigation: {
      attempted: input.navigationAttempted,
      attemptCount: input.navigationAttempted ? 1 : 0
    },
    workTabAcquisition: input.acquisition,
    workTabDisposition: input.disposition,
    observation: input.observation
  };
}

function terminalReasonForError(
  errorCode: string,
  navigationAttempted: boolean
): BilibiliVideoDiscussionUserSelectedTabWorkResult['terminalReason'] {
  if (errorCode === 'work_tab_closed') return 'work_tab_closed';
  if (errorCode === 'work_tab_user_taken_over') return 'work_tab_user_taken_over';
  if (errorCode === 'work_tab_foreground_unavailable') return 'work_tab_foreground_unavailable';
  return navigationAttempted ? 'navigation_outcome_unknown' : 'work_tab_closed';
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'extension_work_execution_failed';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
