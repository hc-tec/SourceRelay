import {
  BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_ITEMS,
  BILIBILI_DISCUSSION_STRATEGY_ID,
  type BilibiliVideoDiscussionReply,
  type BilibiliVideoDiscussionReplyCoverage,
  type StrategyObservationResult
} from '@intelligence/collector-contracts';
import {
  BILIBILI_VIDEO_DISCUSSION_MAX_ROOT_COMMENTS,
  type BilibiliVideoDiscussionDomSnapshot
} from './bilibili-video-discussion-contract';

export interface BilibiliVideoDiscussionStrategyObservation {
  dom: BilibiliVideoDiscussionDomSnapshot;
}

export type BilibiliVideoDiscussionObservationWaitState =
  | 'risk_stopped'
  | 'ready'
  | 'waiting_for_host'
  | 'waiting_for_viewport'
  | 'waiting_for_content';

export function isBilibiliVideoDiscussionContentReady(
  dom: BilibiliVideoDiscussionDomSnapshot
): boolean {
  return dom.commentContentState === 'ready' || dom.commentContentState === 'empty';
}

/**
 * Classifies one DOM observation without performing any browser action. The
 * gateway uses this result to distinguish a lazy-loading comment tree from a
 * genuine empty result. In particular, `loading` and `unknown` never become
 * `ready` merely because the host element exists.
 */
export function bilibiliVideoDiscussionObservationWaitState(
  dom: BilibiliVideoDiscussionDomSnapshot,
  options: { requireViewport: boolean; requireContentReady: boolean }
): BilibiliVideoDiscussionObservationWaitState {
  if (dom.risk.verificationRequired || dom.risk.rateLimited || dom.risk.sourceUnavailable) {
    return 'risk_stopped';
  }
  if (!dom.commentHostPresent || !dom.commentHostVisible) return 'waiting_for_host';
  if (options.requireViewport && !dom.commentHostInViewport) return 'waiting_for_viewport';
  if (options.requireContentReady && !isBilibiliVideoDiscussionContentReady(dom)) {
    return 'waiting_for_content';
  }
  return 'ready';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean || null;
}

function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function page(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100_000
    ? value
    : null;
}

function replyCoverage(value: unknown): BilibiliVideoDiscussionReplyCoverage {
  return value === 'not_expanded' || value === 'current_page' || value === 'empty' || value === 'unknown'
    ? value
    : 'not_expanded';
}

function replies(value: unknown): BilibiliVideoDiscussionReply[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_ITEMS).flatMap((entry) => {
    const candidate = record(entry);
    if (!candidate || typeof candidate.content !== 'string') return [];
    const content = text(candidate.content, 4_000);
    if (!content) return [];
    const likeCount = typeof candidate.likeCount === 'number' && Number.isSafeInteger(candidate.likeCount) && candidate.likeCount >= 0
      ? candidate.likeCount
      : null;
    return [{
      author: text(candidate.author, 200),
      content,
      publishedAt: text(candidate.publishedAt, 100),
      likeCount
    }];
  });
}

function domSnapshot(value: unknown, expectedBvid: string): BilibiliVideoDiscussionDomSnapshot {
  const candidate = record(value);
  const sort = record(candidate?.sortControls);
  const risk = record(candidate?.risk);
  const bounds = record(candidate?.commentHostBounds);
  const rootComments = candidate?.rootCommentTexts;
  const firstThreadReplies = replies(candidate?.firstThreadReplies);
  const commentContentState = candidate?.commentContentState;
  const cleanRootComments = Array.isArray(rootComments)
    ? rootComments.map((entry) => text(entry, 2_000)).filter((entry): entry is string => entry !== null)
    : null;
  const latestState = sort?.latestState;
  if (
    !candidate ||
    candidate.bvid !== expectedBvid ||
    !sort ||
    (latestState !== 'active' && latestState !== 'inactive' && latestState !== 'unknown') ||
    (commentContentState !== 'loading' && commentContentState !== 'ready' &&
      commentContentState !== 'empty' && commentContentState !== 'unknown') ||
    !cleanRootComments ||
    cleanRootComments.length > BILIBILI_VIDEO_DISCUSSION_MAX_ROOT_COMMENTS ||
    !risk
  ) throw new Error('video_discussion_observation_dom_invalid');
  const x = typeof bounds?.x === 'number' && Number.isSafeInteger(bounds.x) ? bounds.x : null;
  const y = typeof bounds?.y === 'number' && Number.isSafeInteger(bounds.y) ? bounds.y : null;
  const width = typeof bounds?.width === 'number' && Number.isSafeInteger(bounds.width) ? bounds.width : null;
  const height = typeof bounds?.height === 'number' && Number.isSafeInteger(bounds.height) ? bounds.height : null;
  const commentHostBounds = x !== null && y !== null && width !== null && height !== null && width > 0 && height > 0
    ? { x, y, width, height }
    : null;
  return {
    bvid: expectedBvid,
    commentHostPresent: bool(candidate.commentHostPresent),
    commentHostVisible: bool(candidate.commentHostVisible),
    commentHostInViewport: bool(candidate.commentHostInViewport),
    commentHostBounds,
    sortControls: {
      hotVisible: bool(sort.hotVisible),
      latestVisible: bool(sort.latestVisible),
      latestState
    },
    commentContentState,
    rootCommentTexts: cleanRootComments,
    firstThreadExpandVisible: bool(candidate.firstThreadExpandVisible),
    firstThreadReplies,
    replyPaginationVisible: bool(candidate.replyPaginationVisible),
    replyPage: page(candidate.replyPage),
    replyPageCount: page(candidate.replyPageCount),
    replyHasMore: typeof candidate.replyHasMore === 'boolean' ? candidate.replyHasMore : null,
    replyCoverage: replyCoverage(candidate.replyCoverage),
    loginGateVisible: bool(candidate.loginGateVisible),
    risk: {
      verificationRequired: bool(risk.verificationRequired),
      rateLimited: bool(risk.rateLimited),
      sourceUnavailable: bool(risk.sourceUnavailable)
    }
  };
}

export function bilibiliVideoDiscussionStrategyObservation(
  result: StrategyObservationResult,
  expectedBvid: string
): BilibiliVideoDiscussionStrategyObservation {
  if (
    result.type !== 'collector_strategy_observation' ||
    result.strategyId !== BILIBILI_DISCUSSION_STRATEGY_ID ||
    result.payloadBytes > 128 * 1024
  ) throw new Error('video_discussion_observation_strategy_result_invalid');
  const payload = record(result.payload);
  if (
    !payload ||
    payload.schemaVersion !== 1 ||
    payload.strategyId !== BILIBILI_DISCUSSION_STRATEGY_ID ||
    payload.bvid !== expectedBvid ||
    typeof payload.documentId !== 'string' ||
    payload.documentId.length === 0 ||
    payload.documentId.length > 256
  ) throw new Error('video_discussion_observation_payload_context_invalid');
  return { dom: domSnapshot(payload.dom, expectedBvid) };
}
