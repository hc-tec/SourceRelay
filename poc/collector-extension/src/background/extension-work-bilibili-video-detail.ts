import {
  canonicalBilibiliPassiveVideoWorkUrl,
  type BilibiliVideoDetailDomObservation,
  type ExtensionWorkItem,
  type ExtensionWorkResult
} from '@intelligence/collector-contracts';
import { captureBilibiliVideoDetailDom } from './strategies/bilibili-video-detail-dom-projection';
import {
  armBilibiliSubtitleCapture,
  captureBilibiliSubtitle
} from './extension-work-bilibili-subtitle-capture';
import {
  observeBilibiliDiscussionOnWorkTab,
  type BilibiliDiscussionObservationResult
} from './extension-work-bilibili-discussion-user-selected-tab';
import {
  acquireExtensionWorkTab,
  abandonExtensionWorkTab,
  currentExtensionWorkTabDisposition,
  navigateExtensionWorkTabOnce,
  readExtensionWorkTab,
  releaseExtensionWorkTab,
  type ExtensionWorkTabLease,
  type WorkTabAcquisition,
  type WorkTabDisposition
} from './extension-work-tabs';

const PAGE_SETTLE_MS = 3_000;
// Match the proven passive-player settle budget. This is still one navigation
// and a bounded read-only observation; it is not a refresh or replay.
// Keep the composed run below the MV3 worker's practical long async-event
// window: detail settling + subtitle probe + one bounded comments pass must
// still have time to persist and deliver a partial result.
const DOM_OBSERVATION_WINDOW_MS = 25_000;
const DISCUSSION_OBSERVATION_WINDOW_MS = 10_000;
const OBSERVATION_INTERVAL_MS = 350;

/**
 * The first direct-mode capability needs no semantic page input: it opens one
 * signed canonical Bilibili video URL once and projects a bounded first-screen
 * DOM observation.  It never refreshes, clicks, scrolls, or retries that
 * platform navigation.
 */
