import { describe, expect, test } from 'vitest';
import {
  extensionWorkTargetUrl,
  isExtensionWorkItem,
  isExtensionWorkResultForItem,
  type XiaohongshuNotePublicDetailWorkItem
} from '../src/index.js';

const item: XiaohongshuNotePublicDetailWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'xiaohongshu',
  capability: 'xiaohongshu.note.public_detail.v1',
  executionTarget: 'existing_public_search_tab',
  issuedAt: '2026-07-28T12:00:00.000Z',
  expiresAt: '2026-07-28T12:01:00.000Z',
  input: { resultRank: 1 },
  budget: {
    maximumPlatformNavigations: 0,
    maximumPageReloads: 0,
    maximumPageInitiatedNewDocuments: 0,
    maximumSemanticActions: 1,
    maximumNetworkResponseBodies: 4,
    maximumProjectedItems: 1,
    maximumRawPayloadBytesStored: 0
  },
  gatewaySignature: 'a'.repeat(64)
};

describe('signed Xiaohongshu note public-detail work contract', () => {
  test('accepts rank-only work and forbids every navigation carrier', () => {
    expect(isExtensionWorkItem(item)).toBe(true);
    expect(() => extensionWorkTargetUrl(item)).toThrow('extension_work_target_navigation_forbidden');
    for (const input of [
      { resultRank: 0 }, { resultRank: 21 }, { resultRank: 1, url: 'https://x' },
      { resultRank: 1, tabId: 7 }, { resultRank: 1, selector: 'img' }, { resultRank: 1, script: 'click()' }
    ]) expect(isExtensionWorkItem({ ...item, input })).toBe(false);
  });

  test('accepts a bounded network-first or DOM-fallback public projection', () => {
    const result = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: item.workId,
      operationId: item.operationId,
      browserBindingId: item.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.note.public_detail.v1',
      executionTarget: 'existing_public_search_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'note_detail_ready',
      completedAt: '2026-07-28T12:00:20.000Z',
      navigation: { attempted: false, attemptCount: 0 },
      semanticAction: { attempted: true, attemptCount: 1 },
      page: { publicSurface: 'note_detail_overlay', sameDocument: true },
      projection: {
        schemaVersion: 1,
        sourceRank: 1,
        captureMode: 'dom_fallback',
        network: { matchedPayloadCount: 0, bodyBytesRead: 0 },
        publicText: '公开标题与正文',
        authorNickname: '公开作者',
        interactionText: '1267 124 7104',
        visibleMediaCount: 1,
        commentEntryVisible: true,
        rawPayloadStored: false,
        responseUrlsStored: false
      },
      rawPayloadStored: false,
      responseUrlsStored: false,
      debuggerDetached: true
    };
    expect(isExtensionWorkResultForItem(result, item)).toBe(true);
    expect(isExtensionWorkResultForItem({ ...result, navigation: { attempted: true, attemptCount: 1 } }, item)).toBe(false);
    expect(isExtensionWorkResultForItem({ ...result, projection: { ...result.projection, sourceRank: 2 } }, item)).toBe(false);
  });
});
