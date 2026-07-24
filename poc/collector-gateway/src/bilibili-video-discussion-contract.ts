import { createHash } from 'node:crypto';
import { BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_ITEMS as SHARED_MAX_REPLY_ITEMS } from '@intelligence/collector-contracts';
import type {
  BilibiliVideoDiscussionReply,
  BilibiliVideoDiscussionReplyCoverage,
  BilibiliVideoDiscussionInteractionAction,
  BilibiliVideoDiscussionInteractionResult,
  PageVisualEvidence,
  StrategyBindingDiagnostics
} from '@intelligence/collector-contracts';

/**
 * Root comments are collected from several bounded DOM snapshots.  Bilibili
 * currently virtualises roughly twenty thread renderers at a time, so the
 * Gateway keeps a larger, still finite cross-scroll budget instead of
 * pretending that one viewport is the whole discussion.
 */
export const BILIBILI_VIDEO_DISCUSSION_MAX_ROOT_COMMENTS = 60;
export const BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_ITEMS = SHARED_MAX_REPLY_ITEMS;
export const BILIBILI_VIDEO_DISCUSSION_STRATEGY_VERSION = '0.1.0' as const;

export interface BilibiliVideoDiscussionInput {
  canonicalVideoUrl: string;
  actions: BilibiliVideoDiscussionInteractionAction[];
}

export interface BilibiliVideoDiscussionDomSnapshot {
  bvid: string | null;
  commentHostPresent: boolean;
  commentHostVisible: boolean;
  commentHostInViewport: boolean;
  commentHostBounds: { x: number; y: number; width: number; height: number } | null;
  sortControls: {
    hotVisible: boolean;
    latestVisible: boolean;
    latestState: 'active' | 'inactive' | 'unknown';
  };
  commentContentState: 'loading' | 'ready' | 'empty' | 'unknown';
  rootCommentTexts: string[];
  firstThreadExpandVisible: boolean;
  firstThreadReplies?: BilibiliVideoDiscussionReply[];
  replyPaginationVisible?: boolean;
  replyPage?: number | null;
  replyPageCount?: number | null;
  replyHasMore?: boolean | null;
  replyCoverage?: BilibiliVideoDiscussionReplyCoverage;
  loginGateVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

/**
 * Merge the visible root-thread texts from successive snapshots.  The
 * platform does not expose a stable public id in this DOM-only MVP, so the
 * normalized visible text is the only safe local deduplication key.  A
 * repeated text is retained once; no inferred identity is written.
 */
export function mergeBilibiliVideoDiscussionRootComments(
  existing: readonly string[],
  incoming: readonly string[]
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of [...existing, ...incoming]) {
    if (typeof value !== 'string') continue;
    const clean = value.replace(/\s+/g, ' ').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    merged.push(clean);
    if (merged.length >= BILIBILI_VIDEO_DISCUSSION_MAX_ROOT_COMMENTS) break;
  }
  return merged;
}

export interface BilibiliVideoDiscussionProjection {
  schemaVersion: 1;
  bvid: string;
  sort: 'hot' | 'latest' | 'unknown';
  contentState: 'ready' | 'empty';
  rootComments: string[];
  replyThreads: BilibiliVideoDiscussionReplyThread[];
  firstThreadExpandVisible: boolean;
  firstThreadExpanded: boolean;
  firstThreadReplies: BilibiliVideoDiscussionReply[];
  replyPaginationVisible: boolean;
  replyPage: number | null;
  replyPageCount: number | null;
  replyHasMore: boolean | null;
  replyCoverage: BilibiliVideoDiscussionReplyCoverage;
  loginGateVisible: boolean;
  capturedAfterScroll: boolean;
  capturedAt: string;
}

/** A bounded reply page captured for one visible root-thread ordinal. */
export interface BilibiliVideoDiscussionReplyThread {
  threadOrdinal: number;
  replies: BilibiliVideoDiscussionReply[];
  paginationVisible: boolean;
  page: number | null;
  pageCount: number | null;
  hasMore: boolean | null;
  coverage: BilibiliVideoDiscussionReplyCoverage;
}

