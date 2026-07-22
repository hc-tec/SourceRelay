import { describe, expect, test } from 'vitest';
import {
  canonicalBilibiliNativeSearchUrl,
  type StrategyObservationResult
} from '@intelligence/collector-contracts';
import {
  bilibiliNativeSearchInput,
  canonicalBilibiliNativeSearchUrlForInput,
  canonicalBilibiliNativeSearchUrlForQuery,
  projectBilibiliNativeSearchDom,
  type BilibiliNativeSearchDomSnapshot
} from '../src/bilibili-native-search-contract.js';
import { bilibiliNativeSearchStrategyObservation } from '../src/bilibili-native-search-observation.js';

function dom(overrides: Partial<BilibiliNativeSearchDomSnapshot> = {}): BilibiliNativeSearchDomSnapshot {
  return {
    searchInputVisible: true,
    resultListVisible: true,
    emptyStateVisible: false,
    resultType: 'comprehensive',
    sort: 'relevance',
    semanticResultCardCount: 1,
    cards: [{
      bvid: 'BV1qZSLBYEpa',
      title: '公开搜索结果',
      visibleText: '公开搜索结果 播放 1000',
      thumbnailUrl: null
    }],
    loginOverlayVisible: false,
    risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false },
    ...overrides
  };
}

function observation(domValue: unknown): StrategyObservationResult {
  return {
    schemaVersion: 1 as const,
    type: 'collector_strategy_observation' as const,
    strategyId: 'bilibili.search.breadth.dom.v2' as const,
    observerBindingId: '11111111-1111-4111-8111-111111111111',
    pageAlias: 'page-1',
    documentGeneration: 1,
    routeGeneration: 0,
    capturedAt: '2026-07-22T02:00:00.000Z',
    payloadBytes: 1_024,
    payload: {
      schemaVersion: 1,
      strategyId: 'bilibili.search.breadth.dom.v2',
      documentId: 'document-1',
      dom: domValue
    } as unknown as StrategyObservationResult['payload']
  };
}

describe('Bilibili native-search contract', () => {
  test('keeps a normalized query transient and projects ordered canonical BV cards', () => {
    expect(canonicalBilibiliNativeSearchUrlForQuery(' 人工智能 '))
      .toBe('https://search.bilibili.com/all?keyword=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD');
    const page = projectBilibiliNativeSearchDom(dom(), '2026-07-22T02:00:01.000Z', {
      resultType: 'comprehensive',
      sort: 'relevance',
      page: 1
    });
    expect(page).toMatchObject({
      resultState: 'video_results',
      visibleVideoCardCount: 1,
      unresolvedCardCount: 0
    });
    expect(page?.items).toEqual([expect.objectContaining({
      rank: 1,
      bvid: 'BV1qZSLBYEpa',
      canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa'
    })]);
  });

  test('represents a visible empty state instead of pretending it is a failed projection', () => {
    const page = projectBilibiliNativeSearchDom(dom({
      resultListVisible: false,
      emptyStateVisible: true,
      semanticResultCardCount: 0,
      cards: []
    }), '2026-07-22T02:00:01.000Z', {
      resultType: 'comprehensive',
      sort: 'relevance',
      page: 1
    });
    expect(page).toMatchObject({ resultState: 'no_video_results', items: [] });
  });

  test('uses only reviewed native video/newest/page-two URL semantics', () => {
    const input = bilibiliNativeSearchInput({
      query: ' 人工智能 ',
      resultType: 'video',
      sort: 'newest',
      page: 2
    });
    expect(input).toEqual({ query: '人工智能', resultType: 'video', sort: 'newest', page: 2 });
    expect(canonicalBilibiliNativeSearchUrlForInput(input))
      .toBe('https://search.bilibili.com/video?keyword=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD&order=pubdate&page=2');
    expect(() => bilibiliNativeSearchInput({ query: '人工智能', resultType: 'comprehensive', sort: 'newest' }))
      .toThrow('bilibili_native_search_input_invalid');
    expect(() => bilibiliNativeSearchInput({ query: '人工智能', page: 3 }))
      .toThrow('bilibili_native_search_input_invalid');
    const observed = 'https://search.bilibili.com/video?keyword=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD&page=2&o=1&vt=2';
    expect(canonicalBilibiliNativeSearchUrl(observed, 'observed_document'))
      .toBe('https://search.bilibili.com/video?keyword=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD&page=2');
    expect(canonicalBilibiliNativeSearchUrl(observed, 'strict_input')).toBeNull();
  });

  test('rejects a bridge payload that tries to carry a raw query value', () => {
    const invalid = observation(dom()) as unknown as { payload: Record<string, unknown> };
    invalid.payload.query = '人工智能';
    expect(() => bilibiliNativeSearchStrategyObservation(invalid as unknown as StrategyObservationResult))
      .toThrow('native_search_observation_payload_context_invalid');
  });
});
