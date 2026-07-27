import { describe, expect, test } from 'vitest';
import {
  bilibiliNativeSearchBatchTargetUrl,
  isBilibiliNativeSearchBatchWorkItem,
  isExtensionWorkItem,
  isExtensionWorkResultForItem,
  type BilibiliNativeSearchBatchWorkItem,
  type ExtensionWorkResult
} from '../src/index.js';

const item: BilibiliNativeSearchBatchWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'bilibili',
  capability: 'bilibili.native_search_batch',
  executionTarget: 'collector_work_tab',
  issuedAt: '2026-07-27T00:00:00.000Z',
  expiresAt: '2026-07-27T00:01:00.000Z',
  input: {
    query: 'DeepSeek',
    resultType: 'comprehensive',
    sort: 'relevance',
    targets: [
      { page: 1, canonicalSearchUrl: 'https://search.bilibili.com/all?keyword=DeepSeek' },
      { page: 2, canonicalSearchUrl: 'https://search.bilibili.com/all?keyword=DeepSeek&page=2' }
    ]
  },
  budget: {
    maximumPlatformNavigations: 2,
    maximumSemanticActions: 0,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 57_344
  },
  gatewaySignature: 'a'.repeat(86)
};

describe('direct native-search fixed two-page work contract', () => {
  test('accepts only the signed canonical first and second native-search URLs', () => {
    expect(isBilibiliNativeSearchBatchWorkItem(item)).toBe(true);
    expect(isExtensionWorkItem(item)).toBe(true);
    expect(bilibiliNativeSearchBatchTargetUrl(item, 1)).toBe(item.input.targets[0].canonicalSearchUrl);
    expect(bilibiliNativeSearchBatchTargetUrl(item, 2)).toBe(item.input.targets[1].canonicalSearchUrl);
    expect(isBilibiliNativeSearchBatchWorkItem({
      ...item,
      input: {
        ...item.input,
        targets: [
          item.input.targets[0],
          { page: 2, canonicalSearchUrl: 'https://search.bilibili.com/all?keyword=DeepSeek&page=2&o=24' }
        ]
      }
    })).toBe(false);
    expect(isBilibiliNativeSearchBatchWorkItem({
      ...item,
      budget: { ...item.budget, maximumPlatformNavigations: 3 }
    })).toBe(false);
  });

  test('accepts a completed result only after both fixed pages were observed once', () => {
    const result: ExtensionWorkResult = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: item.workId,
      operationId: item.operationId,
      browserBindingId: item.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search_batch',
      executionTarget: 'collector_work_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'search_batch_ready',
      completedAt: '2026-07-27T00:00:20.000Z',
      navigation: { attempted: true, attemptCount: 2 },
      workTabAcquisition: 'created',
      workTabDisposition: 'idle_reusable',
      observation: {
        pages: [
          pageObservation(1, 'BV1qZSLBYEpa'),
          pageObservation(2, 'BV1xx411c7mD')
        ]
      }
    };
    expect(isExtensionWorkResultForItem(result, item)).toBe(true);
    expect(isExtensionWorkResultForItem({
      ...result,
      navigation: { attempted: true, attemptCount: 1 }
    }, item)).toBe(false);
    expect(isExtensionWorkResultForItem({
      ...result,
      observation: { pages: [pageObservation(1, 'BV1qZSLBYEpa')] }
    }, item)).toBe(false);
  });

  test('allows an empty first page to stop before a needless second navigation', () => {
    const result: ExtensionWorkResult = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: item.workId,
      operationId: item.operationId,
      browserBindingId: item.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search_batch',
      executionTarget: 'collector_work_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'search_batch_empty',
      completedAt: '2026-07-27T00:00:20.000Z',
      navigation: { attempted: true, attemptCount: 1 },
      workTabAcquisition: 'created',
      workTabDisposition: 'idle_reusable',
      observation: {
        pages: [{ ...pageObservation(1, null), emptyStateVisible: true, resultListVisible: false, semanticResultCardCount: 0, cards: [] }]
      }
    };
    expect(isExtensionWorkResultForItem(result, item)).toBe(true);
  });
});

function pageObservation(page: 1 | 2, bvid: string | null) {
  return {
    page,
    searchInputVisible: true,
    resultListVisible: bvid !== null,
    emptyStateVisible: false,
    resultType: 'comprehensive' as const,
    sort: 'relevance' as const,
    semanticResultCardCount: bvid === null ? 0 : 1,
    cards: bvid === null ? [] : [{
      bvid,
      title: '公开视频',
      visibleText: '公开可见搜索卡片',
      thumbnailUrl: null
    }],
    loginOverlayVisible: false,
    risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
  };
}
