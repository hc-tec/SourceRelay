import type { ExtensionWorkCapability } from './extension-work.js';
import { sanitiseOperationalDetails, type OperationalLogDetails } from './observability.js';

export const EXTENSION_DIAGNOSTIC_SCHEMA_VERSION = 1 as const;

export type ExtensionDiagnosticPhase =
  | 'work_claimed'
  | 'work_tab_acquired'
  | 'navigation_intent_recorded'
  | 'execution_finished'
  | 'result_delivery_failed';

export type ExtensionDiagnosticOutcome = 'started' | 'completed' | 'failed' | 'stopped';

export interface ExtensionDiagnosticEvent {
  schemaVersion: typeof EXTENSION_DIAGNOSTIC_SCHEMA_VERSION;
  eventId: string;
  occurredAt: string;
  browserBindingId: string;
  workId: string;
  operationId: string;
  platform: 'bilibili' | 'xiaohongshu';
  capability: ExtensionWorkCapability;
  phase: ExtensionDiagnosticPhase;
  outcome: ExtensionDiagnosticOutcome;
  durationMs: number | null;
  errorCode: string | null;
  details: OperationalLogDetails;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ERROR_CODE = /^[a-z0-9_]{1,100}$/;
const CAPABILITIES: readonly ExtensionWorkCapability[] = [
  'bilibili.video_detail', 'bilibili.native_search', 'bilibili.native_search_batch',
  'bilibili.account_profile', 'bilibili.account_inventory', 'bilibili.discussion',
  'bilibili.dynamic', 'bilibili.collection_series.overview', 'bilibili.collection_series.detail',
  'bilibili.danmaku', 'xiaohongshu.search.public_notes.v1', 'xiaohongshu.account.public_notes.v1',
  'xiaohongshu.note.public_detail.v1', 'xiaohongshu.note.public_comments.v1',
  'xiaohongshu.note.public_comment_replies.v1'
];

export function isExtensionDiagnosticEvent(value: unknown): value is ExtensionDiagnosticEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<ExtensionDiagnosticEvent>;
  return candidate.schemaVersion === EXTENSION_DIAGNOSTIC_SCHEMA_VERSION &&
    typeof candidate.eventId === 'string' && UUID_PATTERN.test(candidate.eventId) &&
    typeof candidate.occurredAt === 'string' && Number.isFinite(Date.parse(candidate.occurredAt)) &&
    typeof candidate.browserBindingId === 'string' && UUID_PATTERN.test(candidate.browserBindingId) &&
    typeof candidate.workId === 'string' && UUID_PATTERN.test(candidate.workId) &&
    typeof candidate.operationId === 'string' && UUID_PATTERN.test(candidate.operationId) &&
    (candidate.platform === 'bilibili' || candidate.platform === 'xiaohongshu') &&
    typeof candidate.capability === 'string' && CAPABILITIES.includes(candidate.capability) &&
    isPhase(candidate.phase) && isOutcome(candidate.outcome) &&
    (candidate.durationMs === null || (typeof candidate.durationMs === 'number' && Number.isFinite(candidate.durationMs) && candidate.durationMs >= 0)) &&
    (candidate.errorCode === null || (typeof candidate.errorCode === 'string' && SAFE_ERROR_CODE.test(candidate.errorCode))) &&
    candidate.details !== null && typeof candidate.details === 'object' && !Array.isArray(candidate.details);
}

export function sanitiseExtensionDiagnosticDetails(value: unknown): OperationalLogDetails {
  return sanitiseOperationalDetails(value);
}

function isPhase(value: unknown): value is ExtensionDiagnosticPhase {
  return value === 'work_claimed' || value === 'work_tab_acquired' ||
    value === 'navigation_intent_recorded' || value === 'execution_finished' ||
    value === 'result_delivery_failed';
}

function isOutcome(value: unknown): value is ExtensionDiagnosticOutcome {
  return value === 'started' || value === 'completed' || value === 'failed' || value === 'stopped';
}
