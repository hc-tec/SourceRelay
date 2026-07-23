import { describe, expect, test } from 'vitest';
import { BILIBILI_DISCUSSION_STRATEGY_ID, type BridgeJsonValue } from '@intelligence/collector-contracts';
import {
  bilibiliVideoDiscussionObservationWaitState,
  bilibiliVideoDiscussionStrategyObservation
} from '../src/bilibili-video-discussion-observation';
import {
  bilibiliVideoDiscussionBvid,
  bilibiliVideoDiscussionInput,
  canonicalBilibiliVideoDiscussionUrl,
  projectBilibiliVideoDiscussionDom
} from '../src/bilibili-video-discussion-contract';

const bvid = 'BV1qZSLBYEpa';

function result(dom: Record<string, unknown>) {
  return {
    type: 'collector_strategy_observation' as const,
    schemaVersion: 1 as const,
    strategyId: BILIBILI_DISCUSSION_STRATEGY_ID,
    observerBindingId: 'binding-1',
    pageAlias: 'page-1',
    documentGeneration: 1,
    routeGeneration: 0,
    capturedAt: '2026-07-23T01:00:00.000Z',
    payloadBytes: 512,
    payload: {
      schemaVersion: 1,
      strategyId: BILIBILI_DISCUSSION_STRATEGY_ID,
      bvid,
      documentId: 'document-1',
      dom: dom as BridgeJsonValue
    }
  };
}

