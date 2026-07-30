import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Artifact,
  CollectionResult,
  CollectorClientError,
  Operation,
  bilibiliAccountInventory,
  bilibiliAccountProfile,
  bilibiliCollectionSeriesDetail,
  bilibiliCollectionSeriesOverview,
  bilibiliDanmaku,
  bilibiliDiscussion,
  bilibiliDynamic,
  bilibiliNativeSearch,
  bilibiliNativeSearchBatch,
  bilibiliVideoDetail,
  xiaohongshuAccountPublicNotes,
  xiaohongshuNotePublicCommentReplies,
  xiaohongshuNotePublicComments,
  xiaohongshuNotePublicDetail,
  xiaohongshuPublicNotesSearch
} from '../src/index.mjs';

const bindingId = '11111111-1111-4111-8111-111111111111';
const videoUrl = 'https://www.bilibili.com/video/BV1qZSLBYEpa';
const profileUrl = 'https://space.bilibili.com/7481602';
const xhsProfileUrl = 'https://www.xiaohongshu.com/user/profile/638392c7000000001f01fffa?xsec_token=AB3nhVTKjaU7yknO8aprs8qBc4HQ4mWSoXDm4Bse0ZIIo=&xsec_source=pc_feed';

test('Bilibili builders emit only registered wire shapes', () => {
  const requests = [
    bilibiliVideoDetail({ browserBindingId: bindingId, canonicalVideoUrl: `${videoUrl}/` }),
    bilibiliNativeSearch({ browserBindingId: bindingId, query: '  人工\n智能  ' }),
    bilibiliNativeSearchBatch({ browserBindingId: bindingId, query: 'DeepSeek' }),
    bilibiliAccountProfile({ browserBindingId: bindingId, canonicalProfileUrl: `${profileUrl}/` }),
    bilibiliAccountInventory({ browserBindingId: bindingId, canonicalProfileUrl: profileUrl }),
    bilibiliAccountInventory({ browserBindingId: bindingId, canonicalProfileUrl: profileUrl, executionTarget: 'user_selected_tab' }),
    bilibiliDynamic({ browserBindingId: bindingId, canonicalProfileUrl: profileUrl }),
    bilibiliCollectionSeriesOverview({ browserBindingId: bindingId, canonicalProfileUrl: profileUrl }),
    bilibiliCollectionSeriesDetail({ browserBindingId: bindingId, canonicalProfileUrl: profileUrl, stableSeriesId: '123', listType: 'series' }),
    bilibiliDanmaku({ browserBindingId: bindingId, canonicalVideoUrl: videoUrl }),
    bilibiliDiscussion({ browserBindingId: bindingId, canonicalVideoUrl: videoUrl })
  ];
  assert.equal(requests.length, 11);
  for (const request of requests) {
    assert.deepEqual(Object.keys(request).sort(), ['browserBindingId', 'capability', 'executionTarget', 'input', 'platform', 'schemaVersion']);
  }
  assert.deepEqual(requests[0].input, { canonicalVideoUrl: videoUrl });
  assert.deepEqual(requests[1].input, { query: '人工 智能' });
  assert.equal(requests.at(-1).executionTarget, 'user_selected_tab');
});
test('Xiaohongshu builders preserve short-lived profile URL and budgets', () => {
  const search = xiaohongshuPublicNotesSearch({
    browserBindingId: bindingId,
    query: '人工智能',
    maximumDetails: 3,
    commentsMaximumScrolls: 2,
    repliesMaximumThreads: 1
  });
  const profile = xiaohongshuAccountPublicNotes({
    browserBindingId: bindingId,
    maximumScrolls: 20,
    executionTarget: 'ephemeral_public_profile_url',
    profileUrl: xhsProfileUrl
  });
  const detail = xiaohongshuNotePublicDetail({ browserBindingId: bindingId, resultRank: 2 });
  const comments = xiaohongshuNotePublicComments({ browserBindingId: bindingId, maximumScrolls: 3 });
  const replies = xiaohongshuNotePublicCommentReplies({ browserBindingId: bindingId, maximumThreads: 2 });

  assert.deepEqual(search.input, {
    query: '人工智能',
    maximumDetails: 3,
    comments: { maximumScrolls: 2, replies: { maximumThreads: 1 } }
  });
  assert.equal(profile.input.profileUrl, xhsProfileUrl);
  assert.equal(detail.input.resultRank, 2);
  assert.deepEqual(comments.input, { maximumScrolls: 3 });
  assert.deepEqual(replies.input, { maximumThreads: 2 });
});

test('builders reject unsafe or incomplete inputs', () => {
  const invalid = [
    () => bilibiliVideoDetail({ browserBindingId: bindingId, canonicalVideoUrl: 'https://evil.example/video/BV1qZSLBYEpa' }),
    () => bilibiliAccountProfile({ browserBindingId: bindingId, canonicalProfileUrl: 'https://space.bilibili.com/1?from=search' }),
    () => bilibiliCollectionSeriesDetail({ browserBindingId: bindingId, canonicalProfileUrl: profileUrl, stableSeriesId: '0', listType: 'series' }),
    () => xiaohongshuPublicNotesSearch({ browserBindingId: bindingId, query: 'x', commentsMaximumScrolls: 1 }),
    () => xiaohongshuAccountPublicNotes({ browserBindingId: bindingId, maximumScrolls: 4 }),
    () => xiaohongshuAccountPublicNotes({ browserBindingId: bindingId, maximumScrolls: 1, executionTarget: 'ephemeral_public_profile_url' }),
    () => xiaohongshuNotePublicDetail({ browserBindingId: bindingId, resultRank: 21 })
  ];
  for (const factory of invalid) {
    assert.throws(factory, (error) => error instanceof CollectorClientError && error.code === 'collector_client_request_builder_invalid');
  }
});

test('structured JS models project stable fields and preserve future payload fields', () => {
  const operationRaw = {
    schemaVersion: 1,
    operationId: '22222222-2222-4222-8222-222222222222',
    browserBindingId: bindingId,
    platform: 'bilibili',
    capability: 'bilibili.native_search',
    executionTarget: 'collector_work_tab',
    state: 'completed',
    queuedAt: '2026-07-30T00:00:00.000Z',
    claimedAt: '2026-07-30T00:00:01.000Z',
    completedAt: '2026-07-30T00:00:02.000Z',
    errorCode: null,
    terminalReason: null,
    futureField: { kept: true },
    artifact: {
      artifactId: '33333333-3333-4333-8333-333333333333',
      retrievalPath: '/v1/collect/artifacts/bilibili.native_search/33333333-3333-4333-8333-333333333333',
      summary: { capturedItems: 1 }
    }
  };
  const artifactResponse = {
    schemaVersion: 2,
    capability: 'bilibili.native_search',
    artifact: {
      summary: { capturedItems: 1 },
      provenance: { surface: 'public' },
      result: { items: [{ title: '结果' }] },
      futurePayloadField: 'kept'
    }
  };
  const operation = new Operation(operationRaw);
  const artifact = new Artifact(artifactResponse);
  const result = new CollectionResult({ operation: operationRaw, artifact: artifactResponse });

  assert.equal(operation.succeeded, true);
  assert.deepEqual(operation.raw.futureField, { kept: true });
  assert.equal(artifact.result.items[0].title, '结果');
  assert.deepEqual(artifact.provenance, { surface: 'public' });
  assert.equal(artifact.payload.futurePayloadField, 'kept');
  assert.deepEqual(result.result, { items: [{ title: '结果' }] });
  const detached = result.toJSON();
  detached.operation.future = true;
  assert.equal(result.raw.operation.future, undefined);
});
