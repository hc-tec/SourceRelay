import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_JSON_BYTES
} from './constants.mjs';
import { CollectorClientError } from './errors.mjs';
import { boundedInteger, boundedJson, safeGatewayErrorCode, validateLoopbackOrigin } from './validation.mjs';

export class JsonTransport {
  #origin;
  #token;
  #fetch;
  #requestTimeoutMs;

  constructor(options = {}) {
    this.#origin = validateLoopbackOrigin(options.origin ?? 'http://127.0.0.1:43127');
    this.#token = options.token ?? null;
    if (this.#token !== null && !/^cst_[A-Za-z0-9_-]{43}$/.test(this.#token)) {
      throw new CollectorClientError('collector_client_token_invalid', 400);
    }
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.#fetch !== 'function') {
      throw new CollectorClientError('collector_client_fetch_unavailable', 503);
    }
    this.#requestTimeoutMs = boundedInteger(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      100,
      120_000,
      'collector_client_request_timeout_invalid'
    );
  }

  async requestJson(pathname, options = {}) {
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
    const payload = await boundedJson(response, MAX_JSON_BYTES);
    if (!response.ok) throw new CollectorClientError(safeGatewayErrorCode(payload), response.status);
    return payload;
  }
}

function combineTimeout(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}