describe('Bilibili discussion DOM contract', () => {
  test('canonicalises only a clean Bilibili video URL', () => {
    expect(canonicalBilibiliVideoDiscussionUrl(`https://www.bilibili.com/video/${bvid}/`))
      .toBe(`https://www.bilibili.com/video/${bvid}`);
    expect(canonicalBilibiliVideoDiscussionUrl(`https://www.bilibili.com/video/${bvid}?from=search`)).toBeNull();
    expect(bilibiliVideoDiscussionInput({ canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}` }))
      .toEqual({ canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`, actions: [] });
    expect(bilibiliVideoDiscussionBvid(`https://www.bilibili.com/video/${bvid}`)).toBe(bvid);
    expect(bilibiliVideoDiscussionInput({
      canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
      actions: ['select_latest_comments', 'expand_first_thread']
    })).toEqual({
      canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
      actions: ['select_latest_comments', 'expand_first_thread']
    });
    expect(() => bilibiliVideoDiscussionInput({
      canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
      actions: ['select_latest_comments', 'select_latest_comments']
    })).toThrow('bilibili_video_discussion_input_invalid');
  });

  test('accepts a bounded shadow-DOM projection and preserves login gate state', () => {
    const observed = bilibiliVideoDiscussionStrategyObservation(result({
      bvid,
      commentHostPresent: true,
      commentHostVisible: true,
      commentHostInViewport: true,
      commentHostBounds: { x: 0, y: 32, width: 800, height: 500 },
      sortControls: { hotVisible: true, latestVisible: true, latestState: 'unknown' },
      commentContentState: 'ready',
      rootCommentTexts: ['公开评论一', '公开评论二'],
      firstThreadExpandVisible: true,
      loginGateVisible: true,
      risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
    }), bvid);
    expect(observed.dom.rootCommentTexts).toHaveLength(2);
    expect(projectBilibiliVideoDiscussionDom(observed.dom, bvid, true, '2026-07-23T01:00:01.000Z'))
      .toMatchObject({ sort: 'hot', contentState: 'ready', loginGateVisible: true, capturedAfterScroll: true });
  });

  test('projects one bounded visible reply page without inventing missing fields', () => {
    const observed = bilibiliVideoDiscussionStrategyObservation(result({
      bvid,
      commentHostPresent: true,
      commentHostVisible: true,
      commentHostInViewport: true,
      commentHostBounds: { x: 0, y: 32, width: 800, height: 500 },
      sortControls: { hotVisible: true, latestVisible: true, latestState: 'active' },
      commentContentState: 'ready',
      rootCommentTexts: ['根评论'],
      firstThreadExpandVisible: false,
      firstThreadReplies: [{
        author: '回复作者',
        content: '回复正文',
        publishedAt: '2026-07-23 12:00',
        likeCount: 23
      }],
      replyPaginationVisible: true,
      replyPage: 1,
      replyPageCount: 83,
      replyHasMore: true,
      replyCoverage: 'current_page',
      loginGateVisible: false,
      risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
    }), bvid);
    expect(projectBilibiliVideoDiscussionDom(observed.dom, bvid, true, '2026-07-23T01:00:03.000Z'))
      .toMatchObject({
        sort: 'latest',
        firstThreadReplies: [{ author: '回复作者', content: '回复正文', publishedAt: '2026-07-23 12:00', likeCount: 23 }],
        replyPage: 1,
        replyPageCount: 83,
        replyHasMore: true,
        replyCoverage: 'current_page'
      });
  });

  test('rejects a wrong BVID or an unbounded root text list', () => {
    expect(() => bilibiliVideoDiscussionStrategyObservation(result({
      bvid: 'BV1xx411c7mD',
      commentHostPresent: true,
      commentHostVisible: true,
      commentHostInViewport: true,
      commentHostBounds: null,
      sortControls: { hotVisible: true, latestVisible: true, latestState: 'unknown' },
      commentContentState: 'ready',
      rootCommentTexts: [],
      firstThreadExpandVisible: false,
      loginGateVisible: false,
      risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
    }), bvid)).toThrow('video_discussion_observation_dom_invalid');

    const tooMany = Array.from({ length: 21 }, (_, index) => `comment-${index}`);
    expect(() => bilibiliVideoDiscussionStrategyObservation(result({
      bvid,
      commentHostPresent: true,
      commentHostVisible: true,
      commentHostInViewport: true,
      commentHostBounds: null,
      sortControls: { hotVisible: true, latestVisible: true, latestState: 'unknown' },
      commentContentState: 'ready',
      rootCommentTexts: tooMany,
      firstThreadExpandVisible: false,
      loginGateVisible: false,
      risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
    }), bvid)).toThrow('video_discussion_observation_dom_invalid');
  });

  test('does not project a loading spinner as a completed discussion', () => {
    const observed = bilibiliVideoDiscussionStrategyObservation(result({
      bvid,
      commentHostPresent: true,
      commentHostVisible: true,
      commentHostInViewport: true,
      commentHostBounds: { x: 0, y: 32, width: 800, height: 500 },
      sortControls: { hotVisible: false, latestVisible: false, latestState: 'unknown' },
      commentContentState: 'loading',
      rootCommentTexts: [],
      firstThreadExpandVisible: false,
      loginGateVisible: false,
      risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
    }), bvid);
    expect(projectBilibiliVideoDiscussionDom(observed.dom, bvid, true, '2026-07-23T01:00:01.000Z')).toBeNull();
  });

  test('keeps polling a lazy comment host until loading becomes ready', () => {
    const loading = bilibiliVideoDiscussionStrategyObservation(result({
      bvid,
      commentHostPresent: true,
      commentHostVisible: true,
      commentHostInViewport: true,
      commentHostBounds: { x: 0, y: 32, width: 800, height: 500 },
      sortControls: { hotVisible: false, latestVisible: false, latestState: 'unknown' },
      commentContentState: 'loading',
      rootCommentTexts: [],
      firstThreadExpandVisible: false,
      loginGateVisible: false,
      risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
    }), bvid);
    expect(bilibiliVideoDiscussionObservationWaitState(loading.dom, {
      requireViewport: true,
      requireContentReady: true
    })).toBe('waiting_for_content');

    const ready = bilibiliVideoDiscussionStrategyObservation(result({
      bvid,
      commentHostPresent: true,
      commentHostVisible: true,
      commentHostInViewport: true,
      commentHostBounds: { x: 0, y: 32, width: 800, height: 500 },
      sortControls: { hotVisible: true, latestVisible: true, latestState: 'inactive' },
      commentContentState: 'ready',
      rootCommentTexts: ['延迟出现的评论'],
      firstThreadExpandVisible: false,
      loginGateVisible: false,
      risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
    }), bvid);
    expect(bilibiliVideoDiscussionObservationWaitState(ready.dom, {
      requireViewport: true,
      requireContentReady: true
    })).toBe('ready');
  });

  test('classifies a loading timeout as waiting, never as empty', () => {
    const loading = bilibiliVideoDiscussionStrategyObservation(result({
      bvid,
      commentHostPresent: true,
      commentHostVisible: true,
      commentHostInViewport: true,
      commentHostBounds: { x: 0, y: 32, width: 800, height: 500 },
      sortControls: { hotVisible: false, latestVisible: false, latestState: 'unknown' },
      commentContentState: 'loading',
      rootCommentTexts: [],
      firstThreadExpandVisible: false,
      loginGateVisible: false,
      risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
    }), bvid);
    expect(bilibiliVideoDiscussionObservationWaitState(loading.dom, {
      requireViewport: true,
      requireContentReady: true
    })).not.toBe('ready');
    expect(projectBilibiliVideoDiscussionDom(loading.dom, bvid, true, '2026-07-23T01:00:02.000Z'))
      .toBeNull();
  });
});
