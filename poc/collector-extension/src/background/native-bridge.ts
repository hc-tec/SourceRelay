import {
  COLLECTOR_NATIVE_BRIDGE_CONFIG_KEY,
  COLLECTOR_NATIVE_BRIDGE_STATUS_KEY,
  NATIVE_BRIDGE_PROTOCOL_VERSION,
  isCollectorNativeBridgeConfig,
  type CollectorExtensionBridgeHello,
  type CollectorExtensionBridgeReady,
  type CollectorExtensionBridgeStatus,
  type CollectorNativeBridgeConfig
} from '@intelligence/collector-contracts';
import { COLLECTOR_CONTROL_SURFACE_REVISION } from '../shared/control-plane';
import { COLLECTOR_CORE_VERSION } from '../shared/protocol';

let activePort: chrome.runtime.Port | null = null;
let activeConfig: CollectorNativeBridgeConfig | null = null;
let connectionGeneration = 0;

export async function initialiseNativeBridge(): Promise<void> {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'session' || !(COLLECTOR_NATIVE_BRIDGE_CONFIG_KEY in changes)) return;
    void connectConfiguredBridge(changes[COLLECTOR_NATIVE_BRIDGE_CONFIG_KEY]?.newValue);
  });
  const stored = await chrome.storage.session.get(COLLECTOR_NATIVE_BRIDGE_CONFIG_KEY);
  await connectConfiguredBridge(stored[COLLECTOR_NATIVE_BRIDGE_CONFIG_KEY]);
}

async function connectConfiguredBridge(value: unknown): Promise<void> {
  if (!isCollectorNativeBridgeConfig(value)) {
    activePort?.disconnect();
    activePort = null;
    activeConfig = null;
    await storeStatus('unconfigured', null, null);
    return;
  }
  if (activePort && sameConfig(activeConfig, value)) return;
  activePort?.disconnect();
  activePort = null;
  activeConfig = structuredClone(value);
  const generation = ++connectionGeneration;
  await storeStatus('connecting', value, null);

  const port = chrome.runtime.connectNative(value.nativeHostName);
  activePort = port;
  port.onMessage.addListener((message: unknown) => {
    if (generation !== connectionGeneration || activePort !== port) return;
    if (!bridgeReadyMatches(message, value)) {
      void storeStatus('rejected', value, 'native_bridge_ready_invalid');
      port.disconnect();
      return;
    }
    void storeStatus('ready', value, null, new Date().toISOString());
  });
  port.onDisconnect.addListener(() => {
    if (generation !== connectionGeneration || activePort !== port) return;
    activePort = null;
    const errorCode = chrome.runtime.lastError
      ? 'native_bridge_native_host_disconnected'
      : 'native_bridge_port_closed';
    void storeStatus('disconnected', value, errorCode);
  });
  const hello: CollectorExtensionBridgeHello = {
    type: 'collector_extension_bridge_hello',
    protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
    profileId: value.profileId,
    browserSessionId: value.browserSessionId,
    extensionId: chrome.runtime.id,
    collectorVersion: COLLECTOR_CORE_VERSION,
    controlSurfaceRevision: COLLECTOR_CONTROL_SURFACE_REVISION,
    nonce: randomNonce()
  };
  port.postMessage(hello);
}

function bridgeReadyMatches(value: unknown, config: CollectorNativeBridgeConfig): value is CollectorExtensionBridgeReady {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CollectorExtensionBridgeReady>;
  return candidate.type === 'collector_extension_bridge_ready' &&
    candidate.protocolVersion === NATIVE_BRIDGE_PROTOCOL_VERSION &&
    candidate.profileId === config.profileId &&
    candidate.browserSessionId === config.browserSessionId &&
    typeof candidate.bridgeConnectionId === 'string' && candidate.bridgeConnectionId.length > 0;
}

function sameConfig(left: CollectorNativeBridgeConfig | null, right: CollectorNativeBridgeConfig): boolean {
  return left?.nativeHostName === right.nativeHostName &&
    left.profileId === right.profileId &&
    left.browserSessionId === right.browserSessionId;
}

async function storeStatus(
  state: CollectorExtensionBridgeStatus['state'],
  config: CollectorNativeBridgeConfig | null,
  lastErrorCode: string | null,
  connectedAt: string | null = null
): Promise<void> {
  const status: CollectorExtensionBridgeStatus = {
    schemaVersion: 1,
    state,
    profileId: config?.profileId ?? null,
    browserSessionId: config?.browserSessionId ?? null,
    nativeHostName: config?.nativeHostName ?? null,
    connectedAt,
    lastErrorCode
  };
  await chrome.storage.session.set({ [COLLECTOR_NATIVE_BRIDGE_STATUS_KEY]: status });
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
