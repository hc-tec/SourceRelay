import {
  COLLECTOR_EXTENSION_VERSION,
  type ExtensionWorkItem,
  type ExtensionWorkResult
} from '@intelligence/collector-contracts';
import { BilibiliAccountProfileArtifactStore } from './bilibili-account-profile-artifacts';
import {
  projectBilibiliAccountProfileDom,
  type BilibiliAccountProfileTerminalReason
} from './bilibili-account-profile-contract';
import { createBilibiliAccountProfileRunRecord } from './bilibili-account-profile-run-record';
import type { ExtensionWorkArtifactReference } from './extension-work-queue';

/**
 * Records the direct extension lane with its own browser provenance. The
 * profile projection is public visible DOM only; no legacy Browser Host
 * session, Profile ID, request body or response body enters this adapter.
 */
export async function recordBilibiliAccountProfileExtensionWork(input: {
  item: Extract<ExtensionWorkItem, { capability: 'bilibili.account_profile' }>;
  result: Extract<ExtensionWorkResult, { capability: 'bilibili.account_profile' }>;
  artifacts: BilibiliAccountProfileArtifactStore;
}): Promise<ExtensionWorkArtifactReference> {
  const snapshot = input.result.observation
    ? projectBilibiliAccountProfileDom(input.result.observation, input.item.input.canonicalProfileUrl, input.result.completedAt)
    : null;
  const targetTabSelection = input.result.workTabAcquisition === 'created'
    ? 'created_extension_work_tab' as const
    : input.result.workTabAcquisition === 'reused'
      ? 'reused_extension_work_tab' as const
      : 'not_acquired' as const;
  const targetPage = input.result.workTabDisposition;
  const artifact = await input.artifacts.record(createBilibiliAccountProfileRunRecord({
    runId: input.item.operationId,
    collectorVersion: COLLECTOR_EXTENSION_VERSION,
    canonicalProfileUrl: input.item.input.canonicalProfileUrl,
    startedAt: input.item.issuedAt,
    completedAt: input.result.completedAt,
    state: input.result.state === 'completed'
      ? 'completed'
      : input.result.state === 'partial'
        ? 'partial'
        : 'failed',
    errorCode: input.result.errorCode,
    snapshot,
    visualEvidence: null,
    actions: [{
      actionId: 'open_canonical_account_profile',
      intent: 'Open the canonical public Bilibili account profile exactly once.',
      attempted: input.result.navigation.attempted,
      attemptCount: input.result.navigation.attemptCount,
      outcome: actionOutcome(input.result),
      errorCode: input.result.errorCode
    }],
    terminalReason: profileTerminalReason(input.result.terminalReason),
    safeguards: {
      environment: 'user_owned_browser_extension',
      browser: 'user_owned_chromium_tab',
      acquisition: 'extension_owned_tab_navigation_plus_bounded_dom_projection',
      responseBody: 'not_read',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      queryAndFragmentValues: 'discarded',
      currentViewerIdentity: 'excluded',
      semanticActionDelivery: 'at_most_once',
      runDeadlineMs: 60_000,
      targetTabSelection,
      targetPage,
      admissionEligible: false
    }
  }));
  return {
    artifactId: artifact.artifactId,
    retrievalPath: `/v1/collect/artifacts/bilibili.account_profile/${artifact.artifactId}`,
    summary: structuredClone(artifact) as unknown as Record<string, unknown>
  };
}

function actionOutcome(
  result: Extract<ExtensionWorkResult, { capability: 'bilibili.account_profile' }>
): 'completed' | 'postcondition_unmet' | 'risk_stopped' | 'failed' {
  if (result.state === 'completed') return 'completed';
  if (result.terminalReason === 'verification_required' || result.terminalReason === 'rate_limited') {
    return 'risk_stopped';
  }
  if (result.terminalReason === 'source_unavailable' || result.terminalReason === 'run_deadline_exceeded') {
    return 'postcondition_unmet';
  }
  return 'failed';
}

function profileTerminalReason(
  terminalReason: Extract<ExtensionWorkResult, { capability: 'bilibili.account_profile' }>['terminalReason']
): BilibiliAccountProfileTerminalReason {
  if (terminalReason === 'profile_ready') return 'profile_captured';
  if (terminalReason === 'verification_required' || terminalReason === 'rate_limited' ||
    terminalReason === 'source_unavailable' || terminalReason === 'run_deadline_exceeded'
  ) return terminalReason;
  if (terminalReason === 'document_context_changed') return 'context_changed';
  return 'dom_projection_failed';
}
