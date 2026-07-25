import { canonicalJson } from './ipc.js';

/**
 * The production Gateway-to-extension protocol is intentionally narrow.  A
 * work item names one registered capability and its validated input; it is
 * never a carrier for an arbitrary URL, selector, script, CDP command, or
 * input coordinate.
 */
export const EXTENSION_WORK_SCHEMA_VERSION = 1 as const;
export const EXTENSION_WORK_PROTOCOL_VERSION = 1 as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{40,}$/;
const SAFE_ERROR_CODE = /^[a-z0-9_]{1,100}$/;

export type ExtensionWorkCapability = 'bilibili.video_detail';
export type ExtensionWorkExecutionTarget = 'collector_work_tab' | 'user_selected_tab';
export type ExtensionWorkState = 'queued' | 'claimed' | 'completed' | 'partial' | 'stopped' | 'failed';

export interface BilibiliVideoDetailWorkInput {
  canonicalVideoUrl: string;
  bvid: string;
}

/**
 * These are ceilings, not caller-configurable knobs.  The first direct-mode
 * capability has exactly one navigation and zero semantic page input.
 */
export interface BilibiliVideoDetailWorkBudget {
  maximumPlatformNavigations: 1;
  maximumSemanticActions: 0;
  maximumResponseObservations: 0;
  maximumPayloadBytes: 98_304;
}

export interface BilibiliVideoDetailWorkItem {
  schemaVersion: typeof EXTENSION_WORK_SCHEMA_VERSION;
  protocolVersion: typeof EXTENSION_WORK_PROTOCOL_VERSION;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili';
  capability: 'bilibili.video_detail';
  executionTarget: 'collector_work_tab';
  issuedAt: string;
  expiresAt: string;
  input: BilibiliVideoDetailWorkInput;
  budget: BilibiliVideoDetailWorkBudget;
  /** P-256 / SHA-256 signature over `extensionWorkSigningPayload(item)`. */
  gatewaySignature: string;
}

export type ExtensionWorkItem = BilibiliVideoDetailWorkItem;
export type UnsignedExtensionWorkItem = Omit<ExtensionWorkItem, 'gatewaySignature'>;

export type ExtensionWorkTerminalReason =
  | 'detail_ready'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'dom_projection_failed'
  | 'document_context_changed'
  | 'run_deadline_exceeded'
  | 'work_tab_closed'
  | 'work_tab_user_taken_over'
  | 'navigation_outcome_unknown'
  | 'gateway_restarted_before_completion';

export interface BilibiliVideoDetailDomObservation {
  bvid: string;
  title: string | null;
  metadataVisibleText: string | null;
  description: string | null;
  creator: {
    displayName: string | null;
    publicAccountId: string | null;
  } | null;
  tagTexts: string[];
  episodeSummaryText: string | null;
  titleVisible: boolean;
  playerVisible: boolean;
  chargeExclusiveTrialVisible: boolean;
  loginOverlayVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

/**
 * The result has no tab ID, URL, browser Profile, request headers, response
 * body, Cookie, token, or page script.  A Gateway validates the result again
 * against the claimed work item before it can become a local artifact.
 */
export interface BilibiliVideoDetailWorkResult {
  schemaVersion: typeof EXTENSION_WORK_SCHEMA_VERSION;
  protocolVersion: typeof EXTENSION_WORK_PROTOCOL_VERSION;
  workId: string;
  operationId: string;
  browserBindingId: string;
  platform: 'bilibili';
  capability: 'bilibili.video_detail';
  executionTarget: 'collector_work_tab';
  state: Exclude<ExtensionWorkState, 'queued' | 'claimed'>;
  errorCode: string | null;
  terminalReason: ExtensionWorkTerminalReason;
  completedAt: string;
  navigation: {
    attempted: boolean;
    attemptCount: 0 | 1;
  };
  workTabAcquisition: 'created' | 'reused' | 'not_acquired';
  workTabDisposition: 'idle_reusable' | 'retained_not_reusable' | 'user_taken_over' | 'closed_or_missing';
  observation: BilibiliVideoDetailDomObservation | null;
}

export type ExtensionWorkResult = BilibiliVideoDetailWorkResult;

export function canonicalBilibiliVideoWorkUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const bvid = url.protocol === 'https:' && url.hostname === 'www.bilibili.com'
      ? url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null
      : null;
    if (!bvid || url.username || url.password || url.search || url.hash) return null;
    return `https://www.bilibili.com/video/${bvid}`;
  } catch {
    return null;
  }
}

