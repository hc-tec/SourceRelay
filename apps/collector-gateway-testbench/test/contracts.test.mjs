import assert from 'node:assert/strict';
import test from 'node:test';
import {
  artifactPathFromOperation,
  parseTestbenchSubmission,
  readTestbenchConfig,
  TestbenchInputError
} from '../src/contracts.mjs';

const bindingId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const artifactId = '33333333-3333-4333-8333-333333333333';

test('maps a BVID-only detail test into the fixed direct-mode Gateway contract', () => {
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'video_detail',
    input: { bvid: 'BV1qZSLBYEpa' }
  }), {
    schemaVersion: 2,
    browserBindingId: bindingId,
    platform: 'bilibili',
    capability: 'bilibili.video_detail',
    executionTarget: 'collector_work_tab',
    input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
  });
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'account_inventory',
    input: { accountId: '7481602', executionTarget: 'user_selected_tab' }
  }), {
    schemaVersion: 2,
    browserBindingId: bindingId,
    platform: 'bilibili',
    capability: 'bilibili.account_inventory',
    executionTarget: 'user_selected_tab',
    input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
  });
});

test('maps a BVID-only discussion test into the fixed user-selected-tab contract', () => {
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'discussion',
    input: { bvid: 'BV1qZSLBYEpa' }
  }), {
    schemaVersion: 2,
    browserBindingId: bindingId,
    platform: 'bilibili',
    capability: 'bilibili.discussion',
    executionTarget: 'user_selected_tab',
    input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
  });
  assert.throws(() => parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'discussion',
    input: { bvid: 'BV1qZSLBYEpa', tabId: 7 }
  }), TestbenchInputError);
});

test('maps native search into the fixed first-page direct-mode Gateway contract', () => {
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'native_search',
    input: { query: '  DeepSeek   R1  ' }
  }), {
    schemaVersion: 2,
    browserBindingId: bindingId,
    platform: 'bilibili',
    capability: 'bilibili.native_search',
    executionTarget: 'collector_work_tab',
    input: { query: 'DeepSeek R1' }
  });
});

test('maps batch search into the fixed two-page direct-mode Gateway contract without exposing a page list', () => {
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'native_search_batch',
    input: { query: '  DeepSeek   R1  ' }
  }), {
    schemaVersion: 2,
    browserBindingId: bindingId,
    platform: 'bilibili',
    capability: 'bilibili.native_search_batch',
    executionTarget: 'collector_work_tab',
    input: { query: 'DeepSeek R1' }
  });
  assert.throws(() => parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'native_search_batch',
    input: { query: 'DeepSeek', pages: [1, 2] }
  }), TestbenchInputError);
});

test('maps Xiaohongshu search to query-only existing-Explore trusted input', () => {
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_search',
    input: { query: '  咖啡豆  ' }
  }), {
    schemaVersion: 2,
    browserBindingId: bindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.search.public_notes.v1',
    executionTarget: 'existing_public_explore_tab',
    input: { query: '咖啡豆' }
  });
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_search',
    input: { query: '咖啡豆', maximumDetails: 2 }
  }).input, { query: '咖啡豆', maximumDetails: 2 });
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_search',
    input: { query: '咖啡豆', maximumDetails: 1, comments: { maximumScrolls: 2 } }
  }).input, { query: '咖啡豆', maximumDetails: 1, comments: { maximumScrolls: 2 } });
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_search',
    input: { query: '咖啡豆', maximumDetails: 1, comments: { maximumScrolls: 2, replies: { maximumThreads: 1 } } }
  }).input, { query: '咖啡豆', maximumDetails: 1, comments: { maximumScrolls: 2, replies: { maximumThreads: 1 } } });
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_search',
    input: { query: '咖啡豆', maximumDetails: 1, comments: { maximumScrolls: 2, replies: { maximumThreads: 3 } } }
  }).input.comments.replies, { maximumThreads: 3 });
  for (const maximumDetails of [-1, 21, 1.5]) assert.throws(() => parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_search',
    input: { query: '咖啡豆', maximumDetails }
  }), TestbenchInputError);
  for (const comments of [
    { maximumScrolls: 0 }, { maximumScrolls: 4 }, { maximumScrolls: 1.5 }, {}, null,
    { maximumScrolls: 1, replies: { maximumThreads: 4 } }, { maximumScrolls: 1, extra: true },
  ]) assert.throws(() => parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_search',
    input: { query: '咖啡豆', maximumDetails: 1, comments }
  }), TestbenchInputError);
  assert.throws(() => parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_search',
    input: { query: '咖啡豆', comments: { maximumScrolls: 1 } }
  }), TestbenchInputError);
  for (const extra of [
    { url: 'https://www.xiaohongshu.com/search_result?keyword=x' },
    { tabId: 7 },
    { selector: 'textarea' },
    { debuggerCommand: 'Runtime.evaluate' }
  ]) assert.throws(() => parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_search',
    input: { query: '咖啡豆', ...extra }
  }), TestbenchInputError);
});

