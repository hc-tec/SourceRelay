import type {
  BilibiliNativeSearchBatchCoverageArtifactView,
  BilibiliNativeSearchBatchCoveragePair
} from './bilibili-native-search-batch-coverage';

export const BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY_VERSION = '0.1.0' as const;

export const BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY = {
  minimumSampleCount: 3,
  minimumPairCount: 3,
  maximumMeanDriftRate: 0.25,
  maximumPairDriftRate: 0.5,
  minimumMeanJaccardRate: 0.75
} as const;

export type BilibiliNativeSearchBatchReviewDecision =
  | 'blocked'
  | 'candidate_for_independent_review';

export interface BilibiliNativeSearchBatchReviewResult {
  schemaVersion: 1;
  reviewKind: 'machine_precheck';
  policyVersion: typeof BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY_VERSION;
  coverageId: string;
  queryDigest: string;
  decision: BilibiliNativeSearchBatchReviewDecision;
  independentReviewRequired: true;
  reasonCodes: Array<
    | 'coverage_sample_count_below_minimum'
    | 'coverage_pair_count_below_minimum'
    | 'mean_drift_above_threshold'
    | 'pair_drift_above_threshold'
    | 'mean_jaccard_below_threshold'
    | 'independent_review_required'
  >;
  policy: typeof BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY;
  checks: {
    sampleCount: { observed: number; minimum: number; passed: boolean };
    pairCount: { observed: number; minimum: number; passed: boolean };
    meanDriftRate: { observed: number; maximum: number; passed: boolean };
    maximumPairDriftRate: { observed: number; maximum: number; passed: boolean };
    meanJaccardRate: { observed: number; minimum: number; passed: boolean };
  };
}

function maximumPairDrift(pairwise: readonly BilibiliNativeSearchBatchCoveragePair[]): number {
  return Math.max(...pairwise.map((pair) => pair.driftRate));
}

export function reviewBilibiliNativeSearchBatchCoverage(
  artifact: BilibiliNativeSearchBatchCoverageArtifactView
): BilibiliNativeSearchBatchReviewResult {
  const sampleCount = artifact.summary.sampleCount;
  const pairCount = artifact.summary.pairCount;
  const meanDriftRate = artifact.summary.meanDriftRate;
  const meanJaccardRate = artifact.summary.meanJaccardRate;
  const maximumPairDriftRate = maximumPairDrift(artifact.manifest.pairwise);
  const checks = {
    sampleCount: {
      observed: sampleCount,
      minimum: BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY.minimumSampleCount,
      passed: sampleCount >= BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY.minimumSampleCount
    },
    pairCount: {
      observed: pairCount,
      minimum: BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY.minimumPairCount,
      passed: pairCount >= BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY.minimumPairCount
    },
    meanDriftRate: {
      observed: meanDriftRate,
      maximum: BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY.maximumMeanDriftRate,
      passed: meanDriftRate <= BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY.maximumMeanDriftRate
    },
    maximumPairDriftRate: {
      observed: maximumPairDriftRate,
      maximum: BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY.maximumPairDriftRate,
      passed: maximumPairDriftRate <= BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY.maximumPairDriftRate
    },
    meanJaccardRate: {
      observed: meanJaccardRate,
      minimum: BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY.minimumMeanJaccardRate,
      passed: meanJaccardRate >= BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY.minimumMeanJaccardRate
    }
  };
  const reasonCodes: BilibiliNativeSearchBatchReviewResult['reasonCodes'] = [];
  if (!checks.sampleCount.passed) reasonCodes.push('coverage_sample_count_below_minimum');
  if (!checks.pairCount.passed) reasonCodes.push('coverage_pair_count_below_minimum');
  if (!checks.meanDriftRate.passed) reasonCodes.push('mean_drift_above_threshold');
  if (!checks.maximumPairDriftRate.passed) reasonCodes.push('pair_drift_above_threshold');
  if (!checks.meanJaccardRate.passed) reasonCodes.push('mean_jaccard_below_threshold');
  reasonCodes.push('independent_review_required');
  const statisticalChecksPassed = checks.sampleCount.passed && checks.pairCount.passed &&
    checks.meanDriftRate.passed && checks.maximumPairDriftRate.passed && checks.meanJaccardRate.passed;
  return {
    schemaVersion: 1,
    reviewKind: 'machine_precheck',
    policyVersion: BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY_VERSION,
    coverageId: artifact.summary.coverageId,
    queryDigest: artifact.summary.queryDigest,
    decision: statisticalChecksPassed ? 'candidate_for_independent_review' : 'blocked',
    independentReviewRequired: true,
    reasonCodes,
    policy: BILIBILI_NATIVE_SEARCH_BATCH_REVIEW_POLICY,
    checks
  };
}
