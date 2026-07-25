import { artifactPathFromOperation, safeErrorCode } from './contracts.mjs';

const MAX_GATEWAY_JSON_BYTES = 2 * 1024 * 1024;

export class GatewayClientError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'GatewayClientError';
    this.code = code;
    this.status = status;
  }
}

export async function readGatewayStatus(config) {
  return await gatewayJson(config, '/v1/status');
}

export async function readGatewayOpenApi(config) {
  return await gatewayJson(config, '/v2/openapi.json');
}

export async function readBrowserBindings(config) {
  return await gatewayJson(config, '/v2/collector-service/browser-bindings', { requiresToken: true });
}

export async function enqueueOperation(config, request) {
  return await gatewayJson(config, '/v2/collect', {
    method: 'POST',
    requiresToken: true,
    body: request
  });
}

export async function readOperation(config, operationId) {
  return await gatewayJson(config, `/v2/collect/operations/${operationId}`, { requiresToken: true });
}

/**
 * The browser may only retrieve an artifact after this server has re-read a
 * known operation and derived its fixed retrieval path. No browser-supplied
 * Gateway path can reach this function.
 */
export async function readOperationArtifact(config, operationId) {
  const operationPayload = await readOperation(config, operationId);
  const operation = operationPayload?.result;
  const retrievalPath = artifactPathFromOperation(operation);
  if (!retrievalPath) throw new GatewayClientError('testbench_operation_artifact_unavailable', 409);
  const artifact = await gatewayJson(config, retrievalPath, { requiresToken: true });
  return { operation, artifact };
}

async function gatewayJson(config, pathname, options = {}) {
  if (options.requiresToken && !config.token) {
    throw new GatewayClientError('testbench_token_not_configured', 503);
  }
  const headers = { accept: 'application/json' };
  if (options.requiresToken) headers.authorization = `Bearer ${config.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${config.gatewayOrigin}${pathname}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(config.requestTimeoutMs)
    });
  } catch {
    throw new GatewayClientError('testbench_gateway_unreachable', 503);
  }

  const payload = await boundedJson(response);
  if (!response.ok) {
    const gatewayCode = payload && typeof payload.error === 'string'
      ? safeErrorCode(payload.error, 'gateway_rejected')
      : 'gateway_rejected';
    throw new GatewayClientError(gatewayCode, response.status);
  }
  return payload;
}

async function boundedJson(response) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_GATEWAY_JSON_BYTES)) {
    throw new GatewayClientError('testbench_gateway_response_too_large');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_GATEWAY_JSON_BYTES) {
    throw new GatewayClientError('testbench_gateway_response_too_large');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new GatewayClientError('testbench_gateway_response_invalid');
  }
}
