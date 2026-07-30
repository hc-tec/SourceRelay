import {
  DEFAULT_POLL_INITIAL_DELAY_MS,
  DEFAULT_POLL_MAX_DELAY_MS,
  DEFAULT_WAIT_TIMEOUT_MS,
  CORE_RELEASE_VERSION,
  TERMINAL_STATES
} from './constants.mjs';
import { CollectorClientError } from './errors.mjs';
import { JsonTransport } from './transport.mjs';
import { Artifact, CollectionResult, Operation } from './models.mjs';
import {
  artifactPathFromOperation,
  assertUuid,
  boundedInteger,
  isOperation,
  isRecord,
  validateCollectRequest
} from './validation.mjs';

export class CollectorClient {
  #transport;
  #sleep;

  constructor(options = {}) {
    this.#transport = new JsonTransport(options);
    this.#sleep = options.sleepImpl ?? defaultSleep;
    if (typeof this.#sleep !== 'function') {
      throw new CollectorClientError('collector_client_sleep_invalid', 400);
    }
  }

  async listCapabilities(options = {}) {
    const payload = await this.#transport.requestJson('/v2/capabilities', { signal: options.signal });
    if (!isRecord(payload) || !Array.isArray(payload.capabilities)) {
      throw new CollectorClientError('collector_client_capabilities_invalid', 502);
    }
    return structuredClone(payload.capabilities);
  }

  async readStatus(options = {}) {
    return structuredClone(await this.#transport.requestJson('/v1/status', { signal: options.signal }));
  }

  async readOpenApi(options = {}) {
    return structuredClone(await this.#transport.requestJson('/v2/openapi.json', { signal: options.signal }));
  }

  async readRelease(options = {}) {
    const payload = await this.#transport.requestJson('/v2/release', { signal: options.signal });
    if (!isRecord(payload) || payload.product !== 'collector-core' || payload.releaseVersion !== CORE_RELEASE_VERSION) {
      throw new CollectorClientError('collector_client_release_manifest_invalid', 502);
    }
    return structuredClone(payload);
  }

  async listBrowserBindings(options = {}) {
    const payload = await this.#transport.requestJson('/v2/collector-service/browser-bindings', {
      requiresToken: true,
      signal: options.signal
    });
    if (!isRecord(payload) || !Array.isArray(payload.bindings)) {
      throw new CollectorClientError('collector_client_bindings_invalid', 502);
    }
    return structuredClone(payload.bindings);
  }

  async collect(request, options = {}) {
    validateCollectRequest(request);
    const payload = await this.#transport.requestJson('/v2/collect', {
      method: 'POST',
      requiresToken: true,
      body: request,
      signal: options.signal
    });
    const operation = payload?.result;
    if (!isOperation(operation)) {
      throw new CollectorClientError('collector_client_queued_operation_invalid', 502);
    }
    return structuredClone(operation);
  }

  async collectModel(request, options = {}) {
    return new Operation(await this.collect(request, options));
  }

  async getOperation(operationId, options = {}) {
    assertUuid(operationId, 'collector_client_operation_id_invalid');
    const payload = await this.#transport.requestJson(`/v2/collect/operations/${operationId}`, {
      requiresToken: true,
      signal: options.signal
    });
    const operation = payload?.result;
    if (!isOperation(operation)) {
      throw new CollectorClientError('collector_client_operation_invalid', 502);
    }
    return structuredClone(operation);
  }

  async getOperationModel(operationId, options = {}) {
    return new Operation(await this.getOperation(operationId, options));
  }

  async waitOperation(operationId, options = {}) {
    assertUuid(operationId, 'collector_client_operation_id_invalid');
    const timeoutMs = boundedInteger(
      options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
      100,
      3_600_000,
      'collector_client_wait_timeout_invalid'
    );
    const initialDelayMs = boundedInteger(
      options.initialDelayMs ?? DEFAULT_POLL_INITIAL_DELAY_MS,
      0,
      30_000,
      'collector_client_poll_delay_invalid'
    );
    const maxDelayMs = boundedInteger(
      options.maxDelayMs ?? DEFAULT_POLL_MAX_DELAY_MS,
      initialDelayMs,
      60_000,
      'collector_client_poll_delay_invalid'
    );
    const startedAt = Date.now();
    let delayMs = initialDelayMs;
    let operation = await this.getOperation(operationId, { signal: options.signal });
    while (!TERMINAL_STATES.has(operation.state)) {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        throw new CollectorClientError('collector_client_wait_timeout', 408, { operationId });
      }
      await this.#sleep(Math.min(delayMs, remainingMs), options.signal);
      if (Date.now() - startedAt >= timeoutMs) {
        throw new CollectorClientError('collector_client_wait_timeout', 408, { operationId });
      }
      operation = await this.getOperation(operationId, { signal: options.signal });
      delayMs = Math.min(Math.max(delayMs * 2, 1), maxDelayMs);
    }
    return operation;
  }

  async waitOperationModel(operationId, options = {}) {
    return new Operation(await this.waitOperation(operationId, options));
  }

  async readArtifact(operationId, options = {}) {
    const operation = await this.getOperation(operationId, { signal: options.signal });
    return await this.readArtifactFromOperation(operation, options);
  }

  async readArtifactModel(operationId, options = {}) {
    return new Artifact(await this.readArtifact(operationId, options));
  }

  async readArtifactFromOperation(operation, options = {}) {
    const retrievalPath = artifactPathFromOperation(operation);
    if (!retrievalPath) {
      throw new CollectorClientError('collector_client_artifact_unavailable', 409);
    }
    const payload = await this.#transport.requestJson(retrievalPath, {
      requiresToken: true,
      signal: options.signal
    });
    if (!isRecord(payload) || payload.capability !== operation.capability || !('artifact' in payload)) {
      throw new CollectorClientError('collector_client_artifact_invalid', 502);
    }
    return { operation: structuredClone(operation), artifact: structuredClone(payload) };
  }

  async collectAndWait(request, options = {}) {
    const queued = await this.collect(request, { signal: options.signal });
    const operation = await this.waitOperation(queued.operationId, options);
    if (!operation.artifact) return { operation, artifact: null };
    return await this.readArtifactFromOperation(operation, options);
  }

  async collectAndWaitModel(request, options = {}) {
    return new CollectionResult(await this.collectAndWait(request, options));
  }
}

function defaultSleep(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
    }, { once: true });
  });
}
