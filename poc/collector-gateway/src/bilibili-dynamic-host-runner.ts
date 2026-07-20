import {
  BILIBILI_DYNAMIC_STRATEGY_ID,
  BrowserHostError,
  COLLECTOR_EXTENSION_VERSION,
  type AcquirePageResult,
  type PageReleaseDisposition
} from '@intelligence/collector-contracts';
import { randomUUID } from 'node:crypto';
import type { AccountSafetyRegistry, AccountSafetyRunPermit } from './account-safety';
import type { BilibiliDynamicArtifactStore, BilibiliDynamicArtifactSummary } from './bilibili-dynamic-artifacts';
import {
  bilibiliDynamicInput,
  bilibiliDynamicUrl,
  BILIBILI_DYNAMIC_FEED_PATH,
  safeBilibiliDynamicErrorCode,
  stableDynamicAccountId,
  type BilibiliDynamicAction,
  type BilibiliDynamicCrossCheckDiagnostic,
  type BilibiliDynamicPageProjection,
  type BilibiliDynamicResponseEvidence,
  type BilibiliDynamicRunRecord,
  type BilibiliDynamicTerminalReason,
  type BilibiliDynamicVisualEvidence
} from './bilibili-dynamic-contract';
import { bilibiliDynamicStrategyObservation } from './bilibili-dynamic-observation';
import {
  bilibiliDynamicCrossCheckDiagnostic,
  hasFullBilibiliDynamicDomResponseCrossCheck
} from './bilibili-dynamic-cross-check';
import { createBilibiliDynamicRunRecord } from './bilibili-dynamic-run-record';
import { dynamicResponseEvidence, projectBilibiliDynamicPageWithDom } from './bilibili-dynamic-response';
import type { CollectionBrowserManager } from './browser-manager';
import type { BrowserProfileRegistry } from './profiles';

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_DEADLINE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const OBSERVATION_DEADLINE_MS = 15_000;

export interface BilibiliDynamicHostRunInput {
  profileId: string;
  canonicalProfileUrl: string;
}

export interface BilibiliDynamicHostRunResult {
  run: BilibiliDynamicRunRecord;
  artifact: BilibiliDynamicArtifactSummary;
}

function input(value: BilibiliDynamicHostRunInput): BilibiliDynamicHostRunInput {
  if (!PROFILE_ID.test(value.profileId)) throw new Error('bilibili_dynamic_profile_invalid');
  const dynamic = bilibiliDynamicInput({ canonicalProfileUrl: value.canonicalProfileUrl, maxPages: 1 });
  return { profileId: value.profileId, canonicalProfileUrl: dynamic.canonicalProfileUrl };
}

function action(runId: string): BilibiliDynamicAction {
  return {
    actionId: `navigate_dynamic_${runId.replace(/-/g, '_')}`,
    intent: 'Navigate once to the canonical Bilibili account dynamic feed.',
    expectedPageNumber: 1,
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null
  };
}

function pageSelection(selection: AcquirePageResult['selection']): BilibiliDynamicRunRecord['safeguards']['targetTabSelection'] {
  if (selection === 'created_new_page') return 'created_new_managed_tab';
  return selection === 'reused_exact_target'
    ? 'reused_matching_managed_tab'
    : 'reused_retained_managed_tab';
}

function failureFor(error: unknown): {
  state: BilibiliDynamicRunRecord['state'];
  terminalReason: BilibiliDynamicTerminalReason;
  errorCode: string;
  uncertainPageOutcome: boolean;
} {
  const errorCode = safeBilibiliDynamicErrorCode(error);
  if (
    errorCode === 'navigation_outcome_unknown' ||
    errorCode === 'dynamic_strategy_document_context_changed' ||
    errorCode === 'dynamic_strategy_binding_context_rejected' ||
    errorCode === 'dynamic_managed_page_context_changed' ||
    errorCode === 'managed_page_record_version_mismatch' ||
    errorCode === 'managed_page_run_mismatch'
  ) return { state: 'failed', terminalReason: 'context_changed', errorCode, uncertainPageOutcome: true };
  if (errorCode === 'dynamic_strategy_observation_payload_too_large') {
    return { state: 'failed', terminalReason: 'response_projection_failed', errorCode, uncertainPageOutcome: false };
  }
  if (errorCode === 'run_deadline_exceeded') {
    return { state: 'failed', terminalReason: 'run_deadline_exceeded', errorCode, uncertainPageOutcome: true };
  }
  return { state: 'failed', terminalReason: 'source_unavailable', errorCode, uncertainPageOutcome: false };
}

function remainingDeadline(deadline: number, minimumMs: number): number {
  const remaining = deadline - Date.now();
  if (remaining < minimumMs) throw new Error('run_deadline_exceeded');
  return remaining;
}

export class BilibiliDynamicHostRunner {
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #browserManager: CollectionBrowserManager;
  readonly #profiles: BrowserProfileRegistry;
  readonly #artifacts: BilibiliDynamicArtifactStore;