export interface BilibiliVideoDiscussionAction {
  actionId: string;
  kind: 'navigation' | 'scroll' | BilibiliVideoDiscussionInteractionAction;
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
  errorCode: string | null;
}

export type BilibiliVideoDiscussionTerminalReason =
  | 'discussion_ready'
  | 'login_required'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'dom_projection_failed'
  | 'document_context_changed'
  | 'run_deadline_exceeded'
  | 'interaction_prerequisite_unmet';

export interface BilibiliVideoDiscussionRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'video_discussion';
  targetUrlDigest: string;
  bvid: string;
  strategyCandidate: {
    strategyId: 'bilibili.video.discussion.dom.v1';
    version: typeof BILIBILI_VIDEO_DISCUSSION_STRATEGY_VERSION;
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  discussion: BilibiliVideoDiscussionProjection | null;
  interactions: BilibiliVideoDiscussionInteractionResult[];
  visualEvidence: PageVisualEvidence | null;
  bindingDiagnostics?: StrategyBindingDiagnostics;
  actions: BilibiliVideoDiscussionAction[];
  coverage: {
    capturedRootComments: number;
    capturedReplyThreads: number;
    capturedFirstThreadReplies: number;
    sort: BilibiliVideoDiscussionProjection['sort'] | null;
    firstThreadExpandVisible: boolean;
    firstThreadExpanded: boolean;
    replyCoverage: BilibiliVideoDiscussionProjection['replyCoverage'];
    replyPage: number | null;
    replyPageCount: number | null;
    replyHasMore: boolean | null;
    loginGateVisible: boolean;
    capturedAfterScroll: boolean;
    terminalReason: BilibiliVideoDiscussionTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'trusted_navigation_plus_three_bounded_scrolls_plus_shadow_dom_projection';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    networkQueryAndFragmentValues: 'not_read';
    responseBodies: 'not_read';
    productionResponseRoutes: [];
    maxRootComments: typeof BILIBILI_VIDEO_DISCUSSION_MAX_ROOT_COMMENTS;
    maxReplyItems: typeof BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_ITEMS;
    semanticActionDelivery: 'at_most_once';
    runDeadlineMs: 60_000;
    targetTabSelection: 'reused_matching_managed_tab' | 'reused_retained_managed_tab' | 'created_new_managed_tab' | 'not_acquired';
    targetPage: 'retained_after_run' | 'quarantined_on_uncertain_outcome' | 'not_acquired';
    admissionEligible: false;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean || null;
}

function bvid(value: unknown): string | null {
  return typeof value === 'string' && /^BV[0-9A-Za-z]{10}$/.test(value) ? value : null;
}

export function canonicalBilibiliVideoDiscussionUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const id = url.protocol === 'https:' && url.hostname === 'www.bilibili.com'
      ? url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null
      : null;
    return id && !url.username && !url.password && !url.search && !url.hash
      ? `https://www.bilibili.com/video/${id}`
      : null;
  } catch {
    return null;
  }
}

export function bilibiliVideoDiscussionInput(value: unknown): BilibiliVideoDiscussionInput {
  const candidate = record(value);
  if (!candidate || Object.keys(candidate).some((key) => key !== 'canonicalVideoUrl' && key !== 'actions') ||
    typeof candidate.canonicalVideoUrl !== 'string') {
    throw new Error('bilibili_video_discussion_input_invalid');
  }
  const canonicalVideoUrl = canonicalBilibiliVideoDiscussionUrl(candidate.canonicalVideoUrl);
  if (!canonicalVideoUrl) throw new Error('bilibili_video_discussion_input_invalid');
  const actions = candidate.actions === undefined ? [] : candidate.actions;
  if (!Array.isArray(actions) || actions.length > 3 ||
    actions.some((action) => action !== 'select_latest_comments' && action !== 'expand_first_thread' && action !== 'expand_second_thread') ||
    new Set(actions).size !== actions.length) {
    throw new Error('bilibili_video_discussion_input_invalid');
  }
  return { canonicalVideoUrl, actions: [...actions] };
}

