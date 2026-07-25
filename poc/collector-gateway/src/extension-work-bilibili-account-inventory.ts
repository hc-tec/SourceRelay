import {
  COLLECTOR_EXTENSION_VERSION,
  type ExtensionWorkItem,
  type ExtensionWorkResult
} from '@intelligence/collector-contracts';
import { BilibiliAccountVideoInventoryArtifactStore } from './bilibili-account-video-inventory-artifacts';
import {
  projectBilibiliAccountVideoInventoryDom,
  type BilibiliAccountVideoInventoryTerminalReason
} from './bilibili-account-video-inventory-contract';
import { createBilibiliAccountVideoInventoryRunRecord } from './bilibili-account-video-inventory-run-record';
import type { ExtensionWorkArtifactReference } from './extension-work-queue';

/**
 * Persists the bounded first-screen UP-video projection produced in a
 * user-owned browser tab. The artifact records its direct provenance and
 * explicitly leaves pagination, scrolling, filtering and response bodies out.
 */
export async function recordBilibiliAccountInventoryExtensionWork(input: {
  item: Extract<ExtensionWorkItem, { capability: 'bilibili.account_inventory' }>;
  result: Extract<ExtensionWorkResult, { capability: 'bilibili.account_inventory' }>;
  artifacts: BilibiliAccountVideoInventoryArtifactStore;
}): Promise<ExtensionWorkArtifactReference> {
  const page = input.result.observation
    ? projectBilibiliAccountVideoInventoryDom(
      input.result.observation,
      input.item.input.stableAccountId,
      input.result.completedAt
    )
    : null;
  const targetTabSelection = input.result.workTabAcquisition === 'created'
    ? 'created_extension_work_tab' as const
    : input.result.workTabAcquisition === 'reused'
      ? 'reused_extension_work_tab' as const
      : 'not_acquired' as const;
  const targetPage = input.result.workTabDisposition;
  const artifact = await input.artifacts.record(createBilibiliAccountVideoInventoryRunRecord({
    runId: input.item.operationId,
    collectorVersion: COLLECTOR_EXTENSION_VERSION,
    canonicalInventoryUrl: input.item.input.canonicalInventoryUrl,
    stableAccountId: input.item.input.stableAccountId,
    startedAt: input.item.issuedAt,
    completedAt: input.result.completedAt,
    state: input.result.state === 'completed'
      ? 'completed'
      : input.result.state === 'partial'
        ? 'partial'
        : 'failed',
    errorCode: input.result.errorCode,
    page,
    visualEvidence: null,
    actions: [{
      actionId: 'open_canonical_account_inventory',
      kind: 'navigation',
      intent: 'Open the canonical public Bilibili account video inventory exactly once.',
      attempted: input.result.navigation.attempted,
      attemptCount: input.result.navigation.attemptCount,
      outcome: actionOutcome(input.result),
      errorCode: input.result.errorCode
    }],
    terminalReason: inventoryTerminalReason(input.result.terminalReason),
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
      pagination: 'excluded_separate_capability',
      sortAndFilter: 'excluded_separate_capability',
      articleAudioAndSeries: 'excluded_separate_capability',
      semanticActionDelivery: 'at_most_once',
      runDeadlineMs: 60_000,
      targetTabSelection,
      targetPage,
      admissionEligible: false
    }
  }));
  return {
    artifactId: artifact.artifactId,
    retrievalPath: `/v1/collect/artifacts/bilibili.account_inventory/${artifact.artifactId}`,
    summary: structuredClone(artifact) as unknown as Record<string, unknown>
  };
}

function actionOutcome(
  result: Extract<ExtensionWorkResult, { capability: 'bilibili.account_inventory' }>
): 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'risk_stopped' | 'failed' {
  if (result.state === 'completed') return 'completed';
  if (!result.navigation.attempted) return 'prerequisite_unmet';
  if (result.terminalReason === 'verification_required' || result.terminalReason === 'rate_limited') {
    return 'risk_stopped';
  }
  if (result.terminalReason === 'source_unavailable' || result.terminalReason === 'run_deadline_exceeded' ||
    result.terminalReason === 'inventory_partial'
  ) return 'postcondition_unmet';
  return 'failed';
}

function inventoryTerminalReason(
  terminalReason: Extract<ExtensionWorkResult, { capability: 'bilibili.account_inventory' }>['terminalReason']
): BilibiliAccountVideoInventoryTerminalReason {
  if (terminalReason === 'inventory_ready') return 'page_one_ready';
  if (terminalReason === 'inventory_partial') return 'page_one_partial';
  if (terminalReason === 'verification_required' || terminalReason === 'rate_limited' ||
    terminalReason === 'source_unavailable' || terminalReason === 'document_context_changed' ||
    terminalReason === 'run_deadline_exceeded'
  ) return terminalReason;
  return 'dom_projection_failed';
}
