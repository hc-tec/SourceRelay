const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^cst_[A-Za-z0-9_-]{43}$/;
const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const ACCOUNT_ID_PATTERN = /^[1-9]\d{0,19}$/;
const ARTIFACT_PATH_PATTERN = /^\/v1\/collect\/artifacts\/(bilibili\.(?:video_detail|native_search|native_search_batch|account_profile|account_inventory|dynamic|collection_series\.(?:overview|detail)|danmaku|discussion)|xiaohongshu\.search\.public_notes\.v1)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export const TESTBENCH_SCHEMA_VERSION = 1;
export const DIRECT_SCHEMA_VERSION = 2;
export const DEFAULT_GATEWAY_ORIGIN = 'http://127.0.0.1:43127';
export const DEFAULT_TESTBENCH_PORT = 43128;

export class TestbenchInputError extends Error {
  constructor(code) {
    super(code);
    this.name = 'TestbenchInputError';
  }
}

/**
 * The testbench is deliberately a narrower consumer than the Gateway. It
 * accepts fixed public identifiers (BVID, query or MID) rather than arbitrary
 * URLs, and it never exposes a route for selectors, scripts, tab IDs, Browser
 * Profiles, or network data.
 */
export function parseTestbenchSubmission(value) {
  if (!isRecord(value) || !hasExactKeys(value, ['browserBindingId', 'kind', 'input'])) {
    throw new TestbenchInputError('testbench_request_invalid');
  }
  if (!isUuid(value.browserBindingId) || !isRecord(value.input)) {
    throw new TestbenchInputError('testbench_request_invalid');
  }

  if (value.kind === 'video_detail') {
    if (!hasExactKeys(value.input, ['bvid']) || typeof value.input.bvid !== 'string') {
      throw new TestbenchInputError('testbench_request_invalid');
    }
    const bvid = normaliseBvid(value.input.bvid);
    return {
      schemaVersion: DIRECT_SCHEMA_VERSION,
      browserBindingId: value.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.video_detail',
      executionTarget: 'collector_work_tab',
      input: {
        canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`
      }
    };
  }

  if (value.kind === 'native_search') {
    if (!hasExactKeys(value.input, ['query']) || typeof value.input.query !== 'string') {
      throw new TestbenchInputError('testbench_request_invalid');
    }
    const query = normaliseSearchQuery(value.input.query);
    return {
      schemaVersion: DIRECT_SCHEMA_VERSION,
      browserBindingId: value.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search',
      executionTarget: 'collector_work_tab',
      input: { query }
    };
  }

  if (value.kind === 'native_search_batch') {
    if (!hasExactKeys(value.input, ['query']) || typeof value.input.query !== 'string') {
      throw new TestbenchInputError('testbench_request_invalid');
    }
    const query = normaliseSearchQuery(value.input.query);
    return {
      schemaVersion: DIRECT_SCHEMA_VERSION,
      browserBindingId: value.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search_batch',
      executionTarget: 'collector_work_tab',
      input: { query }
    };
  }

  if (value.kind === 'xiaohongshu_search') {
    if (!hasExactKeys(value.input, ['query']) || typeof value.input.query !== 'string') {
      throw new TestbenchInputError('testbench_request_invalid');
    }
    return {
      schemaVersion: DIRECT_SCHEMA_VERSION,
      browserBindingId: value.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      input: { query: normaliseSearchQuery(value.input.query) }
    };
  }

  if (value.kind === 'account_profile' || value.kind === 'account_inventory') {
    const inventoryInput = value.kind === 'account_inventory';
    const validKeys = inventoryInput
      ? hasExactKeys(value.input, ['accountId']) || hasExactKeys(value.input, ['accountId', 'executionTarget'])
      : hasExactKeys(value.input, ['accountId']);
    if (!validKeys || typeof value.input.accountId !== 'string') {
      throw new TestbenchInputError('testbench_request_invalid');
    }
    const accountId = normaliseAccountId(value.input.accountId);
    const executionTarget = inventoryInput
      ? value.input.executionTarget ?? 'collector_work_tab'
      : 'collector_work_tab';
    if (executionTarget !== 'collector_work_tab' && executionTarget !== 'user_selected_tab') {
      throw new TestbenchInputError('testbench_request_invalid');
    }
    return {
      schemaVersion: DIRECT_SCHEMA_VERSION,
      browserBindingId: value.browserBindingId,
      platform: 'bilibili',
      capability: value.kind === 'account_profile' ? 'bilibili.account_profile' : 'bilibili.account_inventory',
      executionTarget,
      input: { canonicalProfileUrl: `https://space.bilibili.com/${accountId}` }
    };
  }

  if (value.kind === 'dynamic' || value.kind === 'collection_series_overview') {
    if (!hasExactKeys(value.input, ['accountId']) || typeof value.input.accountId !== 'string') {
      throw new TestbenchInputError('testbench_request_invalid');
    }
    const accountId = normaliseAccountId(value.input.accountId);
    return {
      schemaVersion: DIRECT_SCHEMA_VERSION,
      browserBindingId: value.browserBindingId,
      platform: 'bilibili',
      capability: value.kind === 'dynamic' ? 'bilibili.dynamic' : 'bilibili.collection_series.overview',
      executionTarget: 'collector_work_tab',
      input: { canonicalProfileUrl: `https://space.bilibili.com/${accountId}` }
    };
  }

  if (value.kind === 'collection_series_detail') {
    if (!hasExactKeys(value.input, ['accountId', 'stableSeriesId', 'listType']) ||
      typeof value.input.accountId !== 'string' || typeof value.input.stableSeriesId !== 'string' ||
      (value.input.listType !== 'series' && value.input.listType !== 'season')
    ) throw new TestbenchInputError('testbench_request_invalid');
    const accountId = normaliseAccountId(value.input.accountId);
    const stableSeriesId = normaliseAccountId(value.input.stableSeriesId);
    return {
      schemaVersion: DIRECT_SCHEMA_VERSION,
      browserBindingId: value.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.collection_series.detail',
      executionTarget: 'collector_work_tab',
      input: {
        canonicalProfileUrl: `https://space.bilibili.com/${accountId}`,
        stableSeriesId,
        listType: value.input.listType
      }
    };
  }

  if (value.kind === 'danmaku') {
    if (!hasExactKeys(value.input, ['bvid']) || typeof value.input.bvid !== 'string') {
      throw new TestbenchInputError('testbench_request_invalid');
    }
    const bvid = normaliseBvid(value.input.bvid);
    return {
      schemaVersion: DIRECT_SCHEMA_VERSION,
      browserBindingId: value.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.danmaku',
      executionTarget: 'collector_work_tab',
      input: { canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}` }
    };
  }

  if (value.kind === 'discussion') {
    if (!hasExactKeys(value.input, ['bvid']) || typeof value.input.bvid !== 'string') {
      throw new TestbenchInputError('testbench_request_invalid');
    }
    const bvid = normaliseBvid(value.input.bvid);
    return {
      schemaVersion: DIRECT_SCHEMA_VERSION,
      browserBindingId: value.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.discussion',
      executionTarget: 'user_selected_tab',
      input: { canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}` }
    };
  }

  throw new TestbenchInputError('testbench_request_invalid');
}

