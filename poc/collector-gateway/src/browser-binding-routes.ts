import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PairingClaimInput, PairingBroker } from './pairing';
import { readJsonBody, requireSameOrigin, safeErrorCode, sendJson } from './gateway-http';
import type { LoadedGatewayIdentity } from './identity';

const EXTENSION_ID = /^[a-p]{32}$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const EXTENSION_CORS_HEADERS = [
  'content-type',
  'authorization',
  'x-collector-extension-id',
  'x-collector-extension-instance-id',
  'x-collector-timestamp',
  'x-collector-nonce',
  'x-collector-body-sha256'
].join(', ');

export interface BrowserBindingRouteContext {
  identity: LoadedGatewayIdentity;
  pairingBroker: PairingBroker;
}

/**
 * This route family is the production bridge to a user-owned browser.
 * It never receives a browser profile path, a tab ID, a URL, or credentials.
 */
export async function handleBrowserBindingRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: BrowserBindingRouteContext
): Promise<boolean> {
  if (request.method === 'OPTIONS' && isExtensionRoute(url.pathname)) {
    const origin = extensionOrigin(request.headers.origin);
    if (!origin) {
      sendJson(response, 403, { schemaVersion: 1, ok: false, error: 'extension_origin_required' });
      return true;
    }
    setExtensionCors(response, origin);
    response.statusCode = 204;
    response.setHeader('cache-control', 'no-store');
    response.end();
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/browser-bindings') {
    if (!requireSameOrigin(request, response, context.identity.publicIdentity.loopbackOrigin)) return true;
    sendJson(response, 200, {
      schemaVersion: 1,
      bindings: context.pairingBroker.listBrowserBindings()
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/browser-bindings/pairing-sessions') {
    if (!requireSameOrigin(request, response, context.identity.publicIdentity.loopbackOrigin)) return true;
    const body = await readJsonBody(request);
    if (!isEmptyObject(body)) throw new Error('browser_binding_pairing_session_input_invalid');
    sendJson(response, 201, {
      schemaVersion: 1,
      pairing: context.pairingBroker.createSession()
    });
    return true;
  }

  const revoke = url.pathname.match(new RegExp(`^/v1/browser-bindings/(${UUID})/revoke$`, 'i'));
  if (request.method === 'POST' && revoke) {
    if (!requireSameOrigin(request, response, context.identity.publicIdentity.loopbackOrigin)) return true;
    const body = await readJsonBody(request);
    if (!isEmptyObject(body)) throw new Error('browser_binding_revoke_input_invalid');
    const binding = await context.pairingBroker.revokeBrowserBinding(revoke[1]!);
    sendJson(response, 200, { schemaVersion: 1, binding });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/extension/pairing/claim') {
    return await handlePairingClaim(request, response, context);
  }

  if (request.method === 'GET' && url.pathname === '/v1/extension/browser-binding') {
    return await handleAuthenticatedBindingRead(request, response, context);
  }

  return false;
}

async function handlePairingClaim(
  request: IncomingMessage,
  response: ServerResponse,
  context: BrowserBindingRouteContext
): Promise<boolean> {
  const origin = extensionOrigin(request.headers.origin);
  if (!origin) {
    sendJson(response, 403, { schemaVersion: 1, ok: false, error: 'extension_origin_required' });
    return true;
  }
  setExtensionCors(response, origin);
  try {
    const input = pairingClaimInput(await readJsonBody(request));
    if (origin !== `chrome-extension://${input.extensionId}`) {
      throw new Error('pairing_origin_rejected');
    }
    const claim = await context.pairingBroker.claim(input);
    sendJson(response, 201, claim);
  } catch (error) {
    sendJson(response, 400, { schemaVersion: 1, ok: false, error: safeErrorCode(error) });
  }
  return true;
}

async function handleAuthenticatedBindingRead(
  request: IncomingMessage,
  response: ServerResponse,
  context: BrowserBindingRouteContext
): Promise<boolean> {
  const origin = extensionOrigin(request.headers.origin);
  if (request.headers.origin !== undefined && !origin) {
    sendJson(response, 403, { schemaVersion: 1, ok: false, error: 'pairing_origin_rejected' });
    return true;
  }
  if (origin) setExtensionCors(response, origin);
  try {
    const authorised = await context.pairingBroker.authoriseRequest({
      origin: header(request, 'origin'),
      extensionId: header(request, 'x-collector-extension-id'),
      extensionInstanceId: header(request, 'x-collector-extension-instance-id'),
      timestamp: header(request, 'x-collector-timestamp'),
      nonce: header(request, 'x-collector-nonce'),
      bodySha256: header(request, 'x-collector-body-sha256'),
      authorization: header(request, 'authorization'),
      method: request.method ?? 'GET',
      pathname: '/v1/extension/browser-binding',
      body: ''
    });
    const binding = context.pairingBroker.getBrowserBinding(authorised.browserBindingId);
    sendJson(response, 200, { schemaVersion: 1, binding });
  } catch (error) {
    sendJson(response, 401, { schemaVersion: 1, ok: false, error: safeErrorCode(error) });
  }
  return true;
}

function pairingClaimInput(value: unknown): PairingClaimInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('pairing_claim_input_invalid');
  }
  const candidate = value as Partial<PairingClaimInput>;
  const allowed = new Set([
    'schemaVersion',
    'pairingSessionId',
    'pairingCode',
    'extensionId',
    'extensionInstanceId',
    'extensionChallenge'
  ]);
  if (
    Object.keys(candidate).some((key) => !allowed.has(key)) ||
    candidate.schemaVersion !== 1 ||
    typeof candidate.pairingSessionId !== 'string' ||
    typeof candidate.pairingCode !== 'string' ||
    typeof candidate.extensionId !== 'string' ||
    typeof candidate.extensionInstanceId !== 'string' ||
    typeof candidate.extensionChallenge !== 'string'
  ) throw new Error('pairing_claim_input_invalid');
  return {
    schemaVersion: 1,
    pairingSessionId: candidate.pairingSessionId,
    pairingCode: candidate.pairingCode,
    extensionId: candidate.extensionId,
    extensionInstanceId: candidate.extensionInstanceId,
    extensionChallenge: candidate.extensionChallenge
  };
}

function isExtensionRoute(pathname: string): boolean {
  return pathname === '/v1/extension/pairing/claim' || pathname === '/v1/extension/browser-binding';
}

function extensionOrigin(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(value);
  return match && EXTENSION_ID.test(match[1]!) ? value : null;
}

function setExtensionCors(response: ServerResponse, origin: string): void {
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.setHeader('access-control-allow-headers', EXTENSION_CORS_HEADERS);
  response.setHeader('access-control-max-age', '300');
  response.setHeader('vary', 'Origin');
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function isEmptyObject(value: unknown): value is Record<string, never> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}
