import {
  COLLECTOR_CONTROL_SURFACE_REVISION,
  COLLECTOR_EXTENSION_VERSION,
  COLLECTOR_RUNTIME_BOOTSTRAP_KEY,
  type CollectorRuntimeBootstrap
} from '@intelligence/collector-contracts';
import {
  clearUserBrowserGatewayPairing,
  getUserBrowserGatewayDirectCapabilityCatalog,
  getUserBrowserGatewayConnection,
  pairUserBrowserGateway,
  requestLoopbackPermissionFromUserGesture,
  type UserBrowserGatewayConnection
} from '../background/user-browser-gateway';
import {
  GATEWAY_PAIRING_DRAFT_STORAGE_KEY,
  loadGatewayPairingDraft,
  requestSaveGatewayPairingDraft,
  type GatewayPairingDraft
} from '../background/user-browser-gateway-storage';
import {
  armNextXiaohongshuCurrentPageNetworkDocument,
  getXiaohongshuCurrentPageNetworkSelectionSummary
} from '../background/xiaohongshu-current-page-network';
import {
  USER_BROWSER_DIRECT_WORK_CAPABILITIES,
  type PairUserBrowserGatewayInput,
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
const xiaohongshuCurrentPageNetworkState = element<HTMLDivElement>('xiaohongshu-current-page-network-state');
const armNextXiaohongshuCurrentPageNetwork = element<HTMLButtonElement>(
  'arm-next-xiaohongshu-current-page-network'
);

// Input events are persisted one at a time. This keeps the last complete form
// snapshot ordered even when Chrome is busy with another storage operation.
let pairingDraftWriteQueue: Promise<void> = Promise.resolve();
let pairingFormTouched = false;
let pairingCompleted = false;

async function render(): Promise<void> {
  const [connection, runtime, draft] = await Promise.all([
    getUserBrowserGatewayConnection(),
    readRuntimeBootstrap(),
    loadGatewayPairingDraft()
  ]);
  restorePairingDraft(draft);
  runtimeStatus.textContent = runtime
    ? `v${runtime.collectorVersion} · r${runtime.controlSurfaceRevision} · ${runtime.buildFingerprint.slice(0, 12)}`
    : `v${chrome.runtime.getManifest().version} · worker marker unavailable`;
  runtimeStatus.className = `status ${connection.state === 'online' ? 'ready' : ''}`;
  renderGatewayConnection(connection);
  await Promise.all([
    renderXiaohongshuCurrentPageNetwork()
  ]);
  await renderDirectCapabilities(connection);
  document.documentElement.dataset.collectorControlReady = 'true';
}

function restorePairingDraft(draft: GatewayPairingDraft | null): void {
  // A successful pairing clears the draft. Therefore any surviving draft is
  // an explicit unfinished-input signal and must be restored regardless of
  // whether an older pairing record is currently online or offline.
  if (!draft || pairingFormTouched) return;
  setInputValue('loopbackOrigin', draft.loopbackOrigin);
  setInputValue('identityFingerprint', draft.identityFingerprint);
  setInputValue('pairingSessionId', draft.pairingSessionId);
  setInputValue('pairingCode', draft.pairingCode);
}

function setInputValue(name: string, value: string): void {
  const input = pairingForm.elements.namedItem(name);
  if (input instanceof HTMLInputElement) input.value = value;
}

function readPairingInputFromForm(): PairUserBrowserGatewayInput {
  const form = new FormData(pairingForm);
  return {
    loopbackOrigin: String(form.get('loopbackOrigin') ?? '').trim(),
    identityFingerprint: String(form.get('identityFingerprint') ?? '').trim().toLowerCase(),
    pairingSessionId: String(form.get('pairingSessionId') ?? '').trim(),
    pairingCode: String(form.get('pairingCode') ?? '').trim()
  };
}

function queuePairingDraftSave(): Promise<void> {
  const input = readPairingInputFromForm();
  // Start this write immediately. The queue only tracks all in-flight writes
  // so submit can wait for them; it must not delay the final input event.
  const write = requestSaveGatewayPairingDraft(input);
  pairingDraftWriteQueue = pairingDraftWriteQueue
    .then(() => write)
    // Draft persistence should never block the pairing attempt or expose a
    // storage error (which could contain implementation details) in the UI.
    .catch(() => undefined);
  return pairingDraftWriteQueue;
}

async function renderXiaohongshuCurrentPageNetwork(): Promise<void> {
  const selection = await getXiaohongshuCurrentPageNetworkSelectionSummary();
  armNextXiaohongshuCurrentPageNetwork.disabled = false;
  if (selection.state === 'not_selected') {
    xiaohongshuCurrentPageNetworkState.textContent =
      '尚未预置。先切到已加载的公开 Explore 或搜索页，再从这里预置它在同一 tab 中下一次由你手动发起的顶层导航。';
    return;
  }
  if (selection.state === 'armed_next_document' && selection.expiresAt) {
    xiaohongshuCurrentPageNetworkState.textContent =
      `已预置下一次同 tab 手动导航，短时有效至 ${new Date(selection.expiresAt).toLocaleTimeString('zh-CN')}。` +
      ' 扩展不会替你触发导航；若不自然发生导航，预置会自动失效。';
    return;
  }
  if (selection.state === 'observing' && selection.expiresAt) {
    xiaohongshuCurrentPageNetworkState.textContent =
      `正在对已选择的公开 ${selection.publicSurface === 'search' ? '搜索' : 'Explore'} document 做短时、正文零读取的网络元数据观察，有效至 ${new Date(selection.expiresAt).toLocaleTimeString('zh-CN')}。`;
    return;
  }
  xiaohongshuCurrentPageNetworkState.textContent =
    '预置已因 document 变化、页面风险、网络不可用或 tab 关闭而停止；不会自动刷新、重试或改用其他页面。';
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
  if (value === 'direct_gateway_dispatch_pending') return '真实 canary 已通过，待 Gateway 派发';
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
    case 'bilibili.discussion':
      return '视频评论区（自动 work-tab）';
    case 'bilibili.dynamic':
      return 'UP 主公开动态';
    case 'bilibili.collection_series.overview':
      return 'UP 主合集概览';
    case 'bilibili.collection_series.detail':
      return '合集视频详情';
    case 'bilibili.danmaku':
      return '视频弹幕';
    case 'xiaohongshu.search.public_notes.v1':
      return '小红书公开笔记站内搜索';
    case 'xiaohongshu.account.public_notes.v1':
      return '小红书公开博主笔记列表';
    case 'xiaohongshu.note.public_detail.v1':
      return '小红书公开笔记详情';
    case 'xiaohongshu.note.public_comments.v1':
      return '小红书公开笔记评论';
    case 'xiaohongshu.note.public_comment_replies.v1':
      return '小红书公开评论回复';
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

function handlePairingFormMutation(): void {
  pairingFormTouched = true;
  void queuePairingDraftSave();
}

pairingForm.addEventListener('input', handlePairingFormMutation);
pairingForm.addEventListener('change', handlePairingFormMutation);
pairingForm.addEventListener('blur', handlePairingFormMutation, true);

// Chrome can destroy an action popup before the final input promise settles.
// These lifecycle hooks send one last snapshot through the worker. They are
// disabled after a successful pairing so cleanup cannot be undone by pagehide.
function persistPairingDraftBeforePopupTeardown(): void {
  if (!pairingCompleted) void queuePairingDraftSave();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistPairingDraftBeforePopupTeardown();
});
window.addEventListener('pagehide', persistPairingDraftBeforePopupTeardown);

// A popup reopened immediately after the previous one closes can render before
// the worker's storage write finishes. Re-read and restore when that write
// lands, provided the user has not started editing this new popup yet.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[GATEWAY_PAIRING_DRAFT_STORAGE_KEY] || pairingCompleted || pairingFormTouched) {
    return;
  }
  void loadGatewayPairingDraft().then((draft) => {
    restorePairingDraft(draft);
  }).catch(() => undefined);
});

pairingForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const pairing = readPairingInputFromForm();
  const submit = pairingForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!submit) return;
  submit.disabled = true;
  controlError.hidden = true;
  // Request the optional loopback origin while this submit event still owns a
  // trusted user gesture. Waiting for the draft-write queue first would make
  // Chrome reject the permission prompt as a background call, leaving the
  // popup looking as if pairing had silently failed after a rebuild.
  void requestLoopbackPermissionFromUserGesture().then((granted) => {
    if (!granted) throw new Error('gateway_loopback_permission_required');
    return pairingDraftWriteQueue;
  }).then(() => pairUserBrowserGateway(pairing, {
    loopbackPermissionAlreadyRequested: true
  })).then(async () => {
    pairingCompleted = true;
    pairingForm.reset();
    pairingFormTouched = false;
    const origin = pairingForm.elements.namedItem('loopbackOrigin');
    if (origin instanceof HTMLInputElement) origin.value = 'http://127.0.0.1:43127';
    // Pairing changes the availability of user-selected passive observation.
    // Re-render the whole local control surface instead of leaving its initial
    // unpaired state on screen after the connection banner turns online.
    await render();
  }).catch((error) => {
    controlError.textContent = error instanceof Error ? error.message : 'gateway_pairing_failed';
    controlError.hidden = false;
  }).finally(() => {
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

armNextXiaohongshuCurrentPageNetwork.addEventListener('click', () => {
  armNextXiaohongshuCurrentPageNetwork.disabled = true;
  controlError.hidden = true;
  void armNextXiaohongshuCurrentPageNetworkDocument().then(async () => {
    await renderXiaohongshuCurrentPageNetwork();
  }).catch((error) => {
    controlError.textContent = error instanceof Error ? error.message : 'xiaohongshu_current_page_network_arm_failed';
    controlError.hidden = false;
  }).finally(() => {
    armNextXiaohongshuCurrentPageNetwork.disabled = false;
  });
});

// Opening the local Control page wakes the work runner. It never reloads the
// extension in the user's browser and carries no URL, selector, credentials,
// or platform action.
void chrome.runtime.sendMessage({ type: 'collector.extensionWorkWake' }).catch(() => undefined);

void render().catch((error) => {
  controlError.textContent = error instanceof Error ? error.message : 'control_state_unavailable';
  controlError.hidden = false;
});