test('maps Xiaohongshu account notes to an existing profile tab with a bounded scroll budget', () => {
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_account_public_notes',
    input: { maximumScrolls: 1 }
  }), {
    schemaVersion: 2,
    browserBindingId: bindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.account.public_notes.v1',
    executionTarget: 'existing_public_profile_tab',
    input: { maximumScrolls: 1 }
  });
  for (const input of [
    { maximumScrolls: 0 },
    { maximumScrolls: 4 },
    { maximumScrolls: 1.5 },
    { maximumScrolls: 1, url: 'https://www.xiaohongshu.com/user/profile/secret' },
    { maximumScrolls: 1, tabId: 7 },
    { maximumScrolls: 1, selector: '.note-item' }
  ]) assert.throws(() => parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_account_public_notes',
    input
  }), TestbenchInputError);
});

test('maps a short-lived Xiaohongshu profile link to the single-navigation account target', () => {
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_account_public_notes',
    input: {
      maximumScrolls: 20,
      profileUrl: 'https://www.xiaohongshu.com/user/profile/abc123?expires=short'
    }
  }), {
    schemaVersion: 2,
    browserBindingId: bindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.account.public_notes.v1',
    executionTarget: 'ephemeral_public_profile_url',
    input: {
      maximumScrolls: 20,
      profileUrl: 'https://www.xiaohongshu.com/user/profile/abc123?expires=short'
    }
  });
  for (const input of [
    { maximumScrolls: 21, profileUrl: 'https://www.xiaohongshu.com/user/profile/abc123' },
    { maximumScrolls: 20, profileUrl: 'https://www.xiaohongshu.com/explore' },
    { maximumScrolls: 20, profileUrl: 'https://evil.example/user/profile/abc123' },
    { maximumScrolls: 20, profileUrl: 'https://www.xiaohongshu.com/user/profile/abc123#fragment' },
    { maximumScrolls: 20, profileUrl: 'https://www.xiaohongshu.com/user/profile/abc123', selector: '.note-item' }
  ]) assert.throws(() => parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_account_public_notes',
    input
  }), TestbenchInputError);
});

test('preserves the exact short-lived profile-link query encoding', () => {
  const profileUrl = 'https://www.xiaohongshu.com/user/profile/abc123?xsec_token=a%2Fb%3Dc&xsec_source=pc';
  const parsed = parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_account_public_notes',
    input: { maximumScrolls: 20, profileUrl }
  });
  assert.equal(parsed.input.profileUrl, profileUrl);
});

test('maps Xiaohongshu public detail to one ranked result in the existing search tab', () => {
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_note_public_detail',
    input: { resultRank: 1 }
  }), {
    schemaVersion: 2,
    browserBindingId: bindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_detail.v1',
    executionTarget: 'existing_public_search_tab',
    input: { resultRank: 1 }
  });
  for (const input of [
    { resultRank: 0 }, { resultRank: 21 }, { resultRank: 1.5 },
    { resultRank: 1, url: 'https://www.xiaohongshu.com/explore/x' },
    { resultRank: 1, selector: 'section.note-item' }
  ]) assert.throws(() => parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'xiaohongshu_note_public_detail',
    input
  }), TestbenchInputError);
});

