import { describe, expect, test } from 'vitest';
import { evaluateBilibiliGateRisk } from '../src/background/strategies/bilibili-gate-risk.js';

describe('Bilibili gate-surface risk classification', () => {
  test('does not stop a healthy page whose gate surfaces contain content vocabulary', () => {
    // Field failure (2026-09-07): a video with title, player, description and
    // seven tags captured, then stopped as rate_limited because unrelated
    // page text (recommendations/comments) matched the old full-body scan.
    // With gate-scoped collection plus the content veto, throttle vocabulary
    // that only appears alongside rendered content cannot stop the run.
    const gateNoise = [
      '做风控的兄弟们看这个视频',
      '评论区：稍后再试一下',
      '网络错误的兄弟重新进一下'
    ].join('\n');
    expect(evaluateBilibiliGateRisk({ gateText: gateNoise, hasPrimaryContent: true }))
      .toEqual({ verificationRequired: false, rateLimited: false, sourceUnavailable: false });
  });

  test('stops only when the gate vocabulary appears in a gate surface', () => {
    expect(evaluateBilibiliGateRisk({
      gateText: '请求过于频繁，请稍后再试',
      hasPrimaryContent: false
    })).toEqual({ verificationRequired: false, rateLimited: true, sourceUnavailable: false });
    expect(evaluateBilibiliGateRisk({
      gateText: '安全验证\n请完成验证后继续访问',
      hasPrimaryContent: false
    })).toEqual({ verificationRequired: true, rateLimited: false, sourceUnavailable: false });
    expect(evaluateBilibiliGateRisk({
      gateText: '页面不存在',
      hasPrimaryContent: false
    })).toEqual({ verificationRequired: false, rateLimited: false, sourceUnavailable: true });
  });

  test('a rendered primary content surface vetoes throttle and unavailable classes', () => {
    // A search page with rendered cards, or a video page with a visible
    // player, is healthy even when a stray toast/banner matches the
    // vocabulary: the capture should proceed and let postconditions judge.
    expect(evaluateBilibiliGateRisk({
      gateText: '网络错误，请稍后再试',
      hasPrimaryContent: true
    })).toEqual({ verificationRequired: false, rateLimited: false, sourceUnavailable: false });
  });

  test('verification is not vetoed by rendered content', () => {
    expect(evaluateBilibiliGateRisk({
      gateText: '异常访问，请进行验证',
      hasPrimaryContent: true
    })).toEqual({ verificationRequired: true, rateLimited: false, sourceUnavailable: false });
  });

  test('tolerates empty or non-string gate text', () => {
    expect(evaluateBilibiliGateRisk({ gateText: '', hasPrimaryContent: false }))
      .toEqual({ verificationRequired: false, rateLimited: false, sourceUnavailable: false });
    expect(evaluateBilibiliGateRisk({ gateText: undefined as unknown as string, hasPrimaryContent: false }))
      .toEqual({ verificationRequired: false, rateLimited: false, sourceUnavailable: false });
  });
});
