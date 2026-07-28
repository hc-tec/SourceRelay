import { canonicalJson } from './ipc.js';
import { canonicalBilibiliNativeSearchUrl } from './bilibili-native-search.js';
import { canonicalBilibiliAccountProfileUrl } from './bilibili-account-profile.js';
import {
  BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID,
  BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
  BILIBILI_COLLECTION_SERIES_STRATEGY_ID,
  BILIBILI_COLLECTION_SERIES_DETAIL_STRATEGY_ID,
  BILIBILI_DANMAKU_STRATEGY_ID,
  BILIBILI_DISCUSSION_STRATEGY_ID,
  BILIBILI_DYNAMIC_STRATEGY_ID,
  BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
  BILIBILI_TRANSCRIPT_STRATEGY_ID,
  BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
  STRATEGY_OBSERVATION_SCHEMA_VERSION,
  isBridgeJsonValue,
  type CollectorStrategyId,
  type StrategyBindingDiagnostics,
  type StrategyObservationReadRequest,
  type StrategyObservationResult,
  type StrategyObserverBindingRequest,
  type StrategyObserverBindingResult
} from './strategy-observation.js';
import {
  isXiaohongshuManagedPageNetworkObservationResult,
  isXiaohongshuManagedPageNetworkObserverArmResult,
  isXiaohongshuManagedPageNetworkObserverRequest,
  isXiaohongshuCurrentPageNetworkObservationResult,
  type XiaohongshuManagedPageNetworkObservationResult,
  type XiaohongshuManagedPageNetworkObserverArmResult,
  type XiaohongshuManagedPageNetworkObserverRequest,
  type XiaohongshuCurrentPageNetworkObservationResult
} from './xiaohongshu-current-page-network.js';

export const NATIVE_BRIDGE_PROTOCOL_VERSION = 4 as const;
export const NATIVE_BRIDGE_MAX_MESSAGE_BYTES = 256 * 1024;
export const COLLECTOR_NATIVE_BRIDGE_CONFIG_KEY = 'collector.native-bridge-config.v1' as const;
export const COLLECTOR_NATIVE_BRIDGE_STATUS_KEY = 'collector.native-bridge-status.v1' as const;

export interface CollectorNativeBridgeConfig {
  schemaVersion: 1;
  protocolVersion: typeof NATIVE_BRIDGE_PROTOCOL_VERSION;
  nativeHostName: string;
  profileId: string;
  browserSessionId: string;
}

export interface CollectorExtensionBridgeHello {
  type: 'collector_extension_bridge_hello';
  protocolVersion: typeof NATIVE_BRIDGE_PROTOCOL_VERSION;
  profileId: string;
  browserSessionId: string;
  extensionId: string;
  collectorVersion: string;
  controlSurfaceRevision: number;
  nonce: string;
}

export interface CollectorExtensionBridgeReady {
  type: 'collector_extension_bridge_ready';
  protocolVersion: typeof NATIVE_BRIDGE_PROTOCOL_VERSION;
  profileId: string;
  browserSessionId: string;
  bridgeConnectionId: string;
}

export interface CollectorListExtensionTabsCommand {
  type: 'collector_list_extension_tabs';
}

/**
 * A host cannot name a tab, URL, selector, route or action here. The
 * extension can answer only from its own one-time explicit current-page
 * selection, and returns the contract's body-free metadata projection.
 */
export interface CollectorReadXiaohongshuCurrentPageNetworkObservationCommand {
  type: 'collector_read_xiaohongshu_current_page_network_observation';
}

export interface CollectorArmXiaohongshuManagedPageNetworkObserverCommand {
  type: 'collector_arm_xiaohongshu_managed_page_network_observer';
  tabId: number;
  request: XiaohongshuManagedPageNetworkObserverRequest;
}

export interface CollectorReadXiaohongshuManagedPageNetworkObservationCommand {
  type: 'collector_read_xiaohongshu_managed_page_network_observation';
  tabId: number;
  request: XiaohongshuManagedPageNetworkObserverRequest;
}

