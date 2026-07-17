import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadGatewayConfig } from './config';
import { consoleHtml, consoleScript, consoleStyles } from './console-assets';
import { loadGatewayIdentity } from './identity';
import { PairingBroker, type PairingClaimInput } from './pairing';

const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const extensionOriginPattern = /^chrome-extension:\/\/[a-p]{32}$/;

function securityHeaders(response: ServerResponse): void {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('cross-origin-resource-policy', 'same-site');
}

function send(response: ServerResponse, status: number, contentType: string, body: string): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader('content-type', contentType);
  response.setHeader('content-length', Buffer.byteLength(body));
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, 'application/json; charset=utf-8', `${JSON.stringify(value)}\n`);
}

function allowExtensionCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !extensionOriginPattern.test(origin)) return false;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type');
  response.setHeader('access-control-max-age', '300');
  response.setHeader('vary', 'origin');
  return true;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_REQUEST_BODY_BYTES) throw new Error('request_body_too_large');
    chunks.push(bytes);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) as unknown : {};
}

function pairingClaim(value: unknown): PairingClaimInput {
  if (!value || typeof value !== 'object') throw new Error('pairing_claim_invalid');
  const candidate = value as Partial<PairingClaimInput>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.pairingSessionId !== 'string' || candidate.pairingSessionId.length > 100 ||
    typeof candidate.pairingCode !== 'string' || candidate.pairingCode.length > 20 ||
    typeof candidate.extensionId !== 'string' || candidate.extensionId.length > 64 ||
    typeof candidate.extensionInstanceId !== 'string' || candidate.extensionInstanceId.length > 100 ||
    typeof candidate.extensionChallenge !== 'string' || candidate.extensionChallenge.length > 100
  ) {
    throw new Error('pairing_claim_invalid');
  }
  return candidate as PairingClaimInput;
}

const config = loadGatewayConfig();
const identity = await loadGatewayIdentity(config);
const pairingBroker = await PairingBroker.create(identity, config.stateDirectory);
const expectedHost = `${config.host}:${config.port}`;

const server = createServer(async (request, response) => {
  try {
    if (request.socket.remoteAddress !== config.host || request.headers.host !== expectedHost) {
      sendJson(response, 403, { error: 'loopback_request_rejected' });
      return;
    }

    const url = new URL(request.url ?? '/', identity.publicIdentity.loopbackOrigin);
    if (request.method === 'GET' && url.pathname === '/') {
      response.setHeader(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      );
      send(response, 200, 'text/html; charset=utf-8', consoleHtml);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/style.css') {
      send(response, 200, 'text/css; charset=utf-8', consoleStyles);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/app.js') {
      send(response, 200, 'text/javascript; charset=utf-8', consoleScript);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/status') {
      sendJson(response, 200, {
        schemaVersion: 1,
        identity: identity.publicIdentity,
        pairedExtensionCount: pairingBroker.pairedExtensionCount
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/pairing/sessions') {
      if (request.headers.origin !== identity.publicIdentity.loopbackOrigin) {
        sendJson(response, 403, { error: 'console_origin_required' });
        return;
      }
      sendJson(response, 201, pairingBroker.createSession());
      return;
    }
    if (request.method === 'OPTIONS' && url.pathname === '/v1/pairing/claim') {
      if (!allowExtensionCors(request, response)) {
        sendJson(response, 403, { error: 'extension_origin_required' });
        return;
      }
      securityHeaders(response);
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/pairing/claim') {
      if (!allowExtensionCors(request, response)) {
        sendJson(response, 403, { error: 'extension_origin_required' });
        return;
      }
      const claim = pairingClaim(await readJsonBody(request));
      if (request.headers.origin !== `chrome-extension://${claim.extensionId}`) {
        sendJson(response, 403, { error: 'extension_origin_mismatch' });
        return;
      }
      sendJson(response, 200, await pairingBroker.claim(claim));
      return;
    }
    sendJson(response, 404, { error: 'route_not_found' });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'gateway_request_failed';
    const clientError = code.startsWith('pairing_') || code.startsWith('request_');
    sendJson(response, clientError ? 400 : 500, { error: clientError ? code : 'gateway_request_failed' });
  }
});

server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 50;

server.listen(config.port, config.host, () => {
  process.stdout.write(`Collector Gateway ready at ${identity.publicIdentity.loopbackOrigin}\n`);
  process.stdout.write(`Gateway identity ${identity.publicIdentity.identityFingerprint}\n`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
