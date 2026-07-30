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
const token = 'cst_' + 'A'.repeat(43);

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
      if (url.endsWith('/v2/collect')) return response({ schemaVersion: 2, result: operation('queued') }, 201);
      if (url.endsWith(`/v2/collect/operations/${operationId}`)) return response({ schemaVersion: 2, result: operation(states.shift()) });
      if (url.endsWith(`/v1/collect/artifacts/xiaohongshu.search.public_notes.v1/${artifactId}`)) {
        return response({ schemaVersion: 2, capability: 'xiaohongshu.search.public_notes.v1', artifact: { result: { items: [{ title: '公开卡片' }] } } });
      }
      throw new Error(`unexpected_url:${url}`);
    }
  });

  const result = await client.collectAndWait({
    schemaVersion: 2,
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
});

test('artifact path must match the operation capability', () => {
  const value = operation('completed');
  value.artifact.retrievalPath = `/v1/collect/artifacts/bilibili.video_detail/${artifactId}`;
  assert.equal(artifactPathFromOperation(value), null);
});

test('collect rejects unsupported or arbitrary-control requests before POST', async () => {
  const client = new CollectorClient({ token, fetchImpl: async () => { throw new Error('must_not_call'); } });
  await assert.rejects(
    client.collect({
      schemaVersion: 2,
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
      if (url.endsWith(`/v2/collect/operations/${operationId}`)) return response({ schemaVersion: 2, result: operation('claimed', false) });
      throw new Error(`unexpected_url:${url}`);
    }
  });
  await assert.rejects(
    client.waitOperation(operationId, { timeoutMs: 100, initialDelayMs: 100, maxDelayMs: 100 }),
    (error) => error instanceof CollectorClientError && error.code === 'collector_client_wait_timeout'
  );
  assert.equal(operationReads, 1);
});
