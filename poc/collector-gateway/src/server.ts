import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { CollectionBrowserManager } from './browser-manager';
import { loadGatewayConfig } from './config';
import { consoleHtml, consoleScript, consoleStyles } from './console-assets';
import { GatewayEvidenceRegistry, gatewayEvidenceSubmission } from './evidence';
import { loadGatewayIdentity } from './identity';
import { PairingBroker, type PairingClaimInput } from './pairing';
import { BrowserProfileRegistry, createBrowserProfileInput } from './profiles';
import { GatewayTaskQueue, scoutTaskInput } from './tasks';
import {
  CapabilityValidationRegistry,
  capabilityValidationInput,
  capabilityValidationReviewInput
} from './validations';
import type {
  GatewayPreflightSubmission,
  GatewayStageReceipt
} from '../../collector-extension/src/shared/control-plane';

const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const MAX_EVIDENCE_BODY_BYTES = 256 * 1024;
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
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.setHeader(
    'access-control-allow-headers',
    'content-type, x-collector-extension-id, x-collector-extension-instance, x-collector-timestamp, x-collector-nonce, x-collector-body-sha256, x-collector-authorization'
  );
  response.setHeader('access-control-max-age', '300');
  response.setHeader('vary', 'origin');
  return true;
}

// Chromium may omit Origin on an extension service worker's same-scheme GET
// even though its custom authentication headers still trigger a protected
// CORS preflight for web pages. Pairing claims and OPTIONS remain
// origin-required; an already-paired request may omit Origin, but if one is
// present it must still be the exact chrome-extension origin.
function allowAuthenticatedExtensionRequest(
  request: IncomingMessage,
  response: ServerResponse
): boolean {
  return request.headers.origin === undefined || allowExtensionCors(request, response);
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function requireConsoleOrigin(request: IncomingMessage, response: ServerResponse, origin: string): boolean {
  if (request.headers.origin === origin) return true;
  sendJson(response, 403, { error: 'console_origin_required' });
  return false;
}

async function readTextBody(
  request: IncomingMessage,
  maximumBytes = MAX_REQUEST_BODY_BYTES
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maximumBytes) throw new Error('request_body_too_large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const text = await readTextBody(request);
  return text ? JSON.parse(text) as unknown : {};
}

function preflightSubmission(value: unknown): GatewayPreflightSubmission {
  if (!value || typeof value !== 'object') throw new Error('preflight_submission_invalid');
  const candidate = value as Partial<GatewayPreflightSubmission>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.taskId !== 'string' ||
    !candidate.plan ||
    candidate.plan.schemaVersion !== 1 ||
    candidate.plan.taskId !== candidate.taskId
  ) {
    throw new Error('preflight_submission_invalid');
  }
  return candidate as GatewayPreflightSubmission;
}

