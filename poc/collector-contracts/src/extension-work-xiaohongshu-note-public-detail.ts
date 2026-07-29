import {
  isXiaohongshuNotePublicCommentsProjection,
  type XiaohongshuNotePublicCommentsProjection
} from './extension-work-xiaohongshu-note-public-comments.js';
import {
  isXiaohongshuPublicReplyThreadProjection,
  type XiaohongshuPublicReplyThreadProjection
} from './extension-work-xiaohongshu-note-public-comment-replies.js';

export const XIAOHONGSHU_NOTE_PUBLIC_DETAIL_CAPABILITY = 'xiaohongshu.note.public_detail.v1' as const;
export const XIAOHONGSHU_NOTE_PUBLIC_DETAIL_BUDGET = Object.freeze({
  maximumPlatformNavigations: 0 as const,
  maximumPageReloads: 0 as const,
  maximumPageInitiatedNewDocuments: 0 as const,
  maximumSemanticActions: 1 as const,
  maximumNetworkResponseBodies: 4 as const,
  maximumProjectedItems: 1 as const,
  maximumRawPayloadBytesStored: 0 as const
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^[A-Za-z0-9_-]{40,}$/;
const SAFE_ERROR = /^[a-z0-9_]{1,100}$/;

export interface XiaohongshuNotePublicDetailProjection {
  schemaVersion: 1;
  sourceRank: number;
  captureMode: 'network_projection' | 'dom_fallback';
  network: { matchedPayloadCount: number; bodyBytesRead: number };
  publicText: string;
  authorNickname: string;
  interactionText: string;
  visibleMediaCount: number;
  commentEntryVisible: boolean;
  comments?: XiaohongshuNotePublicCommentsProjection;
  replyThread?: XiaohongshuPublicReplyThreadProjection;
  replyThreads?: XiaohongshuPublicReplyThreadProjection[];
  rawPayloadStored: false;
  responseUrlsStored: false;
}

export interface XiaohongshuNotePublicDetailWorkItem {
  schemaVersion: 1;
  protocolVersion: 1;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: typeof XIAOHONGSHU_NOTE_PUBLIC_DETAIL_CAPABILITY;
  executionTarget: 'existing_public_search_tab';
  issuedAt: string;
  expiresAt: string;
  input: { resultRank: number };
  budget: typeof XIAOHONGSHU_NOTE_PUBLIC_DETAIL_BUDGET;
  gatewaySignature: string;
}

export type UnsignedXiaohongshuNotePublicDetailWorkItem =
  Omit<XiaohongshuNotePublicDetailWorkItem, 'gatewaySignature'>;

export type XiaohongshuNotePublicDetailTerminalReason =
  | 'note_detail_ready'
  | 'existing_public_search_tab_required'
  | 'existing_public_search_tab_ambiguous'
  | 'search_result_rank_unavailable'
  | 'note_detail_target_new_tab'
  | 'document_context_changed'
  | 'postcondition_unmet'
  | 'login_required'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'debugger_attach_failed'
  | 'debugger_input_failed'
  | 'debugger_detach_failed'
  | 'extension_worker_interrupted';

export interface XiaohongshuNotePublicDetailWorkResult {
  schemaVersion: 1;
  protocolVersion: 1;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: typeof XIAOHONGSHU_NOTE_PUBLIC_DETAIL_CAPABILITY;
  executionTarget: 'existing_public_search_tab';
  state: 'completed' | 'stopped';
  errorCode: string | null;
  terminalReason: XiaohongshuNotePublicDetailTerminalReason;
  completedAt: string;
  navigation: { attempted: false; attemptCount: 0 };
  semanticAction: { attempted: boolean; attemptCount: 0 | 1 };
  page: { publicSurface: 'note_detail_overlay'; sameDocument: true } | null;
  projection: XiaohongshuNotePublicDetailProjection | null;
  rawPayloadStored: false;
  responseUrlsStored: false;
  debuggerDetached: boolean;
}

export function isXiaohongshuNotePublicDetailWorkItem(
  value: unknown
): value is XiaohongshuNotePublicDetailWorkItem {
  return record(value) && exactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'issuedAt', 'expiresAt', 'input', 'budget', 'gatewaySignature'
  ]) && value.schemaVersion === 1 && value.protocolVersion === 1 && uuid(value.workId) && uuid(value.operationId) &&
    uuid(value.browserBindingId) && value.platform === 'xiaohongshu' &&
    value.capability === XIAOHONGSHU_NOTE_PUBLIC_DETAIL_CAPABILITY &&
    value.executionTarget === 'existing_public_search_tab' && timestamp(value.issuedAt) && timestamp(value.expiresAt) &&
    Date.parse(value.expiresAt as string) > Date.parse(value.issuedAt as string) && record(value.input) &&
    exactKeys(value.input, ['resultRank']) && rank(value.input.resultRank) && budget(value.budget) &&
    typeof value.gatewaySignature === 'string' && SIGNATURE.test(value.gatewaySignature);
}

