import {
  BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
  BrowserHostError,
  COLLECTOR_EXTENSION_VERSION,
  type AcquirePageResult,
  type PageReleaseDisposition
} from '@intelligence/collector-contracts';
import { randomUUID } from 'node:crypto';
import type { AccountSafetyRegistry, AccountSafetyRunPermit } from './account-safety';
import type {
  BilibiliNativeSearchArtifactStore,
  BilibiliNativeSearchArtifactSummary
} from './bilibili-native-search-artifacts';
import {
  bilibiliNativeSearchInput,
  canonicalBilibiliNativeSearchUrlForQuery,
  projectBilibiliNativeSearchDom,
  type BilibiliNativeSearchAction,
  type BilibiliNativeSearchProjection,
  type BilibiliNativeSearchRunRecord,
  type BilibiliNativeSearchTerminalReason,
  type BilibiliNativeSearchVisualEvidence
} from './bilibili-native-search-contract';
import { bilibiliNativeSearchStrategyObservation } from './bilibili-native-search-observation';
import { createBilibiliNativeSearchRunRecord } from './bilibili-native-search-run-record';
import type { CollectionBrowserManager } from './browser-manager';
import type { BrowserProfileRegistry } from './profiles';

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_DEADLINE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const OBSERVATION_DEADLINE_MS = 15_000;

export interface BilibiliNativeSearchHostRunInput {
  profileId: string;
  query: string;
}

export interface BilibiliNativeSearchHostRunResult {
  run: BilibiliNativeSearchRunRecord;
  artifact: BilibiliNativeSearchArtifactSummary;
}

interface LeasedPageContext {
  recordVersion: number;
}

function input(value: BilibiliNativeSearchHostRunInput): BilibiliNativeSearchHostRunInput {
  if (!PROFILE_ID.test(value.profileId)) throw new Error('bilibili_native_search_profile_invalid');
  return { profileId: value.profileId, ...bilibiliNativeSearchInput({ query: value.query }) };
}

function navigationAction(runId: string): BilibiliNativeSearchAction {
  return {
    actionId: `navigate_bilibili_native_search_${runId.replace(/-/g, '_')}`,
    kind: 'navigation',
    intent: 'Open the canonical first-party Bilibili search page exactly once.',
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null
  };
}

function pageSelection(selection: AcquirePageResult['selection']):
  BilibiliNativeSearchRunRecord['safeguards']['targetTabSelection'] {
  if (selection === 'created_new_page') return 'created_new_managed_tab';
  return selection === 'reused_exact_target'
    ? 'reused_matching_managed_tab'
    : 'reused_retained_managed_tab';
}

function riskOutcome(
  dom: ReturnType<typeof bilibiliNativeSearchStrategyObservation>['dom'],
  results: BilibiliNativeSearchProjection | null
): {
  state: BilibiliNativeSearchRunRecord['state'];
  terminalReason: BilibiliNativeSearchTerminalReason;
  errorCode: string;
} | null {
  if (dom.risk.verificationRequired) {
    return { state: 'partial', terminalReason: 'verification_required', errorCode: 'verification_required' };
  }
  if (dom.risk.rateLimited) {
    return { state: 'partial', terminalReason: 'rate_limited', errorCode: 'rate_limited' };
  }
  if (dom.risk.sourceUnavailable) {
    return { state: 'partial', terminalReason: 'source_unavailable', errorCode: 'source_unavailable' };
  }
  if (!results && dom.loginOverlayVisible) {
    return { state: 'partial', terminalReason: 'authentication_required', errorCode: 'authentication_required' };
  }
  return null;
}

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof BrowserHostError
    ? error.record.code
    : error instanceof Error
      ? error.message
      : '';
  return /^[a-z0-9_]{1,100}$/.test(candidate) ? candidate : 'native_search_runner_failed';
}

