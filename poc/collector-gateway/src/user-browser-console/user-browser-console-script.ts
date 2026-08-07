export const userBrowserConsoleScript = `
const $ = (selector) => document.querySelector(selector);
const bindingsElement = $('#browser-bindings');
const bindingsEmptyElement = $('#browser-bindings-empty');
const pairingElement = $('#browser-binding-pairing');
const clientsElement = $('#service-clients');
const clientsEmptyElement = $('#service-clients-empty');
const auditElement = $('#service-audit');
const auditEmptyElement = $('#service-audit-empty');
const operationalLogsElement = $('#operational-logs');
const operationalLogsEmptyElement = $('#operational-logs-empty');
const issuedTokenElement = $('#issued-service-token');
const issuedTokenValueElement = $('#issued-service-token-value');
const zhihuProviderBadgeElement = $('#zhihu-provider-badge');
const zhihuProviderStatusElement = $('#zhihu-provider-status');
const zhihuProviderForm = $('#zhihu-provider-form');
const clearZhihuProviderButton = $('#clear-zhihu-provider');
const onboardingStatusElement = $('#onboarding-status');
const toastElement = $('#toast');
let issuedToken = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { 'content-type': 'application/json', ...(options.headers ?? {}) } : options.headers
  });
  const payload = await response.json().catch(() => ({ error: 'gateway_response_invalid' }));
  if (!response.ok) throw new Error(payload.error ?? 'gateway_request_failed');
  return payload;
}

function toast(message) {
  toastElement.textContent = message;
  toastElement.classList.add('visible');
  setTimeout(() => toastElement.classList.remove('visible'), 2800);
}

function bindingCard(binding) {
  const safety = binding.safety ?? null;
  const online = binding.state === 'online';
  const tone = safety?.state === 'locked' ? 'bad' : safety?.state === 'running' ? 'warn' : online ? 'good' : 'neutral';
  return '<article class="card" data-browser-binding-id="' + escapeHtml(binding.browserBindingId) + '">' +
    '<div><h3>浏览器绑定 ' + escapeHtml(binding.browserBindingId) + '</h3>' +
      '<p>扩展 ' + escapeHtml(binding.extensionId) + '</p>' +
      '<p>配对 ' + escapeHtml(binding.pairedAt) + ' · 最近连接 ' + escapeHtml(binding.lastSeenAt ?? '尚未连接') + '</p></div>' +
    '<div class="actions"><span class="badge ' + (online ? 'good' : 'neutral') + '">' + (online ? '在线' : '已配对') + '</span>' +
      '<span class="badge ' + tone + '">采集安全 ' + escapeHtml(safety?.state ?? 'ready') + '</span>' +
      (safety?.state === 'locked' ? '<button data-binding-action="unlock" type="button">明确恢复</button>' : '') +
      '<button class="danger" data-binding-action="revoke" type="button">撤销</button></div></article>';
}

function clientCard(client) {
  const revoked = client.revokedAt !== null;
  const scopes = Array.isArray(client.scopes) ? client.scopes.map(escapeHtml).join(' · ') : '—';
  return '<article class="card" data-client-id="' + escapeHtml(client.clientId) + '">' +
    '<div><h3>' + escapeHtml(client.label) + '</h3>' +
      '<p>Client ' + escapeHtml(client.clientId) + ' · 指纹 ' + escapeHtml(client.tokenFingerprint) + '</p>' +
      '<p>权限 ' + scopes + '</p></div>' +
    '<div class="actions"><span class="badge ' + (revoked ? 'bad' : 'good') + '">' + (revoked ? '已撤销' : '有效') + '</span>' +
      '<button class="danger" data-client-action="revoke" type="button"' + (revoked ? ' disabled' : '') + '>撤销</button></div></article>';
}

function auditCard(event) {
  const actor = event.actor?.kind === 'client' ? '本地客户端 ' + event.actor.clientId :
    event.actor?.kind === 'console' ? 'Gateway Console' : '未识别调用方';
  return '<article class="card"><div><h3>' + escapeHtml(event.action) + ' · ' + escapeHtml(event.outcome) + '</h3>' +
    '<p>' + escapeHtml(actor) + '</p><p>能力 ' + escapeHtml(event.capability ?? '—') +
    ' · 操作 ' + escapeHtml(event.operationId ?? '—') + ' · 错误 ' + escapeHtml(event.errorCode ?? '—') +
    '</p></div><time>' + escapeHtml(event.occurredAt) + '</time></article>';
}

function operationalLogCard(event) {
  const tone = event.level === 'error' ? 'bad' : event.level === 'warn' ? 'warn' : 'neutral';
  const details = event.details && typeof event.details === 'object'
    ? Object.entries(event.details).slice(0, 6).map(([key, value]) => escapeHtml(key) + '=' + escapeHtml(value)).join(' · ')
    : '';
  return '<article class="card"><div><h3><span class="badge ' + tone + '">' + escapeHtml(event.level) + '</span> ' +
    escapeHtml(event.eventType) + '</h3><p>组件 ' + escapeHtml(event.component ?? '—') +
    ' · 结果 ' + escapeHtml(event.outcome ?? '—') + ' · 耗时 ' + escapeHtml(event.durationMs ?? '—') + ' ms</p>' +
    '<p>请求 ' + escapeHtml(event.requestId ?? '—') + ' · 操作 ' + escapeHtml(event.operationId ?? '—') +
    ' · work ' + escapeHtml(event.workId ?? '—') + ' · 错误 ' + escapeHtml(event.errorCode ?? '—') + '</p>' +
    (details ? '<p>' + details + '</p>' : '') + '</div><time>' + escapeHtml(event.occurredAt) + '</time></article>';
}

function providerStateLabel(state) {
  return state === 'ready' ? '已配置' : '需要配置凭证';
}

function providerModeLabel(mode) {
  if (mode === 'environment') return '启动环境变量';
  if (mode === 'console_session') return '本次 Gateway 会话';
  return '未配置';
}

function renderZhihuProvider(provider) {
  const ready = provider?.runtimeState === 'ready';
  const mode = provider?.configurationMode ?? 'none';
  zhihuProviderBadgeElement.textContent = providerStateLabel(provider?.runtimeState);
  zhihuProviderBadgeElement.className = 'badge ' + (ready ? 'good' : 'warn');
  zhihuProviderStatusElement.innerHTML = '<div class="provider-state-grid">' +
    '<div><span>状态</span><strong>' + escapeHtml(providerStateLabel(provider?.runtimeState)) + '</strong></div>' +
    '<div><span>凭证位置</span><strong>Gateway only</strong></div>' +
    '<div><span>配置来源</span><strong>' + escapeHtml(providerModeLabel(mode)) + '</strong></div>' +
    '<div><span>浏览器绑定</span><strong>不需要</strong></div>' +
    '</div>' +
    '<p class="provider-capabilities">可用能力：知乎站内搜索 · 知乎热榜 · 知乎开放平台全网搜索</p>' +
    (mode === 'environment'
      ? '<p class="provider-warning">当前凭证来自 Gateway 启动环境变量。要移除它，请停止 Gateway、清除 <code>ZHIHU_ACCESS_SECRET</code> 后重新启动。</p>'
      : mode === 'console_session'
        ? '<p class="provider-warning">当前凭证只在本次 Gateway 进程内有效，重启后需要重新配置。</p>'
        : '<p class="provider-help">还没有配置凭证。配置后不会安装扩展，也不会打开知乎页面。</p>');
  clearZhihuProviderButton.disabled = !ready || mode === 'environment';
}

function renderOnboarding(status, provider) {
  const browserReady = Number(status.onlineBrowserBindingCount ?? 0) > 0;
  const officialReady = provider?.runtimeState === 'ready';
  onboardingStatusElement.textContent = browserReady && officialReady
    ? '两条数据源路径都已配置，可以创建给上层应用使用的本地 API token。'
    : browserReady
      ? '浏览器路径已配置；如果还需要知乎，请单独配置知乎官方凭证。'
      : officialReady
        ? '知乎官方路径已配置；如果需要 B 站或小红书，请继续配对日常浏览器。'
        : '请选择上面的数据源路径开始配置。两条路径互不依赖。';
}

async function refresh() {
  const results = await Promise.all([
    api('/v1/status'),
    api('/v1/browser-bindings'),
    api('/v2/collector-service/clients'),
    api('/v2/collector-service/audit'),
    api('/v2/observability/logs?limit=100'),
    api('/v2/official-providers')
  ]);
  const status = results[0];
  const bindingPayload = results[1];
  const clientPayload = results[2];
  const auditPayload = results[3];
  const operationalLogPayload = results[4];
  const officialProviderPayload = results[5];
  const zhihuProvider = (officialProviderPayload.providers ?? []).find(
    (provider) => provider.provider === 'zhihu_open_platform'
  ) ?? { runtimeState: 'credential_required', configurationMode: 'none' };
  $('#gateway-mode').textContent = status.deploymentMode === 'user_owned_browser_extension' ? '日常浏览器模式就绪' : '模式异常';
  $('#gateway-mode').className = 'badge ' + (status.deploymentMode === 'user_owned_browser_extension' ? 'good' : 'bad');
  $('#gateway-origin').textContent = status.identity?.loopbackOrigin ?? location.origin;
  $('#binding-count').textContent = String(status.browserBindingCount ?? 0);
  $('#online-binding-count').textContent = String(status.onlineBrowserBindingCount ?? 0);
  renderZhihuProvider(zhihuProvider);
  renderOnboarding(status, zhihuProvider);
  const bindings = await Promise.all((bindingPayload.bindings ?? []).map(async (binding) => {
    try {
      const safety = await api('/v1/browser-bindings/' + encodeURIComponent(binding.browserBindingId) + '/safety');
      return { ...binding, safety: safety.safety ?? null };
    } catch {
      return { ...binding, safety: null };
    }
  }));
  bindingsElement.innerHTML = bindings.map(bindingCard).join('');
  bindingsEmptyElement.hidden = bindings.length !== 0;
  const clients = clientPayload.clients ?? [];
  clientsElement.innerHTML = clients.map(clientCard).join('');
  clientsEmptyElement.hidden = clients.length !== 0;
  const events = auditPayload.events ?? [];
  auditElement.innerHTML = events.map(auditCard).join('');
  auditEmptyElement.hidden = events.length !== 0;
  const operationalEvents = operationalLogPayload.events ?? [];
  operationalLogsElement.innerHTML = operationalEvents.map(operationalLogCard).join('');
  operationalLogsEmptyElement.hidden = operationalEvents.length !== 0;
}

$('#refresh').addEventListener('click', () => refresh().catch((error) => toast(error.message)));

document.querySelectorAll('[data-onboarding-target]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.onboardingTarget);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

zhihuProviderForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const button = formElement.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const form = new FormData(formElement);
    await api('/v2/official-providers/zhihu/credential', {
      method: 'POST',
      body: JSON.stringify({ accessSecret: String(form.get('accessSecret') ?? '') })
    });
    formElement.reset();
    toast('知乎官方凭证已配置到当前 Gateway。');
    await refresh();
  } catch (error) {
    toast(error.message === 'zhihu_official_api_credential_invalid'
      ? '凭证格式无效，请确认没有前后空格。'
      : error.message);
  } finally {
    button.disabled = false;
  }
});

clearZhihuProviderButton.addEventListener('click', async () => {
  if (clearZhihuProviderButton.disabled) return;
  if (!confirm('这会移除当前 Gateway 进程中的知乎凭证，不会影响浏览器配对。继续？')) return;
  clearZhihuProviderButton.disabled = true;
  try {
    await api('/v2/official-providers/zhihu/credential/clear', { method: 'POST', body: '{}' });
    toast('知乎官方凭证已从当前 Gateway 移除。');
    await refresh();
  } catch (error) {
    toast(error.message);
  }
});

$('#create-browser-binding-pairing').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const payload = await api('/v1/browser-bindings/pairing-sessions', { method: 'POST', body: '{}' });
    const pairing = payload.pairing;
    $('#browser-binding-pairing-origin').textContent = location.origin;
    $('#browser-binding-pairing-fingerprint').textContent = pairing.identityFingerprint;
    $('#browser-binding-pairing-session').textContent = pairing.pairingSessionId;
    $('#browser-binding-pairing-code').textContent = pairing.pairingCode;
    pairingElement.hidden = false;
    toast('一次性配对码已生成；只在当前浏览器扩展控制页使用。');
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

bindingsElement.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-binding-action]');
  if (!button) return;
  const bindingId = button.closest('[data-browser-binding-id]')?.dataset.browserBindingId;
  if (!bindingId) return;
  const action = button.dataset.bindingAction;
  if (action === 'revoke' && !confirm('撤销后该扩展不能再连接此 Gateway。继续？')) return;
  if (action === 'unlock' && !confirm('这只恢复后续新任务，不会重放之前停止的页面操作。继续？')) return;
  button.disabled = true;
  try {
    if (action === 'revoke') {
      await api('/v1/browser-bindings/' + encodeURIComponent(bindingId) + '/revoke', { method: 'POST', body: '{}' });
    } else if (action === 'unlock') {
      await api('/v1/browser-bindings/' + encodeURIComponent(bindingId) + '/safety/unlock', {
        method: 'POST',
        body: JSON.stringify({ acknowledgement: 'resume_user_owned_browser_collection' })
      });
    }
    await refresh();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

$('#create-service-client').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    const payload = await api('/v2/collector-service/clients', {
      method: 'POST',
      body: JSON.stringify({ label: String(form.get('label') ?? ''), scopes: form.getAll('scopes') })
    });
    issuedToken = payload.token;
    issuedTokenValueElement.textContent = issuedToken;
    issuedTokenElement.hidden = false;
    formElement.reset();
    await refresh();
  } catch (error) {
    toast(error.message);
  }
});

clientsElement.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-client-action]');
  if (!button || button.dataset.clientAction !== 'revoke') return;
  const clientId = button.closest('[data-client-id]')?.dataset.clientId;
  if (!clientId || !confirm('撤销后对应本地应用将立即失去访问权限。继续？')) return;
  button.disabled = true;
  try {
    await api('/v2/collector-service/clients/' + encodeURIComponent(clientId) + '/revoke', { method: 'POST', body: '{}' });
    await refresh();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

$('#copy-issued-service-token').addEventListener('click', async () => {
  if (!issuedToken) return;
  try {
    await navigator.clipboard.writeText(issuedToken);
    toast('token 已复制。');
  } catch {
    toast('无法自动复制，请手动复制上面的 token。');
  }
});

refresh().catch((error) => toast(error.message));
`;