  constructor(input: {
    accountSafety: AccountSafetyRegistry;
    browserManager: CollectionBrowserManager;
    profiles: BrowserProfileRegistry;
    artifacts: BilibiliDynamicArtifactStore;
  }) {
    this.#accountSafety = input.accountSafety;
    this.#browserManager = input.browserManager;
    this.#profiles = input.profiles;
    this.#artifacts = input.artifacts;
  }

  async run(rawInput: BilibiliDynamicHostRunInput): Promise<BilibiliDynamicHostRunResult> {
    const request = input(rawInput);
    const profile = this.#profiles.get(request.profileId);
    if (
      profile.kind !== 'collection' ||
      profile.platform !== 'bilibili' ||
      profile.account.category !== 'user_managed'
    ) throw new Error('bilibili_dynamic_collection_profile_required');

    const targetUrl = bilibiliDynamicUrl(request.canonicalProfileUrl);
    const stableAccountId = stableDynamicAccountId(request.canonicalProfileUrl);
    const permit = await this.#accountSafety.beginAuthenticatedRun(
      profile.profileId,
      'bilibili',
      'authenticated_dynamic_reconnaissance'
    );
    return await this.#runWithPermit(permit, targetUrl, stableAccountId);
  }

  async #runWithPermit(
    permit: AccountSafetyRunPermit,
    targetUrl: string,
    stableAccountId: string
  ): Promise<BilibiliDynamicHostRunResult> {
    const startedAt = permit.startedAt;
    const deadline = Date.parse(startedAt) + RUN_DEADLINE_MS;
    const navigation = action(permit.runId);
    const pages: BilibiliDynamicPageProjection[] = [];
    let failedResponseEvidence: BilibiliDynamicResponseEvidence | null = null;
    let crossCheckDiagnostic: BilibiliDynamicCrossCheckDiagnostic | null = null;
    let visualEvidence: BilibiliDynamicVisualEvidence | null = null;
    let state: BilibiliDynamicRunRecord['state'] = 'failed';
    let terminalReason: BilibiliDynamicTerminalReason = 'source_unavailable';
    let errorCode: string | null = null;
    let acquired: AcquirePageResult | null = null;
    let targetTabSelection: BilibiliDynamicRunRecord['safeguards']['targetTabSelection'] = 'not_acquired';
    let targetPage: BilibiliDynamicRunRecord['safeguards']['targetPage'] = 'not_acquired';
    let releaseDisposition: PageReleaseDisposition = 'quarantined';
    let releaseReason = 'dynamic_run_not_started';
    let uncertainPageOutcome = false;

    try {
      await this.#browserManager.launch(permit.profileId);
      acquired = await this.#browserManager.acquirePage({
        profileId: permit.profileId,
        taskId: `bilibili_dynamic_${permit.runId.replace(/-/g, '_')}`,
        runId: permit.runId,
        platform: 'bilibili',
        pageRole: 'dynamic_inventory',
        targetUrl,
        leaseDurationMs: RUN_DEADLINE_MS
      });
      targetTabSelection = pageSelection(acquired.selection);
      releaseReason = 'dynamic_strategy_binding_not_completed';

      const expiresAt = new Date(Math.min(deadline, Date.now() + 55_000)).toISOString();
      const observerBindingId = randomUUID();
      await this.#browserManager.bindStrategyObserver({
        schemaVersion: 1,
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        expectedRecordVersion: acquired.page.recordVersion,
        runId: permit.runId,
        observerBindingId,
        strategyId: BILIBILI_DYNAMIC_STRATEGY_ID,
        target: { canonicalUrl: targetUrl, stableAccountId },
        expiresAt,
        maximumResponseObservations: 1,
        maximumPayloadBytes: 192 * 1024
      });

      await this.#accountSafety.recordActionAttempt(
        permit.profileId,
        'bilibili',
        permit.runId,
        navigation.actionId
      );
      navigation.attempted = true;
      navigation.attemptCount = 1;
      await this.#browserManager.navigatePage({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        actionId: navigation.actionId,
        url: targetUrl,
        waitUntil: 'domcontentloaded',
        timeoutMs: Math.min(NAVIGATION_TIMEOUT_MS, remainingDeadline(deadline, 1_000))
      });
      navigation.outcome = 'completed';
      navigation.errorCode = null;
      releaseDisposition = 'retained_for_review';
      releaseReason = 'dynamic_single_page_review_retained';

      const observation = await this.#readStableObservation({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        runId: permit.runId,
        observerBindingId,
        deadline
      });
      const observed = bilibiliDynamicStrategyObservation(observation, stableAccountId);
      failedResponseEvidence = observed.failedResponseEvidence;
      const visual = await this.#captureStableVisualEvidence({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        runId: permit.runId,
        deadline
      });
      visualEvidence = {
        evidenceId: visual.evidenceId,
        capturedAt: visual.capturedAt,
        viewport: visual.viewport,
        screenshot: visual.screenshot
      };

      if (observed.dom.risk.verificationRequired) {
        state = 'partial';
        terminalReason = 'verification_required';
        errorCode = 'verification_required';
      } else if (observed.dom.risk.rateLimited) {
        state = 'partial';
        terminalReason = 'rate_limited';
        errorCode = 'rate_limited';
      } else if (observed.dom.risk.sourceUnavailable) {
        state = 'partial';
        terminalReason = 'source_unavailable';
        errorCode = 'source_unavailable';
      } else if (!observed.response) {
        state = 'failed';
        terminalReason = observed.failedResponseEvidence ? 'response_status_unavailable' : 'response_projection_failed';
        errorCode = observed.failedResponseEvidence
          ? 'dynamic_observation_response_not_captured'
          : 'dynamic_observation_response_missing';
      } else {
        const projected = projectBilibiliDynamicPageWithDom(
          observed.response,
          stableAccountId,
          1,
          [],
          observed.dom,
          observation.capturedAt
        );
        if (!projected) {
          state = 'failed';
          terminalReason = 'response_projection_failed';
          errorCode = 'dynamic_response_projection_failed';
          failedResponseEvidence = dynamicResponseEvidence(observed.response, 1);
        } else if (!hasFullBilibiliDynamicDomResponseCrossCheck(projected.projection)) {
          state = 'failed';
          terminalReason = 'dom_response_mismatch';
          errorCode = 'dynamic_dom_response_cross_check_failed';
          failedResponseEvidence = dynamicResponseEvidence(observed.response, 1);
          crossCheckDiagnostic = bilibiliDynamicCrossCheckDiagnostic(projected.projection);
        } else {
          pages.push(projected.projection);
          state = projected.candidate.hasMore ? 'partial' : 'completed';
          terminalReason = projected.candidate.hasMore ? 'budget_exhausted' : 'feed_terminal_reached';
          errorCode = null;
        }
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
        releaseReason = 'dynamic_page_outcome_unknown';
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
        if (uncertainPageOutcome) {
          targetPage = 'quarantined_on_uncertain_outcome';
        } else {
          const failure = failureFor(error);
          if (errorCode === null) {
            state = 'failed';
            terminalReason = failure.terminalReason;
            errorCode = failure.errorCode;
          }
          targetPage = 'quarantined_on_uncertain_outcome';
        }
      }
    }

    const run = createBilibiliDynamicRunRecord({
      runId: permit.runId,
      collectorVersion: COLLECTOR_EXTENSION_VERSION,
      targetUrl,
      stableAccountId,
      startedAt,
      completedAt: new Date().toISOString(),
      state,
      errorCode,
      pages,
      actions: [navigation],
      terminalReason,
      failedResponseEvidence,
      crossCheckDiagnostic,
      visualEvidence,
      targetTabSelection,
      targetPage
    });
    const safetyReason = errorCode ?? terminalReason;
    try {
      const artifact = await this.#artifacts.record(run);
      return { run, artifact };
    } finally {
      await this.#accountSafety.finishAuthenticatedRun(
        permit.profileId,
        'bilibili',
        permit.runId,
        safetyReason
      );
    }
  }

  async #leasedRecordVersion(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
  }): Promise<number> {
    const snapshot = await this.#browserManager.snapshot();
    const profile = snapshot.profiles.find((candidate) => candidate.profileId === input.profileId);
    const page = profile?.pages.find((candidate) => candidate.pageAlias === input.pageAlias);
    if (
      !page ||
      page.state !== 'leased' ||
      page.activeLease?.pageLeaseId !== input.pageLeaseId ||
      page.activeLease.runId !== input.runId
    ) throw new Error('dynamic_managed_page_context_changed');
    return page.recordVersion;
  }

  async #readStableObservation(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    observerBindingId: string;
    deadline: number;
  }) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const expectedRecordVersion = await this.#leasedRecordVersion(input);
      try {
        return await this.#browserManager.readStrategyObservation({
          schemaVersion: 1,
          profileId: input.profileId,
          pageAlias: input.pageAlias,
          pageLeaseId: input.pageLeaseId,
          expectedRecordVersion,
          runId: input.runId,
          observerBindingId: input.observerBindingId,
          strategyId: BILIBILI_DYNAMIC_STRATEGY_ID,
          deadlineMs: Math.min(OBSERVATION_DEADLINE_MS, remainingDeadline(input.deadline, 100))
        });
      } catch (error) {
        if (!(error instanceof BrowserHostError) ||
          error.record.code !== 'managed_page_record_version_mismatch' || attempt === 1) throw error;
      }
    }
    throw new Error('dynamic_observation_local_version_unavailable');
  }

  async #captureStableVisualEvidence(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    deadline: number;
  }) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const expectedRecordVersion = await this.#leasedRecordVersion(input);
      try {
        return await this.#browserManager.capturePageVisualEvidence({
          profileId: input.profileId,
          pageAlias: input.pageAlias,
          pageLeaseId: input.pageLeaseId,
          expectedRecordVersion,
          runId: input.runId
        });
      } catch (error) {
        if (!(error instanceof BrowserHostError) ||
          error.record.code !== 'managed_page_record_version_mismatch' || attempt === 1) throw error;
        remainingDeadline(input.deadline, 100);
      }
    }
    throw new Error('dynamic_visual_local_version_unavailable');
  }

}