function failureFor(error: unknown): {
  state: BilibiliNativeSearchRunRecord['state'];
  terminalReason: BilibiliNativeSearchTerminalReason;
  errorCode: string;
  uncertainPageOutcome: boolean;
} {
  const errorCode = safeErrorCode(error);
  if (
    errorCode === 'navigation_outcome_unknown' ||
    errorCode === 'managed_page_document_generation_mismatch' ||
    errorCode === 'managed_page_record_version_mismatch' ||
    errorCode === 'managed_page_run_mismatch' ||
    errorCode === 'native_search_strategy_document_context_changed' ||
    errorCode === 'native_search_strategy_binding_context_rejected' ||
    errorCode === 'native_search_managed_page_context_changed'
  ) return { state: 'failed', terminalReason: 'document_context_changed', errorCode, uncertainPageOutcome: true };
  if (errorCode === 'run_deadline_exceeded') {
    return { state: 'failed', terminalReason: 'run_deadline_exceeded', errorCode, uncertainPageOutcome: true };
  }
  return { state: 'failed', terminalReason: 'dom_projection_failed', errorCode, uncertainPageOutcome: false };
}

function remainingDeadline(deadline: number, minimumMs: number): number {
  const remaining = deadline - Date.now();
  if (remaining < minimumMs) throw new Error('run_deadline_exceeded');
  return remaining;
}

export class BilibiliNativeSearchHostRunner {
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #browserManager: CollectionBrowserManager;
  readonly #profiles: BrowserProfileRegistry;
  readonly #artifacts: BilibiliNativeSearchArtifactStore;

  constructor(input: {
    accountSafety: AccountSafetyRegistry;
    browserManager: CollectionBrowserManager;
    profiles: BrowserProfileRegistry;
    artifacts: BilibiliNativeSearchArtifactStore;
  }) {
    this.#accountSafety = input.accountSafety;
    this.#browserManager = input.browserManager;
    this.#profiles = input.profiles;
    this.#artifacts = input.artifacts;
  }

