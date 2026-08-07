import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CollectorClient,
  CollectorClientError,
  artifactPathFromOperation
} from '../src/index.mjs';

const bindingId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const artifactId = '33333333-3333-4333-8333-333333333333';
const clientRequestId = '44444444-4444-4444-8444-444444444444';
const token = 'cst_' + 'A'.repeat(43);
const digest = `sha256:${'a'.repeat(64)}`;

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function operation(state, artifact = true) {
  return {
    schemaVersion: 1,
    operationId,
    browserBindingId: bindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.search.public_notes.v1',
    executionTarget: 'existing_public_explore_tab',
    state,
    queuedAt: '2026-07-30T00:00:00.000Z',
    claimedAt: state === 'queued' ? null : '2026-07-30T00:00:01.000Z',
    completedAt: state === 'queued' || state === 'claimed' ? null : '2026-07-30T00:00:02.000Z',
    errorCode: null,
    terminalReason: null,
    artifact: artifact ? {
      artifactId,
      retrievalPath: `/v1/collect/artifacts/xiaohongshu.search.public_notes.v1/${artifactId}`,
      summary: { itemCount: 1 }
    } : null
  };
}

test('collectAndWait submits once, polls, and reads a Xiaohongshu artifact', async () => {
  const calls = [];
  const states = ['claimed', 'completed'];
  const client = new CollectorClient({
    token,
    sleepImpl: async (delayMs) => await new Promise((resolve) => setTimeout(resolve, delayMs)),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/v2/collect')) {
        return response({ schemaVersion: 3, clientRequestId, idempotentReplay: false, result: operation('queued') }, 201);
      }
      if (url.endsWith(`/v2/collect/operations/${operationId}`)) return response({ schemaVersion: 3, result: operation(states.shift()) });
      if (url.endsWith(`/v1/collect/artifacts/xiaohongshu.search.public_notes.v1/${artifactId}`)) {
        return response({ schemaVersion: 3, capability: 'xiaohongshu.search.public_notes.v1', artifact: { result: { items: [{ title: '公开卡片' }] } } });
      }
      throw new Error(`unexpected_url:${url}`);
    }
  });

  const result = await client.collectAndWait({
    schemaVersion: 3,
    clientRequestId,
    browserBindingId: bindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.search.public_notes.v1',
    executionTarget: 'existing_public_explore_tab',
    input: { query: '人工智能' }
  });

  assert.equal(result.operation.state, 'completed');
  assert.equal(result.artifact.artifact.result.items[0].title, '公开卡片');
  assert.equal(calls.filter((call) => call.url.endsWith('/v2/collect')).length, 1);
  assert.equal(calls.filter((call) => call.url.includes('/v2/collect/operations/')).length, 2);
  const submitted = JSON.parse(calls.find((call) => call.url.endsWith('/v2/collect')).options.body);
  assert.equal(submitted.clientRequestId, clientRequestId);
});

test('artifact path must match the operation capability', () => {
  const value = operation('completed');
  value.artifact.retrievalPath = `/v1/collect/artifacts/bilibili.video_detail/${artifactId}`;
  assert.equal(artifactPathFromOperation(value), null);
});

test('readRelease returns the Core compatibility manifest', async () => {
  const client = new CollectorClient({
    token,
    fetchImpl: async (url) => {
      assert.ok(url.endsWith('/v2/release'));
      return response({
        schemaVersion: 1,
        releaseVersion: '0.7.17',
        product: 'collector-core',
        channel: 'source-compatible',
        service: { schemaVersion: 3, openApiVersion: '3.0.0-experimental' },
        protocols: {},
        boundaries: {},
        compatibility: {
          schemaVersion: 1,
          digestAlgorithm: 'sha256-canonical-json-v1',
          openApiSchemaDigest: digest,
          capabilityCatalogDigest: digest,
          features: ['collect.client_request_id.v1']
        }
      });
    }
  });
  const manifest = await client.readRelease();
  assert.equal(manifest.product, 'collector-core');
  assert.equal(manifest.service.schemaVersion, 3);
});

test('readRelease rejects a Gateway outside the SDK compatibility anchor', async () => {
  const client = new CollectorClient({
    fetchImpl: async () => response({ product: 'collector-core', releaseVersion: '0.7.16' })
  });
  await assert.rejects(
    client.readRelease(),
    (error) => error instanceof CollectorClientError && error.code === 'collector_client_release_manifest_invalid'
  );
});

