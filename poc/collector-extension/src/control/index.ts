import type { CollectorControlSnapshot, StrategyPermissionSnapshot } from '../shared/control-plane';
import type { SupportedPlatform } from '../shared/collection-contracts';
import {
  GET_CONTROL_SNAPSHOT,
  PAIR_GATEWAY,
  REVOKE_GATEWAY_PAIRING,
  SYNC_STRATEGY_PERMISSIONS
} from '../shared/protocol';
import { resolveNativeSearchStrategy } from '../shared/strategy-registry';

const platformLabels: Record<SupportedPlatform, string> = {
  bilibili: 'B站',
  zhihu: '知乎',
  weibo: '微博',
  xiaohongshu: '小红书'
};
const LOOPBACK_GATEWAY_PERMISSION = 'http://127.0.0.1/*';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing control element: ${id}`);
  return found as T;
}

const runtimeStatus = element<HTMLSpanElement>('runtime-status');
const pairingState = element<HTMLDivElement>('pairing-state');
const strategyList = element<HTMLDivElement>('strategy-list');
const leaseState = element<HTMLDivElement>('lease-state');
const controlError = element<HTMLParagraphElement>('control-error');

function showError(error: unknown): void {
  controlError.textContent = error instanceof Error ? error.message : String(error);
  controlError.hidden = false;
}

function clearError(): void {
  controlError.textContent = '';
  controlError.hidden = true;
}

async function controlSnapshot(): Promise<CollectorControlSnapshot> {
  const response = await chrome.runtime.sendMessage({ type: GET_CONTROL_SNAPSHOT });
  if (!response?.ok || !response.snapshot) throw new Error(response?.error ?? '无法读取 Collector 控制状态。');
  return response.snapshot as CollectorControlSnapshot;
}

async function synchronisePermissions(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: SYNC_STRATEGY_PERMISSIONS });
  if (!response?.ok) throw new Error(response?.error ?? '无法同步平台权限。');
}

function actionButton(snapshot: StrategyPermissionSnapshot): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = snapshot.granted ? 'secondary' : '';
  button.textContent = snapshot.granted ? '撤销站点权限' : '授予站点权限';
  button.addEventListener('click', async () => {
    clearError();
    button.disabled = true;
    try {
      const strategy = resolveNativeSearchStrategy(snapshot.platform);
      const request = { origins: [...strategy.browser.optionalHostPermissions] };
      const changed = snapshot.granted
        ? await chrome.permissions.remove(request)
        : await chrome.permissions.request(request);
      if (!changed && !snapshot.granted) throw new Error('用户未授予该策略所需的精确站点权限。');
      await synchronisePermissions();
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function renderStrategy(snapshot: StrategyPermissionSnapshot): HTMLElement {
  const card = document.createElement('article');
  card.className = 'strategy-card';

  const header = document.createElement('div');
  header.className = 'strategy-header';
  const title = document.createElement('p');
  title.className = 'strategy-title';
  title.textContent = platformLabels[snapshot.platform];
  const maturity = document.createElement('span');
  maturity.className = `badge ${snapshot.strategy.maturity === 'build_ready' ? 'experimental' : ''}`;
  maturity.textContent = snapshot.strategy.maturity;
  header.append(title, maturity);

  const meta = document.createElement('p');
  meta.className = 'strategy-meta';
  meta.textContent = `${snapshot.strategy.strategyId} · ${snapshot.strategy.version}`;

  const origins = document.createElement('p');
  origins.className = 'origins';
  origins.textContent = snapshot.requiredOrigins.join(' · ');

  const actions = document.createElement('div');
  actions.className = 'strategy-actions';
  const permissionBadge = document.createElement('span');
  permissionBadge.className = `badge ${snapshot.granted ? 'granted' : ''}`;
  permissionBadge.textContent = snapshot.granted ? '已授权' : '未授权';
  actions.append(permissionBadge, actionButton(snapshot));

  card.append(header, meta, origins, actions);
  return card;
}

function pairingForm(): HTMLFormElement {
  const form = document.createElement('form');
  form.className = 'pairing-form';

  const originLabel = document.createElement('label');
  originLabel.textContent = 'Gateway origin';
  const origin = document.createElement('input');
  origin.name = 'gateway-origin';
  origin.type = 'url';
  origin.required = true;
  origin.value = 'http://127.0.0.1:43127';
  origin.autocomplete = 'off';
  originLabel.append(origin);

  const sessionLabel = document.createElement('label');
  sessionLabel.textContent = '配对 Session ID';
  const sessionId = document.createElement('input');
  sessionId.name = 'pairing-session-id';
  sessionId.type = 'text';
  sessionId.required = true;
  sessionId.autocomplete = 'off';
  sessionId.placeholder = '从本地 Console 复制';
  sessionLabel.append(sessionId);

  const codeLabel = document.createElement('label');
  codeLabel.textContent = '一次性 8 位配对码';
  const pairingCode = document.createElement('input');
  pairingCode.name = 'pairing-code';
  pairingCode.type = 'text';
  pairingCode.required = true;
  pairingCode.inputMode = 'numeric';
  pairingCode.pattern = '\\d{8}';
  pairingCode.maxLength = 8;
  pairingCode.autocomplete = 'one-time-code';
  codeLabel.append(pairingCode);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = '核验并配对';

  form.append(originLabel, sessionLabel, codeLabel, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    submit.disabled = true;
    try {
      const permissionGranted = await chrome.permissions.request({ origins: [LOOPBACK_GATEWAY_PERMISSION] });
      if (!permissionGranted) throw new Error('未授予本地 Gateway loopback 权限。');
      const response = await chrome.runtime.sendMessage({
        type: PAIR_GATEWAY,
        loopbackOrigin: origin.value,
        pairingSessionId: sessionId.value.trim(),
        pairingCode: pairingCode.value.trim()
      });
      pairingCode.value = '';
      if (!response?.ok) throw new Error(response?.error ?? 'Gateway 配对失败。');
      await refresh();
    } catch (error) {
      pairingCode.value = '';
      showError(error);
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}

function renderPairing(snapshot: CollectorControlSnapshot): void {
  if (!snapshot.pairing) {
    const description = document.createElement('p');
    description.className = 'empty-state';
    description.textContent = '尚未配对。先在本地 Console 创建一次性配对 Session，再在这里核验。';
    pairingState.replaceChildren(description, pairingForm());
    return;
  }

  const details = document.createElement('div');
  const name = document.createElement('p');
  name.className = 'strategy-title';
  name.textContent = snapshot.pairing.displayName;
  const origin = document.createElement('p');
  origin.className = 'strategy-meta';
  origin.textContent = `${snapshot.pairing.loopbackOrigin} · ${snapshot.gatewayRuntime.state}`;
  const fingerprint = document.createElement('p');
  fingerprint.className = 'origins';
  fingerprint.textContent = `身份指纹 ${snapshot.pairing.identityFingerprint}`;
  details.append(name, origin, fingerprint);
  if (snapshot.gatewayRuntime.lastErrorCode) {
    const runtimeError = document.createElement('p');
    runtimeError.className = 'error';
    runtimeError.textContent = `Gateway 状态：${snapshot.gatewayRuntime.lastErrorCode}`;
    details.append(runtimeError);
  }

  const revoke = document.createElement('button');
  revoke.type = 'button';
  revoke.className = 'secondary';
  revoke.textContent = '撤销配对';
  revoke.addEventListener('click', async () => {
    clearError();
    revoke.disabled = true;
    try {
      const [response] = await Promise.all([
        chrome.runtime.sendMessage({ type: REVOKE_GATEWAY_PAIRING }),
        chrome.permissions.remove({ origins: [LOOPBACK_GATEWAY_PERMISSION] })
      ]);
      if (!response?.ok) throw new Error(response?.error ?? '无法撤销 Gateway 配对。');
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      revoke.disabled = false;
    }
  });

  const row = document.createElement('div');
  row.className = 'pairing-row';
  row.append(details, revoke);
  pairingState.replaceChildren(row);
}

function render(snapshot: CollectorControlSnapshot): void {
  runtimeStatus.textContent = 'Core 已连接';
  runtimeStatus.className = 'status ready';

  renderPairing(snapshot);

  strategyList.replaceChildren(...snapshot.strategies.map(renderStrategy));

  const activeLeases = snapshot.activeLeases.filter((lease) => lease.status === 'active');
  leaseState.textContent = activeLeases.length === 0
    ? '当前没有活动阶段。'
    : `${activeLeases.length} 个活动阶段；任务页面均受短时 lease 约束。`;

  document.documentElement.dataset.collectorControlReady = 'true';
}

async function refresh(): Promise<void> {
  clearError();
  render(await controlSnapshot());
}

void refresh().catch((error) => {
  runtimeStatus.textContent = 'Core 不可用';
  runtimeStatus.className = 'status';
  showError(error);
});
