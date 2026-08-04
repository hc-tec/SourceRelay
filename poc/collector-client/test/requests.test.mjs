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
  createClientRequestId,
  xiaohongshuAccountPublicNotes,
  xiaohongshuNotePublicCommentReplies,
  xiaohongshuNotePublicComments,
  xiaohongshuNotePublicDetail,
  xiaohongshuPublicNotesSearch,
  zhihuOfficialGlobalSearch,
  zhihuOfficialHotList,
  zhihuOfficialSearch
} from '../src/index.mjs';

const bindingId = '11111111-1111-4111-8111-111111111111';
const clientRequestId = '44444444-4444-4444-8444-444444444444';
const requestIdentity = { clientRequestId, browserBindingId: bindingId };
const videoUrl = 'https://www.bilibili.com/video/BV1qZSLBYEpa';
const profileUrl = 'https://space.bilibili.com/7481602';
const xhsProfileUrl = 'https://www.xiaohongshu.com/user/profile/638392c7000000001f01fffa?xsec_token=AB3nhVTKjaU7yknO8aprs8qBc4HQ4mWSoXDm4Bse0ZIIo=&xsec_source=pc_feed';

test('Bilibili builders emit only registered wire shapes', () => {
  const requests = [
    bilibiliVideoDetail({ ...requestIdentity, canonicalVideoUrl: `${videoUrl}/` }),
    bilibiliNativeSearch({ ...requestIdentity, query: '  人工\n智能  ' }),
    bilibiliNativeSearchBatch({ ...requestIdentity, query: 'DeepSeek' }),
    bilibiliAccountProfile({ ...requestIdentity, canonicalProfileUrl: `${profileUrl}/` }),
    bilibiliAccountInventory({ ...requestIdentity, canonicalProfileUrl: profileUrl }),
    bilibiliAccountInventory({ ...requestIdentity, canonicalProfileUrl: profileUrl, executionTarget: 'user_selected_tab' }),
    bilibiliDynamic({ ...requestIdentity, canonicalProfileUrl: profileUrl }),
    bilibiliCollectionSeriesOverview({ ...requestIdentity, canonicalProfileUrl: profileUrl }),
    bilibiliCollectionSeriesDetail({ ...requestIdentity, canonicalProfileUrl: profileUrl, stableSeriesId: '123', listType: 'series' }),
    bilibiliDanmaku({ ...requestIdentity, canonicalVideoUrl: videoUrl }),
    bilibiliDiscussion({ ...requestIdentity, canonicalVideoUrl: videoUrl })
  ];
  assert.equal(requests.length, 11);
  for (const request of requests) {
    assert.deepEqual(Object.keys(request).sort(), [
      'browserBindingId', 'capability', 'clientRequestId', 'executionTarget', 'input', 'platform', 'schemaVersion'
    ]);
    assert.equal(request.clientRequestId, clientRequestId);
  }
  assert.deepEqual(requests[0].input, { canonicalVideoUrl: videoUrl });
  assert.deepEqual(requests[1].input, { query: '人工 智能' });
  assert.equal(requests.at(-1).executionTarget, 'collector_work_tab');
});
test('Xiaohongshu builders preserve short-lived profile URL and budgets', () => {
  const search = xiaohongshuPublicNotesSearch({
    ...requestIdentity,
    query: '人工智能',
    maximumDetails: 3,
    commentsMaximumScrolls: 2,
    repliesMaximumThreads: 1
  });
  const profile = xiaohongshuAccountPublicNotes({
    ...requestIdentity,
    maximumScrolls: 20,
    executionTarget: 'ephemeral_public_profile_url',
    profileUrl: xhsProfileUrl
  });
  const detail = xiaohongshuNotePublicDetail({ ...requestIdentity, resultRank: 2 });
  const comments = xiaohongshuNotePublicComments({ ...requestIdentity, maximumScrolls: 3 });
  const replies = xiaohongshuNotePublicCommentReplies({ ...requestIdentity, maximumThreads: 2 });

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

test('Zhihu official builders omit browser identity and emit bounded provider shapes', () => {
  const search = zhihuOfficialSearch({ clientRequestId, query: '  RAG\n系统  ', count: 1 });
  const hotList = zhihuOfficialHotList({ clientRequestId, limit: 2 });
  const globalSearch = zhihuOfficialGlobalSearch({
    clientRequestId,
    query: '人工智能',
    count: 3,
    searchDatabase: 'realtime',
    site: 'News.Example.com',
    publishedAfter: '2026-08-01T00:00:00+08:00'
  });
  for (const request of [search, hotList, globalSearch]) {
    assert.deepEqual(Object.keys(request).sort(), [
      'capability', 'clientRequestId', 'executionTarget', 'input', 'platform', 'schemaVersion'
    ]);
    assert.equal(request.executionTarget, 'official_api');
    assert.equal(Object.hasOwn(request, 'browserBindingId'), false);
  }
  assert.deepEqual(search.input, { query: 'RAG 系统', count: 1 });
  assert.deepEqual(hotList.input, { limit: 2 });
  assert.deepEqual(globalSearch.input, {
    query: '人工智能',
    count: 3,
    searchDatabase: 'realtime',
    site: 'news.example.com',
    publishedAfter: '2026-07-31T16:00:00.000Z'
  });
});

test('builders reject unsafe or incomplete inputs', () => {
  const invalid = [
    () => bilibiliVideoDetail({ ...requestIdentity, canonicalVideoUrl: 'https://evil.example/video/BV1qZSLBYEpa' }),
    () => bilibiliAccountProfile({ ...requestIdentity, canonicalProfileUrl: 'https://space.bilibili.com/1?from=search' }),
    () => bilibiliCollectionSeriesDetail({ ...requestIdentity, canonicalProfileUrl: profileUrl, stableSeriesId: '0', listType: 'series' }),
    () => xiaohongshuPublicNotesSearch({ ...requestIdentity, query: 'x', commentsMaximumScrolls: 1 }),
    () => xiaohongshuAccountPublicNotes({ ...requestIdentity, maximumScrolls: 4 }),
    () => xiaohongshuAccountPublicNotes({ ...requestIdentity, maximumScrolls: 1, executionTarget: 'ephemeral_public_profile_url' }),
    () => xiaohongshuNotePublicDetail({ ...requestIdentity, resultRank: 21 }),
    () => bilibiliNativeSearch({ browserBindingId: bindingId, query: 'missing request id' }),
    () => zhihuOfficialSearch({ clientRequestId, query: 'RAG', browserBindingId: bindingId }),
    () => zhihuOfficialSearch({ clientRequestId, query: 'RAG', count: 11 }),
    () => zhihuOfficialGlobalSearch({ clientRequestId, query: 'RAG', site: 'zhihu.com' }),
    () => zhihuOfficialGlobalSearch({ clientRequestId, query: 'RAG', searchDatabase: 'unknown' })
  ];
  for (const factory of invalid) {
    assert.throws(factory, (error) => error instanceof CollectorClientError && error.code === 'collector_client_request_builder_invalid');
  }
});

test('createClientRequestId returns a fresh UUID for caller-controlled replay', () => {
  const first = createClientRequestId();
  const second = createClientRequestId();
  assert.match(first, /^[0-9a-f-]{36}$/i);
  assert.notEqual(first, second);
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
    schemaVersion: 3,
    capability: 'bilibili.native_search',
    artifact: {
      summary: {
        artifactId: '33333333-3333-4333-8333-333333333333',
        capturedItems: 1
      },
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
  assert.equal(artifact.artifactId, '33333333-3333-4333-8333-333333333333');
  assert.deepEqual(artifact.provenance, { surface: 'public' });
  assert.equal(artifact.payload.futurePayloadField, 'kept');
  assert.deepEqual(result.result, { items: [{ title: '结果' }] });
  const detached = result.toJSON();
  detached.operation.future = true;
  assert.equal(result.raw.operation.future, undefined);
});

test('structured JS artifact rejects conflicting payload and summary identities', () => {
  assert.throws(
    () => new Artifact({
      schemaVersion: 3,
      capability: 'bilibili.native_search',
      artifact: {
        artifactId: '33333333-3333-4333-8333-333333333333',
        summary: { artifactId: '44444444-4444-4444-8444-444444444444' }
      }
    }),
    (error) => error instanceof CollectorClientError && error.code === 'collector_client_artifact_invalid'
  );
});
