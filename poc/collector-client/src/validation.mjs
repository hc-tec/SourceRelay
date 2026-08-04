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
    'xiaohongshu\\.(?:(?:search|account)\\.public_notes|note\\.public_(?:detail|comments|comment_replies))\\.v1|' +
    'zhihu\\.(?:search|hot_list)\\.public_content\\.v1|' +
    'web\\.search\\.global\\.zhihu_provider\\.v1' +
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
  if (!isRecord(value) || value.schemaVersion !== 3 || !UUID_PATTERN.test(value.clientRequestId) ||
    typeof value.capability !== 'string' || !DIRECT_CAPABILITIES.has(value.capability) || !isRecord(value.input)) {
    throw new CollectorClientError('collector_client_collect_request_invalid', 400);
  }
  const official = value.executionTarget === 'official_api';
  const expectedKeys = official
    ? ['schemaVersion', 'clientRequestId', 'platform', 'capability', 'executionTarget', 'input']
    : ['schemaVersion', 'clientRequestId', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'];
  const validOfficialIdentity =
    (value.platform === 'zhihu' &&
      (value.capability === 'zhihu.search.public_content.v1' || value.capability === 'zhihu.hot_list.public_content.v1')) ||
    (value.platform === 'web' && value.capability === 'web.search.global.zhihu_provider.v1');
  const validBrowserIdentity =
    ((value.platform === 'bilibili' && value.capability.startsWith('bilibili.')) ||
      (value.platform === 'xiaohongshu' && value.capability.startsWith('xiaohongshu.'))) &&
    typeof value.browserBindingId === 'string' && UUID_PATTERN.test(value.browserBindingId);
  if (!exactKeys(value, expectedKeys) ||
      (official ? !validOfficialIdentity : !validBrowserIdentity) ||
      typeof value.executionTarget !== 'string' || !DIRECT_EXECUTION_TARGETS.has(value.executionTarget)) {
    throw new CollectorClientError('collector_client_collect_request_invalid', 400);
  }
}

export function isOperation(value) {
  return isRecord(value) && UUID_PATTERN.test(value.operationId) &&
    typeof value.capability === 'string' && DIRECT_CAPABILITIES.has(value.capability) &&
    (value.state === 'queued' || value.state === 'claimed' || TERMINAL_STATES.has(value.state));
}

export function isArtifactMetadata(value) {
  return isRecord(value) && value.schemaVersion === 1 && UUID_PATTERN.test(value.artifactId) &&
    (value.operationId === null || UUID_PATTERN.test(value.operationId)) &&
    typeof value.capability === 'string' && DIRECT_CAPABILITIES.has(value.capability) &&
    value.mediaType === 'application/json' && value.representation === 'canonical_json_utf8' &&
    Number.isSafeInteger(value.byteLength) && value.byteLength >= 0 &&
    typeof value.sha256 === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.sha256) &&
    (value.capturedAt === null || typeof value.capturedAt === 'string') &&
    (value.terminalStatus === null ||
      (typeof value.terminalStatus === 'string' && SAFE_ERROR_PATTERN.test(value.terminalStatus))) &&
    value.retentionClass === 'core_managed_local' && value.retainedUntil === null &&
    value.deletionState === 'retained' && value.available === true;
}

export function isArtifactContentWindow(value) {
  return isRecord(value) && value.schemaVersion === 1 && UUID_PATTERN.test(value.artifactId) &&
    typeof value.capability === 'string' && DIRECT_CAPABILITIES.has(value.capability) &&
    value.representation === 'canonical_json_utf8' && value.encoding === 'utf-8' &&
    Number.isSafeInteger(value.offset) && value.offset >= 0 &&
    Number.isSafeInteger(value.endExclusive) && value.endExclusive >= value.offset &&
    Number.isSafeInteger(value.byteLength) && value.byteLength >= value.endExclusive &&
    Number.isSafeInteger(value.maximumBytes) && value.maximumBytes >= 1 && value.maximumBytes <= 65_536 &&
    (value.nextOffset === null || (Number.isSafeInteger(value.nextOffset) && value.nextOffset === value.endExclusive)) &&
    typeof value.truncated === 'boolean' && value.truncated === (value.nextOffset !== null) &&
    typeof value.sha256 === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.chunkSha256 === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.chunkSha256) &&
    typeof value.text === 'string' && Buffer.byteLength(value.text, 'utf8') <= value.maximumBytes;
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
