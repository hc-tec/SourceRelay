export const consoleScript = `
const $ = (selector) => document.querySelector(selector);
const profilesElement = $('#profiles');
const emptyElement = $('#empty');
const serviceClientsElement = $('#service-clients');
const serviceClientsEmptyElement = $('#service-clients-empty');
const issuedServiceTokenElement = $('#issued-service-token');
const issuedServiceTokenValueElement = $('#issued-service-token-value');
const toastElement = $('#toast');
let refreshTimer = null;
let issuedServiceToken = null;

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
  setTimeout(() => toastElement.classList.remove('visible'), 2600);
}

function stateBadge(state) {
  const tone = state === 'idle_reusable' ? 'good'
    : state === 'quarantined' ? 'bad'
      : state.startsWith('leased') ? 'warn' : 'neutral';
  return '<span class="badge ' + tone + ' state-' + escapeHtml(state) + '">' + escapeHtml(state) + '</span>';
}

function pageRows(runtime) {
  if (!runtime?.pages?.length) return '<tr><td colspan="6" class="muted">暂无受管页面</td></tr>';
  return runtime.pages.map((page) => '<tr>' +
    '<td>' + escapeHtml(page.pageAlias) + '</td>' +
    '<td>' + escapeHtml(page.pageRole) + '</td>' +
    '<td>' + stateBadge(page.state) + '</td>' +
    '<td>' + (page.extensionTabBound ? 'bound' : 'unbound') + '</td>' +
    '<td>' + escapeHtml(page.activeLease?.taskId ?? '—') + '</td>' +
    '<td>' + escapeHtml(page.quarantineReason ?? '—') + '</td>' +
  '</tr>').join('');
}

function profileCard(summary) {
  const profile = summary.profile;
  const runtime = summary.runtime;
  const bridgeReady = runtime?.extensionRuntime?.nativeBridgeConnected === true;
  return '<article class="profile-card" data-profile-id="' + escapeHtml(profile.profileId) + '">' +
    '<div class="profile-header"><div class="profile-title">' +
      '<h3>' + escapeHtml(profile.account.label) + '</h3>' +
      '<span class="badge ' + (summary.running ? 'good' : 'neutral') + '">' + (summary.running ? '运行中' : '未运行') + '</span>' +
      '<span class="badge ' + (bridgeReady ? 'good' : 'neutral') + '">Bridge ' + (bridgeReady ? 'ready' : 'offline') + '</span>' +
    '</div><div class="profile-actions">' +
      '<button data-action="launch"' + (summary.running ? ' disabled' : '') + '>启动</button>' +
      '<button class="danger" data-action="close"' + (!summary.running ? ' disabled' : '') + '>关闭 Profile</button>' +
    '</div></div>' +
    '<div class="profile-meta">' +
      '<span>平台 ' + escapeHtml(profile.platform) + '</span>' +
      '<span>Profile ' + escapeHtml(profile.profileId) + '</span>' +
      '<span>Session ' + escapeHtml(runtime?.browserSessionId ?? '—') + '</span>' +
      '<span>Browser PID ' + escapeHtml(runtime?.browserProcessId ?? '—') + '</span>' +
      '<span>页面 ' + escapeHtml(runtime?.managedPages ?? 0) + ' / ' + escapeHtml(runtime?.maximumManagedPages ?? 3) + '</span>' +
    '</div>' +
    '<table class="page-table"><thead><tr><th>Alias</th><th>Role</th><th>State</th><th>Extension</th><th>Task</th><th>Reason</th></tr></thead>' +
      '<tbody>' + pageRows(runtime) + '</tbody></table>' +
  '</article>';
}

function serviceClientCard(client) {
  const revoked = client.revokedAt !== null;
  return '<article class="client-card" data-client-id="' + escapeHtml(client.clientId) + '">' +
    '<div><h3>' + escapeHtml(client.label) + '</h3>' +
      '<p>Client ' + escapeHtml(client.clientId) + ' · fingerprint ' + escapeHtml(client.tokenFingerprint) + '</p>' +
      '<p>最近使用 ' + escapeHtml(client.lastUsedAt ?? '从未') + '</p></div>' +
    '<div class="profile-actions">' +
      '<span class="badge ' + (revoked ? 'bad' : 'good') + '">' + (revoked ? '已撤销' : '有效') + '</span>' +
      '<button class="danger" data-client-action="revoke"' + (revoked ? ' disabled' : '') + '>撤销</button>' +
    '</div>' +
  '</article>';
}

function renderServiceClients(clients) {
  serviceClientsElement.innerHTML = clients.map(serviceClientCard).join('');
  serviceClientsEmptyElement.hidden = clients.length !== 0;
}

async function refresh() {
  const [payload, clientPayload] = await Promise.all([
    api('/v1/profiles'),
    api('/v1/collector-service/clients')
  ]);
  const profiles = payload.profiles ?? [];
  const host = profiles.find((profile) => profile.host)?.host ?? null;
  const runtimes = profiles.map((profile) => profile.runtime).filter(Boolean);
  $('#host-state').textContent = host ? 'Host connected' : 'Host stopped';
  $('#host-state').className = 'badge ' + (host ? 'good' : 'neutral');
  $('#host-pid').textContent = host?.hostProcessId ?? '—';
  $('#snapshot-revision').textContent = host?.snapshotRevision ?? '—';
  $('#running-profiles').textContent = runtimes.filter((runtime) => runtime.running).length;
  $('#managed-pages').textContent = runtimes.reduce((total, runtime) => total + runtime.managedPages, 0);
  profilesElement.innerHTML = profiles.map(profileCard).join('');
  emptyElement.hidden = profiles.length !== 0;
  renderServiceClients(clientPayload.clients ?? []);
}

profilesElement.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const card = button.closest('[data-profile-id]');
  const profileId = card?.dataset.profileId;
  if (!profileId) return;
  const action = button.dataset.action;
  if (action === 'close' && !confirm('关闭这个 Collection Profile 的整个浏览器窗口？')) return;
  button.disabled = true;
  try {
    await api('/v1/profiles/' + encodeURIComponent(profileId) + '/browser/' + action, { method: 'POST', body: '{}' });
    await refresh();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

$('#create-profile').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const expectedVisibleIdentity = String(form.get('expectedVisibleIdentity') ?? '').trim();
  const body = {
    kind: 'collection',
    platform: String(form.get('platform')),
    accountCategory: 'user_managed',
    accountLabel: String(form.get('accountLabel') ?? '').trim(),
    ...(expectedVisibleIdentity ? { expectedVisibleIdentity } : {})
  };
  try {
    await api('/v1/profiles', { method: 'POST', body: JSON.stringify(body) });
    event.currentTarget.reset();
    await refresh();
  } catch (error) {
    toast(error.message);
  }
});

$('#create-service-client').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const payload = await api('/v1/collector-service/clients', {
      method: 'POST',
      body: JSON.stringify({ label: String(form.get('label') ?? '').trim() })
    });
    issuedServiceToken = payload.token;
    issuedServiceTokenValueElement.textContent = issuedServiceToken;
    issuedServiceTokenElement.hidden = false;
    event.currentTarget.reset();
    await refresh();
    toast('本地 API token 已创建；请立即复制。');
  } catch (error) {
    toast(error.message);
  }
});

serviceClientsElement.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-client-action]');
  if (!button || button.dataset.clientAction !== 'revoke') return;
  const card = button.closest('[data-client-id]');
  const clientId = card?.dataset.clientId;
  if (!clientId || !confirm('撤销后该本地应用将立即不能调用 Collector Service。继续？')) return;
  button.disabled = true;
  try {
    await api('/v1/collector-service/clients/' + encodeURIComponent(clientId) + '/revoke', { method: 'POST', body: '{}' });
    await refresh();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

$('#copy-issued-service-token').addEventListener('click', async () => {
  if (!issuedServiceToken) return;
  try {
    await navigator.clipboard.writeText(issuedServiceToken);
    toast('token 已复制。');
  } catch {
    toast('复制失败；请手动复制显示的 token。');
  }
});

$('#refresh').addEventListener('click', () => refresh().catch((error) => toast(error.message)));
$('#exit-host').addEventListener('click', async () => {
  if (!confirm('退出 Browser Host 会关闭所有 Collection Profile 窗口。继续？')) return;
  try {
    await api('/v1/browser-host/exit', { method: 'POST', body: '{}' });
    await refresh();
  } catch (error) {
    toast(error.message);
  }
});

refresh().catch((error) => toast(error.message));
refreshTimer = setInterval(() => refresh().catch(() => undefined), 5000);
window.addEventListener('pagehide', () => clearInterval(refreshTimer));
`;
