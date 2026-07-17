import type { GatewayPairingRecord } from '../shared/control-plane';
import { hmacSha256Base64Url, randomBase64Url, sha256Hex } from '../shared/cryptography';

const MAX_GATEWAY_RESPONSE_BYTES = 1024 * 1024;

async function authenticationHeaders(input: {
  pairing: GatewayPairingRecord;
  method: string;
  pathname: string;
  body: string;
}): Promise<Record<string, string>> {
  const timestamp = Date.now().toString();
  const nonce = randomBase64Url();
  const bodySha256 = await sha256Hex(input.body);
  const payload = [input.method.toUpperCase(), input.pathname, timestamp, nonce, bodySha256].join('\n');
  return {
    'x-collector-extension-id': chrome.runtime.id,
    'x-collector-extension-instance': input.pairing.extensionInstanceId,
    'x-collector-timestamp': timestamp,
    'x-collector-nonce': nonce,
    'x-collector-body-sha256': bodySha256,
    'x-collector-authorization': await hmacSha256Base64Url(input.pairing.pairingAuthorization, payload)
  };
}

async function boundedResponseJson(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_GATEWAY_RESPONSE_BYTES) {
    throw new Error('Gateway response exceeded the control-plane size limit.');
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_GATEWAY_RESPONSE_BYTES) {
    throw new Error('Gateway response exceeded the control-plane size limit.');
  }
  return text ? JSON.parse(text) as unknown : null;
}

export async function authenticatedGatewayRequest(input: {
  pairing: GatewayPairingRecord;
  method: 'GET' | 'POST';
  pathname: string;
  body?: unknown;
}): Promise<unknown> {
  if (!/^\/v1\/[a-z0-9_./-]+$/i.test(input.pathname)) throw new Error('Gateway request path is not registered.');
  const body = input.body === undefined ? '' : JSON.stringify(input.body);
  const headers = await authenticationHeaders({
    pairing: input.pairing,
    method: input.method,
    pathname: input.pathname,
    body
  });
  if (body) headers['content-type'] = 'application/json';

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`${input.pairing.loopbackOrigin}${input.pathname}`, {
      method: input.method,
      headers,
      body: body || undefined,
      cache: 'no-store',
      credentials: 'omit',
      signal: abortController.signal
    });
  } finally {
    clearTimeout(timeout);
  }
  const parsed = await boundedResponseJson(response);
  if (!response.ok) {
    const code = parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string'
      ? (parsed as { error: string }).error
      : `gateway_status_${response.status}`;
    throw new Error(code);
  }
  return parsed;
}