function stageReceipt(value: unknown): GatewayStageReceipt {
  if (!value || typeof value !== 'object') throw new Error('task_stage_receipt_invalid');
  const candidate = value as Partial<GatewayStageReceipt>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.taskId !== 'string' ||
    typeof candidate.stageId !== 'string' ||
    (candidate.status !== 'accepted' && candidate.status !== 'blocked') ||
    typeof candidate.recordedAt !== 'string'
  ) {
    throw new Error('task_stage_receipt_invalid');
  }
  return candidate as GatewayStageReceipt;
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
const profileRegistry = await BrowserProfileRegistry.create(config.profileDirectory, config.stateDirectory);
const browserManager = new CollectionBrowserManager(config, profileRegistry);
const validationRegistry = await CapabilityValidationRegistry.create(config.stateDirectory);
const evidenceRegistry = await GatewayEvidenceRegistry.create(config.stateDirectory);
const taskQueue = new GatewayTaskQueue(identity, evidenceRegistry);
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
      const profiles = await browserManager.list();
      sendJson(response, 200, {
        schemaVersion: 1,
        identity: identity.publicIdentity,
        pairedExtensionCount: pairingBroker.pairedExtensionCount,
        browserProfileCount: profiles.length,
        runningBrowserProfileCount: profiles.filter((profile) => profile.running).length
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/profiles') {
      sendJson(response, 200, { schemaVersion: 1, profiles: await browserManager.list() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/validations') {
      sendJson(response, 200, { schemaVersion: 1, validations: validationRegistry.list() });
      return;
    }
    const validationReviewMatch = url.pathname.match(/^\/v1\/validations\/([0-9a-f-]{36})\/review$/i);
    if (request.method === 'POST' && validationReviewMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 200, {
        schemaVersion: 1,
        validation: await validationRegistry.review(
          validationReviewMatch[1],
          capabilityValidationReviewInput(await readJsonBody(request))
        )
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/profiles') {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const profile = await profileRegistry.createProfile(createBrowserProfileInput(await readJsonBody(request)));
      sendJson(response, 201, {
        schemaVersion: 1,
        profile: (await browserManager.list()).find((summary) => summary.profile.profileId === profile.profileId)
      });
      return;
    }
    const profileLaunchMatch = url.pathname.match(/^\/v1\/profiles\/([0-9a-f-]{36})\/launch$/i);
    if (request.method === 'POST' && profileLaunchMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 200, { schemaVersion: 1, profile: await browserManager.launch(profileLaunchMatch[1]) });
      return;
    }
    const profileCloseMatch = url.pathname.match(/^\/v1\/profiles\/([0-9a-f-]{36})\/close$/i);
    if (request.method === 'POST' && profileCloseMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      await browserManager.close(profileCloseMatch[1]);
      sendJson(response, 200, {
        schemaVersion: 1,
        profile: (await browserManager.list()).find(
          (summary) => summary.profile.profileId === profileCloseMatch[1]
        )
      });
      return;
    }
    const profilePairMatch = url.pathname.match(/^\/v1\/profiles\/([0-9a-f-]{36})\/pair$/i);
    if (request.method === 'POST' && profilePairMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const session = pairingBroker.createSession();
      const profile = await browserManager.pairProfileWithGateway(profilePairMatch[1], {
        loopbackOrigin: identity.publicIdentity.loopbackOrigin,
        gatewayInstanceId: identity.publicIdentity.gatewayInstanceId,
        pairingSessionId: session.pairingSessionId,
        pairingCode: session.pairingCode
      });
      // The one-time pairing code and Session ID remain process-local. This
      // profile-level product route returns only the resulting runtime state.
      sendJson(response, 200, { schemaVersion: 1, profile });
      return;
    }
    const profilePermissionMatch = url.pathname.match(
      /^\/v1\/profiles\/([0-9a-f-]{36})\/strategy-permission$/i
    );
    if (request.method === 'POST' && profilePermissionMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 200, {
        schemaVersion: 1,
        profile: await browserManager.requestStrategyPermission(profilePermissionMatch[1])
      });
      return;
    }
    const profilePollMatch = url.pathname.match(/^\/v1\/profiles\/([0-9a-f-]{36})\/poll$/i);
    if (request.method === 'POST' && profilePollMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 200, {
        schemaVersion: 1,
        profile: await browserManager.pollGatewayTasks(profilePollMatch[1])
      });
      return;
    }
    const bilibiliValidationMatch = url.pathname.match(
      /^\/v1\/profiles\/([0-9a-f-]{36})\/validations\/bilibili$/i
    );
    if (request.method === 'POST' && bilibiliValidationMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const input = capabilityValidationInput(await readJsonBody(request));
      const run = await browserManager.runBilibiliAnonymousValidation(
        bilibiliValidationMatch[1],
        input.query,
        new Set(validationRegistry.list().map((validation) => validation.runId))
      );
      sendJson(response, 201, { schemaVersion: 1, validation: await validationRegistry.record(run) });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/tasks') {
      sendJson(response, 200, { schemaVersion: 1, tasks: taskQueue.list() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/evidence') {
      const taskId = url.searchParams.get('taskId') ?? undefined;
      if (taskId && !/^[0-9a-f-]{36}$/i.test(taskId)) throw new Error('evidence_task_id_invalid');
      sendJson(response, 200, { schemaVersion: 1, batches: evidenceRegistry.list(taskId) });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/tasks') {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      const input = scoutTaskInput(await readJsonBody(request));
      const bindings = profileRegistry.collectionBindings(input.platforms, input.profileIds);
      sendJson(response, 201, taskQueue.createScoutTask(input, bindings));
      return;
    }
    const approvalMatch = url.pathname.match(/^\/v1\/tasks\/([0-9a-f-]{36})\/approve$/i);
    if (request.method === 'POST' && approvalMatch) {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 200, await taskQueue.approve(approvalMatch[1]));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/pairing/sessions') {
      if (!requireConsoleOrigin(request, response, identity.publicIdentity.loopbackOrigin)) return;
      sendJson(response, 201, pairingBroker.createSession());
      return;
    }
    if (
      request.method === 'OPTIONS' &&
      (url.pathname === '/v1/pairing/claim' || url.pathname.startsWith('/v1/extension/'))
    ) {
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
    if (url.pathname === '/v1/extension/work' && request.method === 'GET') {
      if (!allowAuthenticatedExtensionRequest(request, response)) {
        sendJson(response, 403, { error: 'extension_origin_required' });
        return;
      }
      const extension = await pairingBroker.authoriseRequest({
        origin: request.headers.origin,
        extensionId: header(request, 'x-collector-extension-id'),
        extensionInstanceId: header(request, 'x-collector-extension-instance'),
        timestamp: header(request, 'x-collector-timestamp'),
        nonce: header(request, 'x-collector-nonce'),
        bodySha256: header(request, 'x-collector-body-sha256'),
        authorization: header(request, 'x-collector-authorization'),
        method: request.method,
        pathname: url.pathname,
        body: ''
      });
      const work = await taskQueue.nextWork(extension.extensionInstanceId);
      if (!work) {
        securityHeaders(response);
        response.statusCode = 204;
        response.end();
        return;
      }
      sendJson(response, 200, work);
      return;
    }
    if (url.pathname === '/v1/extension/preflight' && request.method === 'POST') {
      if (!allowAuthenticatedExtensionRequest(request, response)) {
        sendJson(response, 403, { error: 'extension_origin_required' });
        return;
      }
      const body = await readTextBody(request);
      const extension = await pairingBroker.authoriseRequest({
        origin: request.headers.origin,
        extensionId: header(request, 'x-collector-extension-id'),
        extensionInstanceId: header(request, 'x-collector-extension-instance'),
        timestamp: header(request, 'x-collector-timestamp'),
        nonce: header(request, 'x-collector-nonce'),
        bodySha256: header(request, 'x-collector-body-sha256'),
        authorization: header(request, 'x-collector-authorization'),
        method: request.method,
        pathname: url.pathname,
        body
      });
      sendJson(
        response,
        200,
        taskQueue.submitPreflight(preflightSubmission(JSON.parse(body) as unknown), extension.extensionInstanceId)
      );
      return;
    }
    if (url.pathname === '/v1/extension/stage-receipt' && request.method === 'POST') {
      if (!allowAuthenticatedExtensionRequest(request, response)) {
        sendJson(response, 403, { error: 'extension_origin_required' });
        return;
      }
      const body = await readTextBody(request);
      const extension = await pairingBroker.authoriseRequest({
        origin: request.headers.origin,
        extensionId: header(request, 'x-collector-extension-id'),
        extensionInstanceId: header(request, 'x-collector-extension-instance'),
        timestamp: header(request, 'x-collector-timestamp'),
        nonce: header(request, 'x-collector-nonce'),
        bodySha256: header(request, 'x-collector-body-sha256'),
        authorization: header(request, 'x-collector-authorization'),
        method: request.method,
        pathname: url.pathname,
        body
      });
      sendJson(
        response,
        200,
        taskQueue.submitStageReceipt(stageReceipt(JSON.parse(body) as unknown), extension.extensionInstanceId)
      );
      return;
    }
    if (url.pathname === '/v1/extension/evidence' && request.method === 'POST') {
      if (!allowAuthenticatedExtensionRequest(request, response)) {
        sendJson(response, 403, { error: 'extension_origin_required' });
        return;
      }
      const body = await readTextBody(request, MAX_EVIDENCE_BODY_BYTES);
      const extension = await pairingBroker.authoriseRequest({
        origin: request.headers.origin,
        extensionId: header(request, 'x-collector-extension-id'),
        extensionInstanceId: header(request, 'x-collector-extension-instance'),
        timestamp: header(request, 'x-collector-timestamp'),
        nonce: header(request, 'x-collector-nonce'),
        bodySha256: header(request, 'x-collector-body-sha256'),
        authorization: header(request, 'x-collector-authorization'),
        method: request.method,
        pathname: url.pathname,
        body
      });
      sendJson(
        response,
        200,
        await taskQueue.submitEvidence(
          gatewayEvidenceSubmission(JSON.parse(body) as unknown),
          extension.extensionInstanceId
        )
      );
      return;
    }
    sendJson(response, 404, { error: 'route_not_found' });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'gateway_request_failed';
    const clientError =
      code.startsWith('pairing_') ||
      code.startsWith('request_') ||
      code.startsWith('task_') ||
      code.startsWith('profile_') ||
      code.startsWith('validation_') ||
      code.startsWith('evidence_') ||
      code.startsWith('preflight_') ||
      code.endsWith('_invalid') ||
      code === 'one_or_more_capabilities_are_not_ready';
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

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([
    new Promise<void>((resolveClose) => server.close(() => resolveClose())),
    browserManager.closeAll()
  ]);
}

process.on('SIGINT', () => void shutdown().catch(() => { process.exitCode = 1; }));
process.on('SIGTERM', () => void shutdown().catch(() => { process.exitCode = 1; }));
