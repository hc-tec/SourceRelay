export const userBrowserConsoleScript = `
const $ = (selector) => document.querySelector(selector);
const bindingsElement = $('#browser-bindings');
const bindingsEmptyElement = $('#browser-bindings-empty');
const pairingElement = $('#browser-binding-pairing');
const clientsElement = $('#service-clients');
const clientsEmptyElement = $('#service-clients-empty');
const auditElement = $('#service-audit');
const auditEmptyElement = $('#service-audit-empty');
const issuedTokenElement = $('#issued-service-token');
const issuedTokenValueElement = $('#issued-service-token-value');
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

async function refresh() {
  const results = await Promise.all([
    api('/v1/status'),
    api('/v1/browser-bindings'),
    api('/v2/collector-service/clients'),
    api('/v2/collector-service/audit')
  ]);
  const status = results[0];
  const bindingPayload = results[1];
  const clientPayload = results[2];
  const auditPayload = results[3];
  $('#gateway-mode').textContent = status.deploymentMode === 'user_owned_browser_extension' ? '日常浏览器模式就绪' : '模式异常';
  $('#gateway-mode').className = 'badge ' + (status.deploymentMode === 'user_owned_browser_extension' ? 'good' : 'bad');
  $('#gateway-origin').textContent = status.identity?.loopbackOrigin ?? location.origin;
  $('#binding-count').textContent = String(status.browserBindingCount ?? 0);
  $('#online-binding-count').textContent = String(status.onlineBrowserBindingCount ?? 0);
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
}

$('#refresh').addEventListener('click', () => refresh().catch((error) => toast(error.message)));

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
  const form = new FormData(event.currentTarget);
  try {
    const payload = await api('/v2/collector-service/clients', {
      method: 'POST',
      body: JSON.stringify({ label: String(form.get('label') ?? ''), scopes: form.getAll('scopes') })
    });
    issuedToken = payload.token;
    issuedTokenValueElement.textContent = issuedToken;
    issuedTokenElement.hidden = false;
    event.currentTarget.reset();
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
