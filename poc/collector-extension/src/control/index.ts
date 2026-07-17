import type { CollectorControlSnapshot, StrategyPermissionSnapshot } from '../shared/control-plane';
import type { SupportedPlatform } from '../shared/collection-contracts';
import {
  GET_CONTROL_SNAPSHOT,
  SYNC_STRATEGY_PERMISSIONS
} from '../shared/protocol';
import { resolveNativeSearchStrategy } from '../shared/strategy-registry';

const platformLabels: Record<SupportedPlatform, string> = {
  bilibili: 'B站',
  zhihu: '知乎',
  weibo: '微博',
  xiaohongshu: '小红书'
};

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

function render(snapshot: CollectorControlSnapshot): void {
  runtimeStatus.textContent = 'Core 已连接';
  runtimeStatus.className = 'status ready';

  pairingState.textContent = snapshot.pairing
    ? `已配对：${snapshot.pairing.displayName}（${snapshot.pairing.loopbackOrigin}）`
    : '尚未配对本地 Gateway。网页和任意 localhost 客户端不能直接下发任务。';

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
