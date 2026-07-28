export const XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_CAPABILITY = 'xiaohongshu.note.public_comments.v1' as const;
export const XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_BUDGET = Object.freeze({
  maximumPlatformNavigations: 0 as const,
  maximumPageReloads: 0 as const,
  maximumPageInitiatedNewDocuments: 0 as const,
  maximumSemanticActions: 3 as const,
  maximumNetworkResponseBodies: 8 as const,
  maximumProjectedItems: 80 as const,
  maximumRawPayloadBytesStored: 0 as const
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^[A-Za-z0-9_-]{40,}$/;
const SAFE_ERROR = /^[a-z0-9_]{1,100}$/;

export interface XiaohongshuPublicCommentProjection {
  rank: number;
  commentId: string;
  publicText: string;
  authorNickname: string;
  likedCountText: string;
  subCommentCountText: string;
  createdAtText: string;
  locationText: string;
  source: 'network' | 'dom';
}

export interface XiaohongshuNotePublicCommentsProjection {
  schemaVersion: 1;
  captureMode: 'network_projection' | 'dom_fallback' | 'hybrid';
  network: {
    matchedPayloadCount: number;
    bodyBytesRead: number;
    hasMore: boolean | null;
    cursorObserved: boolean;
  };
  renderedCommentCount: number;
  comments: XiaohongshuPublicCommentProjection[];
  rawPayloadStored: false;
  responseUrlsStored: false;
}

export interface XiaohongshuNotePublicCommentsWorkItem {
  schemaVersion: 1;
  protocolVersion: 1;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: typeof XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_CAPABILITY;
  executionTarget: 'existing_public_note_overlay';
  issuedAt: string;
  expiresAt: string;
  input: { maximumScrolls: 1 | 2 | 3 };
  budget: typeof XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_BUDGET;
  gatewaySignature: string;
}

export type UnsignedXiaohongshuNotePublicCommentsWorkItem =
  Omit<XiaohongshuNotePublicCommentsWorkItem, 'gatewaySignature'>;

export type XiaohongshuNotePublicCommentsTerminalReason =
  | 'note_comments_ready'
  | 'existing_public_note_overlay_required'
  | 'existing_public_note_overlay_ambiguous'
  | 'comment_scroll_container_unavailable'
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

export interface XiaohongshuNotePublicCommentsWorkResult {
  schemaVersion: 1;
  protocolVersion: 1;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: typeof XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_CAPABILITY;
  executionTarget: 'existing_public_note_overlay';
  state: 'completed' | 'stopped';
  errorCode: string | null;
  terminalReason: XiaohongshuNotePublicCommentsTerminalReason;
  completedAt: string;
  navigation: { attempted: false; attemptCount: 0 };
  semanticAction: { attempted: boolean; attemptCount: 0 | 1 | 2 | 3 };
  scroll: { requestedCount: 1 | 2 | 3; completedCount: 0 | 1 | 2 | 3 };
  page: { publicSurface: 'note_detail_overlay'; sameDocument: true } | null;
  projection: XiaohongshuNotePublicCommentsProjection | null;
  rawPayloadStored: false;
  responseUrlsStored: false;
  debuggerDetached: boolean;
}

export function isXiaohongshuNotePublicCommentsWorkItem(
  value: unknown
): value is XiaohongshuNotePublicCommentsWorkItem {
  return record(value) && exactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'issuedAt', 'expiresAt', 'input', 'budget', 'gatewaySignature'
  ]) && value.schemaVersion === 1 && value.protocolVersion === 1 && uuid(value.workId) && uuid(value.operationId) &&
    uuid(value.browserBindingId) && value.platform === 'xiaohongshu' &&
    value.capability === XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_CAPABILITY &&
    value.executionTarget === 'existing_public_note_overlay' && timestamp(value.issuedAt) && timestamp(value.expiresAt) &&
    Date.parse(value.expiresAt as string) > Date.parse(value.issuedAt as string) && record(value.input) &&
    exactKeys(value.input, ['maximumScrolls']) && scrollCount(value.input.maximumScrolls) &&
    record(value.budget) && JSON.stringify(value.budget) === JSON.stringify(XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_BUDGET) &&
    typeof value.gatewaySignature === 'string' && SIGNATURE.test(value.gatewaySignature);
}

export function isXiaohongshuNotePublicCommentsProjection(
  value: unknown
): value is XiaohongshuNotePublicCommentsProjection {
  return record(value) && exactKeys(value, [
    'schemaVersion', 'captureMode', 'network', 'renderedCommentCount', 'comments', 'rawPayloadStored', 'responseUrlsStored'
  ]) && value.schemaVersion === 1 &&
    (value.captureMode === 'network_projection' || value.captureMode === 'dom_fallback' || value.captureMode === 'hybrid') &&
    record(value.network) && exactKeys(value.network, ['matchedPayloadCount', 'bodyBytesRead', 'hasMore', 'cursorObserved']) &&
    boundedInteger(value.network.matchedPayloadCount, 0, 8) && boundedInteger(value.network.bodyBytesRead, 0, 16 * 1024 * 1024) &&
    (value.network.hasMore === null || typeof value.network.hasMore === 'boolean') &&
    typeof value.network.cursorObserved === 'boolean' && boundedInteger(value.renderedCommentCount, 0, 200) &&
    Array.isArray(value.comments) && value.comments.length <= 80 && value.comments.every(isComment) &&
    value.rawPayloadStored === false && value.responseUrlsStored === false;
}

