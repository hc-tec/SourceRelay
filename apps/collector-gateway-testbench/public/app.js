const state = {
  bindings: [],
  operationId: null,
  operation: null,
  pollTimer: null,
  pollsRemaining: 0
};

const element = (id) => document.getElementById(id);
const badge = element('connection-badge');
const bindingWarning = element('binding-warning');
const operationOutput = element('operation-output');
const artifactOutput = element('artifact-output');
const refreshOperation = element('refresh-operation');
const readArtifact = element('read-artifact');

element('refresh-connection').addEventListener('click', () => void refreshConnection());
refreshOperation.addEventListener('click', () => void refreshCurrentOperation());
readArtifact.addEventListener('click', () => void readCurrentArtifact());
element('video-form').addEventListener('submit', (event) => void submitVideo(event));
element('search-form').addEventListener('submit', (event) => void submitSearch(event, 'native_search'));
element('search-batch-form').addEventListener('submit', (event) => void submitSearch(event, 'native_search_batch'));
element('xiaohongshu-search-form').addEventListener('submit', (event) => void submitSearch(event, 'xiaohongshu_search'));
element('xiaohongshu-account-notes-form').addEventListener('submit', (event) => void submitXiaohongshuAccountNotes(event));
element('xiaohongshu-note-detail-form').addEventListener('submit', (event) => void submitXiaohongshuNoteDetail(event));
element('xiaohongshu-note-comments-form').addEventListener('submit', (event) => void submitXiaohongshuNoteComments(event));
element('profile-form').addEventListener('submit', (event) => void submitAccount(event, 'account_profile'));
element('inventory-form').addEventListener('submit', (event) => void submitAccount(event, 'account_inventory'));
element('discussion-form').addEventListener('submit', (event) => void submitDiscussion(event));
element('passive-form').addEventListener('submit', (event) => void submitPassive(event));

void refreshConnection();

async function refreshConnection() {
  setBadge('pending', '正在检查连接');
  try {
    const status = await api('/api/status');
    renderStatus(status);
    await refreshCapabilityCatalog();
    if (!status.testbench.tokenConfigured) {
      state.bindings = [];
      renderBindings();
      showBindingNotice('bad', 'Local API token 尚未配置。请在 Gateway Console 创建最小权限 client，再用 COLLECTOR_SERVICE_TOKEN 启动此测试台。');
      return;
    }
    const bindingPayload = await api('/api/bindings');
    state.bindings = bindingPayload.bindings.filter((binding) => binding.state === 'online');
    renderBindings();
    if (state.bindings.length === 0) {
      showBindingNotice('bad', 'Gateway 没有在线 browser binding。扩展保持开启后，点击“刷新本地状态”重试；该操作不会导航平台页面。');
      return;
    }
    showBindingNotice('good', `已发现 ${state.bindings.length} 个在线 binding。提交任务前请确认这是你要测试的浏览器扩展实例。`);
  } catch (error) {
    state.bindings = [];
    renderBindings();
    setBadge('bad', '本地连接不可用');
    showBindingNotice('bad', `无法读取本地 Gateway：${error.code ?? 'testbench_request_failed'}`);
  }
}

async function refreshCapabilityCatalog() {
  const note = element('capability-note');
  const list = element('capability-list');
  try {
    const payload = await api('/api/capabilities');
    const capabilities = payload.capabilities;
    const directReady = capabilities.filter((capability) => capability.dispatchState === 'direct_ready').length;
    const canaryPending = capabilities.filter((capability) => capability.dispatchState === 'direct_canary_pending').length;
    const gatewayPending = capabilities.filter((capability) => capability.dispatchState === 'direct_gateway_dispatch_pending').length;
    note.textContent = `已登记 ${capabilities.length} 项浏览器采集能力；${directReady} 项可 direct dispatch，${canaryPending} 项等待真实 canary，${gatewayPending} 项扩展 canary 已通过、正在接通 Gateway。所有项目禁止旧 Browser Host fallback。`;
    list.replaceChildren(...capabilities.map(renderCapability));
  } catch (error) {
    note.textContent = `无法读取能力登记册：${error.code ?? 'testbench_request_failed'}`;
    list.replaceChildren();
  }
}

