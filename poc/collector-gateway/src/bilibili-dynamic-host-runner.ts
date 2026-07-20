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
  type BilibiliDynamicDomSnapshot,
  type BilibiliDynamicOpusFieldDiagnostic,
  type BilibiliDynamicPageProjection,
  type BilibiliDynamicReservationOpusFieldDiagnostic,
  type BilibiliDynamicResponseEvidence,
  type BilibiliDynamicRunRecord,
  type BilibiliDynamicTerminalReason,
  type BilibiliDynamicVisualEvidence
} from './bilibili-dynamic-contract';
import {
  bilibiliDynamicStrategyObservation,
  type BilibiliDynamicStrategyObservation
} from './bilibili-dynamic-observation';
import {
  bilibiliDynamicCrossCheckDiagnostic,
  hasFullBilibiliDynamicDomResponseCrossCheck
} from './bilibili-dynamic-cross-check';
import { createBilibiliDynamicRunRecord } from './bilibili-dynamic-run-record';
import { bilibiliDynamicOpusFieldDiagnostic } from './bilibili-dynamic-opus-diagnostic';
import { bilibiliDynamicReservationOpusFieldDiagnostic } from './bilibili-dynamic-reservation-opus-diagnostic';
import { dynamicResponseEvidence, projectBilibiliDynamicPageWithDom } from './bilibili-dynamic-response';
import {
  BILIBILI_DYNAMIC_SECOND_PAGE_MAX_SCROLL_ACTIONS,
  BILIBILI_DYNAMIC_TRUSTED_SCROLL_DELTA_Y,
  BILIBILI_DYNAMIC_TWO_PAGE_LIMIT,
  bilibiliDynamicNavigationAction,
  bilibiliDynamicSecondPageScrollAction,
  completeBilibiliDynamicScrollAction,
  hasDuplicateBilibiliDynamicIds
} from './bilibili-dynamic-two-page-plan';
import type { CollectionBrowserManager } from './browser-manager';
import type { BrowserProfileRegistry } from './profiles';

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_DEADLINE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const INITIAL_OBSERVATION_TIMEOUT_MS = 15_000;
const AFTER_SCROLL_OBSERVATION_TIMEOUT_MS = 6_000;
const SCROLL_TIMEOUT_MS = 8_000;
const MINIMUM_OBSERVATION_COMMAND_MS = 250;

export interface BilibiliDynamicHostRunInput {
  profileId: string;
  canonicalProfileUrl: string;
}

export interface BilibiliDynamicHostRunResult {
  run: BilibiliDynamicRunRecord;
  artifact: BilibiliDynamicArtifactSummary;
}

interface LeasedPageContext {
  recordVersion: number;
  documentGeneration: number;
}

function input(value: BilibiliDynamicHostRunInput): BilibiliDynamicHostRunInput {
  if (!PROFILE_ID.test(value.profileId)) throw new Error('bilibili_dynamic_profile_invalid');
  const dynamic = bilibiliDynamicInput({
    canonicalProfileUrl: value.canonicalProfileUrl,
    maxPages: BILIBILI_DYNAMIC_TWO_PAGE_LIMIT
  });
  return { profileId: value.profileId, canonicalProfileUrl: dynamic.canonicalProfileUrl };
}

function pageSelection(selection: AcquirePageResult['selection']): BilibiliDynamicRunRecord['safeguards']['targetTabSelection'] {
  if (selection === 'created_new_page') return 'created_new_managed_tab';
  return selection === 'reused_exact_target'
    ? 'reused_matching_managed_tab'
    : 'reused_retained_managed_tab';
}

