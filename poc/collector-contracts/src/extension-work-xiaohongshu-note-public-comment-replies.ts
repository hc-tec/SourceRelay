export const XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_CAPABILITY =
  'xiaohongshu.note.public_comment_replies.v1' as const;
export const XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_BUDGET = Object.freeze({
  maximumPlatformNavigations: 0 as const,
  maximumPageReloads: 0 as const,
  maximumPageInitiatedNewDocuments: 0 as const,
  maximumSemanticActions: 1 as const,
  maximumNetworkResponseBodies: 8 as const,
  maximumProjectedItems: 40 as const,
  maximumRawPayloadBytesStored: 0 as const
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^[A-Za-z0-9_-]{40,}$/;
const SAFE_ERROR = /^[a-z0-9_]{1,100}$/;

export interface XiaohongshuPublicReplyProjection {
  rank: number;
  commentId: string;
  publicText: string;
  authorNickname: string;
  likedCountText: string;
  createdAtText: string;
  locationText: string;
  source: 'network' | 'dom';
}
export interface XiaohongshuPublicReplyThreadProjection {
  schemaVersion: 1;
  captureMode: 'network_projection' | 'dom_fallback' | 'hybrid';
  network: { matchedPayloadCount: number; bodyBytesRead: number; cursorObserved: boolean;
    actionTriggeredResponseCount: number };
  expandedLabelText: string;
  parentComment: XiaohongshuPublicReplyProjection;
  replies: XiaohongshuPublicReplyProjection[];
  rawPayloadStored: false;
  responseUrlsStored: false;
}
export interface XiaohongshuNotePublicCommentRepliesWorkItem {
  schemaVersion: 1; protocolVersion: 1; workId: string; operationId: string; browserBindingId: string;
  platform: 'xiaohongshu'; capability: typeof XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_CAPABILITY;
  executionTarget: 'existing_public_note_overlay'; issuedAt: string; expiresAt: string;
  input: { maximumThreads: 1 }; budget: typeof XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_BUDGET;
  gatewaySignature: string;
}
export type UnsignedXiaohongshuNotePublicCommentRepliesWorkItem =
  Omit<XiaohongshuNotePublicCommentRepliesWorkItem, 'gatewaySignature'>;
export type XiaohongshuNotePublicCommentRepliesTerminalReason =
  | 'comment_replies_ready' | 'existing_public_note_overlay_required' | 'existing_public_note_overlay_ambiguous'
  | 'reply_thread_target_unavailable' | 'document_context_changed' | 'postcondition_unmet' | 'login_required'
  | 'verification_required' | 'rate_limited' | 'source_unavailable' | 'debugger_attach_failed'
  | 'debugger_input_failed' | 'debugger_detach_failed' | 'extension_worker_interrupted';
export interface XiaohongshuNotePublicCommentRepliesWorkResult {
  schemaVersion: 1; protocolVersion: 1; workId: string; operationId: string; browserBindingId: string;
  platform: 'xiaohongshu'; capability: typeof XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_CAPABILITY;
  executionTarget: 'existing_public_note_overlay'; state: 'completed' | 'stopped'; errorCode: string | null;
  terminalReason: XiaohongshuNotePublicCommentRepliesTerminalReason; completedAt: string;
  navigation: { attempted: false; attemptCount: 0 };
  semanticAction: { attempted: boolean; attemptCount: 0 | 1 };
  thread: { requestedCount: 1; completedCount: 0 | 1 };
  page: { publicSurface: 'note_detail_overlay'; sameDocument: true } | null;
  projection: XiaohongshuPublicReplyThreadProjection | null;
  rawPayloadStored: false; responseUrlsStored: false; debuggerDetached: boolean;
}

export function isXiaohongshuNotePublicCommentRepliesWorkItem(value: unknown):
value is XiaohongshuNotePublicCommentRepliesWorkItem {
  return record(value) && exact(value, ['schemaVersion','protocolVersion','workId','operationId','browserBindingId',
    'platform','capability','executionTarget','issuedAt','expiresAt','input','budget','gatewaySignature']) &&
    value.schemaVersion === 1 && value.protocolVersion === 1 && uuid(value.workId) && uuid(value.operationId) &&
    uuid(value.browserBindingId) && value.platform === 'xiaohongshu' &&
    value.capability === XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_CAPABILITY &&
    value.executionTarget === 'existing_public_note_overlay' && timestamp(value.issuedAt) && timestamp(value.expiresAt) &&
    Date.parse(value.expiresAt) > Date.parse(value.issuedAt) && record(value.input) &&
    exact(value.input, ['maximumThreads']) && value.input.maximumThreads === 1 && record(value.budget) &&
    JSON.stringify(value.budget) === JSON.stringify(XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_BUDGET) &&
    typeof value.gatewaySignature === 'string' && SIGNATURE.test(value.gatewaySignature);
}
export function isXiaohongshuPublicReplyThreadProjection(value: unknown):
value is XiaohongshuPublicReplyThreadProjection {
  return record(value) && exact(value, ['schemaVersion','captureMode','network','expandedLabelText','parentComment',
    'replies','rawPayloadStored','responseUrlsStored']) && value.schemaVersion === 1 &&
    ['network_projection','dom_fallback','hybrid'].includes(String(value.captureMode)) && record(value.network) &&
    exact(value.network, ['matchedPayloadCount','bodyBytesRead','cursorObserved','actionTriggeredResponseCount']) &&
    integer(value.network.matchedPayloadCount,0,8) && integer(value.network.bodyBytesRead,0,16*1024*1024) &&
    typeof value.network.cursorObserved === 'boolean' && integer(value.network.actionTriggeredResponseCount,0,8) &&
    text(value.expandedLabelText,1,80) && reply(value.parentComment) && Array.isArray(value.replies) &&
    value.replies.length >= 1 && value.replies.length <= 40 && value.replies.every(reply) &&
    value.rawPayloadStored === false && value.responseUrlsStored === false;
}
export function isXiaohongshuNotePublicCommentRepliesWorkResult(value: unknown):
value is XiaohongshuNotePublicCommentRepliesWorkResult {
  if (!record(value) || !exact(value, ['schemaVersion','protocolVersion','workId','operationId','browserBindingId',
    'platform','capability','executionTarget','state','errorCode','terminalReason','completedAt','navigation',
    'semanticAction','thread','page','projection','rawPayloadStored','responseUrlsStored','debuggerDetached'])) return false;
  if (value.schemaVersion !== 1 || value.protocolVersion !== 1 || !uuid(value.workId) || !uuid(value.operationId) ||
    !uuid(value.browserBindingId) || value.platform !== 'xiaohongshu' ||
    value.capability !== XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_CAPABILITY ||
    value.executionTarget !== 'existing_public_note_overlay' || !['completed','stopped'].includes(String(value.state)) ||
    !(value.errorCode === null || (typeof value.errorCode === 'string' && SAFE_ERROR.test(value.errorCode))) ||
    !terminal(value.terminalReason) || !timestamp(value.completedAt) || !zeroNavigation(value.navigation) ||
    !action(value.semanticAction) || !thread(value.thread) || !page(value.page) ||
    !(value.projection === null || isXiaohongshuPublicReplyThreadProjection(value.projection)) ||
    value.rawPayloadStored !== false || value.responseUrlsStored !== false || typeof value.debuggerDetached !== 'boolean') return false;
  const candidate = value as unknown as XiaohongshuNotePublicCommentRepliesWorkResult;
  if (candidate.semanticAction.attempted !== (candidate.semanticAction.attemptCount === 1) ||
    candidate.thread.completedCount !== candidate.semanticAction.attemptCount) return false;
  return candidate.state === 'completed'
    ? candidate.errorCode === null && candidate.terminalReason === 'comment_replies_ready' && candidate.page !== null &&
      candidate.projection !== null && candidate.debuggerDetached
    : candidate.errorCode !== null;
}
export function isXiaohongshuNotePublicCommentRepliesWorkResultForItem(value: unknown,
  item: XiaohongshuNotePublicCommentRepliesWorkItem): value is XiaohongshuNotePublicCommentRepliesWorkResult {
  return isXiaohongshuNotePublicCommentRepliesWorkResult(value) && value.workId === item.workId &&
    value.operationId === item.operationId && value.browserBindingId === item.browserBindingId &&
    Date.parse(value.completedAt) >= Date.parse(item.issuedAt);
}
function reply(value: unknown): boolean { return record(value) && exact(value,
  ['rank','commentId','publicText','authorNickname','likedCountText','createdAtText','locationText','source']) &&
  integer(value.rank,1,40) && text(value.commentId,1,100) && text(value.publicText,1,2000) &&
  text(value.authorNickname,0,200) && text(value.likedCountText,0,40) && text(value.createdAtText,0,100) &&
  text(value.locationText,0,100) && (value.source === 'network' || value.source === 'dom'); }
function terminal(value: unknown): value is XiaohongshuNotePublicCommentRepliesTerminalReason { return typeof value === 'string' &&
  ['comment_replies_ready','existing_public_note_overlay_required','existing_public_note_overlay_ambiguous',
    'reply_thread_target_unavailable','document_context_changed','postcondition_unmet','login_required',
    'verification_required','rate_limited','source_unavailable','debugger_attach_failed','debugger_input_failed',
    'debugger_detach_failed','extension_worker_interrupted'].includes(value); }
function zeroNavigation(value: unknown): boolean { return record(value) && exact(value,['attempted','attemptCount']) &&
  value.attempted === false && value.attemptCount === 0; }
function action(value: unknown): boolean { return record(value) && exact(value,['attempted','attemptCount']) &&
  typeof value.attempted === 'boolean' && (value.attemptCount === 0 || value.attemptCount === 1); }
function thread(value: unknown): boolean { return record(value) && exact(value,['requestedCount','completedCount']) &&
  value.requestedCount === 1 && (value.completedCount === 0 || value.completedCount === 1); }
function page(value: unknown): boolean { return value === null || (record(value) && exact(value,['publicSurface','sameDocument']) &&
  value.publicSurface === 'note_detail_overlay' && value.sameDocument === true); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual=Object.keys(value); return actual.length===keys.length&&keys.every((key)=>Object.hasOwn(value,key)); }
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function integer(value: unknown,min:number,max:number): boolean { return Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max; }
function text(value: unknown,min:number,max:number): boolean { return typeof value==='string'&&value.length>=min&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value); }