function renderCapability(capability) {
  const card = document.createElement('article');
  const category = capability.dispatchState === 'direct_ready'
    ? 'ready'
    : capability.dispatchState === 'direct_canary_pending'
      ? 'pending'
    : capability.dispatchState === 'direct_gateway_dispatch_pending'
      ? 'pending'
    : capability.dispatchState === 'trusted_interaction_migration_required'
      ? 'trusted'
      : 'pending';
  card.className = `capability ${category}`;
  const title = document.createElement('h3');
  title.textContent = capability.title;
  const identifier = document.createElement('code');
  identifier.textContent = capability.capability;
  const detail = document.createElement('p');
  detail.textContent = `输入：${capability.inputMode} · 采集：${capability.captureMode}`;
  const status = document.createElement('span');
  status.className = 'status';
  status.textContent = capabilityStatusLabel(capability.dispatchState);
  card.append(title, identifier, detail, status);
  return card;
}

function capabilityStatusLabel(value) {
  if (value === 'direct_ready') return '可 direct dispatch';
  if (value === 'direct_canary_pending') return 'direct 已实现，待真实 canary';
  if (value === 'direct_gateway_dispatch_pending') return '扩展 canary 已通过，待 Gateway 派发';
  if (value === 'trusted_interaction_migration_required') return '需可信交互迁移';
  return '待 direct 迁移';
}

function renderStatus(payload) {
  const gateway = payload.gateway;
  element('gateway-origin').textContent = payload.testbench.gatewayOrigin;
  element('deployment-mode').textContent = gateway.reachable ? displayDeploymentMode(gateway.deploymentMode) : '不可达';
  element('online-bindings').textContent = gateway.reachable ? String(gateway.onlineBrowserBindingCount ?? 0) : '—';
  element('token-state').textContent = payload.testbench.tokenConfigured ? '已在服务端配置' : '未配置';
  element('browser-control').textContent = gateway.reachable ? displayBrowserControl(gateway.browserProcessControl) : '—';
  element('connection-note').textContent = gateway.reachable
    ? `Gateway OpenAPI ${gateway.openApiVersion ?? '—'} · 服务契约 ${gateway.serviceVersion ?? '—'} · 测试台只监听 ${payload.testbench.appOrigin}`
    : `Gateway 当前不可达：${gateway.error ?? 'testbench_gateway_unreachable'}`;
  setBadge(gateway.reachable && payload.testbench.tokenConfigured ? 'good' : 'pending',
    gateway.reachable ? (payload.testbench.tokenConfigured ? 'Gateway 与 token 就绪' : 'Gateway 在线，等待 token') : 'Gateway 不可达');
}

function renderBindings() {
  const selects = document.querySelectorAll('.binding-select');
  const enabled = state.bindings.length > 0;
  for (const select of selects) {
    select.replaceChildren();
    if (!enabled) {
      select.append(new Option('没有在线 binding', ''));
      select.disabled = true;
      continue;
    }
    for (const binding of state.bindings) {
      const suffix = binding.lastSeenAt ? ` · 最近在线 ${new Date(binding.lastSeenAt).toLocaleTimeString()}` : '';
      select.append(new Option(`${binding.browserBindingId}${suffix}`, binding.browserBindingId));
    }
    select.disabled = false;
  }
  for (const control of document.querySelectorAll(
    '#video-form input, #video-form select, #search-form input, #search-form select, #search-batch-form input, #search-batch-form select, ' +
    '#xiaohongshu-search-form input, #xiaohongshu-search-form select, #xiaohongshu-account-notes-form select, #xiaohongshu-note-detail-form input, #xiaohongshu-note-detail-form select, #xiaohongshu-note-comments-form select, ' +
    '#profile-form input, #profile-form select, #inventory-form input, #inventory-form select, ' +
    '#discussion-form input, #discussion-form select, ' +
    '#passive-form input, #passive-form select, #video-form button, #search-form button, #search-batch-form button, #xiaohongshu-search-form button, #xiaohongshu-account-notes-form button, #xiaohongshu-note-detail-form button, #xiaohongshu-note-comments-form button, ' +
    '#profile-form button, #inventory-form button, #discussion-form button, #passive-form button'
  )) {
    control.disabled = !enabled;
  }
}

