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
import { BILIBILI_VIDEO_DISCUSSION_MAX_SEMANTIC_ACTIONS as MAX_SEMANTIC_ACTIONS } from '@intelligence/collector-contracts';

/**
 * Root comments are collected from several bounded DOM snapshots.  Bilibili
 * currently virtualises roughly twenty thread renderers at a time, so the
 * Gateway keeps a larger, still finite cross-scroll budget instead of
 * pretending that one viewport is the whole discussion.
 */
export const BILIBILI_VIDEO_DISCUSSION_MAX_ROOT_COMMENTS = 60;
export const BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_ITEMS = SHARED_MAX_REPLY_ITEMS;
/** The MVP records the first observed page and at most one explicit next page. */
export const BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_PAGES = 2 as const;
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
  /** Pages observed in this run; observedPageOrdinal is not a platform page number. */
  pages: BilibiliVideoDiscussionReplyPage[];
}

export interface BilibiliVideoDiscussionReplyPage {
  /** One-based order in which this run observed a page for this thread. */
  observedPageOrdinal: number;
  /** Bilibili's page number is intentionally nullable when the DOM does not expose it. */
  replyPage: number | null;
  replyPageCount: number | null;
  replyHasMore: boolean | null;
  paginationVisible: boolean;
  replies: BilibiliVideoDiscussionReply[];
  /** Count in the bounded DOM projection, not a server-side total. */
  rawReplyCount: number;
  /** Unique normalized replies within this observed page. */
  uniqueReplyCount: number;
  /** Occurrences whose normalized key was already observed on an earlier page. */
  crossPageDuplicateCount: number;
  /** Unique normalized replies accumulated through this observed page. */
  cumulativeUniqueReplyCount: number;
  /** Whether this page differs from the prior observed page (or is the initial capture). */
  contentChanged: boolean;
  contentDigest: string;
}

export interface BilibiliVideoDiscussionReplyPageObservation {
  replies: readonly BilibiliVideoDiscussionReply[];
  paginationVisible: boolean;
  replyPage: number | null;
  replyPageCount: number | null;
  replyHasMore: boolean | null;
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
    maxReplyPages: typeof BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_PAGES;
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
  if (!Array.isArray(actions) || actions.length > MAX_SEMANTIC_ACTIONS ||
    actions.some((action) => action !== 'select_latest_comments' && action !== 'expand_first_thread' &&
      action !== 'reveal_second_thread' && action !== 'reveal_first_thread_pagination' && action !== 'expand_second_thread' &&
      action !== 'reveal_second_thread_pagination' && action !== 'next_first_thread_page' &&
      action !== 'next_second_thread_page') ||
    new Set(actions).size !== actions.length) {
    throw new Error('bilibili_video_discussion_input_invalid');
  }
  validateDiscussionActionDependencies(actions as BilibiliVideoDiscussionInteractionAction[]);
  return { canonicalVideoUrl, actions: [...actions] };
}

