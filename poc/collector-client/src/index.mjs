const DEFAULT_GATEWAY_ORIGIN = 'http://127.0.0.1:43127';
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INITIAL_DELAY_MS = 500;
const DEFAULT_POLL_MAX_DELAY_MS = 2_000;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^cst_[A-Za-z0-9_-]{43}$/;
const SAFE_ERROR_PATTERN = /^[a-z0-9_.-]{1,120}$/i;
const TERMINAL_STATES = new Set(['completed', 'partial', 'stopped', 'failed']);
const DIRECT_CAPABILITIES = new Set([
  'bilibili.video_detail',
  'bilibili.native_search',
  'bilibili.native_search_batch',
  'bilibili.account_profile',
  'bilibili.account_inventory',
  'bilibili.dynamic',
  'bilibili.collection_series.overview',
  'bilibili.collection_series.detail',
  'bilibili.danmaku',
  'bilibili.discussion',
  'xiaohongshu.search.public_notes.v1',
  'xiaohongshu.account.public_notes.v1',
  'xiaohongshu.note.public_detail.v1',
  'xiaohongshu.note.public_comments.v1',
  'xiaohongshu.note.public_comment_replies.v1'
]);
const DIRECT_EXECUTION_TARGETS = new Set([
  'collector_work_tab',
  'user_selected_tab',
  'existing_public_explore_tab',
  'existing_public_profile_tab',
  'ephemeral_public_profile_url',
  'discover_public_profile_from_note',
  'existing_public_search_tab',
  'existing_public_note_overlay'
]);
const ARTIFACT_PATH_PATTERN = new RegExp(
  '^/v1/collect/artifacts/(' +
    'bilibili\\.(?:video_detail|native_search|native_search_batch|account_profile|account_inventory|' +
      'dynamic|collection_series\\.(?:overview|detail)|danmaku|discussion)|' +
    'xiaohongshu\\.(?:(?:search|account)\\.public_notes|note\\.public_(?:detail|comments|comment_replies))\\.v1' +
  ')/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$',
  'i'
);

export class CollectorClientError extends Error {
  constructor(code, status = 502, details = undefined) {
    super(code);
    this.name = 'CollectorClientError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

/**
 * A deliberately small client for the direct user-owned-browser API.
 *
 * It never accepts a caller-supplied browser path, tab ID, selector, script,
 * CDP command, or arbitrary artifact URL. POST /v2/collect is issued exactly
 * once per collect() call; waiting only reads operation state.
 */
export class CollectorClient {
  #origin;
  #token;
  #fetch;
  #sleep;
  #requestTimeoutMs;

  constructor(options = {}) {
    this.#origin = validateLoopbackOrigin(options.origin ?? DEFAULT_GATEWAY_ORIGIN);
    this.#token = options.token ?? null;
    if (this.#token !== null && !TOKEN_PATTERN.test(this.#token)) {
      throw new CollectorClientError('collector_client_token_invalid', 400);
    }
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.#fetch !== 'function') {
      throw new CollectorClientError('collector_client_fetch_unavailable', 503);
    }
    this.#sleep = options.sleepImpl ?? defaultSleep;
    if (typeof this.#sleep !== 'function') {
      throw new CollectorClientError('collector_client_sleep_invalid', 400);
    }
    this.#requestTimeoutMs = boundedInteger(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      100,
      120_000,
      'collector_client_request_timeout_invalid'
    );
  }

  async listCapabilities(options = {}) {
    const payload = await this.#requestJson('/v2/capabilities', { signal: options.signal });
    if (!isRecord(payload) || !Array.isArray(payload.capabilities)) {
      throw new CollectorClientError('collector_client_capabilities_invalid', 502);
    }
    return structuredClone(payload.capabilities);
  }

