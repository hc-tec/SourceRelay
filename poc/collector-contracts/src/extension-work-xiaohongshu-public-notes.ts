import {
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_CAPABILITY,
  isXiaohongshuManagedSearchProjectionResult,
  type XiaohongshuManagedSearchProjectionResult
} from './xiaohongshu-current-page-network.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^[A-Za-z0-9_-]{40,}$/;
const SAFE_ERROR = /^[a-z0-9_]{1,100}$/;

export interface XiaohongshuPublicNotesSearchWorkItem {
  schemaVersion: 1;
  protocolVersion: 1;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_CAPABILITY;
  executionTarget: 'existing_public_explore_tab';
  issuedAt: string;
  expiresAt: string;
  input: { query: string };
  budget: typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET;
  gatewaySignature: string;
}

export type UnsignedXiaohongshuPublicNotesSearchWorkItem =
  Omit<XiaohongshuPublicNotesSearchWorkItem, 'gatewaySignature'>;

export type XiaohongshuPublicNotesSearchTerminalReason =
  | 'search_ready'
  | 'existing_public_explore_tab_required'
  | 'existing_public_explore_tab_ambiguous'
  | 'document_context_changed'
  | 'search_target_unavailable'
  | 'query_not_echoed'
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

export interface XiaohongshuPublicNotesSearchWorkResult {
  schemaVersion: 1;
  protocolVersion: 1;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_CAPABILITY;
  executionTarget: 'existing_public_explore_tab';
  state: 'completed' | 'stopped';
  errorCode: string | null;
  terminalReason: XiaohongshuPublicNotesSearchTerminalReason;
  completedAt: string;
  navigation: { attempted: false; attemptCount: 0 };
  semanticAction: { attempted: boolean; attemptCount: 0 | 1 };
  input: { queryEchoed: boolean; enterAttempted: boolean };
  page: { publicSurface: 'search'; renderedCardCount: number } | null;
  projection: XiaohongshuManagedSearchProjectionResult | null;
  rawPayloadStored: false;
  responseUrlsStored: false;
  debuggerDetached: boolean;
}

export function isXiaohongshuPublicNotesSearchWorkItem(
  value: unknown
): value is XiaohongshuPublicNotesSearchWorkItem {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'issuedAt', 'expiresAt', 'input', 'budget', 'gatewaySignature'
  ])) return false;
  return value.schemaVersion === 1 && value.protocolVersion === 1 && uuid(value.workId) &&
    uuid(value.operationId) && uuid(value.browserBindingId) && value.platform === 'xiaohongshu' &&
    value.capability === XIAOHONGSHU_PUBLIC_NOTES_SEARCH_CAPABILITY &&
    value.executionTarget === 'existing_public_explore_tab' && timestamp(value.issuedAt) && timestamp(value.expiresAt) &&
    Date.parse(value.expiresAt as string) > Date.parse(value.issuedAt as string) &&
    record(value.input) && exactKeys(value.input, ['query']) && query(value.input.query) &&
    isBudget(value.budget) && typeof value.gatewaySignature === 'string' && SIGNATURE.test(value.gatewaySignature);
}

export function isXiaohongshuPublicNotesSearchWorkResult(
  value: unknown
): value is XiaohongshuPublicNotesSearchWorkResult {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'state', 'errorCode', 'terminalReason', 'completedAt', 'navigation', 'semanticAction',
    'input', 'page', 'projection', 'rawPayloadStored', 'responseUrlsStored', 'debuggerDetached'
  ])) return false;
  if (value.schemaVersion !== 1 || value.protocolVersion !== 1 || !uuid(value.workId) || !uuid(value.operationId) ||
    !uuid(value.browserBindingId) || value.platform !== 'xiaohongshu' ||
    value.capability !== XIAOHONGSHU_PUBLIC_NOTES_SEARCH_CAPABILITY ||
    value.executionTarget !== 'existing_public_explore_tab' || (value.state !== 'completed' && value.state !== 'stopped') ||
    !(value.errorCode === null || (typeof value.errorCode === 'string' && SAFE_ERROR.test(value.errorCode))) ||
    !terminalReason(value.terminalReason) || !timestamp(value.completedAt) || !zeroNavigation(value.navigation) ||
    !semanticAction(value.semanticAction) || !inputResult(value.input) || !pageResult(value.page) ||
    !(value.projection === null || isXiaohongshuManagedSearchProjectionResult(value.projection)) ||
    value.rawPayloadStored !== false || value.responseUrlsStored !== false || typeof value.debuggerDetached !== 'boolean') {
    return false;
  }
  const candidate = value as unknown as XiaohongshuPublicNotesSearchWorkResult;
  if (candidate.state === 'completed') {
    return candidate.errorCode === null && candidate.terminalReason === 'search_ready' &&
      candidate.debuggerDetached === true && candidate.semanticAction.attempted &&
      candidate.semanticAction.attemptCount === 1 && candidate.input.queryEchoed &&
      candidate.input.enterAttempted && candidate.page !== null && candidate.page.renderedCardCount > 0 &&
      candidate.projection !== null && candidate.projection.items.length > 0;
  }
  return candidate.errorCode !== null;
}

export function isXiaohongshuPublicNotesSearchWorkResultForItem(
  value: unknown,
  item: XiaohongshuPublicNotesSearchWorkItem
): value is XiaohongshuPublicNotesSearchWorkResult {
  return isXiaohongshuPublicNotesSearchWorkResult(value) && value.workId === item.workId &&
    value.operationId === item.operationId && value.browserBindingId === item.browserBindingId &&
    Date.parse(value.completedAt) >= Date.parse(item.issuedAt) &&
    value.semanticAction.attemptCount === (value.semanticAction.attempted ? 1 : 0);
}

function isBudget(value: unknown): value is typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET {
  return record(value) && exactKeys(value, [
    'maximumPlatformNavigations', 'maximumPageReloads', 'maximumPageInitiatedNewDocuments',
    'maximumSemanticActions', 'maximumNetworkResponseBodies', 'maximumProjectedItems',
    'maximumRawPayloadBytesStored'
  ]) && value.maximumPlatformNavigations === 0 && value.maximumPageReloads === 0 &&
    value.maximumPageInitiatedNewDocuments === 0 && value.maximumSemanticActions === 1 &&
    value.maximumNetworkResponseBodies === 8 && value.maximumProjectedItems === 40 &&
    value.maximumRawPayloadBytesStored === 0;
}

function terminalReason(value: unknown): value is XiaohongshuPublicNotesSearchTerminalReason {
  return typeof value === 'string' && [
    'search_ready', 'existing_public_explore_tab_required', 'existing_public_explore_tab_ambiguous',
    'document_context_changed', 'search_target_unavailable', 'query_not_echoed', 'postcondition_unmet', 'permission_required',
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
    value.attemptCount === (value.attempted ? 1 : 0);
}

function inputResult(value: unknown): boolean {
  return record(value) && exactKeys(value, ['queryEchoed', 'enterAttempted']) &&
    typeof value.queryEchoed === 'boolean' && typeof value.enterAttempted === 'boolean';
}

function pageResult(value: unknown): boolean {
  return value === null || (record(value) && exactKeys(value, ['publicSurface', 'renderedCardCount']) &&
    value.publicSurface === 'search' && Number.isSafeInteger(value.renderedCardCount) &&
    Number(value.renderedCardCount) >= 0 && Number(value.renderedCardCount) <= 40);
}

function query(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= 80 &&
    !/[\u0000-\u001f\u007f]/.test(value);
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
