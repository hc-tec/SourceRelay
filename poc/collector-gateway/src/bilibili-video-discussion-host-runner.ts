import {
  BILIBILI_DISCUSSION_STRATEGY_ID,
  BILIBILI_VIDEO_DISCUSSION_INTERACTION_SCHEMA_VERSION,
  BrowserHostError,
  COLLECTOR_EXTENSION_VERSION,
  type AcquirePageResult,
  type BilibiliVideoDiscussionInteractionAction,
  type BilibiliVideoDiscussionInteractionResult,
  type PageReleaseDisposition,
  type StrategyBindingDiagnostics
} from '@intelligence/collector-contracts';
import { randomUUID } from 'node:crypto';
import type { AccountSafetyRegistry, AccountSafetyRunPermit } from './account-safety';
import type {
  BilibiliVideoDiscussionArtifactStore,
  BilibiliVideoDiscussionArtifactSummary
} from './bilibili-video-discussion-artifacts';
import {
  bilibiliVideoDiscussionBvid,
  bilibiliVideoDiscussionInput,
  mergeBilibiliVideoDiscussionRootComments,
  projectBilibiliVideoDiscussionDom,
  recordBilibiliVideoDiscussionReplyPage,
  BILIBILI_VIDEO_DISCUSSION_MAX_ROOT_COMMENTS,
  type BilibiliVideoDiscussionAction,
  type BilibiliVideoDiscussionProjection,
  type BilibiliVideoDiscussionReplyPageObservation,
  type BilibiliVideoDiscussionRunRecord,
  type BilibiliVideoDiscussionTerminalReason
} from './bilibili-video-discussion-contract';
import {
  bilibiliVideoDiscussionObservationWaitState,
  bilibiliVideoDiscussionStrategyObservation
} from './bilibili-video-discussion-observation';
import {
  createBilibiliVideoDiscussionActionLedger,
  createBilibiliVideoDiscussionScrollAction
} from './bilibili-video-discussion-action-ledger';
import { createBilibiliVideoDiscussionRunRecord } from './bilibili-video-discussion-run-record';
import type { CollectionBrowserManager } from './browser-manager';
import type { BrowserProfileRegistry } from './profiles';

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_DEADLINE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const OBSERVATION_DEADLINE_MS = 15_000;
const INITIAL_OBSERVATION_MAX_WAIT_MS = 8_000;
const ROOT_SCROLL_MAX_ACTIONS = 3;
const ROOT_PROGRESS_OBSERVATION_MAX_WAIT_MS = 3_000;
const DOCUMENT_STABILITY_QUIET_MS = 2_500;
const DOCUMENT_STABILITY_MAX_WAIT_MS = 8_000;
// Keep the short-lived extension binding alive through the full run deadline
// plus a small IPC/cleanup margin. It is still removed by the next bind or
// expiry cleanup and does not extend the platform-action budget.
const OBSERVER_BINDING_TTL_MS = RUN_DEADLINE_MS + 2_000;
const OBSERVATION_POLL_MS = 250;

export interface BilibiliVideoDiscussionHostRunInput {
  profileId: string;
  canonicalVideoUrl: string;
  actions?: BilibiliVideoDiscussionInteractionAction[];
}

export interface BilibiliVideoDiscussionHostRunResult {
  run: BilibiliVideoDiscussionRunRecord;
  artifact: BilibiliVideoDiscussionArtifactSummary;
}

class DiscussionObservationError extends Error {
  readonly bindingDiagnostics: StrategyBindingDiagnostics | null;

  constructor(cause: unknown, bindingDiagnostics: StrategyBindingDiagnostics | null) {
    super(cause instanceof Error ? cause.message : 'video_discussion_strategy_observation_failed');
    this.name = 'DiscussionObservationError';
    this.bindingDiagnostics = bindingDiagnostics;
  }
}

function input(value: BilibiliVideoDiscussionHostRunInput): BilibiliVideoDiscussionHostRunInput & {
  actions: BilibiliVideoDiscussionInteractionAction[];
} {
  if (!PROFILE_ID.test(value.profileId)) throw new Error('bilibili_video_discussion_profile_invalid');
  return {
    profileId: value.profileId,
    ...bilibiliVideoDiscussionInput({ canonicalVideoUrl: value.canonicalVideoUrl, actions: value.actions })
  };
}

function pageSelection(selection: AcquirePageResult['selection']): BilibiliVideoDiscussionRunRecord['safeguards']['targetTabSelection'] {
  if (selection === 'created_new_page') return 'created_new_managed_tab';
  return selection === 'reused_exact_target' ? 'reused_matching_managed_tab' : 'reused_retained_managed_tab';
}

