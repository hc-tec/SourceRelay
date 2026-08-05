import {
  CollectorClient,
  CollectorClientError,
  artifactPathFromOperation,
  CORE_SERVICE_SCHEMA_VERSION,
  createClientRequestId
} from '@intelligence/collector-client';

/**
 * The Testbench keeps its small UI-facing response envelope, but delegates
 * all direct Gateway protocol work to the same client that upper applications
 * use. This prevents the test lane from becoming a second API implementation.
 */
export class GatewayClientError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'GatewayClientError';
    this.code = code;
    this.status = status;
  }
}

export async function readGatewayStatus(config) {
  return await call(config, (client) => client.readStatus());
}

export async function readGatewayOpenApi(config) {
  return await call(config, (client) => client.readOpenApi());
}

export async function readGatewayCapabilities(config) {
  const capabilities = await call(config, (client) => client.listCapabilities());
  return { schemaVersion: 2, capabilities };
}

export async function readBrowserBindings(config) {
  const bindings = await call(config, (client) => client.listBrowserBindings());
  return { schemaVersion: 2, bindings };
}

export async function enqueueOperation(config, request) {
  const operation = await call(config, (client) => client.collect(toCollectorRequest(request)));
  return { schemaVersion: 2, result: operation };
}

/**
 * The Testbench owns a small UI intent envelope.  Convert it at this one
 * boundary to the released Collector Service wire contract instead of
 * maintaining a second versioned HTTP protocol in the app.
 */
export function toCollectorRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new GatewayClientError('testbench_request_invalid', 400);
  }
  return {
    ...request,
    schemaVersion: CORE_SERVICE_SCHEMA_VERSION,
    clientRequestId: createClientRequestId()
  };
}

export async function readOperation(config, operationId) {
  const operation = await call(config, (client) => client.getOperation(operationId));
  return { schemaVersion: 2, result: operation };
}

/**
 * The client re-reads the operation and derives the capability-bound artifact
 * path. No browser-supplied Gateway path can reach this function.
 */
export async function readOperationArtifact(config, operationId) {
  return await call(config, (client) => client.readArtifact(operationId));
}

/** Exported for the contract tests and for callers that need path validation. */
export { artifactPathFromOperation };

async function call(config, action) {
  try {
    return await action(new CollectorClient({
      origin: config.gatewayOrigin,
      token: config.token,
      requestTimeoutMs: config.requestTimeoutMs
    }));
  } catch (error) {
    throw toGatewayClientError(error);
  }
}

function toGatewayClientError(error) {
  if (error instanceof GatewayClientError) return error;
  if (error instanceof CollectorClientError) {
    const mappedCode = {
      collector_client_token_required: 'testbench_token_not_configured',
      collector_client_gateway_unreachable: 'testbench_gateway_unreachable',
      collector_client_request_timeout: 'testbench_gateway_timeout',
      collector_client_response_too_large: 'testbench_gateway_response_too_large',
      collector_client_response_invalid: 'testbench_gateway_response_invalid',
      collector_client_artifact_unavailable: 'testbench_operation_artifact_unavailable',
      collector_client_artifact_invalid: 'testbench_gateway_response_invalid'
    }[error.code] ?? error.code;
    return new GatewayClientError(mappedCode, error.status);
  }
  return new GatewayClientError('testbench_gateway_unreachable', 503);
}
