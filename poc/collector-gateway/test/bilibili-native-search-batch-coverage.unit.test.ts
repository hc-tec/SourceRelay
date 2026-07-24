import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type {
  BilibiliNativeSearchBatchArtifactSummary,
  BilibiliNativeSearchBatchArtifactView
} from '../src/bilibili-native-search-batch-artifacts.js';
import {
  bilibiliNativeSearchBatchCoverageInput,
  computeBilibiliNativeSearchBatchCoverage
} from '../src/bilibili-native-search-batch-coverage.js';
import { BilibiliNativeSearchBatchCoverageArtifactStore } from '../src/bilibili-native-search-batch-coverage-artifacts.js';

const queryDigest = 'a'.repeat(64);
const search = { resultType: 'video' as const, sort: 'newest' as const, pages: [1, 2] };

function view(
  artifactId: string,
  capturedAt: string,
  bvids: string[],
  overrides: Partial<BilibiliNativeSearchBatchArtifactSummary> = {}
): BilibiliNativeSearchBatchArtifactView {
  const mergedItems = bvids.map((bvid, index) => ({
    rank: index + 1,
    bvid,
    canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
    title: `标题 ${bvid}`,
    visibleText: `标题 ${bvid}`,
    thumbnailUrl: null
  }));
  const summary: BilibiliNativeSearchBatchArtifactSummary = {
    schemaVersion: 1,
    artifactId,
    batchId: `bbbbbbb${artifactId.slice(1)}`.slice(0, 36),
    platform: 'bilibili',
    capturedAt,
    state: 'completed',
    search,
    queryDigest,
    requestedPages: 2,
    capturedPages: 2,
    uniqueItems: bvids.length,
    duplicateCount: 0,
    terminalReason: 'search_batch_ready',
    manifestSha256: 'b'.repeat(64),
    ...overrides
  };
  return {
    summary,
    manifest: {} as BilibiliNativeSearchBatchArtifactView['manifest'],
    mergedItems
  };
}

describe('Bilibili native-search batch coverage', () => {
  test('computes bounded pairwise overlap and drift without persisting raw BVIDs', async () => {
    const first = view(
      '11111111-1111-4111-8111-111111111111',
      '2026-07-24T00:00:00.000Z',
      ['BV1qZSLBYEpa', 'BV1BoKD6ZEir', 'BV1xx411c7mD']
    );
    const second = view(
      '22222222-2222-4222-8222-222222222222',
      '2026-07-24T01:00:00.000Z',
      ['BV1BoKD6ZEir', 'BV1xx411c7mD', 'BV1J4gb6CExC']
    );
    const computation = computeBilibiliNativeSearchBatchCoverage(
      [first, second],
      '2026-07-24T02:00:00.000Z'
    );
    expect(computation).toMatchObject({
      queryDigest,
      sampleCount: 2,
      pairCount: 1,
      aggregate: {
        meanOverlapRate: 2 / 3,
        meanJaccardRate: 1 / 2,
        meanDriftRate: 1 / 2
      },
      safeguards: { rawBvids: 'not_persisted_in_coverage_artifact' }
    });
    expect(computation.pairwise[0]).toMatchObject({
      intersectionCount: 2,
      unionCount: 4,
      symmetricDifferenceCount: 2,
      overlapRate: 2 / 3,
      jaccardRate: 1 / 2,
      driftRate: 1 / 2
    });

    const directory = await mkdtemp(join(tmpdir(), 'bilibili-native-search-coverage-'));
    try {
      const store = await BilibiliNativeSearchBatchCoverageArtifactStore.create(directory);
      const summary = await store.record(computation);
      const persisted = await store.get(summary.coverageId);
      expect(persisted?.manifest.pairwise[0]?.intersectionCount).toBe(2);
      const manifestText = await readFile(join(directory, 'bilibili-native-search-batch-coverages', summary.coverageId, 'manifest.json'), 'utf8');
      expect(manifestText).not.toContain('BV1qZSLBYEpa');
      expect((await BilibiliNativeSearchBatchCoverageArtifactStore.create(directory)).list()).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('requires the same complete search window and query digest', () => {
    const first = view(
      '33333333-3333-4333-8333-333333333333',
      '2026-07-24T00:00:00.000Z',
      ['BV1qZSLBYEpa']
    );
    const differentQuery = view(
      '44444444-4444-4444-8444-444444444444',
      '2026-07-24T01:00:00.000Z',
      ['BV1BoKD6ZEir'],
      { queryDigest: 'c'.repeat(64) }
    );
    expect(() => computeBilibiliNativeSearchBatchCoverage([first, differentQuery]))
      .toThrow('bilibili_native_search_batch_coverage_sample_ineligible');
    expect(() => computeBilibiliNativeSearchBatchCoverage([
      first,
      view('55555555-5555-4555-8555-555555555555', '2026-07-24T01:00:00.000Z', ['BV1BoKD6ZEir'], {
        capturedPages: 1
      })
    ])).toThrow('bilibili_native_search_batch_coverage_sample_ineligible');
  });

  test('bounds and validates coverage input', () => {
    expect(bilibiliNativeSearchBatchCoverageInput({
      artifactIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222'
      ]
    })).toEqual({
      artifactIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222'
      ]
    });
    expect(() => bilibiliNativeSearchBatchCoverageInput({
      artifactIds: ['11111111-1111-4111-8111-111111111111']
    })).toThrow('bilibili_native_search_batch_coverage_input_invalid');
    expect(() => bilibiliNativeSearchBatchCoverageInput({
      artifactIds: [
        '11111111-1111-4111-8111-111111111111',
        '11111111-1111-4111-8111-111111111111'
      ]
    })).toThrow('bilibili_native_search_batch_coverage_input_invalid');
  });
});
