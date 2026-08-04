import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildXiaohongshuReconciliationRequest,
  readXiaohongshuReconciliationManifest
} from '../src/xiaohongshu-reconciliation.mjs';

const manifestPath = fileURLToPath(new URL(
  '../../../docs/validation/xiaohongshu-sdk-reconciliation-v0.7.17.json',
  import.meta.url
));
const bindingId = '11111111-1111-4111-8111-111111111111';
const query = '人工智能';
const retainedReadBuilderId = '55555555-5555-4555-8555-555555555555';

test('shared Xiaohongshu evidence contains five safe reconciliation identities', async () => {
  const manifest = await readXiaohongshuReconciliationManifest(manifestPath);
  const serialized = JSON.stringify(manifest);
  assert.equal(manifest.cases.length, 5);
  assert.equal(manifest.livePlatformActionsExpected, 0);
  assert.equal(manifest.cases.filter((item) => item.reconciliationMode === 'idempotent_collect').length, 4);
  assert.equal(manifest.cases.filter((item) => item.reconciliationMode === 'retained_operation_read').length, 1);
  assert.equal(serialized.includes(query), false);
  assert.equal(serialized.includes('browserBindingId'), false);
  assert.equal(serialized.includes('profileUrl'), false);
});

test('all JavaScript builders reconstruct the exact bounded capability requests', async () => {
  const manifest = await readXiaohongshuReconciliationManifest(manifestPath);
  const requests = manifest.cases.map((evidence) =>
    buildXiaohongshuReconciliationRequest(evidence, {
      browserBindingId: bindingId,
      query,
      clientRequestId: evidence.clientRequestId ?? retainedReadBuilderId
    }));
  assert.deepEqual(requests.map((request) => request.capability), manifest.cases.map((item) => item.capability));
  assert.deepEqual(requests.map((request) => request.clientRequestId),
    manifest.cases.map((item) => item.clientRequestId ?? retainedReadBuilderId));
  assert.deepEqual(requests.map((request) => request.input), [
    { query, maximumDetails: 0 },
    { resultRank: 1 },
    { maximumScrolls: 2 },
    { maximumThreads: 1 },
    { maximumScrolls: 3 }
  ]);
});

test('a different search phrase is rejected before an SDK submission can be built', async () => {
  const manifest = await readXiaohongshuReconciliationManifest(manifestPath);
  assert.throws(() => buildXiaohongshuReconciliationRequest(manifest.cases[0], {
    browserBindingId: bindingId,
    query: '不同查询'
  }), /xiaohongshu_reconciliation_query_digest_mismatch/);
});