export function readTestbenchConfig(environment) {
  const gatewayOrigin = loopbackHttpOrigin(
    environment.COLLECTOR_SERVICE_ORIGIN ?? DEFAULT_GATEWAY_ORIGIN,
    'testbench_gateway_origin_invalid'
  );
  const port = readPort(environment.COLLECTOR_TESTBENCH_PORT, DEFAULT_TESTBENCH_PORT);
  const token = typeof environment.COLLECTOR_SERVICE_TOKEN === 'string' && TOKEN_PATTERN.test(environment.COLLECTOR_SERVICE_TOKEN)
    ? environment.COLLECTOR_SERVICE_TOKEN
    : null;
  return Object.freeze({
    gatewayOrigin,
    token,
    appHost: '127.0.0.1',
    appPort: port,
    appOrigin: `http://127.0.0.1:${port}`,
    requestTimeoutMs: 20_000
  });
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function artifactPathFromOperation(operation) {
  if (!isRecord(operation) || !isUuid(operation.operationId) ||
    !isDirectArtifactCapability(operation.capability) ||
    !isRecord(operation.artifact) || typeof operation.artifact.retrievalPath !== 'string') {
    return null;
  }
  const match = operation.artifact.retrievalPath.match(ARTIFACT_PATH_PATTERN);
  if (!match || match[1] !== operation.capability || !isUuid(match[2])) return null;
  return operation.artifact.retrievalPath;
}

export function safeErrorCode(value, fallback = 'testbench_request_failed') {
  return typeof value === 'string' && /^[a-z0-9_.-]{1,120}$/i.test(value)
    ? value
    : fallback;
}

function normaliseBvid(value) {
  const bvid = value.trim();
  if (!BVID_PATTERN.test(bvid)) throw new TestbenchInputError('testbench_bvid_invalid');
  return bvid;
}

function normaliseSearchQuery(value) {
  const query = value.trim().replace(/\s+/g, ' ');
  if (!query || query.length > 80 || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new TestbenchInputError('testbench_search_query_invalid');
  }
  return query;
}

function normaliseAccountId(value) {
  const accountId = value.trim();
  if (!ACCOUNT_ID_PATTERN.test(accountId)) throw new TestbenchInputError('testbench_account_id_invalid');
  return accountId;
}

function isDirectArtifactCapability(value) {
  return value === 'bilibili.video_detail' || value === 'bilibili.native_search' ||
    value === 'bilibili.native_search_batch' ||
    value === 'bilibili.account_profile' || value === 'bilibili.account_inventory' ||
    value === 'bilibili.dynamic' || value === 'bilibili.collection_series.overview' ||
    value === 'bilibili.collection_series.detail' || value === 'bilibili.danmaku' ||
    value === 'bilibili.discussion' || value === 'xiaohongshu.search.public_notes.v1';
}

function loopbackHttpOrigin(value, code) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TestbenchInputError(code);
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port ||
    parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new TestbenchInputError(code);
  }
  return parsed.origin;
}

function readPort(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d{1,5}$/.test(value)) throw new TestbenchInputError('testbench_port_invalid');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new TestbenchInputError('testbench_port_invalid');
  return port;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