export function isXiaohongshuNotePublicDetailProjection(
  value: unknown
): value is XiaohongshuNotePublicDetailProjection {
  return record(value) && detailProjectionKeys(value) && value.schemaVersion === 1 && rank(value.sourceRank) &&
    (value.captureMode === 'network_projection' || value.captureMode === 'dom_fallback') &&
    record(value.network) && exactKeys(value.network, ['matchedPayloadCount', 'bodyBytesRead']) &&
    boundedInteger(value.network.matchedPayloadCount, 0, 4) && boundedInteger(value.network.bodyBytesRead, 0, 8 * 1024 * 1024) &&
    boundedText(value.publicText, 1, 12_000) && boundedText(value.authorNickname, 0, 200) &&
    boundedText(value.interactionText, 0, 1_000) && boundedInteger(value.visibleMediaCount, 0, 20) &&
    typeof value.commentEntryVisible === 'boolean' &&
    (value.comments === undefined || isXiaohongshuNotePublicCommentsProjection(value.comments)) &&
    (value.replyThread === undefined || isXiaohongshuPublicReplyThreadProjection(value.replyThread)) &&
    (value.replyThreads === undefined || (Array.isArray(value.replyThreads) && value.replyThreads.length >= 1 &&
      value.replyThreads.length <= 3 && value.replyThreads.every(isXiaohongshuPublicReplyThreadProjection))) &&
    value.rawPayloadStored === false && value.responseUrlsStored === false;
}

export function isXiaohongshuNotePublicDetailWorkResult(
  value: unknown
): value is XiaohongshuNotePublicDetailWorkResult {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'state', 'errorCode', 'terminalReason', 'completedAt', 'navigation', 'semanticAction',
    'page', 'projection', 'rawPayloadStored', 'responseUrlsStored', 'debuggerDetached'
  ])) return false;
  if (value.schemaVersion !== 1 || value.protocolVersion !== 1 || !uuid(value.workId) || !uuid(value.operationId) ||
    !uuid(value.browserBindingId) || value.platform !== 'xiaohongshu' ||
    value.capability !== XIAOHONGSHU_NOTE_PUBLIC_DETAIL_CAPABILITY ||
    value.executionTarget !== 'existing_public_search_tab' || (value.state !== 'completed' && value.state !== 'stopped') ||
    !(value.errorCode === null || (typeof value.errorCode === 'string' && SAFE_ERROR.test(value.errorCode))) ||
    !terminalReason(value.terminalReason) || !timestamp(value.completedAt) || !zeroNavigation(value.navigation) ||
    !semanticAction(value.semanticAction) || !page(value.page) ||
    !(value.projection === null || isXiaohongshuNotePublicDetailProjection(value.projection)) ||
    value.rawPayloadStored !== false || value.responseUrlsStored !== false || typeof value.debuggerDetached !== 'boolean') return false;
  const candidate = value as unknown as XiaohongshuNotePublicDetailWorkResult;
  if (candidate.semanticAction.attempted !== (candidate.semanticAction.attemptCount === 1)) return false;
  if (candidate.state === 'completed') return candidate.errorCode === null && candidate.terminalReason === 'note_detail_ready' &&
    candidate.semanticAction.attemptCount === 1 && candidate.page !== null && candidate.projection !== null &&
    candidate.debuggerDetached;
  return candidate.errorCode !== null;
}

