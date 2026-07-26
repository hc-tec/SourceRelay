import { describe, expect, test } from 'vitest';
import {
  isBilibiliPassiveExtensionWorkItem,
  isBilibiliPassiveExtensionWorkResultForItem,
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

describe('passive user-owned-browser Bilibili work contract', () => {
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
});
