import { canonicalBilibiliPassiveVideoWorkUrl } from './extension-work-bilibili-passive.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BVID = /^BV[0-9A-Za-z]{10}$/;
const SAFE_ERROR = /^[a-z0-9_]{1,100}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{32,256}$/;

/**
 * A bounded discussion slice executed by the extension's managed work-tab
 * lane. The Gateway signs the canonical video URL; the extension owns the
 * one navigation, foreground activation and one bounded scroll to the public
 * comment host, so callers never need to select a tab manually.
 */
export interface BilibiliVideoDiscussionUserSelectedTabWorkInput {
  canonicalVideoUrl: string;
  bvid: string;
}

export interface BilibiliVideoDiscussionUserSelectedTabWorkBudget {
  maximumPlatformNavigations: 1;
  maximumSemanticActions: 1;
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
  executionTarget: 'collector_work_tab';
  issuedAt: string;
  expiresAt: string;
  input: BilibiliVideoDiscussionUserSelectedTabWorkInput;
  budget: BilibiliVideoDiscussionUserSelectedTabWorkBudget;
  gatewaySignature: string;
}

export type BilibiliVideoDiscussionUserSelectedTabState = 'completed' | 'partial' | 'stopped' | 'failed';

export type BilibiliVideoDiscussionUserSelectedTabDisposition =
  | 'observed'
  | 'idle_reusable'
  | 'retained_not_reusable'
  | 'user_taken_over'
  | 'closed_or_missing';

export type BilibiliVideoDiscussionUserSelectedTabTerminalReason =
  | 'discussion_ready'
  | 'discussion_empty'
  | 'discussion_partial'
  | 'work_tab_closed'
  | 'work_tab_user_taken_over'
  | 'work_tab_foreground_unavailable'
  | 'navigation_outcome_unknown'
  | 'gateway_restarted_before_completion'
  | 'document_context_changed'
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
  executionTarget: 'collector_work_tab';
  state: BilibiliVideoDiscussionUserSelectedTabState;
  errorCode: string | null;
  terminalReason: BilibiliVideoDiscussionUserSelectedTabTerminalReason;
  completedAt: string;
  navigation: { attempted: boolean; attemptCount: 0 | 1 };
  workTabAcquisition: 'created' | 'reused' | 'not_acquired';
  workTabDisposition: BilibiliVideoDiscussionUserSelectedTabDisposition;
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
    value.executionTarget === 'collector_work_tab' && timestamp(value.issuedAt) && timestamp(value.expiresAt) &&
    Date.parse(value.expiresAt) > Date.parse(value.issuedAt) && typeof value.gatewaySignature === 'string' &&
    SIGNATURE.test(value.gatewaySignature) && isInput(value.input) && isBudget(value.budget);
}

export function isBilibiliVideoDiscussionUserSelectedTabWorkResult(
  value: unknown
): value is BilibiliVideoDiscussionUserSelectedTabWorkResult {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
    'executionTarget', 'state', 'errorCode', 'terminalReason', 'completedAt', 'navigation',
    'workTabAcquisition', 'workTabDisposition', 'observation'
  ])) return false;
  return value.schemaVersion === 1 && value.protocolVersion === 1 && uuid(value.workId) && uuid(value.operationId) &&
    uuid(value.browserBindingId) && value.platform === 'bilibili' && value.capability === 'bilibili.discussion' &&
    value.executionTarget === 'collector_work_tab' && isState(value.state) && nullableError(value.errorCode) &&
    isTerminalReason(value.terminalReason) && timestamp(value.completedAt) && isNavigation(value.navigation) &&
    isWorkTabAcquisition(value.workTabAcquisition) && isDisposition(value.workTabDisposition) &&
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
  if (value.errorCode !== null || value.navigation.attempted !== true || value.navigation.attemptCount !== 1 ||
    value.workTabDisposition !== 'idle_reusable' || !observation ||
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
  ]) && value.maximumPlatformNavigations === 1 && value.maximumSemanticActions === 1 &&
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

function isNavigation(value: unknown): boolean {
  return record(value) && exactKeys(value, ['attempted', 'attemptCount']) &&
    typeof value.attempted === 'boolean' && value.attemptCount === (value.attempted ? 1 : 0);
}

function isState(value: unknown): value is BilibiliVideoDiscussionUserSelectedTabState {
  return value === 'completed' || value === 'partial' || value === 'stopped' || value === 'failed';
}

function isDisposition(value: unknown): value is BilibiliVideoDiscussionUserSelectedTabDisposition {
  return value === 'observed' || value === 'idle_reusable' || value === 'retained_not_reusable' ||
    value === 'user_taken_over' || value === 'closed_or_missing';
}

function isTerminalReason(value: unknown): value is BilibiliVideoDiscussionUserSelectedTabTerminalReason {
  return value === 'discussion_ready' || value === 'discussion_empty' || value === 'discussion_partial' ||
    value === 'work_tab_closed' || value === 'work_tab_user_taken_over' ||
    value === 'work_tab_foreground_unavailable' || value === 'navigation_outcome_unknown' ||
    value === 'gateway_restarted_before_completion' || value === 'login_required' || value === 'verification_required' ||
    value === 'rate_limited' || value === 'source_unavailable' || value === 'dom_projection_failed' ||
    value === 'run_deadline_exceeded';
}

function isWorkTabAcquisition(value: unknown): boolean {
  return value === 'created' || value === 'reused' || value === 'not_acquired';
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
