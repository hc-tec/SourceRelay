import {
  clearUserBrowserGatewayPairing,
  getUserBrowserGatewayConnection,
  pairUserBrowserGateway,
  type UserBrowserGatewayConnection
} from '../background/user-browser-gateway';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing control element: ${id}`);
  return found as T;
}

const runtimeStatus = element<HTMLSpanElement>('runtime-status');
const gatewayState = element<HTMLDivElement>('gateway-state');
const controlError = element<HTMLParagraphElement>('control-error');
const pairingForm = element<HTMLFormElement>('pair-gateway');
const forgetGateway = element<HTMLButtonElement>('forget-gateway');

async function render(): Promise<void> {
  const connection = await getUserBrowserGatewayConnection();
  runtimeStatus.textContent = `v${chrome.runtime.getManifest().version}`;
  runtimeStatus.className = `status ${connection.state === 'online' ? 'ready' : ''}`;
  renderGatewayConnection(connection);
  document.documentElement.dataset.collectorControlReady = 'true';
}

function renderGatewayConnection(connection: UserBrowserGatewayConnection): void {
  if (connection.state === 'unpaired') {
    gatewayState.textContent = '尚未配对。请先在 Gateway Console 创建一次性配对会话。';
    forgetGateway.hidden = true;
    return;
  }
  forgetGateway.hidden = false;
  if (connection.state === 'online' && connection.binding) {
    gatewayState.textContent = `已连接 · ${connection.pairing?.displayName ?? 'Local Collector Gateway'} · 绑定 ${connection.binding.browserBindingId}`;
    return;
  }
  gatewayState.textContent = `已有本地配对，但当前 Gateway 未验证连接：${connection.errorCode ?? 'gateway_unreachable'}`;
}

pairingForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(pairingForm);
  const submit = pairingForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!submit) return;
  submit.disabled = true;
  controlError.hidden = true;
  void pairUserBrowserGateway({
    loopbackOrigin: String(form.get('loopbackOrigin') ?? '').trim(),
    identityFingerprint: String(form.get('identityFingerprint') ?? '').trim().toLowerCase(),
    pairingSessionId: String(form.get('pairingSessionId') ?? '').trim(),
    pairingCode: String(form.get('pairingCode') ?? '').trim()
  }).then(
    (connection) => {
      renderGatewayConnection(connection);
      pairingForm.reset();
      const origin = pairingForm.elements.namedItem('loopbackOrigin');
      if (origin instanceof HTMLInputElement) origin.value = 'http://127.0.0.1:43127';
    },
    (error) => {
      controlError.textContent = error instanceof Error ? error.message : 'gateway_pairing_failed';
      controlError.hidden = false;
    }
  ).finally(() => {
    submit.disabled = false;
  });
});

forgetGateway.addEventListener('click', () => {
  void clearUserBrowserGatewayPairing().then(async () => {
    await render();
  }).catch((error) => {
    controlError.textContent = error instanceof Error ? error.message : 'gateway_pairing_clear_failed';
    controlError.hidden = false;
  });
});

void render().catch((error) => {
  controlError.textContent = error instanceof Error ? error.message : 'control_state_unavailable';
  controlError.hidden = false;
});
