import { readFile } from 'node:fs/promises';

const [command, argument] = process.argv.slice(2);
const origin = serviceOrigin(process.env.COLLECTOR_SERVICE_ORIGIN ?? 'http://127.0.0.1:43127');

try {
  switch (command) {
    case 'release':
      print(await request('/v2/release'));
      break;
    case 'openapi':
      print(await request('/v2/openapi.json'));
      break;
    case 'bindings':
      print(await request('/v2/collector-service/browser-bindings', { token: requiredToken() }));
      break;
    case 'queue':
      if (!argument) throw new Error('reference_client_request_file_required');
      print(await request('/v2/collect', {
        method: 'POST',
        token: requiredToken(),
        body: await validatedQueueRequest(argument)
      }));
      break;
    case 'operation':
      if (!/^[0-9a-f-]{36}$/i.test(argument ?? '')) throw new Error('reference_client_operation_id_invalid');
      print(await request(`/v2/collect/operations/${argument}`, { token: requiredToken() }));
      break;
    case 'artifact':
      if (!/^\/v1\/collect\/artifacts\/bilibili\.(video_detail|native_search)\/[0-9a-f-]{36}$/i.test(argument ?? '')) {
        throw new Error('reference_client_artifact_path_invalid');
      }
      print(await request(argument, { token: requiredToken() }));
      break;
    default:
      throw new Error('reference_client_command_invalid');
  }
} catch (error) {
  const code = safeCode(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
  process.exitCode = 1;
}

async function validatedQueueRequest(path) {
  let value;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('reference_client_request_json_invalid');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('reference_client_request_json_invalid');
  }
  const candidate = value;
  const keys = Object.keys(candidate);
  if (
    keys.length !== 6 || candidate.schemaVersion !== 2 ||
    typeof candidate.browserBindingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(candidate.browserBindingId) ||
    candidate.platform !== 'bilibili' ||
    !['bilibili.video_detail', 'bilibili.native_search'].includes(candidate.capability) ||
    candidate.executionTarget !== 'collector_work_tab' || !candidate.input ||
    typeof candidate.input !== 'object' || Array.isArray(candidate.input) || Object.keys(candidate.input).length !== 1
  ) throw new Error('reference_client_request_json_invalid');
  if (candidate.capability === 'bilibili.video_detail' && typeof candidate.input.canonicalVideoUrl !== 'string') {
    throw new Error('reference_client_request_json_invalid');
  }
  if (candidate.capability === 'bilibili.native_search' && typeof candidate.input.query !== 'string') {
    throw new Error('reference_client_request_json_invalid');
  }
  return JSON.stringify(candidate);
}

async function request(path, options = {}) {
  const headers = { accept: 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${origin}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body ? { body: options.body } : {}),
      signal: AbortSignal.timeout(20_000)
    });
  } catch {
    throw new Error('reference_client_gateway_unreachable');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload && typeof payload.error === 'string' && /^[a-z0-9_.-]{1,120}$/i.test(payload.error)
      ? payload.error
      : 'reference_client_gateway_rejected';
    throw new Error(error);
  }
  if (payload === null) throw new Error('reference_client_gateway_response_invalid');
  return payload;
}

function serviceOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('reference_client_origin_invalid');
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('reference_client_origin_invalid');
  }
  return url.origin;
}

function requiredToken() {
  const token = process.env.COLLECTOR_SERVICE_TOKEN ?? '';
  if (!/^cst_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('reference_client_token_required');
  return token;
}

function safeCode(error) {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_.-]{1,120}$/i.test(code) ? code : 'reference_client_failed';
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