export function bilibiliVideoDiscussionBvid(canonicalVideoUrl: string): string {
  const canonical = canonicalBilibiliVideoDiscussionUrl(canonicalVideoUrl);
  const id = canonical?.match(/\/video\/(BV[0-9A-Za-z]{10})$/)?.[1] ?? null;
  if (!id) throw new Error('bilibili_video_discussion_url_invalid');
  return id;
}

export function projectBilibiliVideoDiscussionDom(
  dom: BilibiliVideoDiscussionDomSnapshot,
  expectedBvid: string,
  capturedAfterScroll: boolean,
  capturedAt: string
): BilibiliVideoDiscussionProjection | null {
  if (
    dom.bvid !== expectedBvid ||
    !dom.commentHostPresent ||
    !dom.commentHostVisible ||
    !capturedAfterScroll ||
    !Array.isArray(dom.rootCommentTexts) ||
    dom.rootCommentTexts.length > BILIBILI_VIDEO_DISCUSSION_MAX_ROOT_COMMENTS ||
    (dom.commentContentState !== 'ready' && dom.commentContentState !== 'empty') ||
    typeof dom.loginGateVisible !== 'boolean' ||
    !dom.sortControls ||
    typeof dom.sortControls.hotVisible !== 'boolean' ||
    typeof dom.sortControls.latestVisible !== 'boolean'
  ) return null;
  const rootComments = dom.rootCommentTexts
    .map((value) => cleanText(value, 2_000))
    .filter((value): value is string => value !== null);
  const sort: BilibiliVideoDiscussionProjection['sort'] = dom.sortControls.latestState === 'active'
    ? 'latest'
    : dom.sortControls.hotVisible
      ? 'hot'
      : 'unknown';
  return {
    schemaVersion: 1,
    bvid: expectedBvid,
    sort,
    contentState: dom.commentContentState,
    rootComments,
    replyThreads: [],
    firstThreadExpandVisible: dom.firstThreadExpandVisible,
    firstThreadExpanded: false,
    firstThreadReplies: normaliseReplies(dom.firstThreadReplies),
    replyPaginationVisible: dom.replyPaginationVisible ?? false,
    replyPage: safePage(dom.replyPage),
    replyPageCount: safePage(dom.replyPageCount),
    replyHasMore: typeof dom.replyHasMore === 'boolean' ? dom.replyHasMore : null,
    replyCoverage: normaliseReplyCoverage(dom.replyCoverage, dom.firstThreadReplies),
    loginGateVisible: dom.loginGateVisible,
    capturedAfterScroll: true,
    capturedAt
  };
}

function safePage(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100_000
    ? value
    : null;
}

function normaliseReplies(value: unknown): BilibiliVideoDiscussionReply[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_ITEMS).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, unknown>;
    const author = cleanText(candidate.author, 200);
    const content = cleanText(candidate.content, 4_000);
    const publishedAt = cleanText(candidate.publishedAt, 100);
    const likeCount = typeof candidate.likeCount === 'number' && Number.isSafeInteger(candidate.likeCount) && candidate.likeCount >= 0
      ? candidate.likeCount
      : null;
    return content ? [{ author, content, publishedAt, likeCount }] : [];
  });
}

function normaliseReplyCoverage(value: unknown, replies: unknown): BilibiliVideoDiscussionReplyCoverage {
  if (value === 'not_expanded' || value === 'current_page' || value === 'empty' || value === 'unknown') return value;
  return Array.isArray(replies) && replies.length > 0 ? 'current_page' : 'not_expanded';
}

export function targetUrlDigest(canonicalVideoUrl: string): string {
  return createHash('sha256').update(canonicalVideoUrl).digest('hex');
}