async function submitVideo(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const payload = await api('/api/operations', {
      method: 'POST',
      body: {
        browserBindingId: form.elements.browserBindingId.value,
        kind: 'video_detail',
        input: { bvid: form.elements.bvid.value }
      }
    });
    form.elements.bvid.value = '';
    acceptOperation(payload.result);
  } catch (error) {
    showOperationError(error);
  } finally {
    button.disabled = state.bindings.length === 0;
  }
}

async function submitSearch(event, kind) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const payload = await api('/api/operations', {
      method: 'POST',
      body: {
        browserBindingId: form.elements.browserBindingId.value,
        kind,
        input: { query: form.elements.query.value }
      }
    });
    form.elements.query.value = '';
    acceptOperation(payload.result);
  } catch (error) {
    showOperationError(error);
  } finally {
    button.disabled = state.bindings.length === 0;
  }
}

async function submitXiaohongshuAccountNotes(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const payload = await api('/api/operations', {
      method: 'POST',
      body: {
        browserBindingId: form.elements.browserBindingId.value,
        kind: 'xiaohongshu_account_public_notes',
        input: { maximumScrolls: Number(form.elements.maximumScrolls.value) }
      }
    });
    acceptOperation(payload.result);
  } catch (error) {
    showOperationError(error);
  } finally {
    button.disabled = state.bindings.length === 0;
  }
}

async function submitXiaohongshuNoteDetail(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const payload = await api('/api/operations', {
      method: 'POST',
      body: {
        browserBindingId: form.elements.browserBindingId.value,
        kind: 'xiaohongshu_note_public_detail',
        input: { resultRank: Number(form.elements.resultRank.value) }
      }
    });
    acceptOperation(payload.result);
  } catch (error) {
    showOperationError(error);
  } finally {
    button.disabled = state.bindings.length === 0;
  }
}

async function submitXiaohongshuNoteComments(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const payload = await api('/api/operations', { method: 'POST', body: {
      browserBindingId: form.elements.browserBindingId.value,
      kind: 'xiaohongshu_note_public_comments',
      input: { maximumScrolls: Number(form.elements.maximumScrolls.value) }
    } });
    acceptOperation(payload.result);
  } catch (error) {
    showOperationError(error);
  } finally {
    button.disabled = state.bindings.length === 0;
  }
}

async function submitAccount(event, kind) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const input = { accountId: form.elements.accountId.value };
    if (kind === 'account_inventory') input.executionTarget = form.elements.executionTarget.value;
    const payload = await api('/api/operations', {
      method: 'POST',
      body: {
        browserBindingId: form.elements.browserBindingId.value,
        kind,
        input
      }
    });
    form.elements.accountId.value = '';
    acceptOperation(payload.result);
  } catch (error) {
    showOperationError(error);
  } finally {
    button.disabled = state.bindings.length === 0;
  }
}

async function submitDiscussion(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const payload = await api('/api/operations', {
      method: 'POST',
      body: {
        browserBindingId: form.elements.browserBindingId.value,
        kind: 'discussion',
        input: { bvid: form.elements.bvid.value }
      }
    });
    form.elements.bvid.value = '';
    acceptOperation(payload.result);
  } catch (error) {
    showOperationError(error);
  } finally {
    button.disabled = state.bindings.length === 0;
  }
}

