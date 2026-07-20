import { canonicalJson } from './ipc.js';

export const NATIVE_BRIDGE_PROTOCOL_VERSION = 2 as const;
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

export type CollectorHostExtensionCommand = CollectorListExtensionTabsCommand;

export interface CollectorExtensionTabInventory {
  type: 'collector_extension_tab_inventory';
  schemaVersion: 1;
  tabIds: readonly number[];
}

export type CollectorExtensionCommandResult = CollectorExtensionTabInventory;

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
  return Boolean(value && typeof value === 'object' &&
    (value as Partial<CollectorHostExtensionCommand>).type === 'collector_list_extension_tabs');
}

function isCollectorExtensionCommandResult(value: unknown): value is CollectorExtensionCommandResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CollectorExtensionTabInventory>;
  if (candidate.type !== 'collector_extension_tab_inventory' || candidate.schemaVersion !== 1 ||
    !Array.isArray(candidate.tabIds) || candidate.tabIds.length > 10_000) return false;
  return candidate.tabIds.every((tabId) => Number.isSafeInteger(tabId) && Number(tabId) >= 0) &&
    new Set(candidate.tabIds).size === candidate.tabIds.length;
}

function boundedContextIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function boundedCommandId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 128;
}
