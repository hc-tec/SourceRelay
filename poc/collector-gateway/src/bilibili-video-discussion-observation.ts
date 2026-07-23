import {
  BILIBILI_DISCUSSION_STRATEGY_ID,
  type StrategyObservationResult
} from '@intelligence/collector-contracts';
import {
  BILIBILI_VIDEO_DISCUSSION_MAX_ROOT_COMMENTS,
  type BilibiliVideoDiscussionDomSnapshot
} from './bilibili-video-discussion-contract';

export interface BilibiliVideoDiscussionStrategyObservation {
  dom: BilibiliVideoDiscussionDomSnapshot;
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

function domSnapshot(value: unknown, expectedBvid: string): BilibiliVideoDiscussionDomSnapshot {
  const candidate = record(value);
  const sort = record(candidate?.sortControls);
  const risk = record(candidate?.risk);
  const bounds = record(candidate?.commentHostBounds);
  const rootComments = candidate?.rootCommentTexts;
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
