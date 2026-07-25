import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isUuid,
  parseTestbenchSubmission,
  readTestbenchConfig,
  safeErrorCode,
  TestbenchInputError
} from './contracts.mjs';
import {
  GatewayClientError,
  enqueueOperation,
  readBrowserBindings,
  readGatewayOpenApi,
  readGatewayStatus,
  readOperation,
  readOperationArtifact
} from './gateway-client.mjs';

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_RECENT_OPERATIONS = 40;
const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = resolve(sourceDirectory, '..', 'public');

export async function createTestbenchServer(config = readTestbenchConfig(process.env)) {
  const files = await loadPublicFiles();
  const knownOperations = new Map();
  const server = createServer((request, response) => {
    void handleRequest(request, response, { config, files, knownOperations });
  });
  server.requestTimeout = 25_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 50;
  return server;
}

async function handleRequest(request, response, context) {
  try {
    if (!isTrustedLoopbackRequest(request, context.config)) {
      sendJson(response, 403, { ok: false, error: 'testbench_loopback_request_rejected' });
      return;
    }
    const url = new URL(request.url ?? '/', context.config.appOrigin);
    if (request.method === 'GET' && serveStatic(url.pathname, response, context.files)) return;
    if (request.method === 'GET' && url.pathname === '/api/status') {
      await sendStatus(response, context.config, context.knownOperations.size);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/bindings') {
      const payload = await readBrowserBindings(context.config);
      sendJson(response, 200, { ok: true, ...safeBindingPayload(payload) });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/operations') {
      requireUiMutation(request, context.config);
      const collection = parseTestbenchSubmission(await readJsonBody(request));
      const payload = await enqueueOperation(context.config, collection);
      const operationId = operationIdFromPayload(payload);
      context.knownOperations.set(operationId, Date.now());
      trimKnownOperations(context.knownOperations);
      sendJson(response, 201, { ok: true, ...safeOperationPayload(payload) });
      return;
    }
    const operation = url.pathname.match(/^\/api\/operations\/([0-9a-f-]{36})$/i);
    if (request.method === 'GET' && operation) {
      const operationId = operation[1];
      requireKnownOperation(context.knownOperations, operationId);
      const payload = await readOperation(context.config, operationId);
      sendJson(response, 200, { ok: true, ...safeOperationPayload(payload) });
      return;
    }
    const artifact = url.pathname.match(/^\/api\/operations\/([0-9a-f-]{36})\/artifact$/i);
    if (request.method === 'GET' && artifact) {
      const operationId = artifact[1];
      requireKnownOperation(context.knownOperations, operationId);
      const payload = await readOperationArtifact(context.config, operationId);
      sendJson(response, 200, { ok: true, result: payload.operation, artifact: payload.artifact });
      return;
    }
    sendJson(response, 404, { ok: false, error: 'testbench_route_not_found' });
  } catch (error) {
    const status = error instanceof GatewayClientError ? error.status : error instanceof TestbenchInputError ? 400 : 500;
    sendJson(response, status, { ok: false, error: errorCode(error) });
  }
}

async function sendStatus(response, config, knownOperationCount) {
  let status = null;
  let openApi = null;
  let gatewayError = null;
  try {
    [status, openApi] = await Promise.all([readGatewayStatus(config), readGatewayOpenApi(config)]);
  } catch (error) {
    gatewayError = errorCode(error);
  }
  sendJson(response, 200, {
    ok: true,
    testbench: {
      schemaVersion: 1,
      appOrigin: config.appOrigin,
      gatewayOrigin: config.gatewayOrigin,
      tokenConfigured: config.token !== null,
      knownOperationCount
    },
    gateway: status === null ? { reachable: false, error: gatewayError } : safeGatewayStatus(status, openApi)
  });
}

function safeGatewayStatus(status, openApi) {
  return {
    reachable: true,
    deploymentMode: stringOrNull(status?.deploymentMode),
    browserBindingCount: nonNegativeNumberOrNull(status?.browserBindingCount),
    onlineBrowserBindingCount: nonNegativeNumberOrNull(status?.onlineBrowserBindingCount),
    browserProcessControl: stringOrNull(status?.browserProcessControl),
    openApiVersion: stringOrNull(openApi?.openapi),
    serviceVersion: stringOrNull(openApi?.info?.version)
  };
}

