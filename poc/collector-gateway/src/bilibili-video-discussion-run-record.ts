import { createHash } from 'node:crypto';
import {
  BILIBILI_DISCUSSION_STRATEGY_ID,
  type BilibiliVideoDiscussionInteractionResult,
  type StrategyBindingDiagnostics
} from '@intelligence/collector-contracts';
import {
  BILIBILI_VIDEO_DISCUSSION_MAX_ROOT_COMMENTS,
  BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_ITEMS,
  BILIBILI_VIDEO_DISCUSSION_STRATEGY_VERSION,
  type BilibiliVideoDiscussionAction,
  type BilibiliVideoDiscussionProjection,
  type BilibiliVideoDiscussionRunRecord,
  type BilibiliVideoDiscussionTerminalReason
} from './bilibili-video-discussion-contract';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createBilibiliVideoDiscussionRunRecord(input: {
  runId: string;
  collectorVersion: string;
  canonicalVideoUrl: string;
  bvid: string;
  startedAt: string;
  completedAt: string;
  state: BilibiliVideoDiscussionRunRecord['state'];
  errorCode: string | null;
  discussion: BilibiliVideoDiscussionProjection | null;
  interactions: BilibiliVideoDiscussionInteractionResult[];
  visualEvidence: BilibiliVideoDiscussionRunRecord['visualEvidence'];
  bindingDiagnostics?: StrategyBindingDiagnostics | null;
  actions: BilibiliVideoDiscussionAction[];
  terminalReason: BilibiliVideoDiscussionTerminalReason;
  targetTabSelection: BilibiliVideoDiscussionRunRecord['safeguards']['targetTabSelection'];
  targetPage: BilibiliVideoDiscussionRunRecord['safeguards']['targetPage'];
}): BilibiliVideoDiscussionRunRecord {
  return {
    schemaVersion: 1,
    runId: input.runId,
    collectorVersion: input.collectorVersion,
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'video_discussion',
    targetUrlDigest: sha256(input.canonicalVideoUrl),
    bvid: input.bvid,
    strategyCandidate: {
      strategyId: BILIBILI_DISCUSSION_STRATEGY_ID,
      version: BILIBILI_VIDEO_DISCUSSION_STRATEGY_VERSION,
      admissionEligible: false
    },
    state: input.state,
    errorCode: input.errorCode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    discussion: input.discussion,
    interactions: structuredClone(input.interactions),
    visualEvidence: input.visualEvidence,
    ...(input.bindingDiagnostics ? { bindingDiagnostics: structuredClone(input.bindingDiagnostics) } : {}),
    actions: input.actions,
    coverage: {
      capturedRootComments: input.discussion?.rootComments.length ?? 0,
      capturedFirstThreadReplies: input.discussion?.firstThreadReplies.length ?? 0,
      sort: input.discussion?.sort ?? null,
      firstThreadExpandVisible: input.discussion?.firstThreadExpandVisible ?? false,
      firstThreadExpanded: input.discussion?.firstThreadExpanded ?? false,
      replyCoverage: input.discussion?.replyCoverage ?? 'not_expanded',
      replyPage: input.discussion?.replyPage ?? null,
      replyPageCount: input.discussion?.replyPageCount ?? null,
      replyHasMore: input.discussion?.replyHasMore ?? null,
      loginGateVisible: input.discussion?.loginGateVisible ?? false,
      capturedAfterScroll: input.discussion?.capturedAfterScroll ?? false,
      terminalReason: input.terminalReason
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'trusted_navigation_plus_one_bounded_scroll_plus_shadow_dom_projection',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'not_read',
      responseBodies: 'not_read',
      productionResponseRoutes: [],
      maxRootComments: BILIBILI_VIDEO_DISCUSSION_MAX_ROOT_COMMENTS,
      maxReplyItems: BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_ITEMS,
      semanticActionDelivery: 'at_most_once',
      runDeadlineMs: 60_000,
      targetTabSelection: input.targetTabSelection,
      targetPage: input.targetPage,
      admissionEligible: false
    }
  };
}