export function isXiaohongshuNotePublicDetailWorkResultForItem(
  value: unknown,
  item: XiaohongshuNotePublicDetailWorkItem
): value is XiaohongshuNotePublicDetailWorkResult {
  return isXiaohongshuNotePublicDetailWorkResult(value) && value.workId === item.workId &&
    value.operationId === item.operationId && value.browserBindingId === item.browserBindingId &&
    (value.projection === null || value.projection.sourceRank === item.input.resultRank) &&
    Date.parse(value.completedAt) >= Date.parse(item.issuedAt);
}

function budget(value: unknown): value is typeof XIAOHONGSHU_NOTE_PUBLIC_DETAIL_BUDGET {
  return record(value) && JSON.stringify(value) === JSON.stringify(XIAOHONGSHU_NOTE_PUBLIC_DETAIL_BUDGET);
}

function terminalReason(value: unknown): value is XiaohongshuNotePublicDetailTerminalReason {
  return typeof value === 'string' && [
    'note_detail_ready', 'existing_public_search_tab_required', 'existing_public_search_tab_ambiguous',
    'search_result_rank_unavailable', 'note_detail_target_new_tab', 'document_context_changed', 'postcondition_unmet',
    'login_required', 'verification_required', 'rate_limited', 'source_unavailable', 'debugger_attach_failed',
    'debugger_input_failed', 'debugger_detach_failed', 'extension_worker_interrupted'
  ].includes(value);
}

function zeroNavigation(value: unknown): boolean {
  return record(value) && exactKeys(value, ['attempted', 'attemptCount']) &&
    value.attempted === false && value.attemptCount === 0;
}

function semanticAction(value: unknown): boolean {
  return record(value) && exactKeys(value, ['attempted', 'attemptCount']) && typeof value.attempted === 'boolean' &&
    (value.attemptCount === 0 || value.attemptCount === 1);
}

function page(value: unknown): boolean {
  return value === null || (record(value) && exactKeys(value, ['publicSurface', 'sameDocument']) &&
    value.publicSurface === 'note_detail_overlay' && value.sameDocument === true);
}

function rank(value: unknown): boolean { return boundedInteger(value, 1, 20); }
function boundedInteger(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}
function boundedText(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function detailProjectionKeys(value: Record<string, unknown>): boolean {
  const base = [
    'schemaVersion', 'sourceRank', 'captureMode', 'network', 'publicText', 'authorNickname', 'interactionText',
    'visibleMediaCount', 'commentEntryVisible', 'rawPayloadStored', 'responseUrlsStored'
  ] as const;
  const withComments = [...base.slice(0, 9), 'comments', ...base.slice(9)];
  const withReplies = [...base.slice(0, 9), 'replyThread', ...base.slice(9)];
  const withReplyThreads = [...base.slice(0, 9), 'replyThreads', ...base.slice(9)];
  const withBoth = [...base.slice(0, 9), 'comments', 'replyThread', ...base.slice(9)];
  const withBothThreads = [...base.slice(0, 9), 'comments', 'replyThreads', ...base.slice(9)];
  const withAllReplies = [...base.slice(0, 9), 'replyThread', 'replyThreads', ...base.slice(9)];
  const withCommentsAndAllReplies = [...base.slice(0, 9), 'comments', 'replyThread', 'replyThreads', ...base.slice(9)];
  return exactKeys(value, base) || exactKeys(value, withComments) || exactKeys(value, withReplies) ||
    exactKeys(value, withReplyThreads) || exactKeys(value, withBoth) || exactKeys(value, withBothThreads) ||
    exactKeys(value, withAllReplies) || exactKeys(value, withCommentsAndAllReplies);
}