  async listBrowserBindings(options = {}) {
    const payload = await this.#requestJson('/v2/collector-service/browser-bindings', {
      requiresToken: true,
      signal: options.signal
    });
    if (!isRecord(payload) || !Array.isArray(payload.bindings)) {
      throw new CollectorClientError('collector_client_bindings_invalid', 502);
    }
    return structuredClone(payload.bindings);
  }

  /** Queue one registered capability. This method never retries POST. */
  async collect(request, options = {}) {
    validateCollectRequest(request);
    const payload = await this.#requestJson('/v2/collect', {
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

  async getOperation(operationId, options = {}) {
    assertUuid(operationId, 'collector_client_operation_id_invalid');
    const payload = await this.#requestJson(`/v2/collect/operations/${operationId}`, {
      requiresToken: true,
      signal: options.signal
    });
    const operation = payload?.result;
    if (!isOperation(operation)) {
      throw new CollectorClientError('collector_client_operation_invalid', 502);
    }
    return structuredClone(operation);
  }

  /**
   * Polls only local operation state. It never resubmits the platform task.
   */
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

  /**
   * Re-reads a known operation and derives the artifact path from its
   * capability-bound response. Callers cannot provide an arbitrary path.
   */
  async readArtifact(operationId, options = {}) {
    const operation = await this.getOperation(operationId, { signal: options.signal });
    return await this.readArtifactFromOperation(operation, options);
  }

  async readArtifactFromOperation(operation, options = {}) {
    const retrievalPath = artifactPathFromOperation(operation);
    if (!retrievalPath) {
      throw new CollectorClientError('collector_client_artifact_unavailable', 409);
    }
    const payload = await this.#requestJson(retrievalPath, {
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

  async #requestJson(pathname, options = {}) {
    if (options.requiresToken && this.#token === null) {
      throw new CollectorClientError('collector_client_token_required', 503);
    }
    const headers = { accept: 'application/json' };
    if (options.requiresToken) headers.authorization = `Bearer ${this.#token}`;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    let response;
    try {
      response = await this.#fetch(`${this.#origin}${pathname}`, {
        method: options.method ?? 'GET',
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        redirect: 'error',
        signal: combineTimeout(options.signal, this.#requestTimeoutMs)
      });
    } catch (error) {
      if (error instanceof CollectorClientError) throw error;
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        throw new CollectorClientError('collector_client_request_timeout', 408);
      }
      throw new CollectorClientError('collector_client_gateway_unreachable', 503);
    }
    const payload = await boundedJson(response);
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.error === 'string' && SAFE_ERROR_PATTERN.test(payload.error)
        ? payload.error
        : 'collector_client_gateway_rejected';
      throw new CollectorClientError(code, response.status);
    }
    return payload;
  }
}

export function artifactPathFromOperation(operation) {
  if (!isOperation(operation) || !operation.artifact || !isRecord(operation.artifact) ||
    typeof operation.artifact.retrievalPath !== 'string') return null;
  const match = operation.artifact.retrievalPath.match(ARTIFACT_PATH_PATTERN);
  if (!match || match[1] !== operation.capability || !UUID_PATTERN.test(match[2])) return null;
  return operation.artifact.retrievalPath;
}

export function isTerminalOperationState(state) {
  return TERMINAL_STATES.has(state);
}

function validateCollectRequest(value) {
  if (!isRecord(value) || !exactKeys(value, [
    'schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'
  ]) || value.schemaVersion !== 2 || !UUID_PATTERN.test(value.browserBindingId) ||
    (value.platform !== 'bilibili' && value.platform !== 'xiaohongshu') ||
    typeof value.capability !== 'string' || !DIRECT_CAPABILITIES.has(value.capability) ||
    (value.platform === 'bilibili' && !value.capability.startsWith('bilibili.')) ||
    (value.platform === 'xiaohongshu' && !value.capability.startsWith('xiaohongshu.')) ||
    typeof value.executionTarget !== 'string' || !DIRECT_EXECUTION_TARGETS.has(value.executionTarget) ||
    !isRecord(value.input)) {
    throw new CollectorClientError('collector_client_collect_request_invalid', 400);
  }
}

function isOperation(value) {
  return isRecord(value) && UUID_PATTERN.test(value.operationId) &&
    typeof value.capability === 'string' && DIRECT_CAPABILITIES.has(value.capability) &&
    (value.state === 'queued' || value.state === 'claimed' || TERMINAL_STATES.has(value.state));
}

function validateLoopbackOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CollectorClientError('collector_client_origin_invalid', 400);
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new CollectorClientError('collector_client_origin_invalid', 400);
  }
  return url.origin;
}

function boundedInteger(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CollectorClientError(code, 400);
  }
  return value;
}

function assertUuid(value, code) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new CollectorClientError(code, 400);
  }
}

function exactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function boundedJson(response) {
  const length = response.headers?.get?.('content-length');
  if (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_JSON_BYTES)) {
    throw new CollectorClientError('collector_client_response_too_large', 502);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) {
    throw new CollectorClientError('collector_client_response_too_large', 502);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CollectorClientError('collector_client_response_invalid', 502);
  }
}

function combineTimeout(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
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
