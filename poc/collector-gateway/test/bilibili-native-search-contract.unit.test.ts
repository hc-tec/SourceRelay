import { describe, expect, test } from 'vitest';
import type { StrategyObservationResult } from '@intelligence/collector-contracts';
import {
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
    const page = projectBilibiliNativeSearchDom(dom(), '2026-07-22T02:00:01.000Z');
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
      cards: []
    }), '2026-07-22T02:00:01.000Z');
    expect(page).toMatchObject({ resultState: 'no_video_results', items: [] });
  });

  test('rejects a bridge payload that tries to carry a raw query value', () => {
    const invalid = observation(dom()) as unknown as { payload: Record<string, unknown> };
    invalid.payload.query = '人工智能';
    expect(() => bilibiliNativeSearchStrategyObservation(invalid as unknown as StrategyObservationResult))
      .toThrow('native_search_observation_payload_context_invalid');
  });
});