test('maps Xiaohongshu public comments to bounded scrolling in the existing note overlay', () => {
  assert.deepEqual(parseTestbenchSubmission({ browserBindingId: bindingId,
    kind: 'xiaohongshu_note_public_comments', input: { maximumScrolls: 1 } }), {
    schemaVersion: 2, browserBindingId: bindingId, platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_comments.v1', executionTarget: 'existing_public_note_overlay',
    input: { maximumScrolls: 1 }
  });
  for (const input of [{ maximumScrolls: 0 }, { maximumScrolls: 4 },
    { maximumScrolls: 1, url: 'https://www.xiaohongshu.com/explore/x' },
    { maximumScrolls: 1, cursor: 'next' }, { maximumScrolls: 1, selector: '.comment' }]) {
    assert.throws(() => parseTestbenchSubmission({ browserBindingId: bindingId,
      kind: 'xiaohongshu_note_public_comments', input }), TestbenchInputError);
  }
});
test('maps Xiaohongshu public replies to a bounded existing-overlay thread set',()=>{
  assert.deepEqual(parseTestbenchSubmission({browserBindingId:bindingId,kind:'xiaohongshu_note_public_comment_replies',
    input:{maximumThreads:1}}),{schemaVersion:2,browserBindingId:bindingId,platform:'xiaohongshu',
    capability:'xiaohongshu.note.public_comment_replies.v1',executionTarget:'existing_public_note_overlay',input:{maximumThreads:1}});
  assert.deepEqual(parseTestbenchSubmission({browserBindingId:bindingId,kind:'xiaohongshu_note_public_comment_replies',
    input:{maximumThreads:3}}).input,{maximumThreads:3});
  for(const input of [{maximumThreads:0},{maximumThreads:4},{maximumThreads:1,commentId:'x'},
    {maximumThreads:1,selector:'.reply'}])assert.throws(()=>parseTestbenchSubmission({browserBindingId:bindingId,
      kind:'xiaohongshu_note_public_comment_replies',input}),TestbenchInputError);
});

test('maps a MID-only account request into the two fixed direct-mode account capabilities', () => {
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'account_profile',
    input: { accountId: '7481602' }
  }), {
    schemaVersion: 2,
    browserBindingId: bindingId,
    platform: 'bilibili',
    capability: 'bilibili.account_profile',
    executionTarget: 'collector_work_tab',
    input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
  });
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'account_inventory',
    input: { accountId: '7481602' }
  }), {
    schemaVersion: 2,
    browserBindingId: bindingId,
    platform: 'bilibili',
    capability: 'bilibili.account_inventory',
    executionTarget: 'collector_work_tab',
    input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
  });
});

test('maps passive Bilibili canaries into fixed derived targets without a free-form URL', () => {
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'dynamic',
    input: { accountId: '7481602' }
  }), {
    schemaVersion: 2,
    browserBindingId: bindingId,
    platform: 'bilibili',
    capability: 'bilibili.dynamic',
    executionTarget: 'collector_work_tab',
    input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
  });
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'collection_series_detail',
    input: { accountId: '7481602', stableSeriesId: '123', listType: 'season' }
  }), {
    schemaVersion: 2,
    browserBindingId: bindingId,
    platform: 'bilibili',
    capability: 'bilibili.collection_series.detail',
    executionTarget: 'collector_work_tab',
    input: {
      canonicalProfileUrl: 'https://space.bilibili.com/7481602',
      stableSeriesId: '123',
      listType: 'season'
    }
  });
  assert.deepEqual(parseTestbenchSubmission({
    browserBindingId: bindingId,
    kind: 'danmaku',
    input: { bvid: 'BV1qZSLBYEpa' }
  }), {
    schemaVersion: 2,
    browserBindingId: bindingId,
    platform: 'bilibili',
    capability: 'bilibili.danmaku',
    executionTarget: 'collector_work_tab',
    input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
  });
});

test('rejects arbitrary URL, extra request keys, invalid BVIDs, and control characters', () => {
  for (const value of [
    {
      browserBindingId: bindingId,
      kind: 'video_detail',
      input: { canonicalVideoUrl: 'https://example.com/video/BV1qZSLBYEpa' }
    },
    {
      browserBindingId: bindingId,
      kind: 'video_detail',
      input: { bvid: 'BV_invalid' }
    },
    {
      browserBindingId: bindingId,
      kind: 'native_search',
      input: { query: 'safe\u0000query' }
    },
    {
      browserBindingId: bindingId,
      kind: 'native_search',
      input: { query: 'DeepSeek' },
      selector: '.anything'
    },
    {
      browserBindingId: bindingId,
      kind: 'account_profile',
      input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
    },
    {
      browserBindingId: bindingId,
      kind: 'account_inventory',
      input: { accountId: '0' }
    },
    {
      browserBindingId: bindingId,
      kind: 'account_inventory',
      input: { accountId: '7481602', executionTarget: 'user_selected_tab', tabId: 7 }
    }
  ]) {
    assert.throws(() => parseTestbenchSubmission(value), TestbenchInputError);
  }
});

