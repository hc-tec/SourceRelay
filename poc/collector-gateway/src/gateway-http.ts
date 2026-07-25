import type { IncomingMessage, ServerResponse } from 'node:http';

const MAXIMUM_JSON_BODY_BYTES = 64 * 1024;

export function send(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string
): void {
  response.statusCode = status;
  response.setHeader('content-type', contentType);
  response.setHeader('content-length', Buffer.byteLength(body));
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(body);
}

export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, 'application/json; charset=utf-8', `${JSON.stringify(value)}\n`);
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new Error('json_content_type_required');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAXIMUM_JSON_BODY_BYTES) throw new Error('request_body_too_large');
    chunks.push(buffer);
  }
  if (bytes === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('request_json_invalid');
  }
}

export function requireSameOrigin(
  request: IncomingMessage,
  response: ServerResponse,
  expectedOrigin: string
): boolean {
  // Browsers commonly omit Origin on same-origin GET/fetch requests. The
  // browser-controlled Sec-Fetch-Site signal still identifies the Console;
  // if Origin is present it must remain exact. Cross-origin browser requests
  // keep a non-same-origin Sec-Fetch-Site and are rejected.
  if (
    request.headers['sec-fetch-site'] === 'same-origin' &&
    (request.headers.origin === undefined || request.headers.origin === expectedOrigin)
  ) return true;
  sendJson(response, 403, { ok: false, error: 'console_origin_rejected' });
  return false;
}

export function safeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : '';
  return /^[a-z0-9_.-]{1,120}$/i.test(value) ? value : 'gateway_request_failed';
}
