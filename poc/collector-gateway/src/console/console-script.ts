export const consoleScript = `
const $ = (selector) => document.querySelector(selector);
const profilesElement = $('#profiles');
const emptyElement = $('#empty');
const toastElement = $('#toast');
let refreshTimer = null;

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

async function refresh() {
  const payload = await api('/v1/profiles');
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
