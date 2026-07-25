import { createHash } from 'node:crypto';
import {
  BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
  COLLECTOR_EXTENSION_VERSION,
  type ExtensionWorkItem,
  type ExtensionWorkResult
} from '@intelligence/collector-contracts';
import { BilibiliNativeSearchArtifactStore } from './bilibili-native-search-artifacts';
import {
  projectBilibiliNativeSearchDom,
  type BilibiliNativeSearchRunRecord
} from './bilibili-native-search-contract';
import type { ExtensionWorkArtifactReference } from './extension-work-queue';

/**
 * Materialises the direct extension's bounded public DOM projection into the
 * existing raw-first native-search artifact family. Query text and its URL
 * are used only while the signed work runs; persisted artifacts retain their
 * SHA-256 digests rather than those raw inputs.
 */
export async function recordBilibiliNativeSearchExtensionWork(input: {
  item: Extract<ExtensionWorkItem, { capability: 'bilibili.native_search' }>;
  result: Extract<ExtensionWorkResult, { capability: 'bilibili.native_search' }>;
  artifacts: BilibiliNativeSearchArtifactStore;
}): Promise<ExtensionWorkArtifactReference> {
  const results = input.result.observation
    ? projectBilibiliNativeSearchDom(input.result.observation, input.result.completedAt, input.item.input)
    : null;
  const targetTabSelection = input.result.workTabAcquisition === 'created'
    ? 'created_extension_work_tab' as const
    : input.result.workTabAcquisition === 'reused'
      ? 'reused_extension_work_tab' as const
      : 'not_acquired' as const;
  const targetPage = input.result.workTabDisposition;
  const artifact = await input.artifacts.record({
    schemaVersion: 1,
    runId: input.item.operationId,
    collectorVersion: COLLECTOR_EXTENSION_VERSION,
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'native_search',
    search: {
      resultType: input.item.input.resultType,
      sort: input.item.input.sort,
      page: input.item.input.page
    },
    queryDigest: sha256(input.item.input.query),
    targetUrlDigest: sha256(input.item.input.canonicalSearchUrl),
    strategyCandidate: {
      strategyId: BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
      version: '0.2.0',
      admissionEligible: false
    },
    state: input.result.state === 'completed'
      ? 'completed'
      : input.result.state === 'partial'
        ? 'partial'
        : 'failed',
    errorCode: input.result.errorCode,
    startedAt: input.item.issuedAt,
    completedAt: input.result.completedAt,
    results,
    visualEvidence: null,
    actions: [{
      actionId: 'open_fixed_native_search',
      kind: 'navigation',
      intent: 'Open the canonical first-party Bilibili search page exactly once.',
      attempted: input.result.navigation.attempted,
      attemptCount: input.result.navigation.attemptCount,
      outcome: actionOutcome(input.result),
      errorCode: input.result.errorCode
    }],
    coverage: {
      capturedPages: results ? 1 : 0,
      visibleVideoCardCount: results?.visibleVideoCardCount ?? 0,
      capturedItems: results?.items.length ?? 0,
      unresolvedCardCount: results?.unresolvedCardCount ?? 0,
      resultState: results?.resultState ?? null,
      loginOverlayVisible: results?.loginOverlayVisible ?? false,
      terminalReason: input.result.terminalReason
    },
    safeguards: {
      environment: 'user_owned_browser_extension',
      browser: 'user_owned_chromium_tab',
      acquisition: 'extension_owned_tab_navigation_plus_bounded_dom_projection',
      query: 'sha256_only_in_persisted_artifacts',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'not_read',
      responseBodies: 'not_read',
      sortAndFilter: 'fixed_comprehensive_first_page_no_input',
      pagination: 'fixed_first_page_no_input',
      detailNavigation: 'excluded_separate_capability',
      mixedResultTypes: 'excluded_non_video_objects',
      semanticActionDelivery: 'at_most_once',
      runDeadlineMs: 60_000,
      targetTabSelection,
      targetPage,
      admissionEligible: false
    }
  } satisfies BilibiliNativeSearchRunRecord);
  return {
    artifactId: artifact.artifactId,
    retrievalPath: `/v1/collect/artifacts/bilibili.native_search/${artifact.artifactId}`,
    summary: structuredClone(artifact) as unknown as Record<string, unknown>
  };
}

function actionOutcome(
  result: Extract<ExtensionWorkResult, { capability: 'bilibili.native_search' }>
): 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'risk_stopped' | 'failed' {
  if (result.state === 'completed') return 'completed';
  if (!result.navigation.attempted) return 'prerequisite_unmet';
  if (result.terminalReason === 'verification_required' || result.terminalReason === 'rate_limited') {
    return 'risk_stopped';
  }
  if (
    result.terminalReason === 'source_unavailable' || result.terminalReason === 'run_deadline_exceeded' ||
    result.terminalReason === 'search_results_partial'
  ) return 'postcondition_unmet';
  return 'failed';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
