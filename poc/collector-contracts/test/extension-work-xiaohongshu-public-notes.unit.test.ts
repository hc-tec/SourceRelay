import { describe, expect, test } from 'vitest';
import {
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_DEPTH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_DEPTH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_DEPTH_BUDGET,
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
  budget: {
    maximumPlatformNavigations: 0,
    maximumPageReloads: 0,
    maximumPageInitiatedNewDocuments: 0,
    maximumSemanticActions: 1,
    maximumNetworkResponseBodies: 8,
    maximumProjectedItems: 40,
    maximumRawPayloadBytesStored: 0
  },
  gatewaySignature: 'a'.repeat(64)
};

describe('signed Xiaohongshu public-notes work contract', () => {
  test('admits query-only, navigationless work and has no target URL', () => {
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

  test('accepts only a completed result with one action, zero navigation and a bounded projection', () => {
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
    expect(isExtensionWorkResultForItem({ ...result, navigation: { attempted: true, attemptCount: 1 } }, item)).toBe(false);
    expect(isExtensionWorkResultForItem({ ...result, semanticAction: { attempted: true, attemptCount: 0 } }, item)).toBe(false);
    expect(isExtensionWorkResultForItem({ ...result, debuggerDetached: false }, item)).toBe(false);
  });

  test('admits bounded sequential depth without allowing navigation or arbitrary detail inputs', () => {
    const depthItem = {
      ...item,
      input: { query: '咖啡', maximumDetails: 2 },
      budget: XIAOHONGSHU_PUBLIC_NOTES_SEARCH_DEPTH_BUDGET
    };
    expect(isExtensionWorkItem(depthItem)).toBe(true);
    expect(isExtensionWorkItem({ ...depthItem, input: { query: '咖啡', maximumDetails: 21 } })).toBe(false);
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
      detailActions: { requestedCount: 2, attemptedCount: 2, completedCount: 2, stoppedReason: null },
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
      budget: XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_DEPTH_BUDGET
    };
    expect(isExtensionWorkItem(commentsItem)).toBe(true);
    expect(isExtensionWorkItem({ ...commentsItem, input: { query: '咖啡', comments: { maximumScrolls: 2 } } })).toBe(false);
    expect(isExtensionWorkItem({ ...commentsItem, input: { query: '咖啡', maximumDetails: 1, comments: { maximumScrolls: 4 } } })).toBe(false);
  });

  test('admits one optional reply thread only inside the comments plan', () => {
    const repliesItem = {
      ...item,
      input: {
        query: '咖啡', maximumDetails: 1,
        comments: { maximumScrolls: 2, replies: { maximumThreads: 1 } }
      },
      budget: XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_DEPTH_BUDGET
    };
    expect(isExtensionWorkItem(repliesItem)).toBe(true);
    expect(isExtensionWorkItem({
      ...repliesItem,
      input: { query: '咖啡', maximumDetails: 1, comments: { maximumScrolls: 2, replies: { maximumThreads: 2 } } }
    })).toBe(false);
    expect(isExtensionWorkItem({
      ...repliesItem,
      input: { query: '咖啡', maximumDetails: 1, comments: { maximumScrolls: 2 }, },
      budget: XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_DEPTH_BUDGET
    })).toBe(false);
    expect(isExtensionWorkItem({
      ...repliesItem,
      input: { query: '咖啡', maximumDetails: 1, replies: { maximumThreads: 1 } }
    })).toBe(false);
  });
});
