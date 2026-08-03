import {
  DEFAULT_POLL_INITIAL_DELAY_MS,
  DEFAULT_POLL_MAX_DELAY_MS,
  DEFAULT_WAIT_TIMEOUT_MS,
  CORE_RELEASE_VERSION,
  CORE_SERVICE_SCHEMA_VERSION,
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
  isArtifactContentWindow,
  isArtifactMetadata,
  isRecord,
  validateCollectRequest
} from './validation.mjs';

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

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
    return structuredClone((await this.readCapabilityCatalog(options)).capabilities);
  }

  async readCapabilityCatalog(options = {}) {
    const payload = await this.#transport.requestJson('/v2/capabilities', { signal: options.signal });
    if (!isRecord(payload) || payload.schemaVersion !== CORE_SERVICE_SCHEMA_VERSION ||
      typeof payload.catalogDigest !== 'string' || !DIGEST_PATTERN.test(payload.catalogDigest) ||
      !Array.isArray(payload.capabilities) || !Array.isArray(payload.directContracts)) {
      throw new CollectorClientError('collector_client_capabilities_invalid', 502);
    }
    return structuredClone(payload);
  }

  async readStatus(options = {}) {
    return structuredClone(await this.#transport.requestJson('/v1/status', { signal: options.signal }));
  }

  async readOpenApi(options = {}) {
    return structuredClone(await this.#transport.requestJson('/v2/openapi.json', { signal: options.signal }));
  }

  async readRelease(options = {}) {
    const payload = await this.#transport.requestJson('/v2/release', { signal: options.signal });
    if (!isRecord(payload) || payload.product !== 'collector-core' || payload.releaseVersion !== CORE_RELEASE_VERSION ||
      payload.service?.schemaVersion !== CORE_SERVICE_SCHEMA_VERSION || !isRecord(payload.compatibility) ||
      payload.compatibility.schemaVersion !== 1 ||
      payload.compatibility.digestAlgorithm !== 'sha256-canonical-json-v1' ||
      typeof payload.compatibility.openApiSchemaDigest !== 'string' ||
      !DIGEST_PATTERN.test(payload.compatibility.openApiSchemaDigest) ||
      typeof payload.compatibility.capabilityCatalogDigest !== 'string' ||
      !DIGEST_PATTERN.test(payload.compatibility.capabilityCatalogDigest) ||
      !Array.isArray(payload.compatibility.features) ||
      !payload.compatibility.features.every((feature) => typeof feature === 'string')) {
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

  async readArtifactMetadata(artifactId, options = {}) {
    assertUuid(artifactId, 'collector_client_artifact_id_invalid');
    const payload = await this.#transport.requestJson(`/v2/collect/artifacts/${artifactId}`, {
      requiresToken: true,
      signal: options.signal
    });
    if (!isRecord(payload) || !isArtifactMetadata(payload.metadata)) {
      throw new CollectorClientError('collector_client_artifact_metadata_invalid', 502);
    }
    return structuredClone(payload.metadata);
  }

  async readArtifactContentWindow(artifactId, options = {}) {
    assertUuid(artifactId, 'collector_client_artifact_id_invalid');
    const offset = boundedInteger(
      options.offset ?? 0,
      0,
      Number.MAX_SAFE_INTEGER,
      'collector_client_artifact_offset_invalid'
    );
    const maxBytes = boundedInteger(
      options.maxBytes ?? 16_384,
      1,
      65_536,
      'collector_client_artifact_window_invalid'
    );
    const payload = await this.#transport.requestJson(
      `/v2/collect/artifacts/${artifactId}/content?offset=${offset}&maxBytes=${maxBytes}`,
      { requiresToken: true, signal: options.signal }
    );
    if (!isRecord(payload) || !isArtifactContentWindow(payload.window) ||
      payload.window.artifactId !== artifactId || payload.window.offset !== offset ||
      payload.window.maximumBytes !== maxBytes) {
      throw new CollectorClientError('collector_client_artifact_window_invalid', 502);
    }
    return structuredClone(payload.window);
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
