import type { PageVisualEvidence } from './page-visual-evidence.js';

export const XIAOHONGSHU_NOTE_OVERLAY_RECON_SCHEMA_VERSION = 1 as const;

export interface XiaohongshuNoteOverlayReconRequest {
  schemaVersion: typeof XIAOHONGSHU_NOTE_OVERLAY_RECON_SCHEMA_VERSION;
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  runId: string;
  expectedRecordVersion: number;
  expectedDocumentGeneration: number;
  actionId: string;
  timeoutMs: number;
}

export interface XiaohongshuNoteOverlayReconResult {
  schemaVersion: typeof XIAOHONGSHU_NOTE_OVERLAY_RECON_SCHEMA_VERSION;
  pageAlias: string;
  actionId: string;
  completedAt: string;
  state: 'completed' | 'prerequisite_unmet';
  semanticAction: { attempted: boolean; attemptCount: 0 | 1 };
  before: {
    publicSurface: 'search';
    renderedCardCount: number;
    detailTarget: null | {
      targetMode: 'same_tab' | 'new_tab';
      targetKind: 'public_note_detail';
      interactionElement: 'anchor' | 'image' | 'container';
      bounds: { x: number; y: number; width: number; height: number };
      pointerHitTarget: boolean;
    };
    visualEvidence: PageVisualEvidence;
  };
  after: null | {
    publicSurface: 'note_detail_overlay';
    sameDocument: true;
    overlayVisible: true;
    publicTextDigest: string;
    closeTarget: null | {
      tag: string;
      role: string | null;
      labelClass: 'close_like' | 'icon_only' | 'unclassified';
      insideOverlay: boolean;
      bounds: { x: number; y: number; width: number; height: number };
      pointerHitTarget: boolean;
    };
    authorTarget: null | {
      targetMode: 'same_tab' | 'new_tab';
      targetKind: 'overlay_public_author';
      displayTextDigest: string;
      bounds: { x: number; y: number; width: number; height: number };
      pointerHitTarget: boolean;
    };
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
      topLevelKeys: string[];
      dataKeys: string[];
      firstArrayPath: string | null;
      firstArrayLength: number;
      firstItemKeys: string[];
    }>;
  };
  risk: {
    loginRequired: boolean;
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

export function isXiaohongshuNoteOverlayReconRequest(
  value: unknown
): value is XiaohongshuNoteOverlayReconRequest {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'profileId', 'pageAlias', 'pageLeaseId', 'runId',
    'expectedRecordVersion', 'expectedDocumentGeneration', 'actionId', 'timeoutMs'
  ])) return false;
  return value.schemaVersion === XIAOHONGSHU_NOTE_OVERLAY_RECON_SCHEMA_VERSION &&
    identifier(value.profileId) && identifier(value.pageAlias) && identifier(value.pageLeaseId) &&
    identifier(value.runId) && identifier(value.actionId) &&
    Number.isSafeInteger(value.expectedRecordVersion) && Number(value.expectedRecordVersion) > 0 &&
    Number.isSafeInteger(value.expectedDocumentGeneration) && Number(value.expectedDocumentGeneration) >= 0 &&
    Number.isSafeInteger(value.timeoutMs) && Number(value.timeoutMs) >= 5_000 && Number(value.timeoutMs) <= 30_000;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 180 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
