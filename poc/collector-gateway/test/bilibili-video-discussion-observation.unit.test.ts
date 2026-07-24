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
  mergeBilibiliVideoDiscussionRootComments,
  projectBilibiliVideoDiscussionDom,
  recordBilibiliVideoDiscussionReplyPage
} from '../src/bilibili-video-discussion-contract';
import {
  createBilibiliVideoDiscussionActionLedger,
  createBilibiliVideoDiscussionScrollAction
} from '../src/bilibili-video-discussion-action-ledger';

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
  test('keeps scroll actions before requested interaction actions in the ledger', () => {
    const ledger = createBilibiliVideoDiscussionActionLedger(
      '11111111-1111-4111-8111-111111111111',
      ['expand_first_thread', 'expand_second_thread']
    );
    ledger.appendScroll(createBilibiliVideoDiscussionScrollAction(
      '11111111-1111-4111-8111-111111111111',
      2
    ));
    ledger.appendScroll(createBilibiliVideoDiscussionScrollAction(
      '11111111-1111-4111-8111-111111111111',
      3
    ));
    ledger.appendRequestedInteractions();
    ledger.appendRequestedInteractions();

    expect(ledger.actions.map((action) => action.kind)).toEqual([
      'navigation',
      'scroll',
      'scroll',
      'scroll',
      'expand_first_thread',
      'expand_second_thread'
    ]);
    expect(ledger.actions.map((action) => action.actionId)).toEqual([
      'navigate_video_discussion_11111111_1111_4111_8111_111111111111',
      'scroll_video_discussion_11111111_1111_4111_8111_111111111111',
      'scroll_video_discussion_11111111_1111_4111_8111_111111111111_2',
      'scroll_video_discussion_11111111_1111_4111_8111_111111111111_3',
      'expand_first_thread_11111111_1111_4111_8111_111111111111',
      'expand_second_thread_11111111_1111_4111_8111_111111111111'
    ]);
    expect(ledger.actions.filter((action) => action.kind === 'scroll'))
      .toHaveLength(3);
    expect(() => ledger.appendScroll(createBilibiliVideoDiscussionScrollAction(
      '11111111-1111-4111-8111-111111111111',
      4
    ))).toThrow('bilibili_video_discussion_action_phase_closed');
  });

  test('canonicalises only a clean Bilibili video URL', () => {
    expect(canonicalBilibiliVideoDiscussionUrl(`https://www.bilibili.com/video/${bvid}/`))
      .toBe(`https://www.bilibili.com/video/${bvid}`);
    expect(canonicalBilibiliVideoDiscussionUrl(`https://www.bilibili.com/video/${bvid}?from=search`)).toBeNull();
    expect(bilibiliVideoDiscussionInput({ canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}` }))
      .toEqual({ canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`, actions: [] });
    expect(bilibiliVideoDiscussionBvid(`https://www.bilibili.com/video/${bvid}`)).toBe(bvid);
    expect(bilibiliVideoDiscussionInput({
      canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
      actions: [
        'select_latest_comments',
        'expand_first_thread',
        'reveal_first_thread_pagination',
        'next_first_thread_page',
        'expand_second_thread',
        'reveal_second_thread_pagination',
        'next_second_thread_page'
      ]
    })).toEqual({
      canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
      actions: [
        'select_latest_comments',
        'expand_first_thread',
        'reveal_first_thread_pagination',
        'next_first_thread_page',
        'expand_second_thread',
        'reveal_second_thread_pagination',
        'next_second_thread_page'
      ]
    });
    expect(() => bilibiliVideoDiscussionInput({
      canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
      actions: [
        'select_latest_comments',
        'expand_first_thread',
        'next_first_thread_page',
        'expand_second_thread',
        'next_second_thread_page',
        'expand_first_thread'
      ]
    })).toThrow('bilibili_video_discussion_input_invalid');
    expect(() => bilibiliVideoDiscussionInput({
      canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
      actions: ['reveal_first_thread_pagination', 'expand_first_thread']
    })).toThrow('bilibili_video_discussion_input_invalid');
    expect(() => bilibiliVideoDiscussionInput({
      canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
      actions: ['expand_first_thread', 'next_first_thread_page', 'reveal_first_thread_pagination']
    })).toThrow('bilibili_video_discussion_input_invalid');
    expect(bilibiliVideoDiscussionInput({
      canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
      actions: ['expand_first_thread', 'reveal_second_thread', 'expand_second_thread']
    })).toEqual({
      canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
      actions: ['expand_first_thread', 'reveal_second_thread', 'expand_second_thread']
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

  test('accumulates two observed reply pages with normalized digest and cross-page deduplication', () => {
    const first = recordBilibiliVideoDiscussionReplyPage(undefined, {
      threadOrdinal: 0,
      mode: 'append',
      observation: {
        replies: [
          { author: '甲', content: '同一条回复', publishedAt: '2026-07-23 12:00', likeCount: 1 },
          { author: '乙', content: '第一页独有', publishedAt: null, likeCount: null }
        ],
        paginationVisible: true,
        replyPage: null,
        replyPageCount: null,
        replyHasMore: true,
        coverage: 'current_page'
      }
    });
    const refreshed = recordBilibiliVideoDiscussionReplyPage(first, {
      threadOrdinal: 0,
      mode: 'refresh',
      observation: {
        ...first,
        replies: first.replies,
        paginationVisible: true,
        replyPage: null,
        replyPageCount: null,
        replyHasMore: true,
        coverage: 'current_page'
      }
    });
    const second = recordBilibiliVideoDiscussionReplyPage(refreshed, {
      threadOrdinal: 0,
      mode: 'append',
      observation: {
        replies: [
          // A like-count change must not turn the same normalized reply into
          // a second cross-page item.
          { author: '甲', content: '  同一条回复 ', publishedAt: '2026-07-23 12:00', likeCount: 99 },
          { author: '丙', content: '第二页独有', publishedAt: null, likeCount: null }
        ],
        paginationVisible: true,
        replyPage: null,
        replyPageCount: null,
        replyHasMore: false,
        coverage: 'current_page'
      }
    });

    expect(second.pages).toHaveLength(2);
    expect(second.pages.map((page) => page.observedPageOrdinal)).toEqual([1, 2]);
    expect(second.pages[0]!).toMatchObject({
      rawReplyCount: 2,
      uniqueReplyCount: 2,
      crossPageDuplicateCount: 0,
      cumulativeUniqueReplyCount: 2,
      contentChanged: true
    });
    expect(second.pages[1]!).toMatchObject({
      rawReplyCount: 2,
      uniqueReplyCount: 2,
      crossPageDuplicateCount: 1,
      cumulativeUniqueReplyCount: 3,
      contentChanged: true,
      replyPage: null
    });
    expect(second.pages[0]!.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(second.page).toBeNull();
    expect(second.replies).toEqual(second.pages[1]!.replies);
    expect(refreshed.pages).toHaveLength(1);
    expect(refreshed.pages[0]!.contentChanged).toBe(true);
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

    const tooMany = Array.from({ length: 61 }, (_, index) => `comment-${index}`);
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

  test('merges bounded root snapshots without duplicating visible threads', () => {
    expect(mergeBilibiliVideoDiscussionRootComments(
      ['第一条', '重复内容'],
      ['重复内容', '第二条', '  第三条  ']
    )).toEqual(['第一条', '重复内容', '第二条', '第三条']);
    expect(mergeBilibiliVideoDiscussionRootComments(
      [],
      Array.from({ length: 61 }, (_, index) => `根评论-${index}`)
    )).toHaveLength(60);
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
