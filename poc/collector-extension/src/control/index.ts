import {
  COLLECTOR_RUNTIME_BOOTSTRAP_KEY,
  type CollectorRuntimeBootstrap
} from '@intelligence/collector-contracts';
import {
  clearUserBrowserGatewayPairing,
  getUserBrowserGatewayDirectCapabilityCatalog,
  getUserBrowserGatewayConnection,
  pairUserBrowserGateway,
  type UserBrowserGatewayConnection
} from '../background/user-browser-gateway';
import {
  USER_BROWSER_DIRECT_WORK_CAPABILITIES,
  type UserBrowserDirectWorkCapability,
  type UserBrowserGatewayCapabilityDescriptor
} from '../background/user-browser-gateway-types';

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
const directCapabilityState = element<HTMLDivElement>('direct-capability-state');
const directCapabilityList = element<HTMLDivElement>('direct-capability-list');

async function render(): Promise<void> {
  const [connection, runtime] = await Promise.all([
    getUserBrowserGatewayConnection(),
    readRuntimeBootstrap()
  ]);
  runtimeStatus.textContent = runtime
    ? `v${runtime.collectorVersion} · r${runtime.controlSurfaceRevision} · ${runtime.buildFingerprint.slice(0, 12)}`
    : `v${chrome.runtime.getManifest().version} · worker marker unavailable`;
  runtimeStatus.className = `status ${connection.state === 'online' ? 'ready' : ''}`;
  renderGatewayConnection(connection);
  await renderDirectCapabilities(connection);
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

async function renderDirectCapabilities(connection: UserBrowserGatewayConnection): Promise<void> {
  directCapabilityList.replaceChildren();
  if (connection.state === 'unpaired') {
    directCapabilityState.textContent = '尚未配对；完成本机 Gateway 配对后才会显示真实 direct work 目录。';
    renderLocalDirectCapabilityList(new Map());
    return;
  }
  if (connection.state !== 'online') {
    directCapabilityState.textContent = 'Gateway 当前未在线；不会猜测或展示过期的 direct work 状态。';
    renderLocalDirectCapabilityList(new Map());
    return;
  }
  try {
    const catalog = await getUserBrowserGatewayDirectCapabilityCatalog();
    const byCapability = new Map(catalog.map((descriptor) => [descriptor.capability, descriptor]));
    directCapabilityState.textContent =
      `本扩展编译了 ${USER_BROWSER_DIRECT_WORK_CAPABILITIES.length} 类受限 direct work；` +
      `当前 Gateway 返回 ${catalog.length} 类匹配能力。目录状态来自真实 loopback Gateway，不来自这页的硬编码文本。`;
    renderLocalDirectCapabilityList(byCapability);
  } catch (error) {
    directCapabilityState.textContent = `无法读取 Gateway direct work 目录：${safeErrorCode(error)}。`;
    renderLocalDirectCapabilityList(new Map());
  }
}

function renderLocalDirectCapabilityList(
  byCapability: ReadonlyMap<UserBrowserDirectWorkCapability, UserBrowserGatewayCapabilityDescriptor>
): void {
  for (const capability of USER_BROWSER_DIRECT_WORK_CAPABILITIES) {
    directCapabilityList.append(renderDirectCapability(capability, byCapability.get(capability) ?? null));
  }
}

function renderDirectCapability(
  capability: UserBrowserDirectWorkCapability,
  descriptor: UserBrowserGatewayCapabilityDescriptor | null
): HTMLElement {
  const card = document.createElement('article');
  card.className = 'strategy-card';
  const title = document.createElement('p');
  title.className = 'strategy-title';
  title.textContent = descriptor?.title ?? directCapabilityFallbackTitle(capability);
  const identifier = document.createElement('p');
  identifier.className = 'origins';
  identifier.textContent = capability;
  const meta = document.createElement('p');
  meta.className = 'strategy-meta';
  meta.textContent = descriptor
    ? `输入：${descriptor.inputMode} · 采集：${descriptor.captureMode}`
    : '当前 Gateway 没有返回这项本扩展已编译的 direct work；请检查 Gateway 是否已重启到同一构建。';
  const badge = document.createElement('span');
  badge.className = `badge ${descriptor?.dispatchState === 'direct_ready' ? 'granted' : 'experimental'}`;
  badge.textContent = descriptor ? dispatchStateLabel(descriptor.dispatchState) : 'Gateway 目录缺失';
  card.append(title, identifier, meta, badge);
  return card;
}

function dispatchStateLabel(value: UserBrowserGatewayCapabilityDescriptor['dispatchState']): string {
  if (value === 'direct_ready') return '已完成真实 canary';
  if (value === 'direct_canary_pending') return '已编译，待真实 canary';
  if (value === 'trusted_interaction_migration_required') return '需可信交互迁移';
  return '待迁入 direct work';
}

function directCapabilityFallbackTitle(capability: UserBrowserDirectWorkCapability): string {
  switch (capability) {
    case 'bilibili.video_detail':
      return '视频公开详情';
    case 'bilibili.native_search':
      return 'B站站内搜索';
    case 'bilibili.native_search_batch':
      return 'B站站内搜索固定两页';
    case 'bilibili.account_profile':
      return 'UP 主公开资料';
    case 'bilibili.account_inventory':
      return 'UP 主视频首屏';
  }
}

async function readRuntimeBootstrap(): Promise<CollectorRuntimeBootstrap | null> {
  const stored = await chrome.storage.session.get(COLLECTOR_RUNTIME_BOOTSTRAP_KEY);
  const candidate = stored[COLLECTOR_RUNTIME_BOOTSTRAP_KEY] as Partial<CollectorRuntimeBootstrap> | undefined;
  if (!candidate || candidate.schemaVersion !== 1 || typeof candidate.collectorVersion !== 'string' ||
    !Number.isSafeInteger(candidate.controlSurfaceRevision) || typeof candidate.buildFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(candidate.buildFingerprint)
  ) return null;
  return candidate as CollectorRuntimeBootstrap;
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_.-]{1,120}$/i.test(code) ? code : 'gateway_capability_catalog_unavailable';
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
