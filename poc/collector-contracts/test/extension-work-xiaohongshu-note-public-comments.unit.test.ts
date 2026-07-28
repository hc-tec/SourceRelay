import { describe, expect, test } from 'vitest';
import {
  extensionWorkTargetUrl,
  isExtensionWorkItem,
  isExtensionWorkResultForItem,
  type XiaohongshuNotePublicCommentsWorkItem
} from '../src/index.js';

const item: XiaohongshuNotePublicCommentsWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'xiaohongshu',
  capability: 'xiaohongshu.note.public_comments.v1',
  executionTarget: 'existing_public_note_overlay',
  issuedAt: '2026-07-28T12:00:00.000Z',
  expiresAt: '2026-07-28T12:01:00.000Z',
  input: { maximumScrolls: 1 },
  budget: {
    maximumPlatformNavigations: 0,
    maximumPageReloads: 0,
    maximumPageInitiatedNewDocuments: 0,
    maximumSemanticActions: 3,
    maximumNetworkResponseBodies: 8,
    maximumProjectedItems: 80,
    maximumRawPayloadBytesStored: 0
  },
  gatewaySignature: 'a'.repeat(64)
};

const completed = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: item.workId,
  operationId: item.operationId,
  browserBindingId: item.browserBindingId,
  platform: 'xiaohongshu',
  capability: 'xiaohongshu.note.public_comments.v1',
  executionTarget: 'existing_public_note_overlay',
  state: 'completed',
  errorCode: null,
  terminalReason: 'note_comments_ready',
  completedAt: '2026-07-28T12:00:20.000Z',
  navigation: { attempted: false, attemptCount: 0 },
  semanticAction: { attempted: true, attemptCount: 1 },
  scroll: { requestedCount: 1, completedCount: 1 },
  page: { publicSurface: 'note_detail_overlay', sameDocument: true },
  projection: {
    schemaVersion: 1,
    captureMode: 'dom_fallback',
    network: { matchedPayloadCount: 0, bodyBytesRead: 0, hasMore: null, cursorObserved: false },
    renderedCommentCount: 1,
    comments: [{
      rank: 1,
      commentId: 'dom-0123456789abcdef',
      publicText: '公开评论正文',
      authorNickname: '公开作者',
      likedCountText: '12',
      subCommentCountText: '',
      createdAtText: '2小时前',
      locationText: '上海',
      source: 'dom'
    }],
    rawPayloadStored: false,
    responseUrlsStored: false
  },
  rawPayloadStored: false,
  responseUrlsStored: false,
  debuggerDetached: true
} as const;

describe('signed Xiaohongshu public-comment work contract', () => {
  test('accepts only a bounded scroll count and forbids navigation carriers', () => {
    for (const maximumScrolls of [1, 2, 3]) {
      expect(isExtensionWorkItem({ ...item, input: { maximumScrolls } })).toBe(true);
    }
    expect(() => extensionWorkTargetUrl(item)).toThrow('extension_work_target_navigation_forbidden');
    for (const input of [
      { maximumScrolls: 0 }, { maximumScrolls: 4 }, { maximumScrolls: 1, url: 'https://x' },
      { maximumScrolls: 1, noteId: 'n' }, { maximumScrolls: 1, tabId: 7 },
      { maximumScrolls: 1, documentId: 'd' }, { maximumScrolls: 1, selector: '.comment' },
      { maximumScrolls: 1, coordinate: [1, 2] }, { maximumScrolls: 1, script: 'scroll()' },
      { maximumScrolls: 1, route: '/api/comments' }, { maximumScrolls: 1, cursor: 'next' }
    ]) expect(isExtensionWorkItem({ ...item, input })).toBe(false);
  });

  test('requires a URL-free bounded public projection for completion', () => {
    expect(isExtensionWorkResultForItem(completed, item)).toBe(true);
    expect(isExtensionWorkResultForItem({ ...completed, navigation: { attempted: true, attemptCount: 1 } }, item)).toBe(false);
    expect(isExtensionWorkResultForItem({
      ...completed,
      projection: { ...completed.projection, comments: [] }
    }, item)).toBe(false);
    expect(isExtensionWorkResultForItem({
      ...completed,
      projection: { ...completed.projection, url: 'https://x' }
    }, item)).toBe(false);
  });

  test('records an attempted scroll on a stopped result without claiming completion', () => {
    const stopped = {
      ...completed,
      state: 'stopped',
      errorCode: 'document_context_changed',
      terminalReason: 'document_context_changed',
      scroll: { requestedCount: 1, completedCount: 0 },
      page: null,
      projection: null,
      debuggerDetached: false
    };
    expect(isExtensionWorkResultForItem(stopped, item)).toBe(true);
  });
});
