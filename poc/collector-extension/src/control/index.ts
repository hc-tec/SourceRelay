import {
  COLLECTOR_NATIVE_BRIDGE_STATUS_KEY,
  type CollectorExtensionBridgeStatus
} from '@intelligence/collector-contracts';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing control element: ${id}`);
  return found as T;
}

const runtimeStatus = element<HTMLSpanElement>('runtime-status');
const bridgeState = element<HTMLDivElement>('bridge-state');
const controlError = element<HTMLParagraphElement>('control-error');

async function render(): Promise<void> {
  const stored = await chrome.storage.session.get(COLLECTOR_NATIVE_BRIDGE_STATUS_KEY);
  const status = stored[COLLECTOR_NATIVE_BRIDGE_STATUS_KEY] as CollectorExtensionBridgeStatus | undefined;
  runtimeStatus.textContent = `v${chrome.runtime.getManifest().version}`;
  runtimeStatus.className = `status ${status?.state === 'ready' ? 'ready' : ''}`;
  bridgeState.textContent = status?.state === 'ready'
    ? `已连接 · Profile ${status.profileId ?? 'unknown'} · Session ${status.browserSessionId ?? 'unknown'}`
    : `当前状态：${status?.state ?? 'unconfigured'}`;
  document.documentElement.dataset.collectorControlReady = 'true';
}

void render().catch((error) => {
  controlError.textContent = error instanceof Error ? error.message : 'control_state_unavailable';
  controlError.hidden = false;
});
