import {
  DIRECT_CAPABILITIES,
  DIRECT_EXECUTION_TARGETS,
  SAFE_ERROR_PATTERN,
  TERMINAL_STATES,
  UUID_PATTERN
} from './constants.mjs';
import { CollectorClientError } from './errors.mjs';

const ARTIFACT_PATH_PATTERN = new RegExp(
  '^/v1/collect/artifacts/(' +
    'bilibili\\.(?:video_detail|native_search|native_search_batch|account_profile|account_inventory|' +
      'dynamic|collection_series\\.(?:overview|detail)|danmaku|discussion)|' +
    'xiaohongshu\\.(?:(?:search|account)\\.public_notes|note\\.public_(?:detail|comments|comment_replies))\\.v1' +
  ')/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$',
  'i'
);

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

export function validateCollectRequest(value) {
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

export function isOperation(value) {
  return isRecord(value) && UUID_PATTERN.test(value.operationId) &&
    typeof value.capability === 'string' && DIRECT_CAPABILITIES.has(value.capability) &&
    (value.state === 'queued' || value.state === 'claimed' || TERMINAL_STATES.has(value.state));
}

export function validateLoopbackOrigin(value) {
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

export function boundedInteger(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CollectorClientError(code, 400);
  }
  return value;
}

export function assertUuid(value, code) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new CollectorClientError(code, 400);
  }
}

export function exactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function boundedJson(response, maxBytes) {
  const length = response.headers?.get?.('content-length');
  if (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new CollectorClientError('collector_client_response_too_large', 502);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new CollectorClientError('collector_client_response_too_large', 502);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CollectorClientError('collector_client_response_invalid', 502);
  }
}

export function safeGatewayErrorCode(payload) {
  return isRecord(payload) && typeof payload.error === 'string' && SAFE_ERROR_PATTERN.test(payload.error)
    ? payload.error
    : 'collector_client_gateway_rejected';
}
