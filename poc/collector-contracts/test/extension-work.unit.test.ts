import { describe, expect, test } from 'vitest';
import {
  extensionWorkSigningPayload,
  isExtensionWorkItem,
  isExtensionWorkResultForItem,
  type ExtensionWorkItem,
  type ExtensionWorkResult
} from '../src/index.js';

const item: ExtensionWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'bilibili',
  capability: 'bilibili.video_detail',
  executionTarget: 'collector_work_tab',
  issuedAt: '2026-07-25T00:00:00.000Z',
  expiresAt: '2026-07-25T00:01:00.000Z',
  input: {
    canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
    bvid: 'BV1qZSLBYEpa'
  },
  budget: {
    maximumPlatformNavigations: 1,
    maximumSemanticActions: 0,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 98_304
  },
  gatewaySignature: 'a'.repeat(86)
};

const searchItem: ExtensionWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '44444444-4444-4444-8444-444444444444',
  operationId: '55555555-5555-4555-8555-555555555555',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'bilibili',
  capability: 'bilibili.native_search',
  executionTarget: 'collector_work_tab',
  issuedAt: '2026-07-25T00:00:00.000Z',
  expiresAt: '2026-07-25T00:01:00.000Z',
  input: {
    query: 'DeepSeek',
    canonicalSearchUrl: 'https://search.bilibili.com/all?keyword=DeepSeek',
    resultType: 'comprehensive',
    sort: 'relevance',
    page: 1
  },
  budget: {
    maximumPlatformNavigations: 1,
    maximumSemanticActions: 0,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 98_304
  },
  gatewaySignature: 'b'.repeat(86)
};

describe('direct extension work contract', () => {
  test('signs a fixed typed work item without allowing arbitrary carrier fields', () => {
    expect(isExtensionWorkItem(item)).toBe(true);
    expect(extensionWorkSigningPayload(item)).not.toContain('gatewaySignature');
    expect(isExtensionWorkItem({ ...item, selector: 'body' })).toBe(false);
    expect(isExtensionWorkItem({
      ...item,
      input: { ...item.input, canonicalVideoUrl: `${item.input.canonicalVideoUrl}?from=unsafe` }
    })).toBe(false);
  });

  test('accepts a completed projection only when it remains bound to the claimed item and one navigation', () => {
    const result: ExtensionWorkResult = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: item.workId,
      operationId: item.operationId,
      browserBindingId: item.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.video_detail',
      executionTarget: 'collector_work_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'detail_ready',
      completedAt: '2026-07-25T00:00:20.000Z',
      navigation: { attempted: true, attemptCount: 1 },
      workTabAcquisition: 'created',
      workTabDisposition: 'idle_reusable',
      observation: {
        bvid: item.input.bvid,
        title: '公开页面标题',
        metadataVisibleText: null,
        description: null,
        creator: null,
        tagTexts: ['AI'],
        episodeSummaryText: null,
        titleVisible: true,
        playerVisible: true,
        chargeExclusiveTrialVisible: false,
        loginOverlayVisible: false,
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      }
    };
    expect(isExtensionWorkResultForItem(result, item)).toBe(true);
    expect(isExtensionWorkResultForItem({
      ...result,
      navigation: { attempted: true, attemptCount: 0 }
    }, item)).toBe(false);
    expect(isExtensionWorkResultForItem({
      ...result,
      observation: { ...result.observation!, bvid: 'BV1xx411c7mD' }
    }, item)).toBe(false);
  });

  test('keeps native search to its fixed comprehensive first-page DOM capability', () => {
    expect(isExtensionWorkItem(searchItem)).toBe(true);
    expect(isExtensionWorkItem({
      ...searchItem,
      input: { ...searchItem.input, page: 2 }
    })).toBe(false);
    expect(isExtensionWorkItem({
      ...searchItem,
      input: { ...searchItem.input, sort: 'newest' }
    })).toBe(false);
    expect(isExtensionWorkItem({ ...searchItem, selector: '.search-page' })).toBe(false);

    const result: ExtensionWorkResult = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: searchItem.workId,
      operationId: searchItem.operationId,
      browserBindingId: searchItem.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search',
      executionTarget: 'collector_work_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'search_ready',
      completedAt: '2026-07-25T00:00:20.000Z',
      navigation: { attempted: true, attemptCount: 1 },
      workTabAcquisition: 'created',
      workTabDisposition: 'idle_reusable',
      observation: {
        searchInputVisible: true,
        resultListVisible: true,
        emptyStateVisible: false,
        resultType: 'comprehensive',
        sort: 'relevance',
        page: 1,
        semanticResultCardCount: 1,
        cards: [{
          bvid: 'BV1qZSLBYEpa',
          title: '公开视频',
          visibleText: '公开视频 创作者',
          thumbnailUrl: null
        }],
        loginOverlayVisible: false,
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      }
    };
    expect(isExtensionWorkResultForItem(result, searchItem)).toBe(true);
    expect(isExtensionWorkResultForItem({
      ...result,
      terminalReason: 'search_empty'
    }, searchItem)).toBe(false);
  });
});