test('collect rejects unsupported or arbitrary-control requests before POST', async () => {
  const client = new CollectorClient({ token, fetchImpl: async () => { throw new Error('must_not_call'); } });
  await assert.rejects(
    client.collect({
      schemaVersion: 3,
      clientRequestId,
      browserBindingId: bindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      input: { query: 'x' },
      selector: '#anything'
    }),
    (error) => error instanceof CollectorClientError && error.code === 'collector_client_collect_request_invalid'
  );
});

test('wait timeout does not submit another operation', async () => {
  let operationReads = 0;
  const client = new CollectorClient({
    token,
    sleepImpl: async (delayMs) => await new Promise((resolve) => setTimeout(resolve, delayMs)),
    fetchImpl: async (url) => {
      operationReads += 1;
      if (url.endsWith(`/v2/collect/operations/${operationId}`)) return response({ schemaVersion: 3, result: operation('claimed', false) });
      throw new Error(`unexpected_url:${url}`);
    }
  });
  await assert.rejects(
    client.waitOperation(operationId, { timeoutMs: 100, initialDelayMs: 100, maxDelayMs: 100 }),
    (error) => error instanceof CollectorClientError && error.code === 'collector_client_wait_timeout'
  );
  assert.equal(operationReads, 1);
});

test('capability catalog and bounded Artifact resources use the released v3 routes', async () => {
  const seen = [];
  const metadata = {
    schemaVersion: 1,
    artifactId,
    operationId,
    capability: 'xiaohongshu.search.public_notes.v1',
    mediaType: 'application/json',
    representation: 'canonical_json_utf8',
    byteLength: 2,
    sha256: digest,
    capturedAt: '2026-08-03T00:00:00.000Z',
    terminalStatus: 'completed',
    retentionClass: 'core_managed_local',
    retainedUntil: null,
    deletionState: 'retained',
    available: true
  };
  const window = {
    schemaVersion: 1,
    artifactId,
    capability: 'xiaohongshu.search.public_notes.v1',
    representation: 'canonical_json_utf8',
    encoding: 'utf-8',
    offset: 0,
    endExclusive: 2,
    byteLength: 2,
    maximumBytes: 16_384,
    nextOffset: null,
    truncated: false,
    sha256: digest,
    chunkSha256: digest,
    text: '{}'
  };
  const client = new CollectorClient({
    token,
    fetchImpl: async (url) => {
      seen.push(url);
      if (url.endsWith('/v2/capabilities')) {
        return response({ schemaVersion: 3, catalogDigest: digest, capabilities: [], directContracts: [] });
      }
      if (url.endsWith(`/v2/collect/artifacts/${artifactId}`)) {
        return response({ schemaVersion: 3, metadata });
      }
      if (url.endsWith(`/v2/collect/artifacts/${artifactId}/content?offset=0&maxBytes=16384`)) {
        return response({ schemaVersion: 3, window });
      }
      throw new Error(`unexpected_url:${url}`);
    }
  });

  const catalog = await client.readCapabilityCatalog();
  assert.equal(catalog.catalogDigest, digest);
  assert.deepEqual(await client.listCapabilities(), []);
  assert.deepEqual(await client.readArtifactMetadata(artifactId), metadata);
  assert.deepEqual(await client.readArtifactContentWindow(artifactId), window);
  assert.equal(seen.filter((url) => url.endsWith('/v2/capabilities')).length, 2);
});

test('capability catalog preserves Official Provider runtime readiness separately from its digest', async () => {
  const capability = {
    schemaVersion: 1,
    capability: 'zhihu.search.public_content.v1',
    platform: 'zhihu',
    dispatchState: 'direct_ready',
    runtimeState: 'credential_required',
    credentialLocation: 'gateway_only'
  };
  const client = new CollectorClient({
    fetchImpl: async (url) => {
      if (url.endsWith('/v2/capabilities')) {
        return response({ schemaVersion: 3, catalogDigest: digest, capabilities: [capability], directContracts: [] });
      }
      throw new Error(`unexpected_url:${url}`);
    }
  });
  const catalog = await client.readCapabilityCatalog();
  assert.equal(catalog.catalogDigest, digest);
  assert.deepEqual(catalog.capabilities, [capability]);
  assert.equal(catalog.capabilities[0].runtimeState, 'credential_required');
  assert.equal(catalog.capabilities[0].credentialLocation, 'gateway_only');
});
