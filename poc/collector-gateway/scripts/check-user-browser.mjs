const requireOnline = process.argv.slice(2).includes('--require-online');
const origin = loopbackOrigin(process.env.COLLECTOR_SERVICE_ORIGIN ?? 'http://127.0.0.1:43127');

try {
  const startedAt = Date.now();
  const deadline = startedAt + (requireOnline ? 35_000 : 0);
  let payload = await readStatus();
  let onlineBrowserBindingCount = onlineCount(payload);
  while (requireOnline && onlineBrowserBindingCount < 1 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    payload = await readStatus();
    onlineBrowserBindingCount = onlineCount(payload);
  }
  if (requireOnline && onlineBrowserBindingCount < 1) {
    throw new Error('user_browser_extension_not_online');
  }
  process.stdout.write(JSON.stringify({
    ok: true,
    origin,
    deploymentMode: payload.deploymentMode,
    browserBindingCount: payload.browserBindingCount,
    onlineBrowserBindingCount,
    browserProcessControl: payload.browserProcessControl,
    waitedForOnlineMs: Date.now() - startedAt
  }, null, 2) + '\n');
} catch (error) {
  const code = error instanceof Error && /^[a-z0-9_.-]{1,120}$/i.test(error.message)
    ? error.message
    : 'user_browser_gateway_check_failed';
  process.stderr.write(JSON.stringify({ ok: false, error: code }) + '\n');
  process.exitCode = 1;
}

async function readStatus() {
  let response;
  try {
    response = await fetch(origin + '/v1/status', { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new Error(classifyGatewayFetchError(error));
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== 'object') {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'user_browser_gateway_unreachable');
  }
  if (payload.deploymentMode !== 'user_owned_browser_extension' ||
    payload.browserProcessControl !== 'not_available') {
    throw new Error('user_browser_gateway_mode_mismatch');
  }
  return payload;
}

function classifyGatewayFetchError(error) {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    return 'user_browser_gateway_timeout';
  }

  const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : null;
  const causeCode = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
  if (causeCode === 'ECONNREFUSED' || causeCode === 'ECONNRESET' || causeCode === 'EHOSTUNREACH') {
    return 'user_browser_gateway_unreachable';
  }

  return 'user_browser_gateway_unreachable';
}

function onlineCount(payload) {
  const value = Number(payload.onlineBrowserBindingCount ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function loopbackOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('user_browser_gateway_origin_invalid');
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('user_browser_gateway_origin_invalid');
  }
  return url.origin;
}
