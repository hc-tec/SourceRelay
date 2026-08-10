import {
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_DEPTH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_DEPTH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_DEPTH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_MULTI_DEPTH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_MAX_DETAILS,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_CAPABILITY,
  isXiaohongshuManagedSearchProjectionResult,
  type XiaohongshuManagedSearchProjectionResult
} from './xiaohongshu-current-page-network.js';
import type { ExtensionWorkTabAcquisition, ExtensionWorkTabDisposition } from './extension-work.js';

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
  input: {
    query: string;
    maximumDetails?: number;
    comments?: { maximumScrolls: 1 | 2 | 3; replies?: { maximumThreads: 1 | 2 | 3 } };
  };
  budget: typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET |
    typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_DEPTH_BUDGET |
    typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_DEPTH_BUDGET |
    typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_DEPTH_BUDGET |
    typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_MULTI_DEPTH_BUDGET;
  gatewaySignature: string;
}

export type UnsignedXiaohongshuPublicNotesSearchWorkItem =
  Omit<XiaohongshuPublicNotesSearchWorkItem, 'gatewaySignature'>;

export type XiaohongshuPublicNotesSearchTerminalReason =
  | 'search_ready'
  | 'search_depth_ready'
  | 'search_depth_stopped'
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
  | 'action_already_claimed'
  | 'action_in_progress'
  | 'action_expired'
  | 'query_echo_unavailable'
  | 'postcondition_unavailable'
  | 'work_tab_foreground_unavailable'
  | 'explore_navigation_not_ready'
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
  navigation: { attempted: boolean; attemptCount: 0 | 1 };
  /** Present for Collector-managed execution; omitted by the legacy canary. */
  workTabAcquisition?: ExtensionWorkTabAcquisition;
  /** Present for Collector-managed execution; omitted by the legacy canary. */
  workTabDisposition?: ExtensionWorkTabDisposition;
  semanticAction: { attempted: boolean; attemptCount: 0 | 1 };
  input: { queryEchoed: boolean; enterAttempted: boolean };
  detailActions?: {
    requestedCount: number;
    attemptedCount: number;
    completedCount: number;
    stoppedReason: string | null;
  };
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
    validInput(value.input) && isBudget(value.budget, value.input) &&
    typeof value.gatewaySignature === 'string' && SIGNATURE.test(value.gatewaySignature);
}

