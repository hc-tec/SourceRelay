import {
  XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_BUDGET,
  XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_CAPABILITY,
  isXiaohongshuManagedProfileNotesProjectionResult,
  type XiaohongshuManagedProfileNotesProjectionResult
} from './xiaohongshu-current-page-network.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^[A-Za-z0-9_-]{40,}$/;
const SAFE_ERROR = /^[a-z0-9_]{1,100}$/;

export interface XiaohongshuAccountPublicNotesWorkItem {
  schemaVersion: 1;
  protocolVersion: 1;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: typeof XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_CAPABILITY;
  executionTarget: 'existing_public_profile_tab';
  issuedAt: string;
  expiresAt: string;
  input: { maximumScrolls: 1 | 2 | 3 };
  budget: typeof XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_BUDGET;
  gatewaySignature: string;
}

export type UnsignedXiaohongshuAccountPublicNotesWorkItem =
  Omit<XiaohongshuAccountPublicNotesWorkItem, 'gatewaySignature'>;

export type XiaohongshuAccountPublicNotesTerminalReason =
  | 'profile_notes_ready'
  | 'existing_public_profile_tab_required'
  | 'existing_public_profile_tab_ambiguous'
  | 'document_context_changed'
  | 'postcondition_unmet'
  | 'permission_required'
  | 'login_required'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'debugger_attach_failed'
  | 'debugger_input_failed'
  | 'debugger_detach_failed'
  | 'extension_worker_interrupted';

export interface XiaohongshuAccountPublicNotesWorkResult {
  schemaVersion: 1;
  protocolVersion: 1;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: typeof XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_CAPABILITY;
  executionTarget: 'existing_public_profile_tab';
  state: 'completed' | 'stopped';
  errorCode: string | null;
  terminalReason: XiaohongshuAccountPublicNotesTerminalReason;
  completedAt: string;
  navigation: { attempted: false; attemptCount: 0 };
  semanticAction: { attempted: boolean; attemptCount: 0 | 1 | 2 | 3 };
  scroll: { requestedCount: 1 | 2 | 3; completedCount: 0 | 1 | 2 | 3 };
  page: { publicSurface: 'public_profile'; renderedCardCount: number } | null;
  projection: XiaohongshuManagedProfileNotesProjectionResult | null;
  rawPayloadStored: false;
  responseUrlsStored: false;
  debuggerDetached: boolean;
}

export function isXiaohongshuAccountPublicNotesWorkItem(
  value: unknown
): value is XiaohongshuAccountPublicNotesWorkItem {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'issuedAt', 'expiresAt', 'input', 'budget', 'gatewaySignature'
  ])) return false;
  return value.schemaVersion === 1 && value.protocolVersion === 1 && uuid(value.workId) &&
    uuid(value.operationId) && uuid(value.browserBindingId) && value.platform === 'xiaohongshu' &&
    value.capability === XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_CAPABILITY &&
    value.executionTarget === 'existing_public_profile_tab' && timestamp(value.issuedAt) && timestamp(value.expiresAt) &&
    Date.parse(value.expiresAt as string) > Date.parse(value.issuedAt as string) &&
    record(value.input) && exactKeys(value.input, ['maximumScrolls']) && scrollCount(value.input.maximumScrolls) &&
    isBudget(value.budget) && typeof value.gatewaySignature === 'string' && SIGNATURE.test(value.gatewaySignature);
}

