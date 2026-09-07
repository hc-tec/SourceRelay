import {
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_MAX_DETAILS,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_DEPTH_CHUNK_MAX_DETAILS,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_CAPABILITY,
  computeXiaohongshuPublicNotesSearchBudget,
  isXiaohongshuManagedSearchProjectionResult,
  type XiaohongshuManagedSearchProjectionResult,
  type XiaohongshuPublicNotesSearchBudget
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
    /** Cross-operation deduplication: noteIds whose detail+comments were
     * already captured by this caller (bounded ledger). Skipped ranks are
     * reported in detailActions.skippedCount. */
    dedupe?: { skipKnown: string[] };
  };
  budget: XiaohongshuPublicNotesSearchBudget;
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
    /** Detail+comment units skipped because their noteId was already
     * collected (input.dedupe.skipKnown). */
    skippedCount: number;
    stoppedReason: string | null;
    /** Per-rank truth: one entry per rank the loop touched (attempted or
     * skipped), in order. `stoppedReason` alone hides the real distribution
     * of failures; this makes post-hoc diagnosis exact. */
    ranks?: Array<{
      rank: number;
      noteId: string | null;
      outcome: 'completed' | 'skipped' | 'failed';
      errorCode: string | null;
    }>;
    /** Why the depth loop stopped before the requested rank budget: present
     * only on an early abort. 'overlay_persisting' = a failed rank left the
     * note overlay open so every further rank would hit-test against the
     * mask; 'platform_gate' = a login/verification/rate/source/document gate
     * that every further rank would hit too; 'internal_error' = the composed
     * run itself broke and cannot be trusted to continue. */
    abortReason?: 'overlay_persisting' | 'platform_gate' | 'internal_error';
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
        depth !== undefined &&
        depth.completedCount + depth.skippedCount === depth.requestedCount : candidate.terminalReason === 'search_ready') &&
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
  if (keys.some((key) => key !== 'query' && key !== 'maximumDetails' && key !== 'comments' && key !== 'dedupe')) return false;
  if (Object.hasOwn(value, 'maximumDetails') &&
    (!Number.isSafeInteger(value.maximumDetails) || Number(value.maximumDetails) < 0 ||
      Number(value.maximumDetails) > XIAOHONGSHU_PUBLIC_NOTES_SEARCH_DEPTH_CHUNK_MAX_DETAILS)) return false;
  if (Object.hasOwn(value, 'dedupe') && !validDedupe(value.dedupe)) return false;
  if (!Object.hasOwn(value, 'comments')) return true;
  if (!record(value.comments) || !exactKeysAllowingReplies(value.comments) ||
    (!Number.isSafeInteger((value.comments as Record<string, unknown>).maximumScrolls) ||
      Number((value.comments as Record<string, unknown>).maximumScrolls) < 1 ||
      Number((value.comments as Record<string, unknown>).maximumScrolls) > 3) ||
    Number(value.maximumDetails ?? 0) <= 0) return false;
  if (!Object.hasOwn(value.comments, 'replies')) return true;
  const replies = value.comments.replies;
  return record(replies) && exactKeys(replies, ['maximumThreads']) &&
    Number.isSafeInteger((replies as Record<string, unknown>).maximumThreads) &&
    Number((replies as Record<string, unknown>).maximumThreads) >= 1 &&
    Number((replies as Record<string, unknown>).maximumThreads) <= 3;
}

/** Bounded dedupe ledger: at most 400 noteIds, each a bounded identifier. */
function validDedupe(value: unknown): value is { skipKnown: string[] } {
  if (!record(value) || !exactKeys(value, ['skipKnown'])) return false;
  return Array.isArray(value.skipKnown) && value.skipKnown.length <= 400 &&
    value.skipKnown.every((entry) => boundedNoteId(entry)) &&
    new Set(value.skipKnown).size === value.skipKnown.length;
}

function boundedNoteId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
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
  const expected = computeXiaohongshuPublicNotesSearchBudget({
    maximumDetails: Number(input.maximumDetails ?? 0),
    maximumScrolls: Number(input.comments?.maximumScrolls ?? 0),
    maximumThreads: Number(input.comments?.replies?.maximumThreads ?? 0)
  });
  return maximumSemanticActions === expected.maximumSemanticActions &&
    maximumNetworkResponseBodies === expected.maximumNetworkResponseBodies &&
    maximumProjectedItems === expected.maximumProjectedItems;
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
  if (!record(value) || !detailActionsKeys(value)) return false;
  if (!(Number.isSafeInteger(value.requestedCount) && Number(value.requestedCount) >= 0 &&
      Number(value.requestedCount) <= XIAOHONGSHU_PUBLIC_NOTES_SEARCH_MAX_DETAILS) ||
    !(Number.isSafeInteger(value.attemptedCount) && Number(value.attemptedCount) >= 0 &&
      Number(value.attemptedCount) <= Number(value.requestedCount)) ||
    !(Number.isSafeInteger(value.completedCount) && Number(value.completedCount) >= 0 &&
      Number(value.completedCount) <= Number(value.attemptedCount)) ||
    !(Number.isSafeInteger(value.skippedCount) && Number(value.skippedCount) >= 0 &&
      Number(value.skippedCount) <= Number(value.requestedCount)) ||
    !(Number(value.completedCount) + Number(value.skippedCount) <= Number(value.requestedCount)) ||
    !(value.stoppedReason === null || (typeof value.stoppedReason === 'string' && SAFE_ERROR.test(value.stoppedReason))) ||
    !(value.abortReason === undefined || value.abortReason === 'overlay_persisting' ||
      value.abortReason === 'platform_gate' || value.abortReason === 'internal_error')) {
    return false;
  }
  if (value.ranks === undefined) return true;
  const requestedCount = Number(value.requestedCount);
  if (!Array.isArray(value.ranks) || value.ranks.length > requestedCount) return false;
  return value.ranks.every((entry) => record(entry) && exactKeys(entry, ['rank', 'noteId', 'outcome', 'errorCode']) &&
    Number.isSafeInteger(entry.rank) && Number(entry.rank) >= 1 && Number(entry.rank) <= requestedCount &&
    (entry.noteId === null || (typeof entry.noteId === 'string' && entry.noteId.length >= 1 && entry.noteId.length <= 80)) &&
    (entry.outcome === 'completed' || entry.outcome === 'skipped' || entry.outcome === 'failed') &&
    (entry.errorCode === null || (typeof entry.errorCode === 'string' && SAFE_ERROR.test(entry.errorCode))));
}

/** New results carry `ranks`/`abortReason`; the legacy shape without them
 * stays valid so stored artifacts from older extensions still parse. */
function detailActionsKeys(value: Record<string, unknown>): boolean {
  const base = ['requestedCount', 'attemptedCount', 'completedCount', 'skippedCount', 'stoppedReason'] as const;
  const keys = Object.keys(value);
  return base.every((key) => keys.includes(key)) &&
    keys.every((key) => base.includes(key as typeof base[number]) || key === 'ranks' || key === 'abortReason');
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
