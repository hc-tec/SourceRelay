import {
  COLLECTOR_CONTROL_SURFACE_REVISION,
  COLLECTOR_EXTENSION_VERSION,
  COLLECTOR_NATIVE_BRIDGE_CONFIG_KEY,
  COLLECTOR_NATIVE_BRIDGE_STATUS_KEY,
  NATIVE_BRIDGE_PROTOCOL_VERSION,
  isCollectorHostBridgeCommand,
  isCollectorHostBridgeCommandReceipt,
  isCollectorNativeBridgeConfig,
  type CollectorExtensionBridgeCommandResult,
  type CollectorExtensionCommandResult,
  type CollectorExtensionBridgeHello,
  type CollectorExtensionBridgeReady,
  type CollectorExtensionBridgeStatus,
  type CollectorHostBridgeCommand,
  type CollectorNativeBridgeConfig
} from '@intelligence/collector-contracts';
import {
  bindBilibiliDynamicObserver,
  readBilibiliDynamicObservation
} from './strategies/bilibili-dynamic-strategy';

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
    if (bridgeReadyMatches(message, value)) {
      void storeStatus('ready', value, null, new Date().toISOString());
      return;
    }
    if (isCollectorHostBridgeCommandReceipt(message) &&
      message.profileId === value.profileId &&
      message.browserSessionId === value.browserSessionId) return;
    if (isCollectorHostBridgeCommand(message) && commandMatchesConfig(message, value)) {
      void executeHostCommand(message).then(
        (result) => postCommandResult(port, value, message.commandId, { ok: true, result }),
        () => postCommandResult(port, value, message.commandId, {
          ok: false,
          errorCode: 'native_bridge_extension_command_failed'
        })
      );
      return;
    }
    void storeStatus('rejected', value, 'native_bridge_host_message_invalid');
    port.disconnect();
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
    collectorVersion: COLLECTOR_EXTENSION_VERSION,
    controlSurfaceRevision: COLLECTOR_CONTROL_SURFACE_REVISION,
    nonce: randomNonce()
  };
  port.postMessage(hello);
}

function commandMatchesConfig(command: CollectorHostBridgeCommand, config: CollectorNativeBridgeConfig): boolean {
  return command.profileId === config.profileId &&
    command.browserSessionId === config.browserSessionId &&
    Date.parse(command.expiresAt) > Date.now();
}

async function executeHostCommand(command: CollectorHostBridgeCommand): Promise<CollectorExtensionCommandResult> {
  switch (command.command.type) {
    case 'collector_list_extension_tabs': {
      const tabs = await chrome.tabs.query({});
      const tabIds = [...new Set(tabs
        .map((tab) => tab.id)
        .filter((tabId): tabId is number => Number.isSafeInteger(tabId) && Number(tabId) >= 0))]
        .sort((left, right) => left - right);
      return { type: 'collector_extension_tab_inventory', schemaVersion: 1, tabIds };
    }
    case 'collector_bind_strategy_observer':
      return await bindBilibiliDynamicObserver(command.command);
    case 'collector_read_strategy_observation':
      return await readBilibiliDynamicObservation(command.command);
  }
}

function postCommandResult(
  port: chrome.runtime.Port,
  config: CollectorNativeBridgeConfig,
  commandId: string,
  outcome: Pick<CollectorExtensionBridgeCommandResult, 'ok'> & {
    result?: CollectorExtensionCommandResult;
    errorCode?: string;
  }
): void {
  const message: CollectorExtensionBridgeCommandResult = outcome.ok
    ? {
        type: 'collector_extension_bridge_command_result',
        protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
        profileId: config.profileId,
        browserSessionId: config.browserSessionId,
        commandId,
        ok: true,
        result: outcome.result!
      }
    : {
        type: 'collector_extension_bridge_command_result',
        protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
        profileId: config.profileId,
        browserSessionId: config.browserSessionId,
        commandId,
        ok: false,
        errorCode: outcome.errorCode ?? 'native_bridge_extension_command_failed'
      };
  if (activePort === port) port.postMessage(message);
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