function safeBindingPayload(payload) {
  const bindings = Array.isArray(payload?.bindings)
    ? payload.bindings.flatMap((binding) => {
      if (!binding || typeof binding !== 'object' || !isUuid(binding.browserBindingId) ||
        (binding.state !== 'online' && binding.state !== 'paired')) return [];
      return [{
        browserBindingId: binding.browserBindingId,
        state: binding.state,
        pairedAt: stringOrNull(binding.pairedAt),
        lastSeenAt: stringOrNull(binding.lastSeenAt)
      }];
    })
    : [];
  return { schemaVersion: 1, bindings };
}

function safeOperationPayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.result || typeof payload.result !== 'object' ||
    !isUuid(payload.result.operationId)) {
    throw new GatewayClientError('testbench_gateway_response_invalid');
  }
  return { schemaVersion: 1, result: payload.result };
}

function operationIdFromPayload(payload) {
  const safe = safeOperationPayload(payload);
  return safe.result.operationId;
}

function trimKnownOperations(operations) {
  while (operations.size > MAX_RECENT_OPERATIONS) {
    operations.delete(operations.keys().next().value);
  }
}

function requireKnownOperation(operations, operationId) {
  if (!isUuid(operationId) || !operations.has(operationId)) {
    throw new TestbenchInputError('testbench_operation_not_known');
  }
}

function requireUiMutation(request, config) {
  const origin = request.headers.origin;
  if (request.headers['x-collector-testbench-request'] !== '1' || (origin !== undefined && origin !== config.appOrigin)) {
    throw new GatewayClientError('testbench_ui_mutation_rejected', 403);
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) throw new TestbenchInputError('testbench_request_too_large');
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new TestbenchInputError('testbench_request_invalid');
  }
  return parsed;
}

function isTrustedLoopbackRequest(request, config) {
  const address = request.socket.remoteAddress;
  return request.headers.host === `127.0.0.1:${config.appPort}` &&
    (address === '127.0.0.1' || address === '::ffff:127.0.0.1');
}

function serveStatic(pathname, response, files) {
  const file = pathname === '/' ? files.index : pathname === '/app.js' ? files.script : pathname === '/style.css' ? files.styles : null;
  if (!file) return false;
  response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('cache-control', 'no-store');
  response.writeHead(200, { 'content-type': file.contentType });
  response.end(file.body);
  return true;
}

function sendJson(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(body);
}

async function loadPublicFiles() {
  const [index, script, styles] = await Promise.all([
    readFile(resolve(publicDirectory, 'index.html'), 'utf8'),
    readFile(resolve(publicDirectory, 'app.js'), 'utf8'),
    readFile(resolve(publicDirectory, 'style.css'), 'utf8')
  ]);
  return {
    index: { contentType: 'text/html; charset=utf-8', body: index },
    script: { contentType: 'text/javascript; charset=utf-8', body: script },
    styles: { contentType: 'text/css; charset=utf-8', body: styles }
  };
}

function errorCode(error) {
  if (error instanceof GatewayClientError) return safeErrorCode(error.code);
  if (error instanceof TestbenchInputError) return safeErrorCode(error.message);
  return 'testbench_internal_error';
}

function stringOrNull(value) {
  return typeof value === 'string' ? value : null;
}

function nonNegativeNumberOrNull(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

async function start() {
  const config = readTestbenchConfig(process.env);
  const server = await createTestbenchServer(config);
  server.once('error', (error) => {
    const code = error && typeof error === 'object' && error.code === 'EADDRINUSE'
      ? 'testbench_port_in_use'
      : errorCode(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    process.exitCode = 1;
  });
  server.listen(config.appPort, config.appHost, () => {
    process.stdout.write(`Collector Gateway Testbench ready at ${config.appOrigin}\n`);
    process.stdout.write(`Gateway: ${config.gatewayOrigin}; token configured: ${config.token !== null}\n`);
  });
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
  process.on('SIGINT', () => { void close(); });
  process.on('SIGTERM', () => { void close(); });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await start();
}
