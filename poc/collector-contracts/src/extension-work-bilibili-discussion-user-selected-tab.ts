import { canonicalBilibiliPassiveVideoWorkUrl } from './extension-work-bilibili-passive.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BVID = /^BV[0-9A-Za-z]{10}$/;
const SAFE_ERROR = /^[a-z0-9_]{1,100}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{32,256}$/;

/**
 * A deliberately passive discussion slice. The user has already opened the
 * public video and scrolled the comments into view before creating the
 * one-time tab/document lease in the extension UI.
 */
export interface BilibiliVideoDiscussionUserSelectedTabWorkInput {
  canonicalVideoUrl: string;
  bvid: string;
}

export interface BilibiliVideoDiscussionUserSelectedTabWorkBudget {
  maximumPlatformNavigations: 0;
  maximumSemanticActions: 0;
  maximumResponseObservations: 0;
  maximumPayloadBytes: 98_304;
}

export interface BilibiliVideoDiscussionUserSelectedTabWorkItem {
  schemaVersion: 1;
  protocolVersion: 1;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili';
  capability: 'bilibili.discussion';
  executionTarget: 'user_selected_tab';
  issuedAt: string;
  expiresAt: string;
  input: BilibiliVideoDiscussionUserSelectedTabWorkInput;
  budget: BilibiliVideoDiscussionUserSelectedTabWorkBudget;
  gatewaySignature: string;
}

export type BilibiliVideoDiscussionUserSelectedTabState = 'completed' | 'partial' | 'stopped' | 'failed';

export type BilibiliVideoDiscussionUserSelectedTabDisposition =
  | 'observed'
  | 'selection_unavailable'
  | 'closed_or_missing'
  | 'document_changed'
  | 'target_mismatch'
  | 'foreground_unavailable';

export type BilibiliVideoDiscussionUserSelectedTabTerminalReason =
  | 'discussion_ready'
  | 'discussion_empty'
  | 'discussion_partial'
  | 'user_selected_tab_required'
  | 'user_selected_tab_closed'
  | 'user_selected_tab_document_changed'
  | 'user_selected_tab_target_mismatch'
  | 'user_selected_tab_foreground_unavailable'
  | 'user_selected_tab_worker_interrupted'
  | 'login_required'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'dom_projection_failed'
  | 'run_deadline_exceeded';

export interface BilibiliVideoDiscussionUserSelectedTabRisk {
  verificationRequired: boolean;
  rateLimited: boolean;
  sourceUnavailable: boolean;
}

/** Fixed, bounded projection of the comments already rendered by the page. */
export interface BilibiliVideoDiscussionUserSelectedTabDomObservation {
  bvid: string | null;
  commentHostPresent: boolean;
  commentHostVisible: boolean;
  commentHostInViewport: boolean;
  commentContentState: 'loading' | 'ready' | 'empty' | 'unknown';
  rootCommentTexts: string[];
  sortControls: {
    hotVisible: boolean;
    latestVisible: boolean;
    latestState: 'active' | 'inactive' | 'unknown';
  };
  loginGateVisible: boolean;
  risk: BilibiliVideoDiscussionUserSelectedTabRisk;
}

export interface BilibiliVideoDiscussionUserSelectedTabWorkResult {
  schemaVersion: 1;
  protocolVersion: 1;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili';
  capability: 'bilibili.discussion';
  executionTarget: 'user_selected_tab';
  state: BilibiliVideoDiscussionUserSelectedTabState;
  errorCode: string | null;
  terminalReason: BilibiliVideoDiscussionUserSelectedTabTerminalReason;
  completedAt: string;
  navigation: {
    attempted: false;
    attemptCount: 0;
  };
  userSelectedTabDisposition: BilibiliVideoDiscussionUserSelectedTabDisposition;
  observation: BilibiliVideoDiscussionUserSelectedTabDomObservation | null;
}

export function isBilibiliVideoDiscussionUserSelectedTabWorkItem(
  value: unknown
): value is BilibiliVideoDiscussionUserSelectedTabWorkItem {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'issuedAt', 'expiresAt', 'input', 'budget', 'gatewaySignature'
  ])) return false;
  return value.schemaVersion === 1 && value.protocolVersion === 1 && uuid(value.workId) && uuid(value.operationId) &&
    uuid(value.browserBindingId) && value.platform === 'bilibili' && value.capability === 'bilibili.discussion' &&
    value.executionTarget === 'user_selected_tab' && timestamp(value.issuedAt) && timestamp(value.expiresAt) &&
    Date.parse(value.expiresAt) > Date.parse(value.issuedAt) && typeof value.gatewaySignature === 'string' &&
    SIGNATURE.test(value.gatewaySignature) && isInput(value.input) && isBudget(value.budget);
}

export function isBilibiliVideoDiscussionUserSelectedTabWorkResult(
  value: unknown
): value is BilibiliVideoDiscussionUserSelectedTabWorkResult {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'state', 'errorCode', 'terminalReason', 'completedAt', 'navigation',
    'userSelectedTabDisposition', 'observation'
  ])) return false;
  return value.schemaVersion === 1 && value.protocolVersion === 1 && uuid(value.workId) && uuid(value.operationId) &&
    uuid(value.browserBindingId) && value.platform === 'bilibili' && value.capability === 'bilibili.discussion' &&
    value.executionTarget === 'user_selected_tab' && isState(value.state) && nullableError(value.errorCode) &&
    isTerminalReason(value.terminalReason) && timestamp(value.completedAt) && isZeroNavigation(value.navigation) &&
    isDisposition(value.userSelectedTabDisposition) &&
    (value.observation === null || isObservation(value.observation));
}

