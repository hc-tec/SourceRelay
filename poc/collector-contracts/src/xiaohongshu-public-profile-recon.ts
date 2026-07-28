import type { PageVisualEvidence } from './page-visual-evidence.js';

export const XIAOHONGSHU_PUBLIC_PROFILE_RECON_SCHEMA_VERSION = 1 as const;

export interface XiaohongshuPublicProfileReconRequest {
  schemaVersion: typeof XIAOHONGSHU_PUBLIC_PROFILE_RECON_SCHEMA_VERSION;
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  runId: string;
  expectedRecordVersion: number;
  expectedDocumentGeneration: number;
  actionId: string;
  timeoutMs: number;
}

export interface XiaohongshuPublicProfileReconResult {
  schemaVersion: typeof XIAOHONGSHU_PUBLIC_PROFILE_RECON_SCHEMA_VERSION;
  pageAlias: string;
  actionId: string;
  completedAt: string;
  state: 'completed' | 'prerequisite_unmet';
  semanticAction: { attempted: boolean; attemptCount: 0 | 1 };
  before: {
    publicSurface: 'search';
    renderedCardCount: number;
    authorTarget: null | {
      targetMode: 'same_tab' | 'new_tab';
      targetKind: 'public_note_author';
      displayTextDigest: string;
      bounds: { x: number; y: number; width: number; height: number };
      pointerHitTarget: boolean;
    };
    visualEvidence: PageVisualEvidence;
  };
  after: null | {
    publicSurface: 'public_profile';
    sameTab: true;
    renderedNoteCount: number;
    profileHeaderVisible: boolean;
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

export function isXiaohongshuPublicProfileReconRequest(
  value: unknown
): value is XiaohongshuPublicProfileReconRequest {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'profileId', 'pageAlias', 'pageLeaseId', 'runId',
    'expectedRecordVersion', 'expectedDocumentGeneration', 'actionId', 'timeoutMs'
  ])) return false;
  return value.schemaVersion === XIAOHONGSHU_PUBLIC_PROFILE_RECON_SCHEMA_VERSION &&
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