export async function executeBilibiliVideoDetailExtensionWork(
  item: Extract<ExtensionWorkItem, { capability: 'bilibili.video_detail' }>,
  lifecycle: {
    onWorkTabAcquired?(acquisition: WorkTabAcquisition): Promise<void>;
    onNavigationIntent?(): Promise<void>;
  } = {}
): Promise<Extract<ExtensionWorkResult, { capability: 'bilibili.video_detail' }>> {
  let workTab: ExtensionWorkTabLease | null = null;
  let acquisition: WorkTabAcquisition | 'not_acquired' = 'not_acquired';
  let navigationAttempted = false;
  let observation: BilibiliVideoDetailDomObservation | null = null;
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
    try {
      await armBilibiliSubtitleCapture(workTab, item);
    } catch {
      // Subtitle capture is an accessory; a subtitle arm failure must not
      // prevent the bounded first-screen detail from being delivered.
    }
    await navigateExtensionWorkTabOnce(workTab, item, async () => {
      navigationAttempted = true;
      await lifecycle.onNavigationIntent?.();
    });
    const observed = await observeVideoDetail(workTab, item.input.bvid, item.expiresAt);
    observation = observed.observation;
    let discussionResult: BilibiliDiscussionObservationResult | null = null;
    if (observed.kind === 'ready' && observation) {
      try {
        observation = await captureBilibiliSubtitle(workTab, item, observation);
      } catch {
        // Subtitle capture is component-scoped; the detail and discussion
        // collectors must still be allowed to complete independently.
        observation = {
          ...observation,
          subtitle: { ...observation.subtitle, captureStatus: 'capture_failed', partial: true }
        };
      }
      try {
        discussionResult = await observeBilibiliDiscussionOnWorkTab(
          workTab,
          item.input.bvid,
          item.expiresAt,
          DISCUSSION_OBSERVATION_WINDOW_MS
        );
        observation = withDiscussionObservation(observation, discussionResult);
      } catch {
        discussionResult = {
          kind: 'partial',
          observation: null,
          errorCode: 'bilibili_video_discussion_capture_failed',
          terminalReason: 'dom_projection_failed'
        };
        observation = withDiscussionFailure(observation, 'capture_failed');
      }
    }
    const discussionPartial = discussionResult !== null && discussionResult.kind !== 'ready' && discussionResult.kind !== 'empty';
    const subtitleComplete = observation !== null && observation.subtitle.partial === false &&
      (observation.subtitle.captureStatus === 'captured' ||
        observation.subtitle.captureStatus === 'confirmed_no_subtitle');
    const componentPartial = discussionPartial || observed.kind === 'ready' && !subtitleComplete;
    const disposition = observed.kind === 'ready' || observed.kind === 'incomplete' ||
      observed.terminalReason === 'source_unavailable'
      ? releaseExtensionWorkTab(workTab)
      : abandonExtensionWorkTab(workTab);
    workTab = null;
    if (observed.kind === 'ready') {
      if (!componentPartial) {
        return result(item, {
          state: 'completed',
          errorCode: null,
          terminalReason: 'detail_ready',
          navigationAttempted,
          acquisition,
          disposition,
          observation
        });
      }
      return result(item, {
        state: 'partial',
        errorCode: discussionPartial
          ? discussionResult?.errorCode ?? 'bilibili_video_discussion_capture_incomplete'
          : 'bilibili_video_subtitle_capture_incomplete',
        terminalReason: 'detail_ready',
        navigationAttempted,
        acquisition,
        disposition,
        observation
      });
    }
    return result(item, {
      state: observed.kind === 'incomplete' ? 'partial' : 'stopped',
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

async function observeVideoDetail(
  workTab: ExtensionWorkTabLease,
  expectedBvid: string,
  expiresAt: string
): Promise<
  | { kind: 'ready'; observation: BilibiliVideoDetailDomObservation }
  | { kind: 'stopped'; observation: BilibiliVideoDetailDomObservation | null; errorCode: string; terminalReason: 'verification_required' | 'rate_limited' | 'source_unavailable' }
  | { kind: 'incomplete'; observation: BilibiliVideoDetailDomObservation | null; errorCode: string; terminalReason: 'dom_projection_failed' | 'run_deadline_exceeded' }
> {
  const deadline = Math.min(Date.parse(expiresAt), Date.now() + DOM_OBSERVATION_WINDOW_MS + PAGE_SETTLE_MS);
  const expectedCanonicalUrl = `https://www.bilibili.com/video/${expectedBvid}`;
  let pageReadyAt: number | null = null;
  let lastObservation: BilibiliVideoDetailDomObservation | null = null;
  let lastIdentityError: 'bilibili_video_detail_document_identity_unavailable' |
    'bilibili_video_detail_document_identity_mismatch' | null = null;
  while (Date.now() < deadline) {
    const tab = await readExtensionWorkTab(workTab);
    if (tab.status !== 'complete') {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    if (canonicalBilibiliPassiveVideoWorkUrl(tab.url ?? '', 'observed_document') !== expectedCanonicalUrl) {
      return {
        kind: 'stopped',
        observation: null,
        errorCode: 'bilibili_video_detail_target_not_reached',
        terminalReason: 'source_unavailable'
      };
    }
    pageReadyAt ??= Date.now();
    if (Date.now() - pageReadyAt < PAGE_SETTLE_MS) {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    const dom = await captureBilibiliVideoDetailDom(workTab.tabId);
    const observation = toObservation(dom, expectedBvid);
    if (observation) {
      lastObservation = observation;
    } else {
      lastIdentityError = dom.bvid === null
        ? 'bilibili_video_detail_document_identity_unavailable'
        : 'bilibili_video_detail_document_identity_mismatch';
    }
    if (dom.risk.verificationRequired) {
      return {
        kind: 'stopped', observation, errorCode: 'bilibili_verification_required', terminalReason: 'verification_required'
      };
    }
    if (dom.risk.rateLimited) {
      return {
        kind: 'stopped', observation, errorCode: 'bilibili_rate_limited', terminalReason: 'rate_limited'
      };
    }
    if (dom.risk.sourceUnavailable) {
      return {
        kind: 'stopped', observation, errorCode: 'bilibili_source_unavailable', terminalReason: 'source_unavailable'
      };
    }
    if (observation && observation.titleVisible && observation.playerVisible && observation.title) {
      return { kind: 'ready', observation };
    }
    await delay(OBSERVATION_INTERVAL_MS);
  }
  return {
    kind: 'incomplete',
    observation: lastObservation,
    errorCode: lastObservation === null && lastIdentityError !== null
      ? lastIdentityError
      : 'bilibili_video_detail_dom_not_ready',
    terminalReason: Date.now() >= Date.parse(expiresAt) ? 'run_deadline_exceeded' : 'dom_projection_failed'
  };
}

function toObservation(
  dom: Awaited<ReturnType<typeof captureBilibiliVideoDetailDom>>,
  expectedBvid: string
): BilibiliVideoDetailDomObservation | null {
  if (dom.bvid !== expectedBvid) return null;
  return {
    bvid: dom.bvid,
    title: dom.title,
    metadataVisibleText: dom.metadataVisibleText,
    description: dom.description,
    creator: dom.creator ? { ...dom.creator } : null,
    tagTexts: [...dom.tagTexts],
    episodeSummaryText: dom.episodeSummaryText,
    titleVisible: dom.titleVisible,
    playerVisible: dom.playerVisible,
    chargeExclusiveTrialVisible: dom.chargeExclusiveTrialVisible,
    subtitle: { ...dom.subtitle },
    discussion: emptyDiscussion(),
    loginOverlayVisible: dom.loginOverlayVisible,
    risk: { ...dom.risk }
  };
}

function emptyDiscussion(): BilibiliVideoDetailDomObservation['discussion'] {
  return {
    captureStatus: 'capture_incomplete',
    partial: true,
    commentContentState: 'unknown',
    rootCommentCount: 0,
    rootComments: [],
    sort: 'unknown',
    loginGateVisible: false
  };
}

function withDiscussionFailure(
  base: BilibiliVideoDetailDomObservation,
  captureStatus: BilibiliVideoDetailDomObservation['discussion']['captureStatus']
): BilibiliVideoDetailDomObservation {
  return { ...base, discussion: { ...emptyDiscussion(), captureStatus } };
}

function withDiscussionObservation(
  base: BilibiliVideoDetailDomObservation,
  result: BilibiliDiscussionObservationResult
): BilibiliVideoDetailDomObservation {
  const observation = result.observation;
  const captureStatus = result.kind === 'ready'
    ? 'captured' as const
    : result.kind === 'empty'
      ? 'empty' as const
      : result.terminalReason === 'login_required'
        ? 'login_required' as const
        : result.terminalReason === 'verification_required'
          ? 'verification_required' as const
          : result.terminalReason === 'rate_limited'
            ? 'rate_limited' as const
            : result.terminalReason === 'source_unavailable'
              ? 'source_unavailable' as const
              : result.terminalReason === 'document_context_changed'
                ? 'document_context_changed' as const
                : 'capture_incomplete' as const;
  return {
    ...base,
    discussion: {
      captureStatus,
      partial: result.kind !== 'ready' && result.kind !== 'empty',
      commentContentState: observation?.commentContentState ?? 'unknown',
      rootCommentCount: observation?.rootCommentTexts.length ?? 0,
      rootComments: observation?.rootCommentTexts.slice(0, 20) ?? [],
      sort: observation?.sortControls.latestState === 'active'
        ? 'latest'
        : observation?.sortControls.latestState === 'inactive'
          ? 'hot'
          : 'unknown',
      loginGateVisible: observation?.loginGateVisible ?? false
    }
  };
}

function result(
  item: Extract<ExtensionWorkItem, { capability: 'bilibili.video_detail' }>,
  input: {
    state: 'completed' | 'partial' | 'stopped' | 'failed';
    errorCode: string | null;
    terminalReason: Extract<ExtensionWorkResult, { capability: 'bilibili.video_detail' }>['terminalReason'];
    navigationAttempted: boolean;
    acquisition: WorkTabAcquisition | 'not_acquired';
    disposition: WorkTabDisposition;
    observation: BilibiliVideoDetailDomObservation | null;
  }
): Extract<ExtensionWorkResult, { capability: 'bilibili.video_detail' }> {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.video_detail',
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
): Extract<ExtensionWorkResult, { capability: 'bilibili.video_detail' }>['terminalReason'] {
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
