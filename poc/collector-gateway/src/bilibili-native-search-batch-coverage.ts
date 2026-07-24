import type {
  BilibiliNativeSearchBatchArtifactSummary,
  BilibiliNativeSearchBatchArtifactView
} from './bilibili-native-search-batch-artifacts';
import type { BilibiliNativeSearchBatchRunRecord } from './bilibili-native-search-batch-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
export const BILIBILI_NATIVE_SEARCH_BATCH_COVERAGE_MAX_SAMPLES = 5 as const;
export const BILIBILI_NATIVE_SEARCH_BATCH_COVERAGE_MAX_ATTEMPTS = 10 as const;

export interface BilibiliNativeSearchBatchCoverageInput {
  artifactIds: string[];
  attemptedArtifactIds: string[];
}

export interface BilibiliNativeSearchBatchCoveragePair {
  leftArtifactId: string;
  rightArtifactId: string;
  leftCapturedAt: string;
  rightCapturedAt: string;
  leftUniqueItems: number;
  rightUniqueItems: number;
  intersectionCount: number;
  unionCount: number;
  symmetricDifferenceCount: number;
  overlapRate: number;
  jaccardRate: number;
  driftRate: number;
}

export interface BilibiliNativeSearchBatchCoverageComputation {
  schemaVersion: 1;
  platform: 'bilibili';
  capturedAt: string;
  queryDigest: string;
  search: BilibiliNativeSearchBatchRunRecord['search'];
  sampleArtifactIds: string[];
  sampleCount: number;
  attemptedArtifactIds: string[];
  attemptedCount: number;
  excludedArtifactIds: string[];
  excludedCount: number;
  excludedArtifacts: Array<{
    artifactId: string;
    capturedAt: string;
    state: BilibiliNativeSearchBatchArtifactSummary['state'];
    terminalReason: BilibiliNativeSearchBatchArtifactSummary['terminalReason'];
    capturedPages: number;
    uniqueItems: number;
  }>;
  pairCount: number;
  pairwise: BilibiliNativeSearchBatchCoveragePair[];
  aggregate: {
    minOverlapRate: number;
    maxOverlapRate: number;
    meanOverlapRate: number;
    minJaccardRate: number;
    maxJaccardRate: number;
    meanJaccardRate: number;
    meanDriftRate: number;
  };
  safeguards: {
    source: 'completed_bilibili_native_search_batch_artifacts';
    query: 'sha256_only';
    rawBvids: 'not_persisted_in_coverage_artifact';
    sampleBudget: 5;
    comparison: 'set_intersection_and_jaccard_over_stable_bvids';
    attemptLedger: 'explicit_attempted_artifact_ids';
  };
}

export interface BilibiliNativeSearchBatchCoverageArtifactSummary {
  schemaVersion: 1;
  coverageId: string;
  platform: 'bilibili';
  capturedAt: string;
  queryDigest: string;
  search: BilibiliNativeSearchBatchRunRecord['search'];
  sampleArtifactIds: string[];
  sampleCount: number;
  attemptedArtifactIds?: string[];
  attemptedCount?: number;
  excludedArtifactIds?: string[];
  excludedCount?: number;
  pairCount: number;
  meanOverlapRate: number;
  meanJaccardRate: number;
  meanDriftRate: number;
  manifestSha256: string;
}

export interface BilibiliNativeSearchBatchCoverageArtifactManifest
  extends BilibiliNativeSearchBatchCoverageComputation {
  coverageId: string;
}

