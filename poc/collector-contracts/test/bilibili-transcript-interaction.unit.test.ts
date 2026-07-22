import {
  BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION,
  canonicalBilibiliTranscriptVideoUrl,
  isBilibiliTranscriptChineseSelectionRequest,
  type BilibiliTranscriptChineseSelectionRequest
} from '@intelligence/collector-contracts';
import { describe, expect, test } from 'vitest';

function request(
  overrides: Partial<BilibiliTranscriptChineseSelectionRequest> = {}
): BilibiliTranscriptChineseSelectionRequest {
  return {
    schemaVersion: BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION,
    profileId: '11111111-1111-4111-8111-111111111111',
    pageAlias: 'page-1',
    pageLeaseId: '22222222-2222-4222-8222-222222222222',
    runId: '33333333-3333-4333-8333-333333333333',
    expectedRecordVersion: 3,
    expectedDocumentGeneration: 2,
    actionId: 'select_chinese_caption_once',
    canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
    timeoutMs: 15_000,
    ...overrides
  };
}

describe('Bilibili transcript trusted-interaction contract', () => {
  test('accepts only a canonical video target and a bounded fixed interaction request', () => {
    expect(isBilibiliTranscriptChineseSelectionRequest(request())).toBe(true);
    expect(canonicalBilibiliTranscriptVideoUrl('https://www.bilibili.com/video/BV1qZSLBYEpa/')).toBe(
      'https://www.bilibili.com/video/BV1qZSLBYEpa'
    );
  });

  test('keeps input URLs stricter than the observed Bilibili document identity', () => {
    const observed = 'https://www.bilibili.com/video/BV1qZSLBYEpa/?vd_source=0123456789abcdef0123456789abcdef';
    expect(canonicalBilibiliTranscriptVideoUrl(observed)).toBeNull();
    expect(canonicalBilibiliTranscriptVideoUrl(observed, 'observed_document')).toBe(
      'https://www.bilibili.com/video/BV1qZSLBYEpa'
    );
    expect(canonicalBilibiliTranscriptVideoUrl(
      'https://www.bilibili.com/video/BV1qZSLBYEpa/?vd_source=0123456789abcdef0123456789abcdef&unsafe=1',
      'observed_document'
    )).toBeNull();
  });

  test('rejects arbitrary URLs, missing page generations, and unbounded timeouts before Host input', () => {
    expect(isBilibiliTranscriptChineseSelectionRequest(request({
      canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa/?unsafe=1'
    }))).toBe(false);
    expect(isBilibiliTranscriptChineseSelectionRequest(request({ expectedDocumentGeneration: 0 }))).toBe(false);
    expect(isBilibiliTranscriptChineseSelectionRequest(request({ timeoutMs: 15_001 }))).toBe(false);
  });
});
