import type { PageVisualEvidence } from './page-visual-evidence.js';

export const BILIBILI_DANMAKU_INTERACTION_SCHEMA_VERSION = 1 as const;
export const BILIBILI_DANMAKU_INTERACTION_MAX_TIMEOUT_MS = 20_000 as const;
export const BILIBILI_DANMAKU_LIST_SCROLL_DELTA = 720 as const;

export const BILIBILI_DANMAKU_INTERACTION_ACTIONS = [
  'open_list',
  'scroll_list'
] as const;

export type BilibiliDanmakuInteractionAction =
  typeof BILIBILI_DANMAKU_INTERACTION_ACTIONS[number];

export interface BilibiliDanmakuInteractionRequest {
  schemaVersion: typeof BILIBILI_DANMAKU_INTERACTION_SCHEMA_VERSION;
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  runId: string;
  expectedRecordVersion: number;
  expectedDocumentGeneration: number;
  actionId: string;
  action: BilibiliDanmakuInteractionAction;
  bvid: string;
  timeoutMs: number;
}

export interface BilibiliDanmakuInteractionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BilibiliDanmakuInteractionDomState {
  bvid: string | null;
  playerVisible: boolean;
  listControlVisible: boolean;
  listOpen: boolean;
  listContainerVisible: boolean;
  listRowCount: number;
  listFirstIndex: number | null;
  listLastIndex: number | null;
  listTotalEstimate: number | null;
  listOffset: number | null;
  listHeight: number | null;
  listViewportHeight: number | null;
  loginGateVisible: boolean;
  verificationRequired: boolean;
  rateLimited: boolean;
  sourceUnavailable: boolean;
}

export interface BilibiliDanmakuInteractionResult {
  schemaVersion: typeof BILIBILI_DANMAKU_INTERACTION_SCHEMA_VERSION;
  pageAlias: string;
  actionId: string;
  action: BilibiliDanmakuInteractionAction;
  bvid: string;
  browserInputAttempted: boolean;
  completedAt: string;
  before: {
    dom: BilibiliDanmakuInteractionDomState;
    targetBounds: BilibiliDanmakuInteractionBounds;
    visualEvidence: PageVisualEvidence;
  };
  after: {
    dom: BilibiliDanmakuInteractionDomState;
    visualEvidence: PageVisualEvidence;
  };
}

export function isBilibiliDanmakuInteractionAction(
  value: unknown
): value is BilibiliDanmakuInteractionAction {
  return typeof value === 'string' &&
    (BILIBILI_DANMAKU_INTERACTION_ACTIONS as readonly string[]).includes(value);
}