function riskOutcome(dom: ReturnType<typeof bilibiliVideoDiscussionStrategyObservation>['dom']): {
  state: BilibiliVideoDiscussionRunRecord['state'];
  terminalReason: BilibiliVideoDiscussionTerminalReason;
  errorCode: string;
} | null {
  if (dom.risk.verificationRequired) return { state: 'partial', terminalReason: 'verification_required', errorCode: 'verification_required' };
  if (dom.risk.rateLimited) return { state: 'partial', terminalReason: 'rate_limited', errorCode: 'rate_limited' };
  if (dom.risk.sourceUnavailable) return { state: 'partial', terminalReason: 'source_unavailable', errorCode: 'source_unavailable' };
  return null;
}

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof BrowserHostError
    ? error.record.code
    : error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(candidate) ? candidate : 'video_discussion_runner_failed';
}

function failureFor(error: unknown): {
  state: BilibiliVideoDiscussionRunRecord['state'];
  terminalReason: BilibiliVideoDiscussionTerminalReason;
  errorCode: string;
  uncertainPageOutcome: boolean;
} {
  const errorCode = safeErrorCode(error);
  if (
    errorCode === 'navigation_outcome_unknown' ||
    errorCode === 'scroll_outcome_unknown' ||
    errorCode === 'scroll_page_identity_unverified' ||
    errorCode === 'managed_page_document_generation_mismatch' ||
    errorCode === 'managed_page_record_version_mismatch' ||
    errorCode === 'managed_page_run_mismatch' ||
    errorCode === 'bilibili_video_discussion_interaction_outcome_unknown' ||
    errorCode === 'video_discussion_document_stability_timeout' ||
    errorCode === 'video_discussion_strategy_document_context_changed' ||
    errorCode === 'video_discussion_managed_page_context_changed'
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

function scrollDeltaY(dom: ReturnType<typeof bilibiliVideoDiscussionStrategyObservation>['dom']): number {
  const y = dom.commentHostBounds?.y ?? 900;
  return Math.max(200, Math.min(1_200, Math.ceil(y - 120)));
}

export class BilibiliVideoDiscussionHostRunner {
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #browserManager: CollectionBrowserManager;
  readonly #profiles: BrowserProfileRegistry;
  readonly #artifacts: BilibiliVideoDiscussionArtifactStore;

  constructor(input: {
    accountSafety: AccountSafetyRegistry;
    browserManager: CollectionBrowserManager;
    profiles: BrowserProfileRegistry;
    artifacts: BilibiliVideoDiscussionArtifactStore;
  }) {
    this.#accountSafety = input.accountSafety;
    this.#browserManager = input.browserManager;
    this.#profiles = input.profiles;
    this.#artifacts = input.artifacts;
  }

  async run(rawInput: BilibiliVideoDiscussionHostRunInput): Promise<BilibiliVideoDiscussionHostRunResult> {
    const request = input(rawInput);
    const profile = this.#profiles.get(request.profileId);
    if (profile.kind !== 'collection' || profile.platform !== 'bilibili' || profile.account.category !== 'user_managed') {
      throw new Error('bilibili_video_discussion_collection_profile_required');
    }
    const permit = await this.#accountSafety.beginAuthenticatedRun(
      profile.profileId,
      'bilibili',
      'authenticated_interaction_reconnaissance'
    );
    return await this.#runWithPermit(
      permit,
      request.canonicalVideoUrl,
      bilibiliVideoDiscussionBvid(request.canonicalVideoUrl),
      request.actions
    );
  }

  async #runWithPermit(
    permit: AccountSafetyRunPermit,
    canonicalVideoUrl: string,
    bvid: string,
    requestedActions: BilibiliVideoDiscussionInteractionAction[]
  ): Promise<BilibiliVideoDiscussionHostRunResult> {
    const actionLedger = createBilibiliVideoDiscussionActionLedger(permit.runId, requestedActions);
    const { navigation, firstScroll, requestedInteractionActions, actions } = actionLedger;
    const interactionResults: BilibiliVideoDiscussionInteractionResult[] = [];
    let deadline = 0;
    let acquired: AcquirePageResult | null = null;
    let discussion: BilibiliVideoDiscussionProjection | null = null;
    let visualEvidence: BilibiliVideoDiscussionRunRecord['visualEvidence'] = null;
    let state: BilibiliVideoDiscussionRunRecord['state'] = 'failed';
    let terminalReason: BilibiliVideoDiscussionTerminalReason = 'dom_projection_failed';
    let errorCode: string | null = null;
    let bindingDiagnostics: StrategyBindingDiagnostics | null = null;
    let releaseDisposition: PageReleaseDisposition = 'quarantined';
    let releaseReason = 'video_discussion_run_not_started';
    let uncertainPageOutcome = false;
    let targetTabSelection: BilibiliVideoDiscussionRunRecord['safeguards']['targetTabSelection'] = 'not_acquired';
    let targetPage: BilibiliVideoDiscussionRunRecord['safeguards']['targetPage'] = 'not_acquired';
    try {
      await this.#browserManager.launch(permit.profileId);
      acquired = await this.#browserManager.acquirePage({
        profileId: permit.profileId,
        taskId: `bilibili_video_discussion_${permit.runId.replace(/-/g, '_')}`,
        runId: permit.runId,
        platform: 'bilibili',
        pageRole: 'video_discussion',
        // Bilibili normalises the live document to a trailing slash after
        // navigation. Keep the pool identity in that same form so a retained
        // exact-target tab can be leased again instead of consuming capacity.
        targetUrl: `${canonicalVideoUrl}/`,
        leaseDurationMs: RUN_DEADLINE_MS
      });
      targetTabSelection = pageSelection(acquired.selection);
      releaseReason = 'video_discussion_strategy_binding_not_completed';
      const observerBindingId = randomUUID();
      await this.#browserManager.bindStrategyObserver({
        schemaVersion: 1,
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        expectedRecordVersion: acquired.page.recordVersion,
        runId: permit.runId,
        observerBindingId,
        strategyId: BILIBILI_DISCUSSION_STRATEGY_ID,
        target: { canonicalUrl: canonicalVideoUrl, bvid },
        expiresAt: new Date(Date.now() + OBSERVER_BINDING_TTL_MS).toISOString(),
        maximumResponseObservations: 0,
        maximumPayloadBytes: 128 * 1024,
        documentBindingMode: acquired.selection === 'reused_exact_target' ? 'next_navigation_only' : 'current_document_or_next_navigation'
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
        url: canonicalVideoUrl,
        waitUntil: 'domcontentloaded',
        timeoutMs: Math.min(NAVIGATION_TIMEOUT_MS, remainingDeadline(deadline, 1_000))
      });
      navigation.outcome = 'completed';
      releaseDisposition = 'retained_for_review';
      releaseReason = 'video_discussion_review_retained';

      // Bilibili can commit a second main-frame document shortly after the
      // first DOMContentLoaded while keeping the same BVID. Wait for a quiet
      // document-generation window before taking any scroll action; this is
      // local ledger observation, not a navigation or retry.
      await this.#waitForDocumentStability({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        runId: permit.runId,
        deadline
      });

      const observedBeforeScroll = await this.#observeUntil({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        runId: permit.runId,
        observerBindingId,
        deadline,
        bvid,
        requireViewport: false,
        requireContentReady: false,
        maxWaitMs: INITIAL_OBSERVATION_MAX_WAIT_MS
      });
      const initialRisk = riskOutcome(observedBeforeScroll.dom);
      if (initialRisk) {
        state = initialRisk.state;
        terminalReason = initialRisk.terminalReason;
        errorCode = initialRisk.errorCode;
        firstScroll.outcome = 'risk_stopped';
        firstScroll.errorCode = errorCode;
      } else {
        let observedAfterScroll = observedBeforeScroll;
        let capturedAfterScroll = observedBeforeScroll.dom.commentHostInViewport;
        let accumulatedRootComments = mergeBilibiliVideoDiscussionRootComments(
          [],
          observedBeforeScroll.dom.rootCommentTexts
        );
        let rootProgressed = false;
        if (capturedAfterScroll) {
          // The retained target may already be at the discussion viewport.
          // This is a local precondition result, not a synthetic scroll.
          firstScroll.outcome = 'completed';
        } else {
          try {
            await this.#performRootScroll({
              profileId: permit.profileId,
              pageAlias: acquired.page.pageAlias,
              pageLeaseId: acquired.lease.pageLeaseId,
              runId: permit.runId,
              bvid,
              action: firstScroll,
              dom: observedBeforeScroll.dom,
              deadline
            });
            firstScroll.outcome = 'completed';
            capturedAfterScroll = true;
            const progress = await this.#observeRootProgress({
              profileId: permit.profileId,
              pageAlias: acquired.page.pageAlias,
              pageLeaseId: acquired.lease.pageLeaseId,
              runId: permit.runId,
              observerBindingId,
              deadline,
              bvid,
              previousRootComments: accumulatedRootComments,
              fallbackObserved: observedBeforeScroll
            });
            observedAfterScroll = progress.observed;
            accumulatedRootComments = mergeBilibiliVideoDiscussionRootComments(
              accumulatedRootComments,
              progress.observed.dom.rootCommentTexts
            );
            rootProgressed = progress.progressed;
          } catch (error) {
            if (safeErrorCode(error) === 'scroll_precondition_unmet' && !firstScroll.attempted) {
              firstScroll.outcome = 'prerequisite_unmet';
              firstScroll.errorCode = safeErrorCode(error);
            } else {
              throw error;
            }
          }
        }

        // Once the first scroll has produced new visible roots, take at most
        // two more trusted wheel snapshots.  Stop on the first no-progress
        // window or a local scroll precondition failure; never keep clicking
        // or scrolling just to force a larger result.
        if (capturedAfterScroll && firstScroll.attempted && rootProgressed) {
          for (let ordinal = 2; ordinal <= ROOT_SCROLL_MAX_ACTIONS; ordinal += 1) {
            if (accumulatedRootComments.length >= BILIBILI_VIDEO_DISCUSSION_MAX_ROOT_COMMENTS) break;
            const nextScroll = createBilibiliVideoDiscussionScrollAction(permit.runId, ordinal);
            actionLedger.appendScroll(nextScroll);
            try {
              await this.#performRootScroll({
                profileId: permit.profileId,
                pageAlias: acquired.page.pageAlias,
                pageLeaseId: acquired.lease.pageLeaseId,
                runId: permit.runId,
                bvid,
                action: nextScroll,
                dom: observedAfterScroll.dom,
                deadline
              });
              nextScroll.outcome = 'completed';
              const progress = await this.#observeRootProgress({
                profileId: permit.profileId,
                pageAlias: acquired.page.pageAlias,
                pageLeaseId: acquired.lease.pageLeaseId,
                runId: permit.runId,
                observerBindingId,
                deadline,
                bvid,
                previousRootComments: accumulatedRootComments,
                fallbackObserved: observedAfterScroll
              });
              observedAfterScroll = progress.observed;
              const nextRootComments = mergeBilibiliVideoDiscussionRootComments(
                accumulatedRootComments,
                progress.observed.dom.rootCommentTexts
              );
              rootProgressed = nextRootComments.length > accumulatedRootComments.length;
              accumulatedRootComments = nextRootComments;
              if (!rootProgressed) break;
            } catch (error) {
              if (safeErrorCode(error) === 'scroll_precondition_unmet' && !nextScroll.attempted) {
                nextScroll.outcome = 'prerequisite_unmet';
                nextScroll.errorCode = safeErrorCode(error);
                break;
              }
              throw error;
            }
          }
        }

        if (capturedAfterScroll && observedAfterScroll === observedBeforeScroll) {
          observedAfterScroll = await this.#observeUntil({
            profileId: permit.profileId,
            pageAlias: acquired.page.pageAlias,
            pageLeaseId: acquired.lease.pageLeaseId,
            runId: permit.runId,
            observerBindingId,
            deadline,
            bvid,
            requireViewport: true,
            requireContentReady: true,
            maxWaitMs: remainingDeadline(deadline, 1_000)
          });
        }
        const afterRisk = riskOutcome(observedAfterScroll.dom);
        if (afterRisk) {
          state = afterRisk.state;
          terminalReason = afterRisk.terminalReason;
          errorCode = afterRisk.errorCode;
        } else {
          const projectedDom = {
            ...observedAfterScroll.dom,
            rootCommentTexts: accumulatedRootComments
          };
          discussion = projectBilibiliVideoDiscussionDom(projectedDom, bvid, capturedAfterScroll, new Date().toISOString());
          if (!discussion) {
            state = 'failed';
            terminalReason = 'dom_projection_failed';
            errorCode = 'video_discussion_dom_projection_failed';
          } else if (discussion.loginGateVisible) {
            state = 'partial';
            terminalReason = 'login_required';
            errorCode = 'login_required';
          } else {
            state = 'completed';
            terminalReason = 'discussion_ready';
            errorCode = null;
          }
        }
        // Extra trusted scrolls are added above at the moment they are
        // scheduled.  Append the requested interaction records only after
        // that phase so even unattempted records retain the real phase order.
        actionLedger.appendRequestedInteractions();
        if (discussion && !discussion.loginGateVisible && requestedActions.length > 0) {
          for (const requestedAction of requestedActions) {
            const actionRecord = requestedInteractionActions.find((candidate) => candidate.kind === requestedAction);
            if (!actionRecord) throw new Error('video_discussion_interaction_action_missing');
            let hostCallStarted = false;
            try {
              const context = await this.#leasedPageContext({
                profileId: permit.profileId,
                pageAlias: acquired.page.pageAlias,
                pageLeaseId: acquired.lease.pageLeaseId,
                runId: permit.runId
              });
              await this.#accountSafety.recordActionAttempt(
                permit.profileId,
                'bilibili',
                permit.runId,
                actionRecord.actionId
              );
              hostCallStarted = true;
              const interaction = await this.#browserManager.clickBilibiliVideoDiscussionControl({
                schemaVersion: BILIBILI_VIDEO_DISCUSSION_INTERACTION_SCHEMA_VERSION,
                profileId: permit.profileId,
                pageAlias: acquired.page.pageAlias,
                pageLeaseId: acquired.lease.pageLeaseId,
                runId: permit.runId,
                expectedRecordVersion: context.recordVersion,
                expectedDocumentGeneration: context.documentGeneration,
                actionId: actionRecord.actionId,
                action: requestedAction,
                bvid,
                timeoutMs: Math.min(20_000, remainingDeadline(deadline, 1_000))
              });
              interactionResults.push(interaction);
              const platformInputAttempted = interaction.inputKind !== 'none';
              actionRecord.attempted = platformInputAttempted;
              actionRecord.attemptCount = platformInputAttempted ? 1 : 0;
              if (platformInputAttempted) {
                await this.#accountSafety.recordPlatformActionAttempt(
                  permit.profileId,
                  'bilibili',
                  permit.runId,
                  actionRecord.actionId
                );
              }
              actionRecord.outcome = 'completed';
              if (requestedAction === 'select_latest_comments') {
                // Sorting replaces the visible virtualised root window. Read
                // the strategy observation again so the saved roots belong
                // to the selected order instead of mixing hot and latest
                // snapshots.
                const resorted = await this.#observeUntil({
                  profileId: permit.profileId,
                  pageAlias: acquired.page.pageAlias,
                  pageLeaseId: acquired.lease.pageLeaseId,
                  runId: permit.runId,
                  observerBindingId,
                  deadline,
                  bvid,
                  requireViewport: true,
                  requireContentReady: true,
                  maxWaitMs: Math.min(5_000, remainingDeadline(deadline, 1_000))
                });
                const resortedRisk = riskOutcome(resorted.dom);
                if (resortedRisk) {
                  state = resortedRisk.state;
                  terminalReason = resortedRisk.terminalReason;
                  errorCode = resortedRisk.errorCode;
                  break;
                }
                accumulatedRootComments = mergeBilibiliVideoDiscussionRootComments(
                  [],
                  resorted.dom.rootCommentTexts
                );
                const resortedDiscussion = projectBilibiliVideoDiscussionDom(
                  { ...resorted.dom, rootCommentTexts: accumulatedRootComments },
                  bvid,
                  capturedAfterScroll,
                  new Date().toISOString()
                );
                if (!resortedDiscussion) throw new Error('video_discussion_dom_projection_failed');
                discussion = { ...resortedDiscussion, sort: 'latest' };
              } else if (requestedAction !== 'reveal_second_thread') {
                const threadOrdinal = interaction.threadOrdinal;
                const pageObservation: BilibiliVideoDiscussionReplyPageObservation = {
                  replies: interaction.after.dom.firstThreadReplies,
                  paginationVisible: interaction.after.dom.replyPaginationVisible,
                  replyPage: interaction.after.dom.replyPage,
                  replyPageCount: interaction.after.dom.replyPageCount,
                  replyHasMore: interaction.after.dom.replyHasMore,
                  coverage: interaction.after.dom.replyCoverage
                };
                const mode = requestedAction === 'reveal_first_thread_pagination' ||
                  requestedAction === 'reveal_second_thread_pagination'
                  ? 'refresh' as const
                  : 'append' as const;
                // Expand/next actions append a bounded observed page. A
                // pagination-reveal action only refreshes metadata for the
                // already observed current page and must not duplicate it.
                const replyThread = recordBilibiliVideoDiscussionReplyPage(
                  discussion.replyThreads.find((candidate) => candidate.threadOrdinal === threadOrdinal),
                  { threadOrdinal, observation: pageObservation, mode }
                );
                const replyThreads = [
                  ...discussion.replyThreads.filter((candidate) => candidate.threadOrdinal !== threadOrdinal),
                  replyThread
                ].sort((left, right) => left.threadOrdinal - right.threadOrdinal);
                discussion = {
                  ...discussion,
                  replyThreads,
                  ...(threadOrdinal === 0 ? {
                    firstThreadExpandVisible: false,
                    firstThreadExpanded: true,
                    firstThreadReplies: replyThread.replies,
                    replyPaginationVisible: replyThread.paginationVisible,
                    replyPage: replyThread.page,
                    replyPageCount: replyThread.pageCount,
                    replyHasMore: replyThread.hasMore,
                    replyCoverage: replyThread.coverage
                  } : {})
                };
              }
            } catch (error) {
              const actionErrorCode = safeErrorCode(error);
              actionRecord.errorCode = actionErrorCode;
              const platformActionAttempted = hostCallStarted &&
                (!(error instanceof BrowserHostError) || error.record.platformActionAttempted);
              if (platformActionAttempted) {
                actionRecord.attempted = true;
                actionRecord.attemptCount = 1;
                await this.#accountSafety.recordPlatformActionAttempt(
                  permit.profileId,
                  'bilibili',
                  permit.runId,
                  actionRecord.actionId
                );
                actionRecord.outcome = 'postcondition_unmet';
                throw error;
              }
              actionRecord.outcome = 'prerequisite_unmet';
              state = 'partial';
              terminalReason = 'interaction_prerequisite_unmet';
              errorCode = actionErrorCode;
              break;
            }
          }
          if (state === 'completed' &&
            actions.filter((action) => action.kind === 'select_latest_comments' || action.kind === 'expand_first_thread' ||
              action.kind === 'reveal_second_thread' ||
              action.kind === 'reveal_first_thread_pagination' || action.kind === 'expand_second_thread' ||
              action.kind === 'reveal_second_thread_pagination' || action.kind === 'next_first_thread_page' ||
              action.kind === 'next_second_thread_page')
              .every((action) => action.outcome === 'completed')) {
            terminalReason = 'discussion_ready';
          }
        }
        visualEvidence = await this.#captureVisualEvidence({
          profileId: permit.profileId,
          pageAlias: acquired.page.pageAlias,
          pageLeaseId: acquired.lease.pageLeaseId,
          runId: permit.runId,
          deadline
        });
      }
    } catch (error) {
      if (error instanceof DiscussionObservationError) bindingDiagnostics = error.bindingDiagnostics;
      const failure = failureFor(error);
      state = failure.state;
      terminalReason = failure.terminalReason;
      errorCode = failure.errorCode;
      uncertainPageOutcome = failure.uncertainPageOutcome;
      const attemptedAction = actions.find((candidate) => candidate.attempted && candidate.outcome !== 'completed') ?? null;
      if (attemptedAction && attemptedAction.outcome !== 'completed' && attemptedAction.errorCode === null) {
        attemptedAction.outcome = failure.uncertainPageOutcome ? 'postcondition_unmet' : 'failed';
        attemptedAction.errorCode = failure.errorCode;
      }
      if (failure.uncertainPageOutcome) {
        releaseDisposition = 'quarantined';
        releaseReason = 'video_discussion_page_outcome_unknown';
        targetPage = 'quarantined_on_uncertain_outcome';
      }
    }

    if (acquired) {
      const livePage = (await this.#browserManager.snapshot()).profiles
        .find((profile) => profile.profileId === permit.profileId)?.pages
        .find((page) => page.pageAlias === acquired!.page.pageAlias);
      const pageLeaseActive = Boolean(livePage?.activeLease);
      if (pageLeaseActive) {
        try {
          const released = await this.#browserManager.releasePage({
            profileId: permit.profileId,
            pageAlias: acquired.page.pageAlias,
            pageLeaseId: acquired.lease.pageLeaseId,
            disposition: releaseDisposition,
            ...(releaseDisposition === 'quarantined' ? { quarantineReason: releaseReason } : {})
          });
          targetPage = released.state === 'retained_for_review' ? 'retained_after_run' : 'quarantined_on_uncertain_outcome';
        } catch {
          targetPage = 'quarantined_on_uncertain_outcome';
        }
      }
    }

    // If navigation/observation stopped before the normal interaction phase,
    // still persist the requested records after all actions that actually ran.
    // They remain prerequisite_unmet and cannot be mistaken for platform
    // attempts, while the ledger stays ordered by execution phase.
    actionLedger.appendRequestedInteractions();

    const run = createBilibiliVideoDiscussionRunRecord({
      runId: permit.runId,
      collectorVersion: COLLECTOR_EXTENSION_VERSION,
      canonicalVideoUrl,
      bvid,
      startedAt: permit.startedAt,
      completedAt: new Date().toISOString(),
      state,
      errorCode,
      discussion,
      interactions: interactionResults,
      visualEvidence,
      bindingDiagnostics,
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
      await this.#accountSafety.finishAuthenticatedRun(
        permit.profileId,
        'bilibili',
        permit.runId,
        safetyReason,
        new Date(),
        actions.some((action) => action.attempted && action.outcome !== 'completed')
      );
    }
  }

  async #performRootScroll(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    bvid: string;
    action: BilibiliVideoDiscussionAction;
    dom: ReturnType<typeof bilibiliVideoDiscussionStrategyObservation>['dom'];
    deadline: number;
  }): Promise<void> {
    await this.#accountSafety.recordActionAttempt(
      input.profileId,
      'bilibili',
      input.runId,
      input.action.actionId
    );
    const context = await this.#leasedPageContext({
      profileId: input.profileId,
      pageAlias: input.pageAlias,
      pageLeaseId: input.pageLeaseId,
      runId: input.runId
    });
    let hostCallStarted = false;
    try {
      hostCallStarted = true;
      await this.#browserManager.scrollPage({
        profileId: input.profileId,
        pageAlias: input.pageAlias,
        pageLeaseId: input.pageLeaseId,
        runId: input.runId,
        expectedRecordVersion: context.recordVersion,
        expectedDocumentGeneration: context.documentGeneration,
        actionId: input.action.actionId,
        deltaY: scrollDeltaY(input.dom),
        timeoutMs: Math.min(10_000, remainingDeadline(input.deadline, 1_000)),
        bilibiliVideoBvid: input.bvid
      });
      input.action.attempted = true;
      input.action.attemptCount = 1;
      await this.#accountSafety.recordPlatformActionAttempt(
        input.profileId,
        'bilibili',
        input.runId,
        input.action.actionId
      );
    } catch (error) {
      const platformActionAttempted = hostCallStarted &&
        (!(error instanceof BrowserHostError) || error.record.platformActionAttempted);
      if (platformActionAttempted) {
        input.action.attempted = true;
        input.action.attemptCount = 1;
        await this.#accountSafety.recordPlatformActionAttempt(
          input.profileId,
          'bilibili',
          input.runId,
          input.action.actionId
        );
        input.action.outcome = 'postcondition_unmet';
      } else {
        input.action.outcome = 'prerequisite_unmet';
      }
      input.action.errorCode = safeErrorCode(error);
      throw error;
    }
  }

  async #observeRootProgress(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    observerBindingId: string;
    deadline: number;
    bvid: string;
    previousRootComments: readonly string[];
    fallbackObserved: ReturnType<typeof bilibiliVideoDiscussionStrategyObservation>;
  }): Promise<{
    observed: ReturnType<typeof bilibiliVideoDiscussionStrategyObservation>;
    progressed: boolean;
  }> {
    const observationDeadline = Math.min(
      input.deadline,
      Date.now() + ROOT_PROGRESS_OBSERVATION_MAX_WAIT_MS
    );
    let observed: ReturnType<typeof bilibiliVideoDiscussionStrategyObservation> | null = input.fallbackObserved;
    while (Date.now() < observationDeadline) {
      try {
        observed = bilibiliVideoDiscussionStrategyObservation(
          await this.#readStrategyObservation({
            profileId: input.profileId,
            pageAlias: input.pageAlias,
            pageLeaseId: input.pageLeaseId,
            runId: input.runId,
            observerBindingId: input.observerBindingId,
            deadline: observationDeadline,
            bvid: input.bvid
          }),
          input.bvid
        );
      } catch (error) {
        // A local lazy-load observation window expiring is not a platform
        // action failure.  Keep the last valid DOM snapshot and let the
        // caller stop on no-progress; only propagate errors while the run's
        // actual deadline or document binding is still meaningful.
        const errorCode = safeErrorCode(error);
        const localObservationTimeout = errorCode === 'run_deadline_exceeded' ||
          errorCode === 'video_discussion_strategy_observation_unavailable';
        // #readStrategyObservation reserves a 100ms local tail, so its
        // bounded read can report this just before the wall-clock window.
        if (Date.now() >= observationDeadline - 250 && localObservationTimeout) {
          return { observed, progressed: false };
        }
        throw error;
      }
      const merged = mergeBilibiliVideoDiscussionRootComments(
        input.previousRootComments,
        observed.dom.rootCommentTexts
      );
      if (riskOutcome(observed.dom) || merged.length > input.previousRootComments.length) {
        return { observed, progressed: merged.length > input.previousRootComments.length };
      }
      const remaining = observationDeadline - Date.now();
      if (remaining <= 0) break;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(OBSERVATION_POLL_MS, remaining)));
    }
    if (!observed) throw new Error('video_discussion_strategy_observation_unavailable');
    return {
      observed,
      progressed: mergeBilibiliVideoDiscussionRootComments(
        input.previousRootComments,
        observed.dom.rootCommentTexts
      ).length > input.previousRootComments.length
    };
  }

  async #waitForDocumentStability(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    deadline: number;
  }): Promise<{ recordVersion: number; documentGeneration: number }> {
    const startedAt = Date.now();
    let context = await this.#leasedPageContext(input);
    let generation = context.documentGeneration;
    let stableSince = Date.now();
    while (Date.now() - stableSince < DOCUMENT_STABILITY_QUIET_MS) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= DOCUMENT_STABILITY_MAX_WAIT_MS || Date.now() >= input.deadline) {
        throw new Error('video_discussion_document_stability_timeout');
      }
      await new Promise<void>((resolve) => setTimeout(resolve, OBSERVATION_POLL_MS));
      context = await this.#leasedPageContext(input);
      if (context.documentGeneration !== generation) {
        generation = context.documentGeneration;
        stableSince = Date.now();
      }
    }
    return context;
  }

  async #observeUntil(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    observerBindingId: string;
    deadline: number;
    bvid: string;
    requireViewport: boolean;
    requireContentReady: boolean;
    maxWaitMs?: number;
  }): Promise<ReturnType<typeof bilibiliVideoDiscussionStrategyObservation>> {
    let observed: ReturnType<typeof bilibiliVideoDiscussionStrategyObservation> | null = null;
    const observationDeadline = Math.min(
      input.deadline,
      Date.now() + (input.maxWaitMs ?? Math.max(0, input.deadline - Date.now()))
    );
    while (Date.now() < observationDeadline) {
      const result = await this.#readStrategyObservation({ ...input, deadline: observationDeadline });
      observed = bilibiliVideoDiscussionStrategyObservation(result, input.bvid);
      const waitState = bilibiliVideoDiscussionObservationWaitState(observed.dom, input);
      if (waitState === 'risk_stopped' || waitState === 'ready') return observed;
      const remaining = observationDeadline - Date.now();
      if (remaining <= 0) break;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(OBSERVATION_POLL_MS, remaining)));
    }
    if (!observed) throw new Error('video_discussion_strategy_observation_unavailable');
    if (input.requireContentReady &&
      bilibiliVideoDiscussionObservationWaitState(observed.dom, input) !== 'ready') {
      throw new Error('run_deadline_exceeded');
    }
    return observed;
  }

  async #readStrategyObservation(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    observerBindingId: string;
    deadline: number;
    bvid: string;
  }) {
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
        strategyId: BILIBILI_DISCUSSION_STRATEGY_ID,
        deadlineMs: Math.min(OBSERVATION_DEADLINE_MS, remainingDeadline(input.deadline, 100))
      });
    } catch (error) {
      const diagnostics = await this.#browserManager.readStrategyBindingDiagnostics({
        schemaVersion: 1,
        profileId: input.profileId,
        pageAlias: input.pageAlias,
        pageLeaseId: input.pageLeaseId,
        expectedRecordVersion: context.recordVersion,
        runId: input.runId,
        observerBindingId: input.observerBindingId,
        strategyId: BILIBILI_DISCUSSION_STRATEGY_ID
      }).catch(() => null);
      throw new DiscussionObservationError(error, diagnostics);
    }
  }

  async #captureVisualEvidence(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    deadline: number;
  }) {
    const context = await this.#leasedPageContext(input);
    return await this.#browserManager.capturePageVisualEvidence({
      profileId: input.profileId,
      pageAlias: input.pageAlias,
      pageLeaseId: input.pageLeaseId,
      expectedRecordVersion: context.recordVersion,
      runId: input.runId
    });
  }

  async #leasedPageContext(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
  }): Promise<{ recordVersion: number; documentGeneration: number }> {
    const snapshot = await this.#browserManager.snapshot();
    const profile = snapshot.profiles.find((candidate) => candidate.profileId === input.profileId);
    const page = profile?.pages.find((candidate) => candidate.pageAlias === input.pageAlias);
    if (!page || page.state !== 'leased' || page.activeLease?.pageLeaseId !== input.pageLeaseId || page.activeLease.runId !== input.runId) {
      throw new Error('video_discussion_managed_page_context_changed');
    }
    return { recordVersion: page.recordVersion, documentGeneration: page.documentGeneration };
  }
}
