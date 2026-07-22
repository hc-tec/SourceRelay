import {
  BILIBILI_ACCOUNT_VIDEO_DETAIL_MATERIALIZATION_MAX_DETAILS,
  type BilibiliAccountVideoDetailMaterializationItem,
  type BilibiliAccountVideoDetailMaterializationRunRecord,
  type BilibiliAccountVideoDetailMaterializationSource,
  type BilibiliAccountVideoDetailMaterializationTerminalReason
} from './bilibili-account-video-detail-materialization-contract';

export function createBilibiliAccountVideoDetailMaterializationRunRecord(input: {
  runId: string;
  collectorVersion: string;
  source: BilibiliAccountVideoDetailMaterializationSource;
  startedAt: string;
  completedAt: string;
  state: BilibiliAccountVideoDetailMaterializationRunRecord['state'];
  errorCode: string | null;
  items: BilibiliAccountVideoDetailMaterializationItem[];
  terminalReason: BilibiliAccountVideoDetailMaterializationTerminalReason;
}): BilibiliAccountVideoDetailMaterializationRunRecord {
  const requestedDetails = input.items.length;
  const startedDetails = input.items.filter((item) => item.detailRunStarted).length;
  const navigationAttemptedDetails = input.items.filter((item) => item.navigationAttempted).length;
  const completedDetails = input.items.filter((item) => item.outcome === 'completed').length;
  const partialDetails = input.items.filter((item) => item.outcome === 'partial').length;
  const failedDetails = input.items.filter((item) => item.outcome === 'failed').length;
  const notAttemptedDetails = input.items.filter((item) => item.outcome === 'not_attempted').length;
  if (
    requestedDetails < 1 ||
    requestedDetails > BILIBILI_ACCOUNT_VIDEO_DETAIL_MATERIALIZATION_MAX_DETAILS ||
    new Set(input.items.map((item) => item.bvid)).size !== requestedDetails ||
    startedDetails !== completedDetails + partialDetails + failedDetails ||
    navigationAttemptedDetails > startedDetails ||
    requestedDetails !== startedDetails + notAttemptedDetails
  ) throw new Error('bilibili_account_video_detail_materialization_run_invalid');
  return {
    schemaVersion: 1,
    runId: input.runId,
    collectorVersion: input.collectorVersion,
    platform: 'bilibili',
    accountCategory: 'user_managed',
    source: structuredClone(input.source),
    state: input.state,
    errorCode: input.errorCode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    items: structuredClone(input.items),
    coverage: {
      requestedDetails,
      startedDetails,
      navigationAttemptedDetails,
      completedDetails,
      partialDetails,
      failedDetails,
      notAttemptedDetails,
      terminalReason: input.terminalReason
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'verified_pagination_artifact_plus_sequential_detail_navigation',
      selection: 'explicit_bvids_from_completed_pagination_artifact',
      perProfilePlatformConcurrency: 1,
      maximumDetails: BILIBILI_ACCOUNT_VIDEO_DETAIL_MATERIALIZATION_MAX_DETAILS,
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'not_read',
      responseBodies: 'not_read',
      semanticActionDelivery: 'at_most_once',
      stopOnFirstNonCompletedDetail: true,
      admissionEligible: false
    }
  };
}
