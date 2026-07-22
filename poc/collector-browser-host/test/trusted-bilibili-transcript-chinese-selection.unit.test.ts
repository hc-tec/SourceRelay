import {
  BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION,
  type BilibiliTranscriptChineseSelectionRequest
} from '@intelligence/collector-contracts';
import { describe, expect, test } from 'vitest';
import { validateTrustedBilibiliTranscriptChineseSelectionRequest } from '../src/page-ledger/trusted-bilibili-transcript-chinese-selection.js';

function request(
  overrides: Partial<BilibiliTranscriptChineseSelectionRequest> = {}
): BilibiliTranscriptChineseSelectionRequest {
  return {
    schemaVersion: BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION,
    profileId: '11111111-1111-4111-8111-111111111111',
    pageAlias: 'managed-page-1',
    pageLeaseId: '22222222-2222-4222-8222-222222222222',
    runId: '33333333-3333-4333-8333-333333333333',
    expectedRecordVersion: 5,
    expectedDocumentGeneration: 2,
    actionId: 'select_chinese_caption_once',
    canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
    timeoutMs: 5_000,
    ...overrides
  };
}

describe('Trusted Bilibili Chinese-caption selection', () => {
  test('admits the fixed source-specific contract before any browser input', () => {
    expect(() => validateTrustedBilibiliTranscriptChineseSelectionRequest(request())).not.toThrow();
  });

  test('rejects malformed action envelopes before selector discovery or mouse input', () => {
    expect(() => validateTrustedBilibiliTranscriptChineseSelectionRequest(request({ timeoutMs: 999 }))).toThrow(
      'bilibili_transcript_selection_schema_invalid'
    );
    expect(() => validateTrustedBilibiliTranscriptChineseSelectionRequest(request({
      canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa/?unexpected=1'
    }))).toThrow('bilibili_transcript_selection_schema_invalid');
  });
});
