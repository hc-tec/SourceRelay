import { describe, expect, test } from 'vitest';
import {
  computeXiaohongshuPublicNotesSearchBudget,
  extensionWorkSigningPayload,
  extensionWorkTargetUrl,
  isExtensionWorkItem,
  isExtensionWorkResultForItem,
  type XiaohongshuPublicNotesSearchWorkItem
} from '../src/index.js';

const item: XiaohongshuPublicNotesSearchWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'xiaohongshu',
  capability: 'xiaohongshu.search.public_notes.v1',
  executionTarget: 'existing_public_explore_tab',
  issuedAt: '2026-07-28T08:00:00.000Z',
  expiresAt: '2026-07-28T08:01:00.000Z',
  input: { query: '咖啡' },
  budget: computeXiaohongshuPublicNotesSearchBudget({ maximumDetails: 0, maximumScrolls: 0, maximumThreads: 0 }),
  gatewaySignature: 'a'.repeat(64)
};

describe('signed Xiaohongshu public-notes work contract', () => {
  test('admits query-only work with one bounded Explore navigation and has no target URL', () => {
    expect(isExtensionWorkItem(item)).toBe(true);
    expect(() => extensionWorkTargetUrl(item)).toThrow('extension_work_target_navigation_forbidden');
    expect(extensionWorkSigningPayload(item)).not.toContain('gatewaySignature');
  });

  test('rejects every caller-controlled browser or debugger carrier', () => {
    for (const extra of [
      { url: 'https://www.xiaohongshu.com/search_result?keyword=x' },
      { tabId: 11 },
      { selector: 'input' },
      { coordinate: { x: 1, y: 2 } },
      { script: 'document.body.innerHTML' },
      { debuggerCommand: 'Runtime.evaluate' }
    ]) expect(isExtensionWorkItem({ ...item, input: { ...item.input, ...extra } })).toBe(false);
  });

  test('accepts a completed result with one action, at most one navigation and a bounded projection', () => {
    const result = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: item.workId,
      operationId: item.operationId,
      browserBindingId: item.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'search_ready',
      completedAt: '2026-07-28T08:00:30.000Z',
      navigation: { attempted: false, attemptCount: 0 },
      semanticAction: { attempted: true, attemptCount: 1 },
      input: { queryEchoed: true, enterAttempted: true },
      page: { publicSurface: 'search', renderedCardCount: 19 },
      projection: {
        schemaVersion: 2,
        type: 'xiaohongshu_managed_search_projection',
        pageAlias: item.workId,
        runId: item.workId,
        matchedPayloadCount: 1,
        bodyBytesRead: 44_521,
        rawPayloadStored: false,
        responseUrlsStored: false,
        items: [{
          rank: 1,
          noteId: 'note-1',
          title: '咖啡',
          contentType: 'normal',
          authorId: 'author-1',
          authorNickname: '作者',
          likedCountText: '87'
        }]
      },
      rawPayloadStored: false,
      responseUrlsStored: false,
      debuggerDetached: true
    };
    expect(isExtensionWorkResultForItem(result, item)).toBe(true);
    expect(isExtensionWorkResultForItem({ ...result, navigation: { attempted: true, attemptCount: 1 } }, item)).toBe(true);
    expect(isExtensionWorkResultForItem({ ...result, navigation: { attempted: true, attemptCount: 2 } }, item)).toBe(false);
    expect(isExtensionWorkResultForItem({ ...result, semanticAction: { attempted: true, attemptCount: 0 } }, item)).toBe(false);
    expect(isExtensionWorkResultForItem({ ...result, debuggerDetached: false }, item)).toBe(false);
  });

  test('admits bounded sequential depth without allowing navigation or arbitrary detail inputs', () => {
    const depthItem = {
      ...item,
      input: { query: '咖啡', maximumDetails: 2 },
      budget: computeXiaohongshuPublicNotesSearchBudget({ maximumDetails: 2, maximumScrolls: 0, maximumThreads: 0 })
    };
    expect(isExtensionWorkItem(depthItem)).toBe(true);
    expect(isExtensionWorkItem({ ...depthItem, input: { query: '咖啡', maximumDetails: 301 } })).toBe(false);
    // Per-operation depth is a single MV3-safe chunk: one above the ceiling
    // is already rejected — breadth beyond it is composed via skipKnown.
    expect(isExtensionWorkItem({ ...depthItem, input: { query: '咖啡', maximumDetails: 6 } })).toBe(false);
    const depthResult = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: item.workId,
      operationId: item.operationId,
      browserBindingId: item.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'search_depth_ready',
      completedAt: '2026-07-28T08:00:30.000Z',
      navigation: { attempted: false, attemptCount: 0 },
      semanticAction: { attempted: true, attemptCount: 1 },
      input: { queryEchoed: true, enterAttempted: true },
      detailActions: { requestedCount: 2, attemptedCount: 2, completedCount: 2, skippedCount: 0, stoppedReason: null },
      page: { publicSurface: 'search', renderedCardCount: 19 },
      projection: {
        schemaVersion: 2,
        type: 'xiaohongshu_managed_search_projection',
        pageAlias: item.workId,
        runId: item.workId,
        matchedPayloadCount: 1,
        bodyBytesRead: 44_521,
        rawPayloadStored: false,
        responseUrlsStored: false,
        items: [{
          rank: 1, noteId: 'note-1', title: '咖啡', contentType: 'normal',
          authorId: 'author-1', authorNickname: '作者', likedCountText: '87'
        }],
        details: [{
          noteId: 'note-1', publicText: '公开正文', authorNickname: '作者', interactionText: '赞 87'
        }]
      },
      rawPayloadStored: false,
      responseUrlsStored: false,
      debuggerDetached: true
    };
    expect(isExtensionWorkResultForItem(depthResult, depthItem)).toBe(true);
    expect(isExtensionWorkResultForItem({ ...depthResult, detailActions: { ...depthResult.detailActions, completedCount: 1 } }, depthItem)).toBe(false);
  });

  test('admits optional comments only with bounded detail depth and validates the nested projection', () => {
    const commentsItem = {
      ...item,
      input: { query: '咖啡', maximumDetails: 1, comments: { maximumScrolls: 2 } },
      budget: computeXiaohongshuPublicNotesSearchBudget({ maximumDetails: 1, maximumScrolls: 2, maximumThreads: 0 })
    };
    expect(isExtensionWorkItem(commentsItem)).toBe(true);
    expect(isExtensionWorkItem({ ...commentsItem, input: { query: '咖啡', comments: { maximumScrolls: 2 } } })).toBe(false);
    expect(isExtensionWorkItem({ ...commentsItem, input: { query: '咖啡', maximumDetails: 1, comments: { maximumScrolls: 31 } } })).toBe(false);
  });

  test('admits a bounded optional reply-thread set only inside the comments plan', () => {
    const repliesItem = {
      ...item,
      input: {
        query: '咖啡', maximumDetails: 1,
        comments: { maximumScrolls: 2, replies: { maximumThreads: 1 } }
      },
      budget: computeXiaohongshuPublicNotesSearchBudget({ maximumDetails: 1, maximumScrolls: 2, maximumThreads: 1 })
    };
    expect(isExtensionWorkItem(repliesItem)).toBe(true);
    expect(isExtensionWorkItem({
      ...repliesItem,
      input: { query: '咖啡', maximumDetails: 1, comments: { maximumScrolls: 2, replies: { maximumThreads: 3 } } },
      budget: computeXiaohongshuPublicNotesSearchBudget({ maximumDetails: 1, maximumScrolls: 2, maximumThreads: 3 })
    })).toBe(true);
    expect(isExtensionWorkItem({
      ...repliesItem,
      input: { query: '咖啡', maximumDetails: 1, comments: { maximumScrolls: 2, replies: { maximumThreads: 4 } } }
    })).toBe(false);
    expect(isExtensionWorkItem({
      ...repliesItem,
      input: { query: '咖啡', maximumDetails: 1, comments: { maximumScrolls: 2 }, },
      budget: computeXiaohongshuPublicNotesSearchBudget({ maximumDetails: 1, maximumScrolls: 3, maximumThreads: 1 })
    })).toBe(false);
    expect(isExtensionWorkItem({
      ...repliesItem,
      input: { query: '咖啡', maximumDetails: 1, replies: { maximumThreads: 1 } }
    })).toBe(false);
  });

  test('admits a stopped depth result carrying per-rank truth and an abort reason', () => {
    const stoppedDepth = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: item.workId,
      operationId: item.operationId,
      browserBindingId: item.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      state: 'stopped',
      errorCode: 'xiaohongshu_comment_scroll_container_unavailable',
      terminalReason: 'search_depth_stopped',
      completedAt: '2026-07-28T08:00:30.000Z',
      navigation: { attempted: false, attemptCount: 0 },
      semanticAction: { attempted: true, attemptCount: 1 },
      input: { queryEchoed: true, enterAttempted: true },
      detailActions: {
        requestedCount: 5,
        attemptedCount: 4,
        completedCount: 3,
        skippedCount: 0,
        stoppedReason: 'xiaohongshu_comment_scroll_container_unavailable',
        abortReason: 'overlay_persisting',
        ranks: [
          { rank: 1, noteId: 'note-1', outcome: 'completed', errorCode: null },
          { rank: 2, noteId: 'note-2', outcome: 'completed', errorCode: null },
          { rank: 3, noteId: 'note-3', outcome: 'completed', errorCode: null },
          { rank: 4, noteId: 'note-4', outcome: 'failed', errorCode: 'xiaohongshu_comment_scroll_container_unavailable' }
        ]
      },
      page: { publicSurface: 'search', renderedCardCount: 19 },
      projection: null,
      rawPayloadStored: false,
      responseUrlsStored: false,
      debuggerDetached: true
    };
    expect(isExtensionWorkResultForItem(stoppedDepth, item)).toBe(true);
    expect(isExtensionWorkResultForItem({
      ...stoppedDepth,
      detailActions: { ...stoppedDepth.detailActions, abortReason: 'platform_gate' }
    }, item)).toBe(true);
    expect(isExtensionWorkResultForItem({
      ...stoppedDepth,
      detailActions: { ...stoppedDepth.detailActions, abortReason: 'because' }
    }, item)).toBe(false);
    expect(isExtensionWorkResultForItem({
      ...stoppedDepth,
      detailActions: {
        ...stoppedDepth.detailActions,
        ranks: [...stoppedDepth.detailActions.ranks, { rank: 5, noteId: null, outcome: 'unknown', errorCode: null }]
      }
    }, item)).toBe(false);
    expect(isExtensionWorkResultForItem({
      ...stoppedDepth,
      detailActions: {
        ...stoppedDepth.detailActions,
        ranks: [...stoppedDepth.detailActions.ranks, { rank: 6, noteId: null, outcome: 'failed', errorCode: 'x' }]
      }
    }, item)).toBe(false);
  });
});