export interface CollectorBindStrategyObserverCommand {
  type: 'collector_bind_strategy_observer';
  tabId: number;
  // A lower bound: one user navigation may contain legitimate redirects.
  nextDocumentGeneration: number;
  binding: StrategyObserverBindingRequest;
}

export interface CollectorReadStrategyObservationCommand {
  type: 'collector_read_strategy_observation';
  tabId: number;
  documentGeneration: number;
  routeGeneration: number;
  request: StrategyObservationReadRequest;
}

/**
 * A short-lived, de-sensitised lifecycle read after an observer failure.  The
 * command cannot carry a URL, a selector, page JavaScript, or a response arm.
 */
export interface CollectorReadStrategyBindingDiagnosticsCommand {
  type: 'collector_read_strategy_binding_diagnostics';
  tabId: number;
  observerBindingId: string;
  strategyId: CollectorStrategyId;
}

export type CollectorHostExtensionCommand =
  | CollectorListExtensionTabsCommand
  | CollectorReadXiaohongshuCurrentPageNetworkObservationCommand
  | CollectorArmXiaohongshuManagedPageNetworkObserverCommand
  | CollectorReadXiaohongshuManagedPageNetworkObservationCommand
  | CollectorBindStrategyObserverCommand
  | CollectorReadStrategyObservationCommand
  | CollectorReadStrategyBindingDiagnosticsCommand;

export interface CollectorExtensionTabInventory {
  type: 'collector_extension_tab_inventory';
  schemaVersion: 1;
  tabIds: readonly number[];
}

export type CollectorExtensionCommandResult =
  | CollectorExtensionTabInventory
  | XiaohongshuCurrentPageNetworkObservationResult
  | XiaohongshuManagedPageNetworkObserverArmResult
  | XiaohongshuManagedPageNetworkObservationResult
  | StrategyObserverBindingResult
  | StrategyObservationResult
  | StrategyBindingDiagnostics;

export interface CollectorHostBridgeCommand {
  type: 'collector_host_bridge_command';
  protocolVersion: typeof NATIVE_BRIDGE_PROTOCOL_VERSION;
  profileId: string;
  browserSessionId: string;
  commandId: string;
  issuedAt: string;
  expiresAt: string;
  command: CollectorHostExtensionCommand;
}

export type CollectorExtensionBridgeCommandResult = {
  type: 'collector_extension_bridge_command_result';
  protocolVersion: typeof NATIVE_BRIDGE_PROTOCOL_VERSION;
  profileId: string;
  browserSessionId: string;
  commandId: string;
} & (
  | { ok: true; result: CollectorExtensionCommandResult }
  | { ok: false; errorCode: string }
);

export interface CollectorHostBridgeCommandReceipt {
  type: 'collector_host_bridge_command_receipt';
  protocolVersion: typeof NATIVE_BRIDGE_PROTOCOL_VERSION;
  profileId: string;
  browserSessionId: string;
  commandId: string;
}

export interface CollectorExtensionBridgeStatus {
  schemaVersion: 1;
  state: 'unconfigured' | 'connecting' | 'ready' | 'disconnected' | 'rejected';
  profileId: string | null;
  browserSessionId: string | null;
  nativeHostName: string | null;
  connectedAt: string | null;
  lastErrorCode: string | null;
}

export type CollectorExtensionBridgeMessage =
  | CollectorExtensionBridgeHello
  | CollectorExtensionBridgeCommandResult;
export type CollectorHostBridgeMessage =
  | CollectorExtensionBridgeReady
  | CollectorHostBridgeCommand
  | CollectorHostBridgeCommandReceipt;

export interface NativeBridgeHandshakeRequest {
  type: 'native_bridge_handshake';
  protocolVersion: typeof NATIVE_BRIDGE_PROTOCOL_VERSION;
  hostInstanceId: string;
  profileId: string;
  browserSessionId: string;
  extensionOrigin: string;
  nonce: string;
  issuedAt: string;
  authenticationDigest: string;
}

