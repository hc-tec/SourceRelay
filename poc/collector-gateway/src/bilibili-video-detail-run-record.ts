import {
  BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
  type StrategyBindingDiagnostics
} from '@intelligence/collector-contracts';
import { createHash } from 'node:crypto';
import type {
  BilibiliVideoDetailAction,
  BilibiliVideoDetailDomDiagnostics,
  BilibiliVideoDetailProjection,
  BilibiliVideoDetailRunRecord,
  BilibiliVideoDetailTerminalReason,
  BilibiliVideoDetailVisualEvidence
} from './bilibili-video-detail-contract';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createBilibiliVideoDetailRunRecord(input: {
  runId: string;
  collectorVersion: string;
  canonicalVideoUrl: string;
  bvid: string;
  startedAt: string;
  completedAt: string;
  state: BilibiliVideoDetailRunRecord['state'];
  errorCode: string | null;
  detail: BilibiliVideoDetailProjection | null;
  domDiagnostics?: BilibiliVideoDetailDomDiagnostics;
  visualEvidence: BilibiliVideoDetailVisualEvidence | null;
  bindingDiagnostics?: StrategyBindingDiagnostics | null;
  actions: BilibiliVideoDetailAction[];
  terminalReason: BilibiliVideoDetailTerminalReason;
  targetTabSelection: BilibiliVideoDetailRunRecord['safeguards']['targetTabSelection'];
  targetPage: BilibiliVideoDetailRunRecord['safeguards']['targetPage'];
  safeguards?: BilibiliVideoDetailRunRecord['safeguards'];
}): BilibiliVideoDetailRunRecord {
  const detail = input.detail;
  return {
    schemaVersion: 2,
    runId: input.runId,
    collectorVersion: input.collectorVersion,
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'video_detail',
    targetUrlDigest: sha256(input.canonicalVideoUrl),
    bvid: input.bvid,
    strategyCandidate: {
      strategyId: BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
      version: '0.4.0',
      admissionEligible: false
    },
    state: input.state,
    errorCode: input.errorCode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    detail,
    ...(input.domDiagnostics ? { domDiagnostics: structuredClone(input.domDiagnostics) } : {}),
    visualEvidence: input.visualEvidence,
    ...(input.bindingDiagnostics ? { bindingDiagnostics: structuredClone(input.bindingDiagnostics) } : {}),
    actions: input.actions,
    coverage: {
      capturedDetails: detail ? 1 : 0,
      titleCaptured: Boolean(detail?.title),
      metadataCaptured: detail?.metadataVisibleText !== null && detail?.metadataVisibleText !== undefined,
      descriptionCaptured: detail?.description !== null && detail?.description !== undefined,
      creatorCaptured: detail?.creator !== null && detail?.creator !== undefined,
      tagCount: detail?.tagTexts.length ?? 0,
      episodeSummaryCaptured: detail?.episodeSummaryText !== null && detail?.episodeSummaryText !== undefined,
      accessStatus: detail?.accessStatus ?? null,
      loginOverlayVisible: detail?.loginOverlayVisible ?? false,
      terminalReason: input.terminalReason
    },
    safeguards: input.safeguards ?? {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'trusted_navigation_plus_bounded_dom_projection',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'not_read',
      responseBodies: 'not_read',
      subtitle: 'included_indicator',
      multipart: 'summary_only_separate_catalog_capability',
      discussion: 'excluded_separate_capability',
      recommendations: 'excluded',
      semanticActionDelivery: 'at_most_once',
      runDeadlineMs: 60_000,
      targetTabSelection: input.targetTabSelection,
      targetPage: input.targetPage,
      admissionEligible: false
    }
  };
}