export function isBilibiliVideoDiscussionUserSelectedTabWorkResultForItem(
  value: unknown,
  item: BilibiliVideoDiscussionUserSelectedTabWorkItem
): value is BilibiliVideoDiscussionUserSelectedTabWorkResult {
  if (!isBilibiliVideoDiscussionUserSelectedTabWorkResult(value) || value.workId !== item.workId ||
    value.operationId !== item.operationId || value.browserBindingId !== item.browserBindingId ||
    Date.parse(value.completedAt) < Date.parse(item.issuedAt)
  ) return false;
  if (value.state !== 'completed') return true;
  const observation = value.observation;
  if (value.errorCode !== null || value.userSelectedTabDisposition !== 'observed' || !observation ||
    observation.bvid !== item.input.bvid || !observation.commentHostPresent || !observation.commentHostVisible ||
    !observation.commentHostInViewport || observation.loginGateVisible || observation.risk.verificationRequired ||
    observation.risk.rateLimited || observation.risk.sourceUnavailable
  ) return false;
  return (value.terminalReason === 'discussion_ready' && observation.commentContentState === 'ready' &&
    observation.rootCommentTexts.length > 0) ||
    (value.terminalReason === 'discussion_empty' && observation.commentContentState === 'empty' &&
      observation.rootCommentTexts.length === 0);
}

function isInput(value: unknown): value is BilibiliVideoDiscussionUserSelectedTabWorkInput {
  if (!record(value) || !exactKeys(value, ['canonicalVideoUrl', 'bvid']) ||
    typeof value.canonicalVideoUrl !== 'string' || typeof value.bvid !== 'string' || !BVID.test(value.bvid)
  ) return false;
  return canonicalBilibiliPassiveVideoWorkUrl(value.canonicalVideoUrl) === value.canonicalVideoUrl &&
    value.canonicalVideoUrl.endsWith(`/${value.bvid}`);
}

function isBudget(value: unknown): value is BilibiliVideoDiscussionUserSelectedTabWorkBudget {
  return record(value) && exactKeys(value, [
    'maximumPlatformNavigations', 'maximumSemanticActions', 'maximumResponseObservations', 'maximumPayloadBytes'
  ]) && value.maximumPlatformNavigations === 0 && value.maximumSemanticActions === 0 &&
    value.maximumResponseObservations === 0 && value.maximumPayloadBytes === 98_304;
}

function isObservation(value: unknown): value is BilibiliVideoDiscussionUserSelectedTabDomObservation {
  if (!record(value) || !exactKeys(value, [
    'bvid', 'commentHostPresent', 'commentHostVisible', 'commentHostInViewport', 'commentContentState',
    'rootCommentTexts', 'sortControls', 'loginGateVisible', 'risk'
  ]) || (value.bvid !== null && (typeof value.bvid !== 'string' || !BVID.test(value.bvid))) ||
    typeof value.commentHostPresent !== 'boolean' || typeof value.commentHostVisible !== 'boolean' ||
    typeof value.commentHostInViewport !== 'boolean' ||
    !['loading', 'ready', 'empty', 'unknown'].includes(string(value.commentContentState)) ||
    !Array.isArray(value.rootCommentTexts) || value.rootCommentTexts.length > 20 ||
    !value.rootCommentTexts.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 2_000) ||
    !isSortControls(value.sortControls) || typeof value.loginGateVisible !== 'boolean' || !isRisk(value.risk)
  ) return false;
  return true;
}

function isSortControls(value: unknown): boolean {
  return record(value) && exactKeys(value, ['hotVisible', 'latestVisible', 'latestState']) &&
    typeof value.hotVisible === 'boolean' && typeof value.latestVisible === 'boolean' &&
    (value.latestState === 'active' || value.latestState === 'inactive' || value.latestState === 'unknown');
}

function isRisk(value: unknown): value is BilibiliVideoDiscussionUserSelectedTabRisk {
  return record(value) && exactKeys(value, ['verificationRequired', 'rateLimited', 'sourceUnavailable']) &&
    typeof value.verificationRequired === 'boolean' && typeof value.rateLimited === 'boolean' &&
    typeof value.sourceUnavailable === 'boolean';
}

function isZeroNavigation(value: unknown): boolean {
  return record(value) && exactKeys(value, ['attempted', 'attemptCount']) &&
    value.attempted === false && value.attemptCount === 0;
}

function isState(value: unknown): value is BilibiliVideoDiscussionUserSelectedTabState {
  return value === 'completed' || value === 'partial' || value === 'stopped' || value === 'failed';
}

function isDisposition(value: unknown): value is BilibiliVideoDiscussionUserSelectedTabDisposition {
  return value === 'observed' || value === 'selection_unavailable' || value === 'closed_or_missing' ||
    value === 'document_changed' || value === 'target_mismatch' || value === 'foreground_unavailable';
}

function isTerminalReason(value: unknown): value is BilibiliVideoDiscussionUserSelectedTabTerminalReason {
  return value === 'discussion_ready' || value === 'discussion_empty' || value === 'discussion_partial' ||
    value === 'user_selected_tab_required' || value === 'user_selected_tab_closed' ||
    value === 'user_selected_tab_document_changed' || value === 'user_selected_tab_target_mismatch' ||
    value === 'user_selected_tab_foreground_unavailable' ||
    value === 'user_selected_tab_worker_interrupted' || value === 'login_required' || value === 'verification_required' ||
    value === 'rate_limited' || value === 'source_unavailable' || value === 'dom_projection_failed' ||
    value === 'run_deadline_exceeded';
}

function nullableError(value: unknown): boolean {
  return value === null || (typeof value === 'string' && SAFE_ERROR.test(value));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
