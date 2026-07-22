import { describe, expect, test } from 'vitest';
import type { StrategyObservationResult } from '@intelligence/collector-contracts';
import {
  projectBilibiliVideoDetailDom,
  type BilibiliVideoDetailDomSnapshot
} from '../src/bilibili-video-detail-contract.js';
import { bilibiliVideoDetailStrategyObservation } from '../src/bilibili-video-detail-observation.js';

const bvid = 'BV1BoKD6ZEir';
const capturedAt = '2026-07-22T07:40:00.000Z';

function dom(overrides: Partial<BilibiliVideoDetailDomSnapshot> = {}): BilibiliVideoDetailDomSnapshot {
  return {
    bvid,
    title: '受限访问状态测试视频',
    metadataVisibleText: '公开可见元数据',
    description: null,
    creator: { displayName: '公开创作者', publicAccountId: '7481602' },
    tagTexts: ['历史'],
    episodeSummaryText: null,
    titleVisible: true,
    playerVisible: true,
    playerControlsVisible: true,
    chargeExclusiveTrialVisible: false,
    loginOverlayVisible: false,
    risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false },
    ...overrides
  };
}

function observation(domValue: unknown): StrategyObservationResult {
  return {
    schemaVersion: 1 as const,
    type: 'collector_strategy_observation' as const,
    strategyId: 'bilibili.video.detail.dom.v2' as const,
    observerBindingId: '11111111-1111-4111-8111-111111111111',
    pageAlias: 'page-1',
    documentGeneration: 1,
    routeGeneration: 0,
    capturedAt,
    payloadBytes: 1_024,
    payload: {
      schemaVersion: 1,
      strategyId: 'bilibili.video.detail.dom.v2',
      bvid,
      documentId: 'document-1',
      dom: domValue
    } as unknown as StrategyObservationResult['payload']
  };
}

describe('Bilibili video-detail access-status contract', () => {
  test('keeps an unmarked visible player indeterminate rather than claiming public playback', () => {
    const detail = projectBilibiliVideoDetailDom(dom(), bvid, capturedAt);

    expect(detail).toMatchObject({
      schemaVersion: 2,
      playerVisible: true,
      accessStatus: 'indeterminate'
    });
  });

  test('refuses to project a title plus a pre-hydration player shell', () => {
    expect(projectBilibiliVideoDetailDom(dom({ playerControlsVisible: false }), bvid, capturedAt)).toBeNull();
  });

  test('projects the positively observed charge-trial gate and does not let a player shell hide it', () => {
    const chargeTrial = projectBilibiliVideoDetailDom(dom({ chargeExclusiveTrialVisible: true }), bvid, capturedAt);
    const loginGate = projectBilibiliVideoDetailDom(
      dom({ chargeExclusiveTrialVisible: true, loginOverlayVisible: true }),
      bvid,
      capturedAt
    );

    expect(chargeTrial?.accessStatus).toBe('charge_exclusive_trial');
    expect(loginGate?.accessStatus).toBe('login_required');
  });

  test('rejects an untrusted bridge observation that omits the required access-gate boolean', () => {
    const invalid = { ...dom() } as Record<string, unknown>;
    delete invalid.chargeExclusiveTrialVisible;

    expect(() => bilibiliVideoDetailStrategyObservation(observation(invalid), bvid))
      .toThrow('video_detail_observation_dom_invalid');
  });
});