export function isXiaohongshuAccountPublicNotesWorkResult(
  value: unknown
): value is XiaohongshuAccountPublicNotesWorkResult {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'state', 'errorCode', 'terminalReason', 'completedAt', 'navigation', 'semanticAction',
    'scroll', 'page', 'projection', 'rawPayloadStored', 'responseUrlsStored', 'debuggerDetached'
  ])) return false;
  if (value.schemaVersion !== 1 || value.protocolVersion !== 1 || !uuid(value.workId) || !uuid(value.operationId) ||
    !uuid(value.browserBindingId) || value.platform !== 'xiaohongshu' ||
    value.capability !== XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_CAPABILITY ||
    value.executionTarget !== 'existing_public_profile_tab' || (value.state !== 'completed' && value.state !== 'stopped') ||
    !(value.errorCode === null || (typeof value.errorCode === 'string' && SAFE_ERROR.test(value.errorCode))) ||
    !terminalReason(value.terminalReason) || !timestamp(value.completedAt) || !zeroNavigation(value.navigation) ||
    !semanticAction(value.semanticAction) || !scroll(value.scroll) || !pageResult(value.page) ||
    !(value.projection === null || isXiaohongshuManagedProfileNotesProjectionResult(value.projection)) ||
    value.rawPayloadStored !== false || value.responseUrlsStored !== false || typeof value.debuggerDetached !== 'boolean') {
    return false;
  }
  const candidate = value as unknown as XiaohongshuAccountPublicNotesWorkResult;
  if (candidate.semanticAction.attempted !== (candidate.semanticAction.attemptCount > 0) ||
    candidate.scroll.completedCount > candidate.semanticAction.attemptCount ||
    candidate.semanticAction.attemptCount > candidate.scroll.requestedCount) return false;
  if (candidate.state === 'completed') {
    return candidate.errorCode === null && candidate.terminalReason === 'profile_notes_ready' &&
      candidate.debuggerDetached && candidate.semanticAction.attemptCount === candidate.scroll.completedCount &&
      candidate.page !== null && candidate.page.renderedCardCount > 0 &&
      candidate.projection !== null && candidate.projection.items.length > 0;
  }
  return candidate.errorCode !== null;
}

export function isXiaohongshuAccountPublicNotesWorkResultForItem(
  value: unknown,
  item: XiaohongshuAccountPublicNotesWorkItem
): value is XiaohongshuAccountPublicNotesWorkResult {
  return isXiaohongshuAccountPublicNotesWorkResult(value) && value.workId === item.workId &&
    value.operationId === item.operationId && value.browserBindingId === item.browserBindingId &&
    value.scroll.requestedCount === item.input.maximumScrolls && Date.parse(value.completedAt) >= Date.parse(item.issuedAt);
}

function isBudget(value: unknown): value is typeof XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_BUDGET {
  return record(value) && exactKeys(value, [
    'maximumPlatformNavigations', 'maximumPageReloads', 'maximumPageInitiatedNewDocuments',
    'maximumSemanticActions', 'maximumNetworkResponseBodies', 'maximumProjectedItems',
    'maximumRawPayloadBytesStored'
  ]) && value.maximumPlatformNavigations === 0 && value.maximumPageReloads === 0 &&
    value.maximumPageInitiatedNewDocuments === 0 && value.maximumSemanticActions === 3 &&
    value.maximumNetworkResponseBodies === 8 && value.maximumProjectedItems === 40 &&
    value.maximumRawPayloadBytesStored === 0;
}

function terminalReason(value: unknown): value is XiaohongshuAccountPublicNotesTerminalReason {
  return typeof value === 'string' && [
    'profile_notes_ready', 'existing_public_profile_tab_required', 'existing_public_profile_tab_ambiguous',
    'document_context_changed', 'postcondition_unmet', 'permission_required', 'login_required',
    'verification_required', 'rate_limited', 'source_unavailable', 'debugger_attach_failed',
    'debugger_input_failed', 'debugger_detach_failed', 'extension_worker_interrupted'
  ].includes(value);
}

function zeroNavigation(value: unknown): boolean {
  return record(value) && exactKeys(value, ['attempted', 'attemptCount']) &&
    value.attempted === false && value.attemptCount === 0;
}

function semanticAction(value: unknown): boolean {
  return record(value) && exactKeys(value, ['attempted', 'attemptCount']) && typeof value.attempted === 'boolean' &&
    scrollCompletedCount(value.attemptCount);
}

function scroll(value: unknown): boolean {
  return record(value) && exactKeys(value, ['requestedCount', 'completedCount']) &&
    scrollCount(value.requestedCount) && scrollCompletedCount(value.completedCount);
}

function pageResult(value: unknown): boolean {
  return value === null || (record(value) && exactKeys(value, ['publicSurface', 'renderedCardCount']) &&
    value.publicSurface === 'public_profile' && Number.isSafeInteger(value.renderedCardCount) &&
    Number(value.renderedCardCount) >= 0 && Number(value.renderedCardCount) <= 80);
}

function scrollCount(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}

function scrollCompletedCount(value: unknown): value is 0 | 1 | 2 | 3 {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