export interface NativeBridgeHandshakeAccepted {
  ok: true;
  type: 'native_bridge_handshake_accepted';
  protocolVersion: typeof NATIVE_BRIDGE_PROTOCOL_VERSION;
  bridgeConnectionId: string;
}

export interface NativeBridgeMessageEnvelope {
  type: 'native_bridge_message';
  protocolVersion: typeof NATIVE_BRIDGE_PROTOCOL_VERSION;
  bridgeConnectionId: string;
  messageId: string;
  payload: CollectorExtensionBridgeMessage;
}

export interface NativeBridgeMessageDelivery {
  ok: true;
  type: 'native_bridge_delivery';
  protocolVersion: typeof NATIVE_BRIDGE_PROTOCOL_VERSION;
  messageId: string;
  payload: CollectorHostBridgeMessage;
}

export interface NativeBridgeHostPush {
  type: 'native_bridge_host_push';
  protocolVersion: typeof NATIVE_BRIDGE_PROTOCOL_VERSION;
  bridgeConnectionId: string;
  payload: CollectorHostBridgeMessage;
}

export interface NativeBridgeErrorResponse {
  ok: false;
  type: 'native_bridge_error';
  protocolVersion: typeof NATIVE_BRIDGE_PROTOCOL_VERSION;
  messageId: string | null;
  errorCode: string;
}

export type NativeBridgeHostRequest = NativeBridgeHandshakeRequest | NativeBridgeMessageEnvelope;
export type NativeBridgeHostResponse =
  | NativeBridgeHandshakeAccepted
  | NativeBridgeMessageDelivery
  | NativeBridgeErrorResponse
  | NativeBridgeHostPush;

export function nativeBridgeHandshakeAuthenticationPayload(
  request: Omit<NativeBridgeHandshakeRequest, 'authenticationDigest'>
): string {
  return canonicalJson(request);
}

export function isCollectorNativeBridgeConfig(value: unknown): value is CollectorNativeBridgeConfig {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CollectorNativeBridgeConfig>;
  return candidate.schemaVersion === 1 &&
    candidate.protocolVersion === NATIVE_BRIDGE_PROTOCOL_VERSION &&
    typeof candidate.nativeHostName === 'string' && /^[a-z0-9_.]{1,200}$/.test(candidate.nativeHostName) &&
    typeof candidate.profileId === 'string' && candidate.profileId.length > 0 && candidate.profileId.length <= 128 &&
    typeof candidate.browserSessionId === 'string' && candidate.browserSessionId.length > 0 &&
    candidate.browserSessionId.length <= 128;
}

export function isCollectorExtensionBridgeHello(value: unknown): value is CollectorExtensionBridgeHello {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CollectorExtensionBridgeHello>;
  return candidate.type === 'collector_extension_bridge_hello' &&
    candidate.protocolVersion === NATIVE_BRIDGE_PROTOCOL_VERSION &&
    typeof candidate.profileId === 'string' && candidate.profileId.length > 0 && candidate.profileId.length <= 128 &&
    typeof candidate.browserSessionId === 'string' && candidate.browserSessionId.length > 0 &&
    candidate.browserSessionId.length <= 128 &&
    typeof candidate.extensionId === 'string' && /^[a-p]{32}$/.test(candidate.extensionId) &&
    typeof candidate.collectorVersion === 'string' && /^\d{1,6}(?:\.\d{1,6}){2,3}$/.test(candidate.collectorVersion) &&
    Number.isSafeInteger(candidate.controlSurfaceRevision) && Number(candidate.controlSurfaceRevision) > 0 &&
    typeof candidate.nonce === 'string' && candidate.nonce.length >= 16 && candidate.nonce.length <= 128;
}