export function extensionWorkSigningPayload(item: ExtensionWorkItem | UnsignedExtensionWorkItem): string {
  const { gatewaySignature: _gatewaySignature, ...unsigned } = item as ExtensionWorkItem;
  return canonicalJson(unsigned);
}

export function isExtensionWorkItem(value: unknown): value is ExtensionWorkItem {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(value, [
      'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
      'executionTarget', 'issuedAt', 'expiresAt', 'input', 'budget', 'gatewaySignature'
    ]) ||
    value.schemaVersion !== EXTENSION_WORK_SCHEMA_VERSION ||
    value.protocolVersion !== EXTENSION_WORK_PROTOCOL_VERSION ||
    !isUuid(value.workId) || !isUuid(value.operationId) || !isUuid(value.browserBindingId) ||
    value.platform !== 'bilibili' || value.capability !== 'bilibili.video_detail' ||
    value.executionTarget !== 'collector_work_tab' || !isTimestamp(value.issuedAt) || !isTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) || !BASE64URL_PATTERN.test(stringValue(value.gatewaySignature)) ||
    !isBilibiliVideoDetailWorkInput(value.input) || !isBilibiliVideoDetailWorkBudget(value.budget)
  ) return false;
  return true;
}

export function isExtensionWorkResult(value: unknown): value is ExtensionWorkResult {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(value, [
      'schemaVersion', 'protocolVersion', 'workId', 'operationId', 'browserBindingId', 'platform', 'capability',
      'executionTarget', 'state', 'errorCode', 'terminalReason', 'completedAt', 'navigation',
      'workTabAcquisition', 'workTabDisposition', 'observation'
    ]) ||
    value.schemaVersion !== EXTENSION_WORK_SCHEMA_VERSION ||
    value.protocolVersion !== EXTENSION_WORK_PROTOCOL_VERSION ||
    !isUuid(value.workId) || !isUuid(value.operationId) || !isUuid(value.browserBindingId) ||
    value.platform !== 'bilibili' || value.capability !== 'bilibili.video_detail' ||
    value.executionTarget !== 'collector_work_tab' ||
    !isTerminalWorkState(value.state) || !isSafeNullableErrorCode(value.errorCode) ||
    !isTerminalReason(value.terminalReason) || !isTimestamp(value.completedAt) ||
    !isNavigation(value.navigation) || !isWorkTabAcquisition(value.workTabAcquisition) ||
    !isWorkTabDisposition(value.workTabDisposition) ||
    !(value.observation === null || isBilibiliVideoDetailDomObservation(value.observation))
  ) return false;
  return true;
}

export function isExtensionWorkResultForItem(
  value: unknown,
  item: ExtensionWorkItem
): value is ExtensionWorkResult {
  if (!isExtensionWorkResult(value)) return false;
  if (
    value.workId !== item.workId || value.operationId !== item.operationId ||
    value.browserBindingId !== item.browserBindingId || value.capability !== item.capability ||
    Date.parse(value.completedAt) < Date.parse(item.issuedAt)
  ) return false;
  if (value.navigation.attemptCount !== (value.navigation.attempted ? 1 : 0)) return false;
  if (value.observation && value.observation.bvid !== item.input.bvid) return false;
  if (value.state === 'completed') {
    return value.errorCode === null && value.terminalReason === 'detail_ready' && value.observation !== null &&
      value.observation.title !== null && value.observation.titleVisible && value.observation.playerVisible &&
      value.navigation.attemptCount === 1 && value.workTabDisposition === 'idle_reusable';
  }
  return true;
}

