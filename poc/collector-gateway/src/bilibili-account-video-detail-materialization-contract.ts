import type { BilibiliAccountVideoPaginationArtifactView } from './bilibili-account-video-pagination-artifacts';
import { canonicalBilibiliVideoDetailUrl } from './bilibili-video-detail-contract';
import type { BilibiliVideoDetailArtifactSummary } from './bilibili-video-detail-artifacts';

export const BILIBILI_ACCOUNT_VIDEO_DETAIL_MATERIALIZATION_MAX_DETAILS = 3;

export interface BilibiliAccountVideoDetailMaterializationInput {
  bvids: string[];
}

export interface BilibiliAccountVideoDetailMaterializationSource {
  sourceArtifactId: string;
  sourceManifestSha256: string;
  stableAccountId: string;
  capturedAt: string;
}

export interface BilibiliAccountVideoDetailMaterializationSelection {
  bvid: string;
  sourcePageNumber: number;
  canonicalVideoUrl: string;
}

export interface BilibiliAccountVideoDetailMaterializationItem
  extends BilibiliAccountVideoDetailMaterializationSelection {
  detailRunStarted: boolean;
  navigationAttempted: boolean;
  navigationAttemptCount: 0 | 1;
  outcome: 'completed' | 'partial' | 'failed' | 'not_attempted';
  errorCode: string | null;
  detailRunId: string | null;
  detailArtifact: BilibiliVideoDetailArtifactSummary | null;
}

export type BilibiliAccountVideoDetailMaterializationTerminalReason =
  | 'all_selected_details_materialized'
  | 'detail_run_not_completed'
  | 'account_safety_stopped'
  | 'detail_runner_error';

export interface BilibiliAccountVideoDetailMaterializationRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  source: BilibiliAccountVideoDetailMaterializationSource;
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  items: BilibiliAccountVideoDetailMaterializationItem[];
  coverage: {
    requestedDetails: number;
    startedDetails: number;
    navigationAttemptedDetails: number;
    completedDetails: number;
    partialDetails: number;
    failedDetails: number;
    notAttemptedDetails: number;
    terminalReason: BilibiliAccountVideoDetailMaterializationTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'verified_pagination_artifact_plus_sequential_detail_navigation';
    selection: 'explicit_bvids_from_completed_pagination_artifact';
    perProfilePlatformConcurrency: 1;
    maximumDetails: typeof BILIBILI_ACCOUNT_VIDEO_DETAIL_MATERIALIZATION_MAX_DETAILS;
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    networkQueryAndFragmentValues: 'not_read';
    responseBodies: 'not_read';
    semanticActionDelivery: 'at_most_once';
    stopOnFirstNonCompletedDetail: true;
    admissionEligible: false;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validBvid(value: unknown): value is string {
  return typeof value === 'string' && /^BV[0-9A-Za-z]{10}$/.test(value);
}

/**
 * Accept only an explicit, small selection. The caller cannot request an
 * unbounded "all details" expansion or add arbitrary video URLs here.
 */
export function bilibiliAccountVideoDetailMaterializationInput(
  value: unknown
): BilibiliAccountVideoDetailMaterializationInput {
  const candidate = record(value);
  if (!candidate || Object.keys(candidate).length !== 1 || !Array.isArray(candidate.bvids)) {
    throw new Error('bilibili_account_video_detail_materialization_input_invalid');
  }
  const bvids = candidate.bvids;
  if (
    bvids.length < 1 ||
    bvids.length > BILIBILI_ACCOUNT_VIDEO_DETAIL_MATERIALIZATION_MAX_DETAILS ||
    !bvids.every(validBvid) ||
    new Set(bvids).size !== bvids.length
  ) throw new Error('bilibili_account_video_detail_materialization_input_invalid');
  return { bvids: [...bvids] };
}

export function materializationSource(
  source: BilibiliAccountVideoPaginationArtifactView
): BilibiliAccountVideoDetailMaterializationSource {
  return {
    sourceArtifactId: source.summary.artifactId,
    sourceManifestSha256: source.summary.manifestSha256,
    stableAccountId: source.summary.stableAccountId,
    capturedAt: source.summary.capturedAt
  };
}

/**
 * Resolves user-selected IDs against an integrity-checked, completed inventory
 * artifact. The returned canonical URLs are copied from that artifact rather
 * than accepted from the request body.
 */
export function selectBilibiliAccountVideoDetailMaterializations(
  source: BilibiliAccountVideoPaginationArtifactView,
  rawInput: unknown
): BilibiliAccountVideoDetailMaterializationSelection[] {
  const input = bilibiliAccountVideoDetailMaterializationInput(rawInput);
  if (
    source.summary.state !== 'completed' ||
    source.summary.capturedPages < 1 ||
    source.summary.capturedPages !== source.pages.length ||
    source.manifest.coverage.unresolvedCardCount !== 0 ||
    source.summary.stableAccountId !== source.manifest.stableAccountId
  ) throw new Error('bilibili_account_video_detail_materialization_source_rejected');

  const available = new Map<string, BilibiliAccountVideoDetailMaterializationSelection>();
  for (const page of source.pages) {
    if (page.projection.stableAccountId !== source.summary.stableAccountId) {
      throw new Error('bilibili_account_video_detail_materialization_source_rejected');
    }
    for (const item of page.projection.items) {
      const canonicalVideoUrl = canonicalBilibiliVideoDetailUrl(item.canonicalVideoUrl);
      if (!canonicalVideoUrl || canonicalVideoUrl !== item.canonicalVideoUrl || !validBvid(item.bvid)) {
        throw new Error('bilibili_account_video_detail_materialization_source_rejected');
      }
      if (available.has(item.bvid)) {
        throw new Error('bilibili_account_video_detail_materialization_source_duplicate_bvid');
      }
      available.set(item.bvid, {
        bvid: item.bvid,
        sourcePageNumber: page.pageNumber,
        canonicalVideoUrl
      });
    }
  }
  const selected = input.bvids.map((bvid) => available.get(bvid) ?? null);
  if (selected.some((item) => item === null)) {
    throw new Error('bilibili_account_video_detail_materialization_bvid_not_in_source');
  }
  return selected as BilibiliAccountVideoDetailMaterializationSelection[];
}
