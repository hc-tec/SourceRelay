import {
  COLLECTOR_EXTENSION_VERSION,
  type BilibiliVideoDetailDomObservation,
  type ExtensionWorkItem,
  type ExtensionWorkResult
} from '@intelligence/collector-contracts';
import { BilibiliVideoDetailArtifactStore } from './bilibili-video-detail-artifacts';
import {
  projectBilibiliVideoDetailDom,
  type BilibiliVideoDetailDomDiagnostics
} from './bilibili-video-detail-contract';
import { createBilibiliVideoDetailRunRecord } from './bilibili-video-detail-run-record';
import type { ExtensionWorkArtifactReference } from './extension-work-queue';

/**
 * Converts the extension's fixed DOM projection into the existing raw-first
 * artifact format.  The extension result is already bound to the claimed
 * work item by the route; this module never accepts a caller-selected URL or
 * selector.
 */
export async function recordBilibiliVideoDetailExtensionWork(input: {
  item: Extract<ExtensionWorkItem, { capability: 'bilibili.video_detail' }>;
  result: Extract<ExtensionWorkResult, { capability: 'bilibili.video_detail' }>;
  artifacts: BilibiliVideoDetailArtifactStore;
}): Promise<ExtensionWorkArtifactReference> {
  const detail = input.result.observation
    ? projectBilibiliVideoDetailDom(input.result.observation, input.item.input.bvid, input.result.completedAt)
    : null;
  const targetTabSelection = input.result.workTabAcquisition === 'created'
    ? 'created_extension_work_tab' as const
    : input.result.workTabAcquisition === 'reused'
      ? 'reused_extension_work_tab' as const
      : 'not_acquired' as const;
  const targetPage = input.result.workTabDisposition;
  const artifact = await input.artifacts.record(createBilibiliVideoDetailRunRecord({
    runId: input.item.operationId,
    collectorVersion: COLLECTOR_EXTENSION_VERSION,
    canonicalVideoUrl: input.item.input.canonicalVideoUrl,
    bvid: input.item.input.bvid,
    startedAt: input.item.issuedAt,
    completedAt: input.result.completedAt,
    state: input.result.state === 'completed'
      ? 'completed'
      : input.result.state === 'partial'
        ? 'partial'
        : 'failed',
    errorCode: input.result.errorCode,
    detail,
    domDiagnostics: domDiagnostics(input.result.observation),
    visualEvidence: null,
    actions: [{
      actionId: 'open_canonical_video',
      kind: 'navigation',
      intent: 'Open the canonical public Bilibili video page exactly once.',
      attempted: input.result.navigation.attempted,
      attemptCount: input.result.navigation.attemptCount,
      outcome: actionOutcome(input.result),
      errorCode: input.result.errorCode
    }],
    terminalReason: input.result.terminalReason,
    targetTabSelection,
    targetPage,
    safeguards: {
      environment: 'user_owned_browser_extension',
      browser: 'user_owned_chromium_tab',
      acquisition: 'extension_owned_tab_navigation_plus_bounded_dom_projection',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'not_read',
      responseBodies: 'not_read',
      subtitle: 'included_indicator',
      multipart: 'summary_only_separate_catalog_capability',
      discussion: 'included_bounded_dom_projection',
      recommendations: 'excluded',
      semanticActionDelivery: 'at_most_once',
      runDeadlineMs: 120_000,
      targetTabSelection,
      targetPage,
      admissionEligible: false
    }
  }));
  return {
    artifactId: artifact.artifactId,
    retrievalPath: `/v1/collect/artifacts/bilibili.video_detail/${artifact.artifactId}`,
    summary: structuredClone(artifact) as unknown as Record<string, unknown>
  };
}

function actionOutcome(result: ExtensionWorkResult):
  | 'completed'
  | 'prerequisite_unmet'
  | 'postcondition_unmet'
  | 'risk_stopped'
  | 'failed' {
  if (result.state === 'completed') return 'completed';
  if (!result.navigation.attempted) return 'prerequisite_unmet';
  if (result.terminalReason === 'verification_required' || result.terminalReason === 'rate_limited') {
    return 'risk_stopped';
  }
  if (result.terminalReason === 'source_unavailable' || result.terminalReason === 'run_deadline_exceeded' ||
    result.terminalReason === 'dom_projection_failed'
  ) {
    return 'postcondition_unmet';
  }
  return 'failed';
}

function domDiagnostics(
  observation: Extract<ExtensionWorkResult, { capability: 'bilibili.video_detail' }>['observation']
): BilibiliVideoDetailDomDiagnostics {
  if (!observation) {
    return {
      observationPresent: false,
      titlePresent: null,
      titleVisible: null,
      playerVisible: null,
      chargeExclusiveTrialVisible: null,
      subtitle: null,
      discussion: null,
      loginOverlayVisible: null,
      verificationRequired: null,
      rateLimited: null,
      sourceUnavailable: null
    };
  }
  return diagnosticsFromObservation(observation);
}

function diagnosticsFromObservation(observation: BilibiliVideoDetailDomObservation): BilibiliVideoDetailDomDiagnostics {
  return {
    observationPresent: true,
    titlePresent: observation.title !== null,
    titleVisible: observation.titleVisible,
    playerVisible: observation.playerVisible,
    chargeExclusiveTrialVisible: observation.chargeExclusiveTrialVisible,
    subtitle: {
      captureStatus: observation.subtitle.captureStatus,
      available: observation.subtitle.available,
      language: observation.subtitle.language,
      panelVisible: observation.subtitle.panelVisible,
      segmentCount: observation.subtitle.segmentCount,
      partial: observation.subtitle.partial,
      segments: observation.subtitle.segments.map((segment) => ({ ...segment }))
    },
    discussion: structuredClone(observation.discussion),
    loginOverlayVisible: observation.loginOverlayVisible,
    verificationRequired: observation.risk.verificationRequired,
    rateLimited: observation.risk.rateLimited,
    sourceUnavailable: observation.risk.sourceUnavailable
  };
}
