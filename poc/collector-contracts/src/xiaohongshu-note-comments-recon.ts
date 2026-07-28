import type { PageVisualEvidence } from './page-visual-evidence.js';

export const XIAOHONGSHU_NOTE_COMMENTS_RECON_SCHEMA_VERSION = 1 as const;

export interface XiaohongshuNoteCommentsReconRequest {
  schemaVersion: typeof XIAOHONGSHU_NOTE_COMMENTS_RECON_SCHEMA_VERSION;
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  runId: string;
  expectedRecordVersion: number;
  expectedDocumentGeneration: number;
  actionId: string;
  action: 'scroll_comment_panel' | 'expand_first_reply_thread';
  timeoutMs: number;
}

export interface XiaohongshuReconPublicComment {
  rank: number;
  commentId: string;
  content: string;
  authorNickname: string;
  likedCountText: string;
  subCommentCountText: string;
  createdAtText: string;
  locationText: string;
}

export interface XiaohongshuNoteCommentsReconResult {
  schemaVersion: typeof XIAOHONGSHU_NOTE_COMMENTS_RECON_SCHEMA_VERSION;
  pageAlias: string;
  actionId: string;
  completedAt: string;
  state: 'completed' | 'prerequisite_unmet';
  semanticAction: { attempted: boolean; attemptCount: 0 | 1 };
  before: {
    publicSurface: 'note_detail_overlay';
    scrollContainer: null | {
      bounds: { x: number; y: number; width: number; height: number };
      scrollTop: number;
      clientHeight: number;
      scrollHeight: number;
      pointerHitTarget: boolean;
    };
    renderedCommentCount: number;
    replyTarget: null | {
      label: string;
      bounds: { x: number; y: number; width: number; height: number };
      pointerHitTarget: boolean;
    };
    visualEvidence: PageVisualEvidence;
  };
  after: null | {
    publicSurface: 'note_detail_overlay';
    sameDocument: true;
    scrollTop: number;
    renderedCommentCount: number;
    replyTargetVisible: boolean;
    renderedCommentTextDigest: string | null;
    visualEvidence: PageVisualEvidence;
  };
  network: {
    responseBodiesRead: boolean;
    temporaryBodyBytesRead: number;
    responses: Array<{
      method: string;
      path: string;
      status: number;
      mime: string;
      bodyBytes: number;
      projectedCommentCount: number;
      hasMore: boolean | null;
      cursorPresent: boolean;
    }>;
    comments: XiaohongshuReconPublicComment[];
  };
  risk: {
    loginRequired: boolean;
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

export function isXiaohongshuNoteCommentsReconRequest(
  value: unknown
): value is XiaohongshuNoteCommentsReconRequest {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'profileId', 'pageAlias', 'pageLeaseId', 'runId',
    'expectedRecordVersion', 'expectedDocumentGeneration', 'actionId', 'action', 'timeoutMs'
  ])) return false;
  return value.schemaVersion === XIAOHONGSHU_NOTE_COMMENTS_RECON_SCHEMA_VERSION &&
    identifier(value.profileId) && identifier(value.pageAlias) && identifier(value.pageLeaseId) &&
    identifier(value.runId) && identifier(value.actionId) &&
    (value.action === 'scroll_comment_panel' || value.action === 'expand_first_reply_thread') &&
    Number.isSafeInteger(value.expectedRecordVersion) && Number(value.expectedRecordVersion) > 0 &&
    Number.isSafeInteger(value.expectedDocumentGeneration) && Number(value.expectedDocumentGeneration) >= 0 &&
    Number.isSafeInteger(value.timeoutMs) && Number(value.timeoutMs) >= 5_000 && Number(value.timeoutMs) <= 30_000;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 180 && /^[A-Za-z0-9._:-]+$/.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
