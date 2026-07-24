import type { PageVisualEvidence } from './page-visual-evidence.js';

/**
 * A deliberately narrow browser-input contract for the public discussion
 * controls proved during reconnaissance. The Gateway chooses only the
 * semantic action; the Host discovers the live Shadow DOM target and owns the
 * pointer coordinates.
 */
export const BILIBILI_VIDEO_DISCUSSION_INTERACTION_SCHEMA_VERSION = 1 as const;
export const BILIBILI_VIDEO_DISCUSSION_INTERACTION_MAX_NETWORK_OBSERVATIONS = 3 as const;
export const BILIBILI_VIDEO_DISCUSSION_INTERACTION_MAX_TIMEOUT_MS = 20_000 as const;
/** A single expanded reply page is intentionally bounded for the MVP. */
export const BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_ITEMS = 20 as const;

export const BILIBILI_VIDEO_DISCUSSION_INTERACTION_ACTIONS = [
  'select_latest_comments',
  'expand_first_thread',
  'expand_second_thread'
] as const;

export type BilibiliVideoDiscussionInteractionAction =
  typeof BILIBILI_VIDEO_DISCUSSION_INTERACTION_ACTIONS[number];

export interface BilibiliVideoDiscussionInteractionRequest {
  schemaVersion: typeof BILIBILI_VIDEO_DISCUSSION_INTERACTION_SCHEMA_VERSION;
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  runId: string;
  expectedRecordVersion: number;
  expectedDocumentGeneration: number;
  actionId: string;
  action: BilibiliVideoDiscussionInteractionAction;
  bvid: string;
  timeoutMs: number;
}

export interface BilibiliVideoDiscussionInteractionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Public fields projected from one visible reply renderer.  This is a DOM
 * projection, not a response-body copy; absent/ambiguous fields stay null.
 */
export interface BilibiliVideoDiscussionReply {
  author: string | null;
  content: string;
  publishedAt: string | null;
  likeCount: number | null;
}

export type BilibiliVideoDiscussionReplyCoverage =
  | 'not_expanded'
  | 'current_page'
  | 'empty'
  | 'unknown';

export interface BilibiliVideoDiscussionInteractionDomState {
  commentHostPresent: boolean;
  commentHostVisible: boolean;
  commentHostInViewport: boolean;
  loginGateVisible: boolean;
  verificationRequired: boolean;
  rateLimited: boolean;
  sourceUnavailable: boolean;
  latestState: 'active' | 'inactive' | 'unknown';
  targetVisible: boolean;
  targetInViewport: boolean;
  targetBounds: BilibiliVideoDiscussionInteractionBounds | null;
  targetPointerHit: boolean;
  targetHovered: boolean;
  /** Zero-based visible root-thread ordinal selected for an expand action. */
  threadOrdinal: number;
  targetExpanded: boolean;
  rootCommentCount: number;
  replyPaginationVisible: boolean;
  firstThreadReplies: BilibiliVideoDiscussionReply[];
  replyPage: number | null;
  replyPageCount: number | null;
  replyHasMore: boolean | null;
  replyCoverage: BilibiliVideoDiscussionReplyCoverage;
}

/** Metadata only; query strings and response bodies are intentionally absent. */
export interface BilibiliVideoDiscussionInteractionNetworkObservation {
  method: 'GET';
  origin: 'https://api.bilibili.com';
  path: '/x/v2/reply/wbi/main' | '/x/v2/reply/reply';
  status: number;
  receivedAt: string;
}

export interface BilibiliVideoDiscussionInteractionResult {
  schemaVersion: typeof BILIBILI_VIDEO_DISCUSSION_INTERACTION_SCHEMA_VERSION;
  pageAlias: string;
  actionId: string;
  action: BilibiliVideoDiscussionInteractionAction;
  /** Zero-based visible root-thread ordinal selected for an expand action. */
  threadOrdinal: number;
  bvid: string;
  clickAttempted: boolean;
  completedAt: string;
  before: {
    dom: BilibiliVideoDiscussionInteractionDomState;
    targetBounds: BilibiliVideoDiscussionInteractionBounds;
    pointerHitTarget: true;
    pointerHoveredTarget: true;
    visualEvidence: PageVisualEvidence;
  };
  after: {
    dom: BilibiliVideoDiscussionInteractionDomState;
    visualEvidence: PageVisualEvidence;
  };
  network: {
    observations: BilibiliVideoDiscussionInteractionNetworkObservation[];
  };
}

export function isBilibiliVideoDiscussionInteractionAction(
  value: unknown
): value is BilibiliVideoDiscussionInteractionAction {
  return typeof value === 'string' &&
    (BILIBILI_VIDEO_DISCUSSION_INTERACTION_ACTIONS as readonly string[]).includes(value);
}
