import { describe, expect, test, vi } from 'vitest';
import {
  bilibiliNativeSearchBatchInput
} from '../src/bilibili-native-search-batch-contract.js';
import { BilibiliNativeSearchBatchHostRunner } from '../src/bilibili-native-search-batch-host-runner.js';
import type { BilibiliNativeSearchHostRunResult } from '../src/bilibili-native-search-host-runner.js';

const profileId = '11111111-1111-4111-8111-111111111111';

function pageResult(page: number, bvids: string[]): BilibiliNativeSearchHostRunResult {
  const items = bvids.map((bvid, index) => ({
    rank: index + 1,
    bvid,
    canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
    title: `搜索结果 ${bvid}`,
    visibleText: `搜索结果 ${bvid}`,
    thumbnailUrl: null
  }));
  const projection = {
    schemaVersion: 1 as const,
    resultType: 'video' as const,
    sort: 'newest' as const,
    page,
    resultState: 'video_results' as const,
    items,
    semanticResultCardCount: items.length,
    visibleVideoCardCount: items.length,
    unresolvedCardCount: 0,
    loginOverlayVisible: false,
    risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false },
    capturedAt: '2026-07-23T00:00:00.000Z'
  };
  return {
    run: {
      runId: `22222222-2222-4222-8222-22222222222${page}`,
      search: { resultType: 'video', sort: 'newest', page },
      state: 'completed',
      errorCode: null,
      results: projection,
      coverage: {
        capturedItems: items.length,
        unresolvedCardCount: 0,
        terminalReason: 'search_ready'
      }
    },
    artifact: {
      artifactId: `33333333-3333-4333-8333-33333333333${page}`
    }
  } as unknown as BilibiliNativeSearchHostRunResult;
}

describe('Bilibili native-search batch contract', () => {
  test('normalizes a bounded ordered page list and rejects unsafe variants', () => {
    expect(bilibiliNativeSearchBatchInput({
      profileId,
      query: ' 人工智能 ',
      resultType: 'video',
      sort: 'newest',
      pages: [2, 1]
    })).toEqual({
      profileId,
      query: '人工智能',
      resultType: 'video',
      sort: 'newest',
      pages: [1, 2]
    });
    expect(() => bilibiliNativeSearchBatchInput({ profileId, query: '人工智能', pages: [1, 1] }))
      .toThrow('bilibili_native_search_batch_input_invalid');
    expect(() => bilibiliNativeSearchBatchInput({ profileId, query: '人工智能', pages: [1, 2, 3] }))
      .toThrow('bilibili_native_search_batch_input_invalid');
    expect(() => bilibiliNativeSearchBatchInput({
      profileId, query: '人工智能', resultType: 'comprehensive', sort: 'newest', pages: [1, 2]
    })).toThrow('bilibili_native_search_input_invalid');
  });

  test('runs pages sequentially and records overlap as a partial batch', async () => {
    const singleRunner = {
      run: vi.fn()
        .mockResolvedValueOnce(pageResult(1, ['BV1qZSLBYEpa', 'BV1xx411c7mD']))
        .mockResolvedValueOnce(pageResult(2, ['BV1xx411c7mD', 'BV1BoKD6ZEir']))
    };
    const record = vi.fn(async () => ({
      schemaVersion: 1 as const,
      artifactId: '44444444-4444-4444-8444-444444444444',
      batchId: '55555555-5555-4555-8555-555555555555',
      platform: 'bilibili' as const,
      capturedAt: '2026-07-23T00:00:00.000Z',
      state: 'partial' as const,
      search: { resultType: 'video' as const, sort: 'newest' as const, pages: [1, 2] },
      queryDigest: 'a'.repeat(64),
      requestedPages: 2,
      capturedPages: 2,
      uniqueItems: 3,
      duplicateCount: 1,
      terminalReason: 'search_batch_duplicates' as const,
      manifestSha256: 'b'.repeat(64)
    }));
    const runner = new BilibiliNativeSearchBatchHostRunner({
      singleRunner: singleRunner as never,
      artifacts: { record } as never
    });
    const result = await runner.run({
      profileId,
      query: '人工智能',
      resultType: 'video',
      sort: 'newest',
      pages: [1, 2]
    });
    expect(singleRunner.run).toHaveBeenCalledTimes(2);
    expect(singleRunner.run.mock.calls.map(([input]) => input.page)).toEqual([1, 2]);
    expect(result.run.state).toBe('partial');
    expect(result.run.coverage).toMatchObject({
      requestedPages: 2,
      capturedPages: 2,
      uniqueItems: 3,
      duplicateBvids: ['BV1xx411c7mD'],
      duplicateCount: 1,
      terminalReason: 'search_batch_duplicates'
    });
    expect(record).toHaveBeenCalledOnce();
  });
});