function riskOutcome(dom: BilibiliDynamicStrategyObservation['dom']): {
  state: BilibiliDynamicRunRecord['state'];
  terminalReason: BilibiliDynamicTerminalReason;
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
  return null;
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
    errorCode === 'scroll_outcome_unknown' ||
    errorCode === 'scroll_page_identity_unverified' ||
    errorCode === 'managed_page_document_generation_mismatch' ||
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

function pageDomSnapshot(dom: BilibiliDynamicDomSnapshot, previousCardCount: number): BilibiliDynamicDomSnapshot {
  return { ...dom, cards: dom.cards.slice(previousCardCount) };
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
    // Account Safety starts before any local setup. The bounded semantic-action
    // window starts only after the exact page lease and observer binding exist,
    // so a cold Host/Profile launch cannot silently consume the Bilibili
    // navigation-and-scroll budget while the safety permit is already active.
    let deadline = 0;
    const navigation = bilibiliDynamicNavigationAction(permit.runId);
    const actions: BilibiliDynamicAction[] = [navigation];
    const pages: BilibiliDynamicPageProjection[] = [];
    const visualEvidence: BilibiliDynamicVisualEvidence[] = [];
    let failedResponseEvidence: BilibiliDynamicResponseEvidence | null = null;
    let crossCheckDiagnostic: BilibiliDynamicCrossCheckDiagnostic | null = null;
    let reservationOpusFieldDiagnostic: BilibiliDynamicReservationOpusFieldDiagnostic | null = null;
    let opusFieldDiagnostic: BilibiliDynamicOpusFieldDiagnostic | null = null;
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

      const expiresAt = new Date(Date.now() + 55_000).toISOString();
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
        maximumResponseObservations: BILIBILI_DYNAMIC_TWO_PAGE_LIMIT,
        maximumPayloadBytes: 192 * 1024
      });
      deadline = Date.now() + RUN_DEADLINE_MS;

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
      releaseReason = 'dynamic_two_page_review_retained';

      const firstObserved = await this.#observeUntil({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        runId: permit.runId,
        observerBindingId,
        deadline,
        minimumResponses: 1,
        maximumWaitMs: INITIAL_OBSERVATION_TIMEOUT_MS
      }, stableAccountId);
      failedResponseEvidence = firstObserved.failedResponseEvidence;
      visualEvidence.push(await this.#captureVisualEvidence({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        runId: permit.runId,
        deadline,
        phase: 'baseline',
        actionId: navigation.actionId
      }));

      const initialRisk = riskOutcome(firstObserved.dom);
      if (initialRisk) {
        state = initialRisk.state;
        terminalReason = initialRisk.terminalReason;
        errorCode = initialRisk.errorCode;
      } else if (!firstObserved.responses[0]) {
        state = 'failed';
        terminalReason = firstObserved.failedResponseEvidence ? 'response_status_unavailable' : 'response_projection_failed';
        errorCode = firstObserved.failedResponseEvidence
          ? 'dynamic_observation_response_not_captured'
          : 'dynamic_observation_response_missing';
      } else {
        const firstPage = projectBilibiliDynamicPageWithDom(
          firstObserved.responses[0],
          stableAccountId,
          1,
          [],
          firstObserved.dom,
          new Date().toISOString()
        );
        if (!firstPage) {
          state = 'failed';
          terminalReason = 'response_projection_failed';
          errorCode = 'dynamic_response_projection_failed';
          failedResponseEvidence = dynamicResponseEvidence(firstObserved.responses[0], 1);
        } else if (!hasFullBilibiliDynamicDomResponseCrossCheck(firstPage.projection)) {
          reservationOpusFieldDiagnostic = bilibiliDynamicReservationOpusFieldDiagnostic({
            responseValue: firstObserved.responses[0].value,
            expectedAccountId: stableAccountId,
            dom: firstObserved.dom
          });
          opusFieldDiagnostic = bilibiliDynamicOpusFieldDiagnostic({
            responseValue: firstObserved.responses[0].value,
            expectedAccountId: stableAccountId,
            pageNumber: 1,
            dom: firstObserved.dom
          });
          state = 'failed';
          terminalReason = 'dom_response_mismatch';
          errorCode = 'dynamic_dom_response_cross_check_failed';
          failedResponseEvidence = dynamicResponseEvidence(firstObserved.responses[0], 1);
          crossCheckDiagnostic = bilibiliDynamicCrossCheckDiagnostic(firstPage.projection);
        } else {
          reservationOpusFieldDiagnostic = bilibiliDynamicReservationOpusFieldDiagnostic({
            responseValue: firstObserved.responses[0].value,
            expectedAccountId: stableAccountId,
            dom: firstObserved.dom
          });
          pages.push(firstPage.projection);
          if (!firstPage.candidate.hasMore) {
            state = 'completed';
            terminalReason = 'feed_terminal_reached';
            errorCode = null;
          } else {
            const secondObserved = await this.#scrollUntilSecondResponse({
              permit,
              acquired,
              observerBindingId,
              deadline,
              stableAccountId,
              actions,
              visualEvidence
            });
            if (!secondObserved) {
              state = 'partial';
              terminalReason = 'scroll_response_not_observed';
              errorCode = 'dynamic_second_response_not_captured';
            } else {
              failedResponseEvidence = secondObserved.failedResponseEvidence;
              const postScrollRisk = riskOutcome(secondObserved.dom);
              if (postScrollRisk) {
                state = postScrollRisk.state;
                terminalReason = postScrollRisk.terminalReason;
                errorCode = postScrollRisk.errorCode;
              } else if (!secondObserved.responses[1]) {
                state = 'failed';
                terminalReason = secondObserved.failedResponseEvidence
                  ? 'response_status_unavailable'
                  : 'scroll_response_not_observed';
                errorCode = secondObserved.failedResponseEvidence
                  ? 'dynamic_observation_second_response_not_captured'
                  : 'dynamic_second_response_not_captured';
              } else {
                const secondPage = projectBilibiliDynamicPageWithDom(
                  secondObserved.responses[1],
                  stableAccountId,
                  2,
                  pages.flatMap((page) => page.items),
                  secondObserved.dom,
                  new Date().toISOString()
                );
                if (!secondPage) {
                  state = 'failed';
                  terminalReason = 'response_projection_failed';
                  errorCode = 'dynamic_second_response_projection_failed';
                  failedResponseEvidence = dynamicResponseEvidence(secondObserved.responses[1], 2);
                } else if (hasDuplicateBilibiliDynamicIds([...pages, secondPage.projection])) {
                  state = 'failed';
                  terminalReason = 'duplicate_dynamic_id';
                  errorCode = 'dynamic_response_duplicate_id';
                  failedResponseEvidence = dynamicResponseEvidence(secondObserved.responses[1], 2);
                } else if (!hasFullBilibiliDynamicDomResponseCrossCheck(secondPage.projection)) {
                  // The response itself is valid and structurally aligned with
                  // the rendered page. Preserve its item-level evidence for
                  // review; only a card-level proof remains unresolved.
                  pages.push(secondPage.projection);
                  reservationOpusFieldDiagnostic = bilibiliDynamicReservationOpusFieldDiagnostic({
                    responseValue: secondObserved.responses[1].value,
                    expectedAccountId: stableAccountId,
                    dom: pageDomSnapshot(secondObserved.dom, pages.flatMap((page) => page.items).length)
                  });
                  opusFieldDiagnostic = bilibiliDynamicOpusFieldDiagnostic({
                    responseValue: secondObserved.responses[1].value,
                    expectedAccountId: stableAccountId,
                    pageNumber: 2,
                    dom: pageDomSnapshot(secondObserved.dom, pages.flatMap((page) => page.items).length)
                  });
                  state = 'partial';
                  terminalReason = 'dom_response_mismatch';
                  errorCode = 'dynamic_second_card_evidence_partial';
                  failedResponseEvidence = null;
                  crossCheckDiagnostic = bilibiliDynamicCrossCheckDiagnostic(secondPage.projection);
                } else {
                  pages.push(secondPage.projection);
                  state = secondPage.candidate.hasMore ? 'partial' : 'completed';
                  terminalReason = secondPage.candidate.hasMore ? 'budget_exhausted' : 'feed_terminal_reached';
                  errorCode = null;
                }
              }
            }
          }
        }
      }
    } catch (error) {
      const failure = failureFor(error);
      state = failure.state;
      terminalReason = failure.terminalReason;
      errorCode = failure.errorCode;
      uncertainPageOutcome = failure.uncertainPageOutcome;
      const latestAttempt = [...actions].reverse().find((action) => action.attempted && action.outcome !== 'completed');
      if (latestAttempt) {
        latestAttempt.outcome = failure.uncertainPageOutcome ? 'postcondition_unmet' : 'failed';
        latestAttempt.errorCode = failure.errorCode;
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
      actions,
      terminalReason,
      failedResponseEvidence,
      crossCheckDiagnostic,
      reservationOpusFieldDiagnostic,
      opusFieldDiagnostic,
      visualEvidence,
      plannedMaximumPages: BILIBILI_DYNAMIC_TWO_PAGE_LIMIT,
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

  async #scrollUntilSecondResponse(input: {
    permit: AccountSafetyRunPermit;
    acquired: AcquirePageResult;
    observerBindingId: string;
    deadline: number;
    stableAccountId: string;
    actions: BilibiliDynamicAction[];
    visualEvidence: BilibiliDynamicVisualEvidence[];
  }): Promise<BilibiliDynamicStrategyObservation | null> {
    for (let ordinal = 1; ordinal <= BILIBILI_DYNAMIC_SECOND_PAGE_MAX_SCROLL_ACTIONS; ordinal += 1) {
      const action = bilibiliDynamicSecondPageScrollAction(input.permit.runId, ordinal);
      input.actions.push(action);
      const context = await this.#leasedPageContext({
        profileId: input.permit.profileId,
        pageAlias: input.acquired.page.pageAlias,
        pageLeaseId: input.acquired.lease.pageLeaseId,
        runId: input.permit.runId
      });
      await this.#accountSafety.recordActionAttempt(
        input.permit.profileId,
        'bilibili',
        input.permit.runId,
        action.actionId
      );
      action.attempted = true;
      action.attemptCount = 1;
      const result = await this.#browserManager.scrollPage({
        profileId: input.permit.profileId,
        pageAlias: input.acquired.page.pageAlias,
        pageLeaseId: input.acquired.lease.pageLeaseId,
        runId: input.permit.runId,
        expectedRecordVersion: context.recordVersion,
        expectedDocumentGeneration: context.documentGeneration,
        actionId: action.actionId,
        deltaY: BILIBILI_DYNAMIC_TRUSTED_SCROLL_DELTA_Y,
        timeoutMs: Math.min(SCROLL_TIMEOUT_MS, remainingDeadline(input.deadline, 1_000))
      });
      completeBilibiliDynamicScrollAction(action, result);
      const observed = await this.#observeUntil({
        profileId: input.permit.profileId,
        pageAlias: input.acquired.page.pageAlias,
        pageLeaseId: input.acquired.lease.pageLeaseId,
        runId: input.permit.runId,
        observerBindingId: input.observerBindingId,
        deadline: input.deadline,
        minimumResponses: 2,
        maximumWaitMs: AFTER_SCROLL_OBSERVATION_TIMEOUT_MS
      }, input.stableAccountId);
      input.visualEvidence.push(await this.#captureVisualEvidence({
        profileId: input.permit.profileId,
        pageAlias: input.acquired.page.pageAlias,
        pageLeaseId: input.acquired.lease.pageLeaseId,
        runId: input.permit.runId,
        deadline: input.deadline,
        phase: 'after_trusted_scroll',
        actionId: action.actionId
      }));
      if (
        riskOutcome(observed.dom) ||
        observed.failedResponseEvidence ||
        observed.responses.length >= 2
      ) return observed;
    }
    return null;
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
    ) throw new Error('dynamic_managed_page_context_changed');
    return { recordVersion: page.recordVersion, documentGeneration: page.documentGeneration };
  }

  async #readStrategyResult(input: {
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
          strategyId: BILIBILI_DYNAMIC_STRATEGY_ID,
          deadlineMs: Math.min(INITIAL_OBSERVATION_TIMEOUT_MS, remainingDeadline(input.deadline, 100))
        });
      } catch (error) {
        if (!(error instanceof BrowserHostError) ||
          error.record.code !== 'managed_page_record_version_mismatch' || attempt === 1) throw error;
      }
    }
    throw new Error('dynamic_observation_local_version_unavailable');
  }

  async #observeUntil(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    observerBindingId: string;
    deadline: number;
    minimumResponses: 1 | 2;
    maximumWaitMs: number;
  }, expectedAccountId: string): Promise<BilibiliDynamicStrategyObservation> {
    const observationDeadline = Math.min(input.deadline, Date.now() + input.maximumWaitMs);
    let observed: BilibiliDynamicStrategyObservation | null = null;
    while (true) {
      const globalRemaining = remainingDeadline(input.deadline, 100);
      const observationRemaining = observationDeadline - Date.now();
      // The short observation window is a local read budget, not a failed
      // platform action and not the run deadline. Do not start a new bridge
      // read when it cannot receive its minimum bounded deadline.
      if (observationRemaining < MINIMUM_OBSERVATION_COMMAND_MS) break;
      const result = await this.#readStrategyResult({
        profileId: input.profileId,
        pageAlias: input.pageAlias,
        pageLeaseId: input.pageLeaseId,
        runId: input.runId,
        observerBindingId: input.observerBindingId,
        deadline: Date.now() + Math.min(globalRemaining, observationRemaining)
      });
      observed = bilibiliDynamicStrategyObservation(result, expectedAccountId);
      if (
        riskOutcome(observed.dom) ||
        observed.failedResponseEvidence ||
        observed.responses.length >= input.minimumResponses
      ) return observed;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    if (!observed) throw new Error('dynamic_observation_local_window_unavailable');
    return observed;
  }

  async #captureVisualEvidence(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    deadline: number;
    phase: BilibiliDynamicVisualEvidence['phase'];
    actionId: string;
  }): Promise<BilibiliDynamicVisualEvidence> {
    const visual = await this.#captureStableVisualEvidence(input);
    return {
      phase: input.phase,
      actionId: input.actionId,
      evidenceId: visual.evidenceId,
      capturedAt: visual.capturedAt,
      viewport: visual.viewport,
      screenshot: visual.screenshot
    };
  }

  async #captureStableVisualEvidence(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    deadline: number;
  }) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const context = await this.#leasedPageContext(input);
      try {
        return await this.#browserManager.capturePageVisualEvidence({
          profileId: input.profileId,
          pageAlias: input.pageAlias,
          pageLeaseId: input.pageLeaseId,
          expectedRecordVersion: context.recordVersion,
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