export function isCollectorHostBridgeCommand(value: unknown): value is CollectorHostBridgeCommand {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CollectorHostBridgeCommand>;
  return candidate.type === 'collector_host_bridge_command' &&
    candidate.protocolVersion === NATIVE_BRIDGE_PROTOCOL_VERSION &&
    boundedContextIdentifier(candidate.profileId) &&
    boundedContextIdentifier(candidate.browserSessionId) &&
    boundedCommandId(candidate.commandId) &&
    typeof candidate.issuedAt === 'string' && Number.isFinite(Date.parse(candidate.issuedAt)) &&
    typeof candidate.expiresAt === 'string' && Number.isFinite(Date.parse(candidate.expiresAt)) &&
    isCollectorHostExtensionCommand(candidate.command);
}

export function isCollectorExtensionBridgeCommandResult(
  value: unknown
): value is CollectorExtensionBridgeCommandResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CollectorExtensionBridgeCommandResult> & {
    result?: unknown;
    errorCode?: unknown;
  };
  if (candidate.type !== 'collector_extension_bridge_command_result' ||
    candidate.protocolVersion !== NATIVE_BRIDGE_PROTOCOL_VERSION ||
    !boundedContextIdentifier(candidate.profileId) ||
    !boundedContextIdentifier(candidate.browserSessionId) ||
    !boundedCommandId(candidate.commandId)) return false;
  return candidate.ok === true
    ? isCollectorExtensionCommandResult(candidate.result)
    : candidate.ok === false && typeof candidate.errorCode === 'string' && /^[a-z0-9_]{1,100}$/.test(candidate.errorCode);
}

export function isCollectorHostBridgeCommandReceipt(
  value: unknown
): value is CollectorHostBridgeCommandReceipt {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CollectorHostBridgeCommandReceipt>;
  return candidate.type === 'collector_host_bridge_command_receipt' &&
    candidate.protocolVersion === NATIVE_BRIDGE_PROTOCOL_VERSION &&
    boundedContextIdentifier(candidate.profileId) &&
    boundedContextIdentifier(candidate.browserSessionId) &&
    boundedCommandId(candidate.commandId);
}

function isCollectorHostExtensionCommand(value: unknown): value is CollectorHostExtensionCommand {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CollectorHostExtensionCommand> & {
    tabId?: unknown;
    nextDocumentGeneration?: unknown;
    documentGeneration?: unknown;
    routeGeneration?: unknown;
    observerBindingId?: unknown;
    strategyId?: unknown;
    binding?: unknown;
    request?: unknown;
  };
  if (candidate.type === 'collector_list_extension_tabs' ||
    candidate.type === 'collector_read_xiaohongshu_current_page_network_observation') {
    return exactKeys(candidate, ['type']);
  }
  if (!Number.isSafeInteger(candidate.tabId) || Number(candidate.tabId) < 0) return false;
  if (candidate.type === 'collector_arm_xiaohongshu_managed_page_network_observer' ||
    candidate.type === 'collector_read_xiaohongshu_managed_page_network_observation') {
    return exactKeys(candidate, ['type', 'tabId', 'request']) &&
      isXiaohongshuManagedPageNetworkObserverRequest(candidate.request);
  }
  if (candidate.type === 'collector_bind_strategy_observer') {
    return Number.isSafeInteger(candidate.nextDocumentGeneration) &&
      Number(candidate.nextDocumentGeneration) > 0 &&
      isStrategyObserverBindingRequest(candidate.binding);
  }
  if (candidate.type === 'collector_read_strategy_binding_diagnostics') {
    return boundedCommandId(candidate.observerBindingId) && isCollectorStrategyId(candidate.strategyId);
  }
  return candidate.type === 'collector_read_strategy_observation' &&
    Number.isSafeInteger(candidate.documentGeneration) && Number(candidate.documentGeneration) > 0 &&
    Number.isSafeInteger(candidate.routeGeneration) && Number(candidate.routeGeneration) >= 0 &&
    isStrategyObservationReadRequest(candidate.request);
}

