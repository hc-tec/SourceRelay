import { createHash } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import {
  bilibiliNativeSearchBatchCheckpointResolveInput,
  bilibiliNativeSearchBatchInput,
  bilibiliNativeSearchBatchResumeInput
} from '../src/bilibili-native-search-batch-contract.js';
import { BilibiliNativeSearchBatchHostRunner } from '../src/bilibili-native-search-batch-host-runner.js';
import type { BilibiliNativeSearchHostRunResult } from '../src/bilibili-native-search-host-runner.js';

const profileId = '11111111-1111-4111-8111-111111111111';

function pageResult(page: number, bvids: string[], terminalReason: 'search_ready' | 'search_empty' = 'search_ready'): BilibiliNativeSearchHostRunResult {
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
    resultState: bvids.length > 0 ? 'video_results' as const : 'no_video_results' as const,
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
        terminalReason
      }
    },
    artifact: {
      artifactId: `33333333-3333-4333-8333-33333333333${page}`
    }
  } as unknown as BilibiliNativeSearchHostRunResult;
}

function checkpointStore() {
  return {
    start: vi.fn(async () => undefined),
    activate: vi.fn(() => undefined),
    markPageStarted: vi.fn(async () => undefined),
    recordPage: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    get: vi.fn(() => null)
  };
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
    expect(bilibiliNativeSearchBatchResumeInput({
      profileId,
      batchId: '66666666-6666-4666-8666-666666666666',
      query: ' recoverable search '
    })).toEqual({
      profileId,
      batchId: '66666666-6666-4666-8666-666666666666',
      query: 'recoverable search'
    });
    expect(() => bilibiliNativeSearchBatchResumeInput({ profileId, batchId: 'not-a-uuid', query: 'search' }))
      .toThrow('bilibili_native_search_batch_resume_input_invalid');
    expect(bilibiliNativeSearchBatchCheckpointResolveInput({
      profileId,
      batchId: '66666666-6666-4666-8666-666666666666',
      disposition: 'abandon',
      acknowledgement: 'acknowledge_unknown_platform_action'
    })).toEqual({
      profileId,
      batchId: '66666666-6666-4666-8666-666666666666',
      disposition: 'abandon',
      acknowledgement: 'acknowledge_unknown_platform_action'
    });
    expect(() => bilibiliNativeSearchBatchCheckpointResolveInput({
      profileId,
      batchId: '66666666-6666-4666-8666-666666666666',
      disposition: 'abandon',
      acknowledgement: 'anything_else'
    })).toThrow('bilibili_native_search_batch_checkpoint_resolution_input_invalid');
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
      singleArtifacts: {} as never,
      artifacts: { record } as never,
      checkpoints: checkpointStore() as never
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

  test('stops at a real empty page and preserves an explicit empty terminal reason', async () => {
    const singleRunner = {
      run: vi.fn().mockResolvedValueOnce(pageResult(1, [], 'search_empty'))
    };
    const record = vi.fn(async () => ({
      schemaVersion: 1 as const,
      artifactId: '44444444-4444-4444-8444-444444444444',
      batchId: '55555555-5555-4555-8555-555555555555',
      platform: 'bilibili' as const,
      capturedAt: '2026-07-23T00:00:00.000Z',
      state: 'completed' as const,
      search: { resultType: 'video' as const, sort: 'newest' as const, pages: [1, 2] },
      queryDigest: 'a'.repeat(64),
      requestedPages: 2,
      capturedPages: 1,
      uniqueItems: 0,
      duplicateCount: 0,
      terminalReason: 'search_batch_empty' as const,
      manifestSha256: 'b'.repeat(64)
    }));
    const runner = new BilibiliNativeSearchBatchHostRunner({
      singleRunner: singleRunner as never,
      singleArtifacts: {} as never,
      artifacts: { record } as never,
      checkpoints: checkpointStore() as never
    });
    const result = await runner.run({
      profileId,
      query: '不存在的检索词',
      resultType: 'video',
      sort: 'newest',
      pages: [1, 2]
    });
    expect(singleRunner.run).toHaveBeenCalledOnce();
    expect(result.run.state).toBe('completed');
    expect(result.run.coverage).toMatchObject({
      requestedPages: 2,
      capturedPages: 1,
      uniqueItems: 0,
      duplicateCount: 0,
      partial: false,
      terminalReason: 'search_batch_empty'
    });
  });

  test('resume reuses completed page artifacts and dispatches only the missing page', async () => {
    const batchId = '66666666-6666-4666-8666-666666666666';
    const query = 'recoverable search';
    const queryDigest = createHash('sha256').update(query).digest('hex');
    const firstPage = pageResult(1, ['BV1qZSLBYEpa']);
    const secondPage = pageResult(2, ['BV1BoKD6ZEir']);
    const checkpoint = {
      schemaVersion: 1 as const,
      batchId,
      profileId,
      platform: 'bilibili' as const,
      search: { resultType: 'video' as const, sort: 'newest' as const, pages: [1, 2] },
      queryDigest,
      state: 'running' as const,
      terminalReason: null,
      inFlightPage: null,
      pageRuns: [{
        page: 1,
        runId: firstPage.run.runId,
        artifactId: firstPage.artifact.artifactId,
        state: 'completed' as const,
        terminalReason: 'search_ready' as const,
        capturedItems: 1,
        unresolvedCardCount: 0
      }],
      artifactId: null,
      startedAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:01.000Z'
    };
    const checkpoints = {
      start: vi.fn(async () => undefined),
      activate: vi.fn(() => undefined),
      markPageStarted: vi.fn(async () => undefined),
      recordPage: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined),
      get: vi.fn(() => checkpoint)
    };
    const singleRunner = { run: vi.fn().mockResolvedValue(secondPage) };
    const singleArtifacts = {
      get: vi.fn(async () => ({
        summary: {
          runId: firstPage.run.runId,
          artifactId: firstPage.artifact.artifactId,
          queryDigest,
          search: firstPage.run.search
        },
        results: firstPage.run.results
      }))
    };
    const record = vi.fn(async () => ({
      schemaVersion: 1 as const,
      artifactId: '77777777-7777-4777-8777-777777777777',
      batchId,
      platform: 'bilibili' as const,
      capturedAt: '2026-07-24T00:00:02.000Z',
      state: 'completed' as const,
      search: { resultType: 'video' as const, sort: 'newest' as const, pages: [1, 2] },
      queryDigest,
      requestedPages: 2,
      capturedPages: 2,
      uniqueItems: 2,
      duplicateCount: 0,
      terminalReason: 'search_batch_ready' as const,
      manifestSha256: 'b'.repeat(64)
    }));
    const runner = new BilibiliNativeSearchBatchHostRunner({
      singleRunner: singleRunner as never,
      singleArtifacts: singleArtifacts as never,
      artifacts: { record } as never,
      checkpoints: checkpoints as never
    });

    const result = await runner.resume({ profileId, batchId, query });

    expect(singleArtifacts.get).toHaveBeenCalledOnce();
    expect(singleRunner.run).toHaveBeenCalledOnce();
    expect(singleRunner.run.mock.calls[0]?.[0]).toMatchObject({ page: 2 });
    expect(checkpoints.activate).toHaveBeenCalledWith(batchId);
    expect(checkpoints.markPageStarted).toHaveBeenCalledWith(batchId, 2);
    expect(result.run.coverage).toMatchObject({ capturedPages: 2, uniqueItems: 2, terminalReason: 'search_batch_ready' });
  });

  test('never replays a page whose action was in flight when the process stopped', async () => {
    const batchId = '88888888-8888-4888-8888-888888888888';
    const checkpoints = {
      start: vi.fn(async () => undefined),
      activate: vi.fn(() => undefined),
      markPageStarted: vi.fn(async () => undefined),
      recordPage: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined),
      get: vi.fn(() => ({
        schemaVersion: 1 as const,
        batchId,
        profileId,
        platform: 'bilibili' as const,
        search: { resultType: 'video' as const, sort: 'newest' as const, pages: [1, 2] },
        queryDigest: createHash('sha256').update('recoverable search').digest('hex'),
        state: 'running' as const,
        terminalReason: null,
        inFlightPage: 2,
        pageRuns: [],
        artifactId: null,
        startedAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:01.000Z'
      }))
    };
    const singleRunner = { run: vi.fn() };
    const runner = new BilibiliNativeSearchBatchHostRunner({
      singleRunner: singleRunner as never,
      singleArtifacts: {} as never,
      artifacts: { record: vi.fn() } as never,
      checkpoints: checkpoints as never
    });

    await expect(runner.resume({ profileId, batchId, query: 'recoverable search' }))
      .rejects.toThrow('bilibili_native_search_batch_recovery_outcome_unknown');
    expect(singleRunner.run).not.toHaveBeenCalled();
  });
});