export interface BilibiliNativeSearchBatchCoverageArtifactView {
  summary: BilibiliNativeSearchBatchCoverageArtifactSummary;
  manifest: BilibiliNativeSearchBatchCoverageArtifactManifest;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sameSearch(
  left: BilibiliNativeSearchBatchRunRecord['search'],
  right: BilibiliNativeSearchBatchRunRecord['search']
): boolean {
  return left.resultType === right.resultType && left.sort === right.sort &&
    left.pages.length === right.pages.length && left.pages.every((page, index) => page === right.pages[index]);
}

function stableBvids(view: BilibiliNativeSearchBatchArtifactView): Set<string> {
  const bvids = view.mergedItems.map((item) => item.bvid);
  if (bvids.some((bvid) => !BVID_PATTERN.test(bvid))) {
    throw new Error('bilibili_native_search_batch_coverage_bvid_invalid');
  }
  const unique = new Set(bvids);
  if (unique.size !== view.summary.uniqueItems || unique.size !== bvids.length) {
    throw new Error('bilibili_native_search_batch_coverage_artifact_inconsistent');
  }
  return unique;
}

function eligibleSummary(summary: BilibiliNativeSearchBatchArtifactSummary): boolean {
  return summary.state === 'completed' && summary.terminalReason === 'search_batch_ready' &&
    summary.requestedPages === summary.capturedPages && summary.uniqueItems > 0 && summary.duplicateCount === 0;
}

export function bilibiliNativeSearchBatchCoverageInput(value: unknown): BilibiliNativeSearchBatchCoverageInput {
  const candidate = record(value);
  if (!candidate || Object.keys(candidate).some((key) => !['artifactIds', 'attemptedArtifactIds'].includes(key)) ||
    !Array.isArray(candidate.artifactIds) ||
    candidate.artifactIds.length < 2 || candidate.artifactIds.length > BILIBILI_NATIVE_SEARCH_BATCH_COVERAGE_MAX_SAMPLES ||
    candidate.artifactIds.some((artifactId) => typeof artifactId !== 'string' || !UUID_PATTERN.test(artifactId))) {
    throw new Error('bilibili_native_search_batch_coverage_input_invalid');
  }
  const artifactIds = candidate.artifactIds as string[];
  if (new Set(artifactIds).size !== artifactIds.length) {
    throw new Error('bilibili_native_search_batch_coverage_input_invalid');
  }
  const attemptedArtifactIds = candidate.attemptedArtifactIds === undefined
    ? artifactIds
    : candidate.attemptedArtifactIds;
  if (!Array.isArray(attemptedArtifactIds) || attemptedArtifactIds.length < artifactIds.length ||
    attemptedArtifactIds.length > BILIBILI_NATIVE_SEARCH_BATCH_COVERAGE_MAX_ATTEMPTS ||
    attemptedArtifactIds.some((artifactId) => typeof artifactId !== 'string' || !UUID_PATTERN.test(artifactId)) ||
    new Set(attemptedArtifactIds).size !== attemptedArtifactIds.length ||
    artifactIds.some((artifactId) => !attemptedArtifactIds.includes(artifactId))) {
    throw new Error('bilibili_native_search_batch_coverage_input_invalid');
  }
  return { artifactIds: [...artifactIds], attemptedArtifactIds: [...attemptedArtifactIds] };
}

export function computeBilibiliNativeSearchBatchCoverage(
  views: readonly BilibiliNativeSearchBatchArtifactView[],
  capturedAt = new Date().toISOString(),
  attemptedViews: readonly BilibiliNativeSearchBatchArtifactView[] = views
): BilibiliNativeSearchBatchCoverageComputation {
  if (views.length < 2 || views.length > BILIBILI_NATIVE_SEARCH_BATCH_COVERAGE_MAX_SAMPLES) {
    throw new Error('bilibili_native_search_batch_coverage_sample_count_invalid');
  }
  if (attemptedViews.length < views.length || attemptedViews.length > BILIBILI_NATIVE_SEARCH_BATCH_COVERAGE_MAX_ATTEMPTS) {
    throw new Error('bilibili_native_search_batch_coverage_attempt_count_invalid');
  }
  const attemptIds = attemptedViews.map((view) => view.summary.artifactId);
  const sampleIds = views.map((view) => view.summary.artifactId);
  if (new Set(attemptIds).size !== attemptIds.length || new Set(sampleIds).size !== sampleIds.length ||
    sampleIds.some((artifactId) => !attemptIds.includes(artifactId))) {
    throw new Error('bilibili_native_search_batch_coverage_attempt_ledger_invalid');
  }
  const ordered = [...views].sort((left, right) => Date.parse(left.summary.capturedAt) - Date.parse(right.summary.capturedAt));
  const orderedAttempts = [...attemptedViews].sort((left, right) => Date.parse(left.summary.capturedAt) - Date.parse(right.summary.capturedAt));
  const first = ordered[0]!.summary;
  if (!SHA256_PATTERN.test(first.queryDigest) || !orderedAttempts.every((view) =>
    UUID_PATTERN.test(view.summary.artifactId) &&
    view.summary.queryDigest === first.queryDigest &&
    sameSearch(view.summary.search, first.search)
  ) || !ordered.every((view) =>
    UUID_PATTERN.test(view.summary.artifactId) &&
    view.summary.queryDigest === first.queryDigest &&
    sameSearch(view.summary.search, first.search) &&
    eligibleSummary(view.summary)
  )) {
    throw new Error('bilibili_native_search_batch_coverage_sample_ineligible');
  }

  const sampleArtifactIds = new Set(ordered.map((view) => view.summary.artifactId));
  const excludedArtifacts = orderedAttempts
    .filter((view) => !sampleArtifactIds.has(view.summary.artifactId))
    .map((view) => ({
      artifactId: view.summary.artifactId,
      capturedAt: view.summary.capturedAt,
      state: view.summary.state,
      terminalReason: view.summary.terminalReason,
      capturedPages: view.summary.capturedPages,
      uniqueItems: view.summary.uniqueItems
    }));

  const sampleSets = ordered.map((view) => ({
    summary: view.summary,
    bvids: stableBvids(view)
  }));
  const pairwise: BilibiliNativeSearchBatchCoveragePair[] = [];
  for (let leftIndex = 0; leftIndex < sampleSets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sampleSets.length; rightIndex += 1) {
      const left = sampleSets[leftIndex]!;
      const right = sampleSets[rightIndex]!;
      const intersectionCount = [...left.bvids].filter((bvid) => right.bvids.has(bvid)).length;
      const unionCount = left.bvids.size + right.bvids.size - intersectionCount;
      const overlapRate = intersectionCount / Math.min(left.bvids.size, right.bvids.size);
      const jaccardRate = intersectionCount / unionCount;
      pairwise.push({
        leftArtifactId: left.summary.artifactId,
        rightArtifactId: right.summary.artifactId,
        leftCapturedAt: left.summary.capturedAt,
        rightCapturedAt: right.summary.capturedAt,
        leftUniqueItems: left.bvids.size,
        rightUniqueItems: right.bvids.size,
        intersectionCount,
        unionCount,
        symmetricDifferenceCount: unionCount - intersectionCount,
        overlapRate,
        jaccardRate,
        driftRate: 1 - jaccardRate
      });
    }
  }
  const overlapRates = pairwise.map((pair) => pair.overlapRate);
  const jaccardRates = pairwise.map((pair) => pair.jaccardRate);
  const meanJaccardRate = mean(jaccardRates);
  return {
    schemaVersion: 1,
    platform: 'bilibili',
    capturedAt,
    queryDigest: first.queryDigest,
    search: structuredClone(first.search),
    sampleArtifactIds: ordered.map((view) => view.summary.artifactId),
    sampleCount: ordered.length,
    attemptedArtifactIds: orderedAttempts.map((view) => view.summary.artifactId),
    attemptedCount: orderedAttempts.length,
    excludedArtifactIds: excludedArtifacts.map((artifact) => artifact.artifactId),
    excludedCount: excludedArtifacts.length,
    excludedArtifacts,
    pairCount: pairwise.length,
    pairwise,
    aggregate: {
      minOverlapRate: Math.min(...overlapRates),
      maxOverlapRate: Math.max(...overlapRates),
      meanOverlapRate: mean(overlapRates),
      minJaccardRate: Math.min(...jaccardRates),
      maxJaccardRate: Math.max(...jaccardRates),
      meanJaccardRate,
      meanDriftRate: 1 - meanJaccardRate
    },
    safeguards: {
      source: 'completed_bilibili_native_search_batch_artifacts',
      query: 'sha256_only',
      rawBvids: 'not_persisted_in_coverage_artifact',
      sampleBudget: BILIBILI_NATIVE_SEARCH_BATCH_COVERAGE_MAX_SAMPLES,
      comparison: 'set_intersection_and_jaccard_over_stable_bvids',
      attemptLedger: 'explicit_attempted_artifact_ids'
    }
  };
}