export function isBilibiliVideoDetailDomObservation(value: unknown): value is BilibiliVideoDetailDomObservation {
  if (!isRecord(value) || !hasExactKeys(value, [
    'bvid', 'title', 'metadataVisibleText', 'description', 'creator', 'tagTexts', 'episodeSummaryText',
    'titleVisible', 'playerVisible', 'chargeExclusiveTrialVisible', 'loginOverlayVisible', 'risk'
  ]) || !isBvid(value.bvid) ||
    !isNullableText(value.title, 500) || !isNullableText(value.metadataVisibleText, 1_000) ||
    !isNullableText(value.description, 20_000) || !isNullableText(value.episodeSummaryText, 500) ||
    !isTextArray(value.tagTexts, 20, 100) || !isNullableCreator(value.creator) ||
    typeof value.titleVisible !== 'boolean' || typeof value.playerVisible !== 'boolean' ||
    typeof value.chargeExclusiveTrialVisible !== 'boolean' || typeof value.loginOverlayVisible !== 'boolean' ||
    !isRecord(value.risk) || !hasExactKeys(value.risk, ['verificationRequired', 'rateLimited', 'sourceUnavailable']) ||
    typeof value.risk.verificationRequired !== 'boolean' ||
    typeof value.risk.rateLimited !== 'boolean' || typeof value.risk.sourceUnavailable !== 'boolean'
  ) return false;
  return true;
}

function isBilibiliVideoDetailWorkInput(value: unknown): value is BilibiliVideoDetailWorkInput {
  if (!isRecord(value) || Object.keys(value).length !== 2 || typeof value.canonicalVideoUrl !== 'string' || !isBvid(value.bvid)) {
    return false;
  }
  return canonicalBilibiliVideoWorkUrl(value.canonicalVideoUrl) === `https://www.bilibili.com/video/${value.bvid}`;
}

function isBilibiliVideoDetailWorkBudget(value: unknown): value is BilibiliVideoDetailWorkBudget {
  return isRecord(value) && Object.keys(value).length === 4 &&
    value.maximumPlatformNavigations === 1 && value.maximumSemanticActions === 0 &&
    value.maximumResponseObservations === 0 && value.maximumPayloadBytes === 98_304;
}

function isTerminalWorkState(value: unknown): value is BilibiliVideoDetailWorkResult['state'] {
  return value === 'completed' || value === 'partial' || value === 'stopped' || value === 'failed';
}

function isTerminalReason(value: unknown): value is ExtensionWorkTerminalReason {
  return value === 'detail_ready' || value === 'verification_required' || value === 'rate_limited' ||
    value === 'source_unavailable' || value === 'dom_projection_failed' || value === 'document_context_changed' ||
    value === 'run_deadline_exceeded' || value === 'work_tab_closed' || value === 'work_tab_user_taken_over' ||
    value === 'navigation_outcome_unknown' || value === 'gateway_restarted_before_completion';
}

function isNavigation(value: unknown): value is BilibiliVideoDetailWorkResult['navigation'] {
  return isRecord(value) && Object.keys(value).length === 2 && typeof value.attempted === 'boolean' &&
    (value.attemptCount === 0 || value.attemptCount === 1);
}

function isWorkTabDisposition(value: unknown): value is BilibiliVideoDetailWorkResult['workTabDisposition'] {
  return value === 'idle_reusable' || value === 'retained_not_reusable' ||
    value === 'user_taken_over' || value === 'closed_or_missing';
}

function isWorkTabAcquisition(value: unknown): value is BilibiliVideoDetailWorkResult['workTabAcquisition'] {
  return value === 'created' || value === 'reused' || value === 'not_acquired';
}

function isNullableCreator(value: unknown): value is BilibiliVideoDetailDomObservation['creator'] {
  return value === null || (isRecord(value) && Object.keys(value).length === 2 &&
    isNullableText(value.displayName, 200) && isNullableAccountId(value.publicAccountId));
}

function isNullableAccountId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && /^\d{1,20}$/.test(value) && value !== '0');
}

function isTextArray(value: unknown, maximumItems: number, maximumLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maximumItems && value.every((item) => isText(item, maximumLength));
}

function isNullableText(value: unknown, maximumLength: number): value is string | null {
  return value === null || isText(value, maximumLength);
}

function isText(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/.test(value) && value.trim().length > 0;
}

function isSafeNullableErrorCode(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && SAFE_ERROR_CODE.test(value));
}

function isBvid(value: unknown): value is string {
  return typeof value === 'string' && /^BV[0-9A-Za-z]{10}$/.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