function isCollectorExtensionCommandResult(value: unknown): value is CollectorExtensionCommandResult {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  if (type === 'collector_extension_tab_inventory') {
    const candidate = value as Partial<CollectorExtensionTabInventory>;
    return candidate.schemaVersion === 1 && Array.isArray(candidate.tabIds) && candidate.tabIds.length <= 10_000 &&
      candidate.tabIds.every((tabId) => Number.isSafeInteger(tabId) && Number(tabId) >= 0) &&
      new Set(candidate.tabIds).size === candidate.tabIds.length;
  }
  if (type === 'xiaohongshu_current_page_network_observation') {
    return isXiaohongshuCurrentPageNetworkObservationResult(value);
  }
  if (type === 'xiaohongshu_managed_page_network_observer_armed') {
    return isXiaohongshuManagedPageNetworkObserverArmResult(value);
  }
  if (type === 'xiaohongshu_managed_page_network_observation') {
    return isXiaohongshuManagedPageNetworkObservationResult(value);
  }
  if (type === 'collector_strategy_observer_binding') {
    const candidate = value as Partial<StrategyObserverBindingResult>;
    return candidate.schemaVersion === STRATEGY_OBSERVATION_SCHEMA_VERSION &&
      isCollectorStrategyId(candidate.strategyId) &&
      boundedCommandId(candidate.observerBindingId) &&
      typeof candidate.pageAlias === 'string' && candidate.pageAlias.length <= 128 &&
      candidate.state === 'ready' &&
      Number.isSafeInteger(candidate.nextDocumentGeneration) && Number(candidate.nextDocumentGeneration) > 0 &&
      typeof candidate.expiresAt === 'string' && Number.isFinite(Date.parse(candidate.expiresAt));
  }
  if (type === 'collector_strategy_binding_diagnostics') {
    const candidate = value as Partial<StrategyBindingDiagnostics>;
    return candidate.schemaVersion === STRATEGY_OBSERVATION_SCHEMA_VERSION &&
      isCollectorStrategyId(candidate.strategyId) &&
      boundedCommandId(candidate.observerBindingId) &&
      (candidate.bindingState === 'missing' || candidate.bindingState === 'invalid' ||
        candidate.bindingState === 'expired' || candidate.bindingState === 'active') &&
      (candidate.documentBindingState === 'not_bound' || candidate.documentBindingState === 'bound') &&
      (candidate.documentBindCount === 0 || candidate.documentBindCount === 1 ||
        candidate.documentBindCount === 2 || candidate.documentBindCount === 3) &&
      (candidate.bridgeRegistration === 'registered' || candidate.bridgeRegistration === 'missing' ||
        candidate.bridgeRegistration === 'unavailable') &&
      (candidate.currentMainFrameState === 'not_checked' || candidate.currentMainFrameState === 'unavailable' ||
        candidate.currentMainFrameState === 'target_mismatch' ||
        candidate.currentMainFrameState === 'current_document_unbound' ||
        candidate.currentMainFrameState === 'matches_bound_document' ||
        candidate.currentMainFrameState === 'different_document' ||
        candidate.currentMainFrameState === 'excluded_document');
  }
  const candidate = value as Partial<StrategyObservationResult>;
  return candidate.type === 'collector_strategy_observation' &&
    candidate.schemaVersion === STRATEGY_OBSERVATION_SCHEMA_VERSION &&
    isCollectorStrategyId(candidate.strategyId) &&
    boundedCommandId(candidate.observerBindingId) &&
    typeof candidate.pageAlias === 'string' && candidate.pageAlias.length <= 128 &&
    Number.isSafeInteger(candidate.documentGeneration) && Number(candidate.documentGeneration) > 0 &&
    Number.isSafeInteger(candidate.routeGeneration) && Number(candidate.routeGeneration) >= 0 &&
    typeof candidate.capturedAt === 'string' && Number.isFinite(Date.parse(candidate.capturedAt)) &&
    Number.isSafeInteger(candidate.payloadBytes) && Number(candidate.payloadBytes) >= 0 &&
    Number(candidate.payloadBytes) <= NATIVE_BRIDGE_MAX_MESSAGE_BYTES &&
    isBridgeJsonValue(candidate.payload);
}