export function isXiaohongshuPublicNotesSearchWorkResult(
  value: unknown
): value is XiaohongshuPublicNotesSearchWorkResult {
  if (!record(value) || !searchResultKeys(value)) return false;
  if (value.schemaVersion !== 1 || value.protocolVersion !== 1 || !uuid(value.workId) || !uuid(value.operationId) ||
    !uuid(value.browserBindingId) || value.platform !== 'xiaohongshu' ||
    value.capability !== XIAOHONGSHU_PUBLIC_NOTES_SEARCH_CAPABILITY ||
    value.executionTarget !== 'existing_public_explore_tab' || (value.state !== 'completed' && value.state !== 'stopped') ||
    !(value.errorCode === null || (typeof value.errorCode === 'string' && SAFE_ERROR.test(value.errorCode))) ||
    !terminalReason(value.terminalReason) || !timestamp(value.completedAt) || !navigation(value.navigation) ||
    !workTabFields(value) ||
    !semanticAction(value.semanticAction) || !inputResult(value.input) || !detailActions(value.detailActions) || !pageResult(value.page) ||
    !(value.projection === null || isXiaohongshuManagedSearchProjectionResult(value.projection)) ||
    value.rawPayloadStored !== false || value.responseUrlsStored !== false || typeof value.debuggerDetached !== 'boolean') {
    return false;
  }
  const candidate = value as unknown as XiaohongshuPublicNotesSearchWorkResult;
  if (candidate.state === 'completed') {
    const depth = candidate.detailActions;
    const depthRequested = depth?.requestedCount ?? 0;
    return candidate.errorCode === null &&
      (depthRequested > 0 ? candidate.terminalReason === 'search_depth_ready' &&
        depth !== undefined && depth.completedCount === depth.requestedCount : candidate.terminalReason === 'search_ready') &&
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

function validInput(value: unknown): value is XiaohongshuPublicNotesSearchWorkItem['input'] {
  if (!record(value) || !query(value.query)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'query' && key !== 'maximumDetails' && key !== 'comments')) return false;
  if (Object.hasOwn(value, 'maximumDetails') &&
    (!Number.isSafeInteger(value.maximumDetails) || Number(value.maximumDetails) < 0 ||
      Number(value.maximumDetails) > XIAOHONGSHU_PUBLIC_NOTES_SEARCH_MAX_DETAILS)) return false;
  if (!Object.hasOwn(value, 'comments')) return true;
  if (!record(value.comments) || !exactKeysAllowingReplies(value.comments) ||
    (value.comments.maximumScrolls !== 1 && value.comments.maximumScrolls !== 2 && value.comments.maximumScrolls !== 3) ||
    Number(value.maximumDetails ?? 0) <= 0) return false;
  if (!Object.hasOwn(value.comments, 'replies')) return true;
  const replies = value.comments.replies;
  return record(replies) && exactKeys(replies, ['maximumThreads']) &&
    (replies.maximumThreads === 1 || replies.maximumThreads === 2 || replies.maximumThreads === 3);
}

function isBudget(
  value: unknown,
  input: XiaohongshuPublicNotesSearchWorkItem['input']
): value is XiaohongshuPublicNotesSearchWorkItem['budget'] {
  if (!record(value) || !exactKeys(value, [
    'maximumPlatformNavigations', 'maximumPageReloads', 'maximumPageInitiatedNewDocuments',
    'maximumSemanticActions', 'maximumNetworkResponseBodies', 'maximumProjectedItems',
    'maximumRawPayloadBytesStored'
  ])) return false;
  const maximumPlatformNavigations = Number(value.maximumPlatformNavigations);
  const maximumPageReloads = Number(value.maximumPageReloads);
  const maximumPageInitiatedNewDocuments = Number(value.maximumPageInitiatedNewDocuments);
  const maximumSemanticActions = Number(value.maximumSemanticActions);
  const maximumNetworkResponseBodies = Number(value.maximumNetworkResponseBodies);
  const maximumProjectedItems = Number(value.maximumProjectedItems);
  const maximumRawPayloadBytesStored = Number(value.maximumRawPayloadBytesStored);
  if (maximumPlatformNavigations !== 1 || maximumPageReloads !== 0 || maximumPageInitiatedNewDocuments !== 0 ||
    maximumRawPayloadBytesStored !== 0) return false;
  if (Number(input.maximumDetails ?? 0) <= 0) {
    return maximumSemanticActions === 1 && maximumNetworkResponseBodies === 8 && maximumProjectedItems === 40;
  }
  if (Object.hasOwn(input, 'comments') && Object.hasOwn(input.comments!, 'replies')) {
    const maximumThreads = Number(input.comments!.replies!.maximumThreads);
    if (maximumThreads > 1) {
      return maximumSemanticActions === 161 && maximumNetworkResponseBodies === 648 && maximumProjectedItems === 4040;
    }
    return maximumSemanticActions === 121 && maximumNetworkResponseBodies === 328 && maximumProjectedItems === 2440;
  }
  if (Object.hasOwn(input, 'comments')) {
    return maximumSemanticActions === 101 && maximumNetworkResponseBodies === 168 && maximumProjectedItems === 1640;
  }
  return maximumSemanticActions === 41 && maximumNetworkResponseBodies === 8 && maximumProjectedItems === 40;
}

function terminalReason(value: unknown): value is XiaohongshuPublicNotesSearchTerminalReason {
  return typeof value === 'string' && [
    'search_ready', 'search_depth_ready', 'search_depth_stopped', 'existing_public_explore_tab_required', 'existing_public_explore_tab_ambiguous',
    'document_context_changed', 'search_target_unavailable', 'query_not_echoed', 'postcondition_unmet', 'permission_required',
    'login_required', 'verification_required', 'rate_limited', 'source_unavailable', 'debugger_attach_failed',
    'debugger_input_failed', 'debugger_detach_failed', 'action_already_claimed', 'action_in_progress',
    'action_expired', 'query_echo_unavailable', 'postcondition_unavailable', 'work_tab_foreground_unavailable',
    'explore_navigation_not_ready', 'extension_worker_interrupted'
  ].includes(value);
}

function detailActions(value: unknown): boolean {
  if (value === undefined) return true;
  if (!record(value) || !exactKeys(value, ['requestedCount', 'attemptedCount', 'completedCount', 'stoppedReason'])) return false;
  return Number.isSafeInteger(value.requestedCount) && Number(value.requestedCount) >= 0 &&
    Number(value.requestedCount) <= XIAOHONGSHU_PUBLIC_NOTES_SEARCH_MAX_DETAILS &&
    Number.isSafeInteger(value.attemptedCount) && Number(value.attemptedCount) >= 0 &&
    Number(value.attemptedCount) <= Number(value.requestedCount) &&
    Number.isSafeInteger(value.completedCount) && Number(value.completedCount) >= 0 &&
    Number(value.completedCount) <= Number(value.attemptedCount) &&
    (value.stoppedReason === null || (typeof value.stoppedReason === 'string' && SAFE_ERROR.test(value.stoppedReason)));
}

function searchResultKeys(value: Record<string, unknown>): boolean {
  const base = [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'state', 'errorCode', 'terminalReason', 'completedAt', 'navigation',
    'semanticAction', 'input', 'page', 'projection', 'rawPayloadStored', 'responseUrlsStored', 'debuggerDetached'
  ] as const;
  const withDetails = [...base.slice(0, 15), 'detailActions', ...base.slice(15)];
  const withWorkTab = [...base.slice(0, 16), 'workTabAcquisition', 'workTabDisposition', ...base.slice(16)];
  const withDetailsAndWorkTab = [
    ...base.slice(0, 15), 'detailActions', ...base.slice(15, 16),
    'workTabAcquisition', 'workTabDisposition', ...base.slice(16)
  ];
  return exactKeys(value, base) || exactKeys(value, withDetails) ||
    exactKeys(value, withWorkTab) || exactKeys(value, withDetailsAndWorkTab);
}

function navigation(value: unknown): boolean {
  return record(value) && exactKeys(value, ['attempted', 'attemptCount']) &&
    typeof value.attempted === 'boolean' && (value.attemptCount === 0 || value.attemptCount === 1) &&
    value.attemptCount === (value.attempted ? 1 : 0);
}

function workTabFields(value: Record<string, unknown>): boolean {
  const hasAcquisition = Object.hasOwn(value, 'workTabAcquisition');
  const hasDisposition = Object.hasOwn(value, 'workTabDisposition');
  if (hasAcquisition !== hasDisposition) return false;
  if (!hasAcquisition) return true;
  return (value.workTabAcquisition === 'created' || value.workTabAcquisition === 'reused' ||
      value.workTabAcquisition === 'not_acquired') &&
    (value.workTabDisposition === 'idle_reusable' || value.workTabDisposition === 'retained_not_reusable' ||
      value.workTabDisposition === 'user_taken_over' || value.workTabDisposition === 'closed_or_missing');
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

function exactKeysAllowingReplies(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return (keys.length === 1 && keys[0] === 'maximumScrolls') ||
    (keys.length === 2 && keys.includes('maximumScrolls') && keys.includes('replies'));
}
