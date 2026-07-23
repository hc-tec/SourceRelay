import { createHash } from 'node:crypto';
import type {
  BilibiliVideoDiscussionInteractionAction,
  BilibiliVideoDiscussionInteractionResult,
  PageVisualEvidence,
  StrategyBindingDiagnostics
} from '@intelligence/collector-contracts';

export const BILIBILI_VIDEO_DISCUSSION_MAX_ROOT_COMMENTS = 20;
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
  loginGateVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

export interface BilibiliVideoDiscussionProjection {
  schemaVersion: 1;
  bvid: string;
  sort: 'hot' | 'latest' | 'unknown';
  contentState: 'ready' | 'empty';
  rootComments: string[];
  firstThreadExpandVisible: boolean;
  firstThreadExpanded: boolean;
  loginGateVisible: boolean;
  capturedAfterScroll: boolean;
  capturedAt: string;
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
    sort: BilibiliVideoDiscussionProjection['sort'] | null;
    firstThreadExpandVisible: boolean;
    firstThreadExpanded: boolean;
    loginGateVisible: boolean;
    capturedAfterScroll: boolean;
    terminalReason: BilibiliVideoDiscussionTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'trusted_navigation_plus_one_bounded_scroll_plus_shadow_dom_projection';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    networkQueryAndFragmentValues: 'not_read';
    responseBodies: 'not_read';
    productionResponseRoutes: [];
    maxRootComments: typeof BILIBILI_VIDEO_DISCUSSION_MAX_ROOT_COMMENTS;
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
  if (!Array.isArray(actions) || actions.length > 2 ||
    actions.some((action) => action !== 'select_latest_comments' && action !== 'expand_first_thread') ||
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
    firstThreadExpandVisible: dom.firstThreadExpandVisible,
    firstThreadExpanded: false,
    loginGateVisible: dom.loginGateVisible,
    capturedAfterScroll: true,
    capturedAt
  };
}

export function targetUrlDigest(canonicalVideoUrl: string): string {
  return createHash('sha256').update(canonicalVideoUrl).digest('hex');
}
