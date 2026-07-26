import { describe, expect, test } from 'vitest';
import {
  canonicalBilibiliPassiveVideoWorkUrl,
  isBilibiliPassiveExtensionWorkItem,
  isBilibiliPassiveExtensionWorkResultForItem,
  type BilibiliCollectionSeriesOverviewWorkItem,
  type BilibiliCollectionSeriesOverviewWorkResult,
  type BilibiliDynamicWorkItem,
  type BilibiliDynamicWorkResult
} from '../src/index.js';

const item: BilibiliDynamicWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'bilibili',
  capability: 'bilibili.dynamic',
  executionTarget: 'collector_work_tab',
  issuedAt: '2026-07-26T00:00:00.000Z',
  expiresAt: '2026-07-26T00:01:00.000Z',
  input: {
    canonicalProfileUrl: 'https://space.bilibili.com/7481602',
    canonicalDynamicUrl: 'https://space.bilibili.com/7481602/dynamic',
    stableAccountId: '7481602'
  },
  budget: {
    maximumPlatformNavigations: 1,
    maximumSemanticActions: 0,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 98_304
  },
  gatewaySignature: 'a'.repeat(86)
};

const overviewItem: BilibiliCollectionSeriesOverviewWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '44444444-4444-4444-8444-444444444444',
  operationId: '55555555-5555-4555-8555-555555555555',
  browserBindingId: item.browserBindingId,
  platform: 'bilibili',
  capability: 'bilibili.collection_series.overview',
  executionTarget: 'collector_work_tab',
  issuedAt: item.issuedAt,
  expiresAt: item.expiresAt,
  input: {
    canonicalProfileUrl: 'https://space.bilibili.com/7481602',
    canonicalOverviewUrl: 'https://space.bilibili.com/7481602/lists',
    stableAccountId: '7481602'
  },
  budget: {
    maximumPlatformNavigations: 1,
    maximumSemanticActions: 0,
    maximumResponseObservations: 1,
    maximumPayloadBytes: 98_304
  },
  gatewaySignature: 'c'.repeat(86)
};

describe('passive user-owned-browser Bilibili work contract', () => {
  test('keeps signed video input query-free while accepting an observed Bilibili attribution query', () => {
    expect(canonicalBilibiliPassiveVideoWorkUrl('https://www.bilibili.com/video/BV1qZSLBYEpa')).toBe(
      'https://www.bilibili.com/video/BV1qZSLBYEpa'
    );
    expect(canonicalBilibiliPassiveVideoWorkUrl(
      'https://www.bilibili.com/video/BV1qZSLBYEpa?spm_id_from=333.1007.top_right_bar_window_history.content.click'
    )).toBeNull();
    expect(canonicalBilibiliPassiveVideoWorkUrl(
      'https://www.bilibili.com/video/BV1qZSLBYEpa?spm_id_from=333.1007.top_right_bar_window_history.content.click',
      'observed_document'
    )).toBe('https://www.bilibili.com/video/BV1qZSLBYEpa');
  });

  test('binds dynamic work to one derived public page and rejects arbitrary carrier fields', () => {
    expect(isBilibiliPassiveExtensionWorkItem(item)).toBe(true);
    expect(isBilibiliPassiveExtensionWorkItem({
      ...item,
      input: { ...item.input, canonicalDynamicUrl: `${item.input.canonicalDynamicUrl}?page=2` }
    })).toBe(false);
    expect(isBilibiliPassiveExtensionWorkItem({ ...item, selector: '.bili-dyn-list' })).toBe(false);
  });

  test('accepts a completed passive projection only with one navigation, matching MID and a reusable work tab', () => {
    const result: BilibiliDynamicWorkResult = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: item.workId,
      operationId: item.operationId,
      browserBindingId: item.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.dynamic',
      executionTarget: 'collector_work_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'dynamic_ready',
      completedAt: '2026-07-26T00:00:20.000Z',
      navigation: { attempted: true, attemptCount: 1 },
      workTabAcquisition: 'created',
      workTabDisposition: 'idle_reusable',
      observation: {
        stableAccountId: '7481602',
        feedVisible: true,
        activeFilterLabel: '全部',
        cards: [{
          author: '公开 UP 主',
          publishedVisibleText: null,
          visibleText: '公开动态',
          links: [],
          imageUrls: [],
          kind: 'other',
          blockedPlaceholder: false,
          reservation: false,
          forwarded: false
        }],
        loginOverlayVisible: false,
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      }
    };
    expect(isBilibiliPassiveExtensionWorkResultForItem(result, item)).toBe(true);
    expect(isBilibiliPassiveExtensionWorkResultForItem({
      ...result,
      observation: { ...result.observation!, stableAccountId: '1' }
    }, item)).toBe(false);
    expect(isBilibiliPassiveExtensionWorkResultForItem({
      ...result,
      workTabDisposition: 'retained_not_reusable'
    }, item)).toBe(false);
  });

  test('allows collection overview to project one fixed response identity but rejects an unbounded or raw-response carrier', () => {
    expect(isBilibiliPassiveExtensionWorkItem(overviewItem)).toBe(true);
    expect(isBilibiliPassiveExtensionWorkItem({
      ...overviewItem,
      budget: { ...overviewItem.budget, maximumResponseObservations: 0 }
    })).toBe(false);

    const result: BilibiliCollectionSeriesOverviewWorkResult = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: overviewItem.workId,
      operationId: overviewItem.operationId,
      browserBindingId: overviewItem.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.collection_series.overview',
      executionTarget: 'collector_work_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'collection_series_overview_ready',
      completedAt: '2026-07-26T00:00:20.000Z',
      navigation: { attempted: true, attemptCount: 1 },
      workTabAcquisition: 'created',
      workTabDisposition: 'idle_reusable',
      observation: {
        stableAccountId: '7481602',
        listVisible: true,
        items: [{
          listType: 'series',
          stableSeriesId: '100',
          title: '公开合集',
          declaredItemCount: 1,
          previewBvids: ['BV1qZSLBYEpa']
        }],
        network: {
          routeStatus: 'captured',
          httpStatus: 200,
          responseIdentityCount: 1,
          domMatchedItemCount: 1
        },
        loginOverlayVisible: false,
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      }
    };
    expect(isBilibiliPassiveExtensionWorkResultForItem(result, overviewItem)).toBe(true);
    expect(isBilibiliPassiveExtensionWorkResultForItem({
      ...result,
      observation: {
        ...result.observation!,
        network: { ...result.observation!.network, body: { unsafe: 'not-an-artifact-field' } }
      }
    }, overviewItem)).toBe(false);
  });
});