function validateDiscussionActionDependencies(actions: readonly BilibiliVideoDiscussionInteractionAction[]): void {
  const index = (action: BilibiliVideoDiscussionInteractionAction): number => actions.indexOf(action);
  for (const ordinal of [0, 1] as const) {
    const expand = ordinal === 0 ? 'expand_first_thread' : 'expand_second_thread';
    const reveal = ordinal === 0 ? 'reveal_first_thread_pagination' : 'reveal_second_thread_pagination';
    const next = ordinal === 0 ? 'next_first_thread_page' : 'next_second_thread_page';
    const expandIndex = index(expand);
    const revealIndex = index(reveal);
    const nextIndex = index(next);
    if (revealIndex >= 0 && (expandIndex < 0 || revealIndex < expandIndex)) {
      throw new Error('bilibili_video_discussion_input_invalid');
    }
    if (nextIndex >= 0 && (expandIndex < 0 || nextIndex < expandIndex ||
      (revealIndex >= 0 && nextIndex < revealIndex))) {
      throw new Error('bilibili_video_discussion_input_invalid');
    }
  }
  const revealSecondIndex = index('reveal_second_thread');
  const firstExpandIndex = index('expand_first_thread');
  const secondExpandIndex = index('expand_second_thread');
  if (revealSecondIndex >= 0 && (firstExpandIndex < 0 || revealSecondIndex < firstExpandIndex ||
    (secondExpandIndex >= 0 && revealSecondIndex > secondExpandIndex))) {
    throw new Error('bilibili_video_discussion_input_invalid');
  }
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
    firstThreadReplies: normaliseBilibiliVideoDiscussionReplies(dom.firstThreadReplies),
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

export function normaliseBilibiliVideoDiscussionReplies(value: unknown): BilibiliVideoDiscussionReply[] {
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

function normaliseReplyForKey(reply: BilibiliVideoDiscussionReply): string {
  return JSON.stringify({
    author: cleanText(reply.author, 200),
    content: cleanText(reply.content, 4_000) ?? '',
    publishedAt: cleanText(reply.publishedAt, 100)
  });
}

function normaliseReplyForDigest(reply: BilibiliVideoDiscussionReply): BilibiliVideoDiscussionReply {
  const likeCount = typeof reply.likeCount === 'number' && Number.isSafeInteger(reply.likeCount) && reply.likeCount >= 0
    ? reply.likeCount
    : null;
  return {
    author: cleanText(reply.author, 200),
    content: cleanText(reply.content, 4_000) ?? '',
    publishedAt: cleanText(reply.publishedAt, 100),
    likeCount
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** A stable digest of the bounded, normalized reply projection in order. */
export function bilibiliVideoDiscussionReplyContentDigest(
  replies: readonly BilibiliVideoDiscussionReply[]
): string {
  return sha256(JSON.stringify(replies.map(normaliseReplyForDigest)));
}

function replyKeys(replies: readonly BilibiliVideoDiscussionReply[]): string[] {
  return replies.map(normaliseReplyForKey);
}

/**
 * Records one page observation without claiming that observedPageOrdinal is
 * the platform's page number.  `append` is used by expand/next actions;
 * `refresh` updates the current page after a pagination-reveal action.
 */
export function recordBilibiliVideoDiscussionReplyPage(
  existing: BilibiliVideoDiscussionReplyThread | undefined,
  input: {
    threadOrdinal: number;
    observation: BilibiliVideoDiscussionReplyPageObservation;
    mode: 'append' | 'refresh';
  }
): BilibiliVideoDiscussionReplyThread {
  const replies = normaliseBilibiliVideoDiscussionReplies(input.observation.replies);
  const existingPages = existing?.pages ?? [];
  if (input.mode === 'append' && existingPages.length >= BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_PAGES) {
    throw new Error('bilibili_video_discussion_reply_page_limit');
  }
  const refreshing = input.mode === 'refresh' && existingPages.length > 0;
  const previousPages = refreshing ? existingPages.slice(0, -1) : existingPages;
  const priorKeys = new Set(previousPages.flatMap((page) => replyKeys(page.replies)));
  const pageKeys = replyKeys(replies);
  const uniquePageKeys = new Set(pageKeys);
  const crossPageDuplicateCount = pageKeys.filter((key) => priorKeys.has(key)).length;
  const cumulativeKeys = new Set([...priorKeys, ...uniquePageKeys]);
  const contentDigest = bilibiliVideoDiscussionReplyContentDigest(replies);
  const previousDigest = existingPages.at(-1)?.contentDigest ?? null;
  const page: BilibiliVideoDiscussionReplyPage = {
    observedPageOrdinal: refreshing
      ? existingPages.at(-1)!.observedPageOrdinal
      : existingPages.length + 1,
    replyPage: input.observation.replyPage,
    replyPageCount: input.observation.replyPageCount,
    replyHasMore: input.observation.replyHasMore,
    paginationVisible: input.observation.paginationVisible,
    replies,
    rawReplyCount: replies.length,
    uniqueReplyCount: uniquePageKeys.size,
    crossPageDuplicateCount,
    cumulativeUniqueReplyCount: cumulativeKeys.size,
    contentChanged: refreshing
      ? existingPages.at(-1)!.contentChanged || previousDigest !== contentDigest
      : previousDigest === null || previousDigest !== contentDigest,
    contentDigest
  };
  const pages = refreshing ? [...previousPages, page] : [...existingPages, page];
  return {
    threadOrdinal: existing?.threadOrdinal ?? input.threadOrdinal,
    replies: page.replies,
    paginationVisible: page.paginationVisible,
    page: page.replyPage,
    pageCount: page.replyPageCount,
    hasMore: page.replyHasMore,
    coverage: input.observation.coverage,
    pages
  };
}

function normaliseReplyCoverage(value: unknown, replies: unknown): BilibiliVideoDiscussionReplyCoverage {
  if (value === 'not_expanded' || value === 'current_page' || value === 'empty' || value === 'unknown') return value;
  return Array.isArray(replies) && replies.length > 0 ? 'current_page' : 'not_expanded';
}

export function targetUrlDigest(canonicalVideoUrl: string): string {
  return createHash('sha256').update(canonicalVideoUrl).digest('hex');
}