function isStrategyObserverBindingRequest(value: unknown): value is StrategyObserverBindingRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StrategyObserverBindingRequest>;
  return candidate.schemaVersion === STRATEGY_OBSERVATION_SCHEMA_VERSION &&
    boundedContextIdentifier(candidate.profileId) &&
    typeof candidate.pageAlias === 'string' && candidate.pageAlias.length > 0 && candidate.pageAlias.length <= 128 &&
    boundedCommandId(candidate.pageLeaseId) &&
    Number.isSafeInteger(candidate.expectedRecordVersion) && Number(candidate.expectedRecordVersion) > 0 &&
    boundedCommandId(candidate.runId) &&
    boundedCommandId(candidate.observerBindingId) &&
    typeof candidate.expiresAt === 'string' && Date.parse(candidate.expiresAt) > Date.now() &&
    Number.isSafeInteger(candidate.maximumPayloadBytes) &&
    Number(candidate.maximumPayloadBytes) >= 1_024 && Number(candidate.maximumPayloadBytes) <= 192 * 1024 &&
    validStrategyDocumentBindingMode(candidate.documentBindingMode) &&
    validStrategyBindingTargetAndBudget(candidate);
}

function validStrategyDocumentBindingMode(value: unknown): boolean {
  return value === undefined ||
    value === 'current_document_or_next_navigation' ||
    value === 'next_navigation_only';
}

function isStrategyObservationReadRequest(value: unknown): value is StrategyObservationReadRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StrategyObservationReadRequest>;
  return candidate.schemaVersion === STRATEGY_OBSERVATION_SCHEMA_VERSION &&
    boundedContextIdentifier(candidate.profileId) &&
    typeof candidate.pageAlias === 'string' && candidate.pageAlias.length > 0 && candidate.pageAlias.length <= 128 &&
    boundedCommandId(candidate.pageLeaseId) &&
    Number.isSafeInteger(candidate.expectedRecordVersion) && Number(candidate.expectedRecordVersion) > 0 &&
    boundedCommandId(candidate.runId) &&
    boundedCommandId(candidate.observerBindingId) &&
    isCollectorStrategyId(candidate.strategyId) &&
    Number.isSafeInteger(candidate.deadlineMs) && Number(candidate.deadlineMs) >= 100 && Number(candidate.deadlineMs) <= 20_000;
}

function isCollectorStrategyId(value: unknown): value is StrategyObserverBindingRequest['strategyId'] {
  return value === BILIBILI_DYNAMIC_STRATEGY_ID ||
    value === BILIBILI_VIDEO_DETAIL_STRATEGY_ID ||
    value === BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID ||
    value === BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID ||
    value === BILIBILI_NATIVE_SEARCH_STRATEGY_ID ||
    value === BILIBILI_TRANSCRIPT_STRATEGY_ID ||
    value === BILIBILI_DISCUSSION_STRATEGY_ID ||
    value === BILIBILI_DANMAKU_STRATEGY_ID ||
    value === BILIBILI_COLLECTION_SERIES_STRATEGY_ID ||
    value === BILIBILI_COLLECTION_SERIES_DETAIL_STRATEGY_ID;
}

