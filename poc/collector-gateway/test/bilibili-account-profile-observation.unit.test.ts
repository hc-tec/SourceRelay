import { describe, expect, test } from 'vitest';
import { BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID } from '@intelligence/collector-contracts';
import { bilibiliAccountProfileStrategyObservation } from '../src/bilibili-account-profile-observation';

describe('Bilibili account profile observation', () => {
  test('accepts statistics fields without an optional navigation href', () => {
    const result = bilibiliAccountProfileStrategyObservation({
      schemaVersion: 1,
      type: 'collector_strategy_observation',
      strategyId: BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID,
      observerBindingId: 'observer-binding-id-123',
      pageAlias: 'page-1',
      documentGeneration: 1,
      routeGeneration: 0,
      capturedAt: '2026-07-23T00:00:00.000Z',
      payloadBytes: 1_000,
      payload: {
        schemaVersion: 1,
        strategyId: BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID,
        stableAccountId: '7481602',
        documentId: 'document-id-123',
        dom: {
          stableAccountId: '7481602',
          displayName: '安州牧',
          visibleDescription: null,
          avatarUrl: null,
          bannerUrl: null,
          textBadges: [],
          imageBadges: [],
          statistics: [{ label: '粉丝数', value: '254.5万' }],
          navigation: [{
            label: '动态',
            value: null,
            href: 'https://space.bilibili.com/7481602/dynamic'
          }],
          announcementText: null,
          chargeText: null,
          highlights: [],
          profileHeaderVisible: true,
          loginOverlayVisible: false,
          risk: {
            verificationRequired: false,
            rateLimited: false,
            sourceUnavailable: false
          }
        }
      }
    });

    expect(result.dom.statistics).toEqual([{ label: '粉丝数', value: '254.5万' }]);
    expect(result.dom.navigation[0]).toEqual({
      label: '动态',
      value: null,
      href: 'https://space.bilibili.com/7481602/dynamic'
    });
  });
});