test('only accepts an artifact path derived from the matching direct operation capability', () => {
  assert.equal(artifactPathFromOperation({
    operationId,
    capability: 'bilibili.native_search',
    artifact: {
      retrievalPath: `/v1/collect/artifacts/bilibili.native_search/${artifactId}`
    }
  }), `/v1/collect/artifacts/bilibili.native_search/${artifactId}`);
  assert.equal(artifactPathFromOperation({
    operationId,
    capability: 'bilibili.native_search_batch',
    artifact: {
      retrievalPath: `/v1/collect/artifacts/bilibili.native_search_batch/${artifactId}`
    }
  }), `/v1/collect/artifacts/bilibili.native_search_batch/${artifactId}`);
  assert.equal(artifactPathFromOperation({
    operationId,
    capability: 'bilibili.video_detail',
    artifact: {
      retrievalPath: `/v1/collect/artifacts/bilibili.native_search/${artifactId}`
    }
  }), null);
  assert.equal(artifactPathFromOperation({
    operationId,
    capability: 'bilibili.account_inventory',
    artifact: {
      retrievalPath: `/v1/collect/artifacts/bilibili.account_inventory/${artifactId}`
    }
  }), `/v1/collect/artifacts/bilibili.account_inventory/${artifactId}`);
  assert.equal(artifactPathFromOperation({
    operationId,
    capability: 'bilibili.dynamic',
    artifact: {
      retrievalPath: `/v1/collect/artifacts/bilibili.dynamic/${artifactId}`
    }
  }), `/v1/collect/artifacts/bilibili.dynamic/${artifactId}`);
  assert.equal(artifactPathFromOperation({
    operationId,
    capability: 'bilibili.discussion',
    artifact: {
      retrievalPath: `/v1/collect/artifacts/bilibili.discussion/${artifactId}`
    }
  }), `/v1/collect/artifacts/bilibili.discussion/${artifactId}`);
  assert.equal(artifactPathFromOperation({
    operationId,
    capability: 'xiaohongshu.search.public_notes.v1',
    artifact: {
      retrievalPath: `/v1/collect/artifacts/xiaohongshu.search.public_notes.v1/${artifactId}`
    }
  }), `/v1/collect/artifacts/xiaohongshu.search.public_notes.v1/${artifactId}`);
  assert.equal(artifactPathFromOperation({
    operationId,
    capability: 'xiaohongshu.account.public_notes.v1',
    artifact: {
      retrievalPath: `/v1/collect/artifacts/xiaohongshu.account.public_notes.v1/${artifactId}`
    }
  }), `/v1/collect/artifacts/xiaohongshu.account.public_notes.v1/${artifactId}`);
  assert.equal(artifactPathFromOperation({
    operationId,
    capability: 'xiaohongshu.note.public_detail.v1',
    artifact: {
      retrievalPath: `/v1/collect/artifacts/xiaohongshu.note.public_detail.v1/${artifactId}`
    }
  }), `/v1/collect/artifacts/xiaohongshu.note.public_detail.v1/${artifactId}`);
  assert.equal(artifactPathFromOperation({ operationId, capability: 'xiaohongshu.note.public_comments.v1',
    artifact: { retrievalPath: `/v1/collect/artifacts/xiaohongshu.note.public_comments.v1/${artifactId}` }
  }), `/v1/collect/artifacts/xiaohongshu.note.public_comments.v1/${artifactId}`);
  assert.equal(artifactPathFromOperation({operationId,capability:'xiaohongshu.note.public_comment_replies.v1',
    artifact:{retrievalPath:`/v1/collect/artifacts/xiaohongshu.note.public_comment_replies.v1/${artifactId}`}}),
    `/v1/collect/artifacts/xiaohongshu.note.public_comment_replies.v1/${artifactId}`);
});

test('keeps Gateway and testbench listener configuration on explicit loopback origins', () => {
  assert.deepEqual(readTestbenchConfig({
    COLLECTOR_SERVICE_ORIGIN: 'http://127.0.0.1:43127',
    COLLECTOR_TESTBENCH_PORT: '43128',
    COLLECTOR_SERVICE_TOKEN: 'cst_1234567890123456789012345678901234567890123'
  }), {
    gatewayOrigin: 'http://127.0.0.1:43127',
    token: 'cst_1234567890123456789012345678901234567890123',
    appHost: '127.0.0.1',
    appPort: 43128,
    appOrigin: 'http://127.0.0.1:43128',
    requestTimeoutMs: 20_000
  });
  assert.throws(() => readTestbenchConfig({ COLLECTOR_SERVICE_ORIGIN: 'https://example.com:443' }), TestbenchInputError);
  assert.throws(() => readTestbenchConfig({ COLLECTOR_TESTBENCH_PORT: '80' }), TestbenchInputError);
});