function validStrategyBindingTargetAndBudget(
  candidate: Partial<StrategyObserverBindingRequest>
): boolean {
  if (candidate.strategyId === BILIBILI_DYNAMIC_STRATEGY_ID) {
    return validDynamicTarget(candidate.target) &&
      (candidate.maximumResponseObservations === 1 || candidate.maximumResponseObservations === 2);
  }
  if (candidate.strategyId === BILIBILI_VIDEO_DETAIL_STRATEGY_ID) {
    return validVideoDetailTarget(candidate.target) && candidate.maximumResponseObservations === 0;
  }
  if (candidate.strategyId === BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID) {
    return validAccountVideoInventoryTarget(candidate.target) && candidate.maximumResponseObservations === 0;
  }
  if (candidate.strategyId === BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID) {
    return validAccountProfileTarget(candidate.target) && candidate.maximumResponseObservations === 0;
  }
  if (candidate.strategyId === BILIBILI_NATIVE_SEARCH_STRATEGY_ID) {
    return validBilibiliNativeSearchTarget(candidate.target) && candidate.maximumResponseObservations === 0;
  }
  if (candidate.strategyId === BILIBILI_TRANSCRIPT_STRATEGY_ID) {
    return validVideoDetailTarget(candidate.target) && candidate.maximumResponseObservations === 2;
  }
  if (candidate.strategyId === BILIBILI_DISCUSSION_STRATEGY_ID) {
    return validVideoDetailTarget(candidate.target) && candidate.maximumResponseObservations === 0;
  }
  if (candidate.strategyId === BILIBILI_DANMAKU_STRATEGY_ID) {
    return validVideoDetailTarget(candidate.target) && candidate.maximumResponseObservations === 0;
  }
  if (candidate.strategyId === BILIBILI_COLLECTION_SERIES_STRATEGY_ID) {
    return validCollectionSeriesTarget(candidate.target) && candidate.maximumResponseObservations === 1;
  }
  if (candidate.strategyId === BILIBILI_COLLECTION_SERIES_DETAIL_STRATEGY_ID) {
    return validCollectionSeriesDetailTarget(candidate.target) && candidate.maximumResponseObservations === 1;
  }
  return false;
}

function validDynamicTarget(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<{ canonicalUrl: string; stableAccountId: string }>;
  if (typeof candidate.stableAccountId !== 'string' || !/^\d{1,20}$/.test(candidate.stableAccountId)) return false;
  return candidate.canonicalUrl === `https://space.bilibili.com/${candidate.stableAccountId}/dynamic`;
}

function validVideoDetailTarget(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<{ canonicalUrl: string; bvid: string }>;
  return typeof candidate.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(candidate.bvid) &&
    candidate.canonicalUrl === `https://www.bilibili.com/video/${candidate.bvid}`;
}

function validAccountVideoInventoryTarget(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<{ canonicalUrl: string; stableAccountId: string }>;
  if (typeof candidate.stableAccountId !== 'string' || !/^\d{1,20}$/.test(candidate.stableAccountId)) return false;
  return candidate.canonicalUrl === `https://space.bilibili.com/${candidate.stableAccountId}/upload/video`;
}

function validCollectionSeriesTarget(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<{ canonicalUrl: string; stableAccountId: string }>;
  if (typeof candidate.stableAccountId !== 'string' || !/^\d{1,20}$/.test(candidate.stableAccountId)) return false;
  return candidate.canonicalUrl === `https://space.bilibili.com/${candidate.stableAccountId}/lists`;
}

function validCollectionSeriesDetailTarget(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<{
    canonicalUrl: string;
    stableAccountId: string;
    stableSeriesId: string;
    listType: 'series' | 'season';
  }>;
  if (typeof candidate.stableAccountId !== 'string' || !/^\d{1,20}$/.test(candidate.stableAccountId)) return false;
  if (typeof candidate.stableSeriesId !== 'string' || !/^\d{1,20}$/.test(candidate.stableSeriesId)) return false;
  if (candidate.listType !== 'series' && candidate.listType !== 'season') return false;
  return candidate.canonicalUrl ===
    `https://space.bilibili.com/${candidate.stableAccountId}/lists/${candidate.stableSeriesId}?type=${candidate.listType}`;
}

function validAccountProfileTarget(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<{ canonicalUrl: string; stableAccountId: string }>;
  if (typeof candidate.stableAccountId !== 'string' || !/^\d{1,20}$/.test(candidate.stableAccountId)) return false;
  return candidate.canonicalUrl === `https://space.bilibili.com/${candidate.stableAccountId}` &&
    canonicalBilibiliAccountProfileUrl(candidate.canonicalUrl, 'strict_input') === candidate.canonicalUrl;
}

function validBilibiliNativeSearchTarget(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<{ canonicalUrl: string }>;
  return typeof candidate.canonicalUrl === 'string' &&
    canonicalBilibiliNativeSearchUrl(candidate.canonicalUrl, 'strict_input') === candidate.canonicalUrl;
}

function boundedContextIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function boundedCommandId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 128;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