  async run(rawInput: BilibiliNativeSearchHostRunInput): Promise<BilibiliNativeSearchHostRunResult> {
    const request = input(rawInput);
    const profile = this.#profiles.get(request.profileId);
    if (
      profile.kind !== 'collection' ||
      profile.platform !== 'bilibili' ||
      profile.account.category !== 'user_managed'
    ) throw new Error('bilibili_native_search_collection_profile_required');
    const permit = await this.#accountSafety.beginAuthenticatedRun(
      profile.profileId,
      'bilibili',
      'authenticated_native_search_reconnaissance'
    );
    return await this.#runWithPermit(
      permit,
      request.query,
      canonicalBilibiliNativeSearchUrlForQuery(request.query)
    );
  }

  async #runWithPermit(
    permit: AccountSafetyRunPermit,
    query: string,
    canonicalSearchUrl: string
  ): Promise<BilibiliNativeSearchHostRunResult> {
    const navigation = navigationAction(permit.runId);
    const actions = [navigation];
    let deadline = 0;
    let acquired: AcquirePageResult | null = null;
    let results: BilibiliNativeSearchProjection | null = null;
    let visualEvidence: BilibiliNativeSearchVisualEvidence | null = null;
    let state: BilibiliNativeSearchRunRecord['state'] = 'failed';
    let terminalReason: BilibiliNativeSearchTerminalReason = 'dom_projection_failed';
    let errorCode: string | null = null;
    let releaseDisposition: PageReleaseDisposition = 'quarantined';
    let releaseReason = 'native_search_run_not_started';
    let uncertainPageOutcome = false;
    let targetTabSelection: BilibiliNativeSearchRunRecord['safeguards']['targetTabSelection'] = 'not_acquired';
    let targetPage: BilibiliNativeSearchRunRecord['safeguards']['targetPage'] = 'not_acquired';
    try {
      await this.#browserManager.launch(permit.profileId);
      acquired = await this.#browserManager.acquirePage({
        profileId: permit.profileId,
        taskId: `bilibili_native_search_${permit.runId.replace(/-/g, '_')}`,
        runId: permit.runId,
        platform: 'bilibili',
        pageRole: 'native_search',
        targetUrl: canonicalSearchUrl,
        leaseDurationMs: RUN_DEADLINE_MS
      });
      targetTabSelection = pageSelection(acquired.selection);
      releaseReason = 'native_search_strategy_binding_not_completed';
      const observerBindingId = randomUUID();
      await this.#browserManager.bindStrategyObserver({
        schemaVersion: 1,
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        expectedRecordVersion: acquired.page.recordVersion,
        runId: permit.runId,
        observerBindingId,
        strategyId: BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
        target: { canonicalUrl: canonicalSearchUrl },
        expiresAt: new Date(Date.now() + 55_000).toISOString(),
        maximumResponseObservations: 0,
        maximumPayloadBytes: 128 * 1024,
        documentBindingMode: acquired.selection === 'reused_exact_target'
          ? 'next_navigation_only'
          : 'current_document_or_next_navigation'
      });
      deadline = Date.now() + RUN_DEADLINE_MS;
      await this.#accountSafety.recordActionAttempt(permit.profileId, 'bilibili', permit.runId, navigation.actionId);
      navigation.attempted = true;
      navigation.attemptCount = 1;
      await this.#browserManager.navigatePage({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        actionId: navigation.actionId,
        url: canonicalSearchUrl,
        waitUntil: 'domcontentloaded',
        timeoutMs: Math.min(NAVIGATION_TIMEOUT_MS, remainingDeadline(deadline, 1_000))
      });
      navigation.outcome = 'completed';
      releaseDisposition = 'retained_for_review';
      releaseReason = 'native_search_review_retained';
      visualEvidence = await this.#captureVisualEvidence({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        runId: permit.runId,
        deadline,
        actionId: navigation.actionId
      });
      const observed = await this.#observeUntil({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        runId: permit.runId,
        observerBindingId,
        deadline
      });
      results = projectBilibiliNativeSearchDom(observed.dom, new Date().toISOString());
      const risk = riskOutcome(observed.dom, results);
      if (risk) {
        state = risk.state;
        terminalReason = risk.terminalReason;
        errorCode = risk.errorCode;
      } else if (!results) {
        state = 'failed';
        terminalReason = 'dom_projection_failed';
        errorCode = 'native_search_dom_projection_failed';
      } else if (results.unresolvedCardCount > 0) {
        state = 'partial';
        terminalReason = 'search_results_partial';
        errorCode = 'native_search_unresolved_cards';
      } else if (results.items.length === 0) {
        state = 'completed';
        terminalReason = 'search_empty';
        errorCode = null;
      } else {
        state = 'completed';
        terminalReason = 'search_ready';
        errorCode = null;
      }
    } catch (error) {
      const failure = failureFor(error);
      state = failure.state;
      terminalReason = failure.terminalReason;
      errorCode = failure.errorCode;
      uncertainPageOutcome = failure.uncertainPageOutcome;
      if (navigation.attempted && navigation.outcome !== 'completed') {
        navigation.outcome = failure.uncertainPageOutcome ? 'postcondition_unmet' : 'failed';
        navigation.errorCode = failure.errorCode;
      }
      if (failure.uncertainPageOutcome) {
        releaseDisposition = 'quarantined';
        releaseReason = 'native_search_page_outcome_unknown';
        targetPage = 'quarantined_on_uncertain_outcome';
      }
    }

    if (acquired) {
      try {
        const released = await this.#browserManager.releasePage({
          profileId: permit.profileId,
          pageAlias: acquired.page.pageAlias,
          pageLeaseId: acquired.lease.pageLeaseId,
          disposition: releaseDisposition,
          ...(releaseDisposition === 'quarantined' ? { quarantineReason: releaseReason } : {})
        });
        targetPage = released.state === 'retained_for_review'
          ? 'retained_after_run'
          : 'quarantined_on_uncertain_outcome';
      } catch (error) {
        if (!uncertainPageOutcome && errorCode === null) {
          const failure = failureFor(error);
          state = failure.state;
          terminalReason = failure.terminalReason;
          errorCode = failure.errorCode;
        }
        targetPage = 'quarantined_on_uncertain_outcome';
      }
    }

    const run = createBilibiliNativeSearchRunRecord({
      runId: permit.runId,
      collectorVersion: COLLECTOR_EXTENSION_VERSION,
      query,
      canonicalSearchUrl,
      startedAt: permit.startedAt,
      completedAt: new Date().toISOString(),
      state,
      errorCode,
      results,
      visualEvidence,
      actions,
      terminalReason,
      targetTabSelection,
      targetPage
    });
    const safetyReason = errorCode ?? terminalReason;
    try {
      const artifact = await this.#artifacts.record(run);
      return { run, artifact };
    } finally {
      await this.#accountSafety.finishAuthenticatedRun(permit.profileId, 'bilibili', permit.runId, safetyReason);
    }
  }

  async #observeUntil(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    observerBindingId: string;
    deadline: number;
  }): Promise<ReturnType<typeof bilibiliNativeSearchStrategyObservation>> {
    let observed: ReturnType<typeof bilibiliNativeSearchStrategyObservation> | null = null;
    while (Date.now() < input.deadline) {
      const result = await this.#readStrategyObservation(input);
      observed = bilibiliNativeSearchStrategyObservation(result);
      const results = projectBilibiliNativeSearchDom(observed.dom, new Date().toISOString());
      if (riskOutcome(observed.dom, results) || results) return observed;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    if (!observed) throw new Error('native_search_strategy_observation_unavailable');
    return observed;
  }

  async #readStrategyObservation(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    observerBindingId: string;
    deadline: number;
  }) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const context = await this.#leasedPageContext(input);
      try {
        return await this.#browserManager.readStrategyObservation({
          schemaVersion: 1,
          profileId: input.profileId,
          pageAlias: input.pageAlias,
          pageLeaseId: input.pageLeaseId,
          expectedRecordVersion: context.recordVersion,
          runId: input.runId,
          observerBindingId: input.observerBindingId,
          strategyId: BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
          deadlineMs: Math.min(OBSERVATION_DEADLINE_MS, remainingDeadline(input.deadline, 100))
        });
      } catch (error) {
        if (!(error instanceof BrowserHostError) || error.record.code !== 'managed_page_record_version_mismatch' || attempt === 1) {
          throw error;
        }
      }
    }
    throw new Error('native_search_local_version_unavailable');
  }

  async #captureVisualEvidence(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    deadline: number;
    actionId: string;
  }): Promise<BilibiliNativeSearchVisualEvidence> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const context = await this.#leasedPageContext(input);
      try {
        const visual = await this.#browserManager.capturePageVisualEvidence({
          profileId: input.profileId,
          pageAlias: input.pageAlias,
          pageLeaseId: input.pageLeaseId,
          expectedRecordVersion: context.recordVersion,
          runId: input.runId
        });
        return {
          phase: 'baseline',
          actionId: input.actionId,
          evidenceId: visual.evidenceId,
          capturedAt: visual.capturedAt,
          viewport: visual.viewport,
          screenshot: visual.screenshot
        };
      } catch (error) {
        if (!(error instanceof BrowserHostError) || error.record.code !== 'managed_page_record_version_mismatch' || attempt === 1) {
          throw error;
        }
        remainingDeadline(input.deadline, 100);
      }
    }
    throw new Error('native_search_visual_local_version_unavailable');
  }

  async #leasedPageContext(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
  }): Promise<LeasedPageContext> {
    const snapshot = await this.#browserManager.snapshot();
    const profile = snapshot.profiles.find((candidate) => candidate.profileId === input.profileId);
    const page = profile?.pages.find((candidate) => candidate.pageAlias === input.pageAlias);
    if (
      !page ||
      page.state !== 'leased' ||
      page.activeLease?.pageLeaseId !== input.pageLeaseId ||
      page.activeLease.runId !== input.runId
    ) throw new Error('native_search_managed_page_context_changed');
    return { recordVersion: page.recordVersion };
  }
}
