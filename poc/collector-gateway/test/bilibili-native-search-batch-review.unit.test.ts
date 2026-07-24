import { describe, expect, test } from 'vitest';
import type { BilibiliNativeSearchBatchCoverageArtifactView } from '../src/bilibili-native-search-batch-coverage.js';
import { reviewBilibiliNativeSearchBatchCoverage } from '../src/bilibili-native-search-batch-review.js';

function artifact(input: {
  sampleCount: number;
  pairCount: number;
  meanDriftRate: number;
  meanJaccardRate: number;
  pairDrifts: number[];
}): BilibiliNativeSearchBatchCoverageArtifactView {
  return {
    summary: {
      schemaVersion: 1,
      coverageId: '11111111-1111-4111-8111-111111111111',
      platform: 'bilibili',
      capturedAt: '2026-07-24T00:00:00.000Z',
      queryDigest: 'a'.repeat(64),
      search: { resultType: 'video', sort: 'newest', pages: [1, 2] },
      sampleArtifactIds: [],
      sampleCount: input.sampleCount,
      attemptedArtifactIds: [],
      attemptedCount: input.sampleCount,
      excludedArtifactIds: [],
      excludedCount: 0,
      pairCount: input.pairCount,
      meanOverlapRate: 1 - input.meanDriftRate,
      meanJaccardRate: input.meanJaccardRate,
      meanDriftRate: input.meanDriftRate,
      manifestSha256: 'b'.repeat(64)
    },
    manifest: {
      schemaVersion: 1,
      coverageId: '11111111-1111-4111-8111-111111111111',
      platform: 'bilibili',
      capturedAt: '2026-07-24T00:00:00.000Z',
      queryDigest: 'a'.repeat(64),
      search: { resultType: 'video', sort: 'newest', pages: [1, 2] },
      sampleArtifactIds: [],
      sampleCount: input.sampleCount,
      attemptedArtifactIds: [],
      attemptedCount: input.sampleCount,
      excludedArtifactIds: [],
      excludedCount: 0,
      excludedArtifacts: [],
      pairCount: input.pairCount,
      pairwise: input.pairDrifts.map((driftRate, index) => ({
        leftArtifactId: '22222222-2222-4222-8222-222222222222',
        rightArtifactId: '33333333-3333-4333-8333-333333333333',
        leftCapturedAt: '2026-07-24T00:00:00.000Z',
        rightCapturedAt: `2026-07-24T0${index + 1}:00:00.000Z`,
        leftUniqueItems: 40,
        rightUniqueItems: 40,
        intersectionCount: Math.round(40 * (1 - driftRate)),
        unionCount: 40,
        symmetricDifferenceCount: Math.round(40 * driftRate),
        overlapRate: 1 - driftRate,
        jaccardRate: 1 - driftRate,
        driftRate
      })),
      aggregate: {
        minOverlapRate: 1 - input.meanDriftRate,
        maxOverlapRate: 1 - input.meanDriftRate,
        meanOverlapRate: 1 - input.meanDriftRate,
        minJaccardRate: input.meanJaccardRate,
        maxJaccardRate: input.meanJaccardRate,
        meanJaccardRate: input.meanJaccardRate,
        meanDriftRate: input.meanDriftRate
      },
      safeguards: {
        source: 'completed_bilibili_native_search_batch_artifacts',
        query: 'sha256_only',
        rawBvids: 'not_persisted_in_coverage_artifact',
        sampleBudget: 5,
        comparison: 'set_intersection_and_jaccard_over_stable_bvids',
        attemptLedger: 'explicit_attempted_artifact_ids'
      }
    }
  };
}

describe('Bilibili native-search batch machine review', () => {
  test('blocks the current two-sample drift result and names every blocking reason', () => {
    const result = reviewBilibiliNativeSearchBatchCoverage(artifact({
      sampleCount: 2,
      pairCount: 1,
      meanDriftRate: 1,
      meanJaccardRate: 0,
      pairDrifts: [1]
    }));
    expect(result).toMatchObject({
      reviewKind: 'machine_precheck',
      decision: 'blocked',
      independentReviewRequired: true,
      reasonCodes: [
        'coverage_sample_count_below_minimum',
        'coverage_pair_count_below_minimum',
        'mean_drift_above_threshold',
        'pair_drift_above_threshold',
        'mean_jaccard_below_threshold',
        'independent_review_required'
      ]
    });
  });

  test('only produces an independent-review candidate after statistical checks pass', () => {
    const result = reviewBilibiliNativeSearchBatchCoverage(artifact({
      sampleCount: 3,
      pairCount: 3,
      meanDriftRate: 0.1,
      meanJaccardRate: 0.9,
      pairDrifts: [0.1, 0.2, 0.0]
    }));
    expect(result.decision).toBe('candidate_for_independent_review');
    expect(result.independentReviewRequired).toBe(true);
    expect(result.reasonCodes).toEqual(['independent_review_required']);
    expect(result).not.toHaveProperty('admission');
  });
});