export function isXiaohongshuNotePublicCommentsWorkResult(
  value: unknown
): value is XiaohongshuNotePublicCommentsWorkResult {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'state', 'errorCode', 'terminalReason', 'completedAt', 'navigation', 'semanticAction',
    'scroll', 'page', 'projection', 'rawPayloadStored', 'responseUrlsStored', 'debuggerDetached'
  ])) return false;
  if (value.schemaVersion !== 1 || value.protocolVersion !== 1 || !uuid(value.workId) || !uuid(value.operationId) ||
    !uuid(value.browserBindingId) || value.platform !== 'xiaohongshu' ||
    value.capability !== XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_CAPABILITY ||
    value.executionTarget !== 'existing_public_note_overlay' || (value.state !== 'completed' && value.state !== 'stopped') ||
    !(value.errorCode === null || (typeof value.errorCode === 'string' && SAFE_ERROR.test(value.errorCode))) ||
    !terminalReason(value.terminalReason) || !timestamp(value.completedAt) || !zeroNavigation(value.navigation) ||
    !semanticAction(value.semanticAction) || !scroll(value.scroll) || !page(value.page) ||
    !(value.projection === null || isXiaohongshuNotePublicCommentsProjection(value.projection)) ||
    value.rawPayloadStored !== false || value.responseUrlsStored !== false || typeof value.debuggerDetached !== 'boolean') return false;
  const candidate = value as unknown as XiaohongshuNotePublicCommentsWorkResult;
  if (candidate.semanticAction.attempted !== (candidate.semanticAction.attemptCount > 0) ||
    candidate.scroll.completedCount > candidate.semanticAction.attemptCount ||
    candidate.semanticAction.attemptCount > candidate.scroll.requestedCount) return false;
  if (candidate.state === 'completed') return candidate.errorCode === null &&
    candidate.terminalReason === 'note_comments_ready' && candidate.page !== null && candidate.projection !== null &&
    candidate.projection.comments.length > 0 && candidate.debuggerDetached;
  return candidate.errorCode !== null;
}

export function isXiaohongshuNotePublicCommentsWorkResultForItem(
  value: unknown,
  item: XiaohongshuNotePublicCommentsWorkItem
): value is XiaohongshuNotePublicCommentsWorkResult {
  return isXiaohongshuNotePublicCommentsWorkResult(value) && value.workId === item.workId &&
    value.operationId === item.operationId && value.browserBindingId === item.browserBindingId &&
    value.scroll.requestedCount === item.input.maximumScrolls && Date.parse(value.completedAt) >= Date.parse(item.issuedAt);
}

function isComment(value: unknown): boolean {
  return record(value) && exactKeys(value, [
    'rank', 'commentId', 'publicText', 'authorNickname', 'likedCountText', 'subCommentCountText',
    'createdAtText', 'locationText', 'source'
  ]) && boundedInteger(value.rank, 1, 80) && boundedText(value.commentId, 1, 100) &&
    boundedText(value.publicText, 1, 2_000) && boundedText(value.authorNickname, 0, 200) &&
    boundedText(value.likedCountText, 0, 40) && boundedText(value.subCommentCountText, 0, 40) &&
    boundedText(value.createdAtText, 0, 100) && boundedText(value.locationText, 0, 100) &&
    (value.source === 'network' || value.source === 'dom');
}
function terminalReason(value: unknown): value is XiaohongshuNotePublicCommentsTerminalReason {
  return typeof value === 'string' && [
    'note_comments_ready', 'existing_public_note_overlay_required', 'existing_public_note_overlay_ambiguous',
    'comment_scroll_container_unavailable', 'document_context_changed', 'postcondition_unmet', 'login_required',
    'verification_required', 'rate_limited', 'source_unavailable', 'debugger_attach_failed', 'debugger_input_failed',
    'debugger_detach_failed', 'extension_worker_interrupted'
  ].includes(value);
}
function zeroNavigation(value: unknown): boolean {
  return record(value) && exactKeys(value, ['attempted', 'attemptCount']) && value.attempted === false && value.attemptCount === 0;
}
function semanticAction(value: unknown): boolean {
  return record(value) && exactKeys(value, ['attempted', 'attemptCount']) && typeof value.attempted === 'boolean' &&
    completedCount(value.attemptCount);
}
function scroll(value: unknown): boolean {
  return record(value) && exactKeys(value, ['requestedCount', 'completedCount']) &&
    scrollCount(value.requestedCount) && completedCount(value.completedCount);
}
function page(value: unknown): boolean {
  return value === null || (record(value) && exactKeys(value, ['publicSurface', 'sameDocument']) &&
    value.publicSurface === 'note_detail_overlay' && value.sameDocument === true);
}
function scrollCount(value: unknown): value is 1 | 2 | 3 { return value === 1 || value === 2 || value === 3; }
function completedCount(value: unknown): value is 0 | 1 | 2 | 3 {
  return value === 0 || value === 1 || value === 2 || value === 3;
}
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