async function submitPassive(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const kind = form.elements.kind.value;
    const input = kind === 'danmaku'
      ? { bvid: form.elements.bvid.value }
      : kind === 'collection_series_detail'
        ? {
          accountId: form.elements.accountId.value,
          stableSeriesId: form.elements.stableSeriesId.value,
          listType: form.elements.listType.value
        }
        : { accountId: form.elements.accountId.value };
    const payload = await api('/api/operations', {
      method: 'POST',
      body: {
        browserBindingId: form.elements.browserBindingId.value,
        kind,
        input
      }
    });
    acceptOperation(payload.result);
  } catch (error) {
    showOperationError(error);
  } finally {
    button.disabled = state.bindings.length === 0;
  }
}

function acceptOperation(operation) {
  state.operationId = operation.operationId;
  state.operation = operation;
  artifactOutput.hidden = true;
  refreshOperation.disabled = false;
  renderOperation();
  state.pollsRemaining = 25;
  void pollOperationOnce();
}

async function refreshCurrentOperation() {
  if (state.operationId) await pollOperationOnce(false);
}

async function pollOperationOnce(scheduleNext = true) {
  if (!state.operationId) return;
  clearTimeout(state.pollTimer);
  try {
    const payload = await api(`/api/operations/${encodeURIComponent(state.operationId)}`);
    state.operation = payload.result;
    renderOperation();
    if (isActive(state.operation.state) && scheduleNext && state.pollsRemaining-- > 0) {
      state.pollTimer = window.setTimeout(() => void pollOperationOnce(true), 2_000);
    }
  } catch (error) {
    showOperationError(error);
  }
}

async function readCurrentArtifact() {
  if (!state.operationId) return;
  readArtifact.disabled = true;
  try {
    const payload = await api(`/api/operations/${encodeURIComponent(state.operationId)}/artifact`);
    artifactOutput.hidden = false;
    artifactOutput.textContent = JSON.stringify(payload.artifact, null, 2);
  } catch (error) {
    showOperationError(error);
  } finally {
    readArtifact.disabled = !(state.operation?.artifact?.retrievalPath);
  }
}

function renderOperation() {
  const operation = state.operation;
  element('operation-note').textContent = isActive(operation.state)
    ? `operation 正在 ${operation.state}。这页最多自动轮询 25 次；轮询只读取本地 Gateway，不会提交第二个任务。`
    : `operation 已进入 ${operation.state} 终态。不会自动重放；如有 artifact，可显式读取一次。`;
  operationOutput.textContent = JSON.stringify(operation, null, 2);
  readArtifact.disabled = !operation.artifact?.retrievalPath;
}

function showOperationError(error) {
  clearTimeout(state.pollTimer);
  element('operation-note').textContent = `操作未完成：${error.code ?? 'testbench_request_failed'}。测试台不会自动重新提交平台任务。`;
  operationOutput.textContent = JSON.stringify({ ok: false, error: error.code ?? 'testbench_request_failed' }, null, 2);
}

function showBindingNotice(kind, message) {
  bindingWarning.className = `notice ${kind}`;
  bindingWarning.textContent = message;
}

function setBadge(kind, message) {
  badge.className = `badge ${kind}`;
  badge.textContent = message;
}

function isActive(stateName) {
  return stateName === 'queued' || stateName === 'claimed';
}

function displayDeploymentMode(value) {
  return value === 'user_owned_browser_extension' ? '日常浏览器扩展' : value ?? '未知';
}

function displayBrowserControl(value) {
  return value === 'not_available' ? '不可用（按设计）' : value ?? '未知';
}

async function api(path, options = {}) {
  const headers = { accept: 'application/json' };
  if (options.method === 'POST') {
    headers['content-type'] = 'application/json';
    headers['x-collector-testbench-request'] = '1';
  }
  let response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    });
  } catch {
    throw { code: 'testbench_ui_unreachable' };
  }
  const payload = await response.json().catch(() => ({ ok: false, error: 'testbench_response_invalid' }));
  if (!response.ok || !payload.ok) throw { code: payload.error ?? 'testbench_request_failed' };
  return payload;
}
