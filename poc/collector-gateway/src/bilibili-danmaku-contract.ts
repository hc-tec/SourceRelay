import {
  BILIBILI_DANMAKU_STRATEGY_ID,
  type BilibiliDanmakuInteractionResult
} from '@intelligence/collector-contracts';
import type {
  BilibiliDanmakuDomSnapshot,
  BilibiliDanmakuListRow
} from '../../collector-extension/src/shared/bilibili-danmaku-capture';

/** Three bounded virtual-list windows are enough for the danmaku MVP. */
export const BILIBILI_DANMAKU_MAX_SCROLL_WINDOWS = 3 as const;

export interface BilibiliDanmakuInput {
  canonicalVideoUrl: string;
}

export function bilibiliDanmakuInput(value: unknown): BilibiliDanmakuInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('bilibili_danmaku_input_invalid');
  const candidate = value as Partial<BilibiliDanmakuInput>;
  if (Object.keys(candidate).length !== 1 || typeof candidate.canonicalVideoUrl !== 'string' ||
    !/^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}$/.test(candidate.canonicalVideoUrl)) {
    throw new Error('bilibili_danmaku_input_invalid');
  }
  return { canonicalVideoUrl: candidate.canonicalVideoUrl };
}

export type BilibiliDanmakuTerminalReason =
  | 'danmaku_ready'
  | 'list_unavailable'
  | 'list_not_opened'
  | 'budget_exhausted'
  | 'authentication_required'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'observer_not_bound'
  | 'document_context_changed'
  | 'run_deadline_exceeded'
  | 'dom_projection_failed';

export interface BilibiliDanmakuNavigationAction {
  actionId: string;
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'failed';
  errorCode: string | null;
}

export interface BilibiliDanmakuRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'video_detail';
  targetUrlDigest: string;
  bvid: string;
  strategyCandidate: {
    strategyId: typeof BILIBILI_DANMAKU_STRATEGY_ID;
    version: '0.1.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  navigation: BilibiliDanmakuNavigationAction;
  interactions: Array<Pick<BilibiliDanmakuInteractionResult,
    'actionId' | 'action' | 'browserInputAttempted' | 'completedAt'>>;
  dom: BilibiliDanmakuDomSnapshot | null;
  rows: BilibiliDanmakuListRow[];
  coverage: {
    listOpened: boolean;
    windowsCaptured: number;
    uniqueRows: number;
    totalEstimate: number | null;
    partial: boolean;
    terminalReason: BilibiliDanmakuTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'trusted_browser_input_plus_dom_only_mv3';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    networkQueryAndFragmentValues: 'discarded';
    browserCredentialData: 'not_collected';
    responseBodies: 'not_read';
    semanticActionDelivery: 'at_most_once';
    navigationCount: 1;
    maxScrollWindows: typeof BILIBILI_DANMAKU_MAX_SCROLL_WINDOWS;
    targetTabSelection: 'not_acquired' | 'created_new_managed_tab' | 'reused_matching_managed_tab' | 'reused_retained_managed_tab';
    targetPage: 'not_acquired' | 'retained_after_run' | 'quarantined_on_uncertain_outcome';
    admissionEligible: false;
  };
}

export function bvidFromCanonicalBilibiliDanmakuUrl(url: string): string {
  const match = /^https:\/\/www\.bilibili\.com\/video\/(BV[0-9A-Za-z]{10})$/.exec(url);
  if (!match) throw new Error('bilibili_danmaku_url_invalid');
  return match[1];
}
