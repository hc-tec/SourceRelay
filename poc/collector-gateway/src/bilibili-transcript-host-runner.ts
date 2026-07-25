import {
  BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION,
  BILIBILI_TRANSCRIPT_STRATEGY_ID,
  BrowserHostError,
  COLLECTOR_EXTENSION_VERSION,
  type AcquirePageResult,
  type BilibiliTranscriptChineseSelectionResult,
  type PageReleaseDisposition
} from '@intelligence/collector-contracts';
import { randomUUID } from 'node:crypto';
import type { AccountSafetyRegistry, AccountSafetyRunPermit } from './account-safety';
import type {
  BilibiliTranscriptArtifactStore,
  BilibiliTranscriptArtifactSummary
} from './bilibili-transcript-artifacts';
import {
  bilibiliTranscriptInput,
  bvidFromCanonicalBilibiliTranscriptUrl,
  type BilibiliTranscriptNavigationAction,
  type BilibiliTranscriptRunRecord,
  type BilibiliTranscriptTerminalReason
} from './bilibili-transcript-contract';
import { bilibiliTranscriptStrategyObservation } from './bilibili-transcript-observation';
import { createBilibiliTranscriptRunRecord } from './bilibili-transcript-run-record';
import type { CollectionBrowserManager } from './browser-manager';
import type { BrowserProfileRegistry } from './profiles';

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_DEADLINE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 15_000;
const INTERACTION_TIMEOUT_MS = 12_000;
const OBSERVATION_TIMEOUT_MS = 12_000;

export interface BilibiliTranscriptHostRunInput {
  profileId: string;
  canonicalVideoUrl: string;
}

export interface BilibiliTranscriptHostRunResult {
  run: BilibiliTranscriptRunRecord;
  artifact: BilibiliTranscriptArtifactSummary;
}

interface LeasedPageContext {
  recordVersion: number;
  documentGeneration: number;
}

function input(value: BilibiliTranscriptHostRunInput): BilibiliTranscriptHostRunInput {
  if (!PROFILE_ID.test(value.profileId)) throw new Error('bilibili_transcript_profile_invalid');
  return { profileId: value.profileId, ...bilibiliTranscriptInput({ canonicalVideoUrl: value.canonicalVideoUrl }) };
}

function navigationAction(runId: string): BilibiliTranscriptNavigationAction {
  return {
    actionId: `navigate_bilibili_transcript_${runId.replace(/-/g, '_')}`,
    kind: 'navigation',
    intent: 'Open the canonical Bilibili video page exactly once.',
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null
  };
}

function refreshAction(runId: string): BilibiliTranscriptNavigationAction {
  return {
    actionId: `refresh_bilibili_transcript_${runId.replace(/-/g, '_')}`,
    kind: 'single_refresh',
    intent: 'Refresh the same Bilibili video page once after a blank player preflight.',
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null
  };
}

function targetTabSelection(selection: AcquirePageResult['selection']): BilibiliTranscriptRunRecord['safeguards']['targetTabSelection'] {
  if (selection === 'created_new_page') return 'created_new_managed_tab';
  return selection === 'reused_exact_target'
    ? 'reused_matching_managed_tab'
    : 'reused_retained_managed_tab';
}

function terminalForInteraction(result: BilibiliTranscriptChineseSelectionResult): BilibiliTranscriptTerminalReason | null {
  if (result.dom.authenticationRequired) return 'authentication_required';
  if (result.dom.verificationRequired) return 'verification_required';
  if (result.dom.rateLimited) return 'rate_limited';
  if (result.dom.sourceUnavailable) return 'source_unavailable';
  const reveal = result.actions.find((action) => action.step === 'reveal_player_controls');
  const menu = result.actions.find((action) => action.step === 'open_caption_menu');
  const selection = result.actions.find((action) => action.step === 'select_chinese_caption');
  if (!result.dom.playerAreaPresent || !result.dom.captionControlAttached || reveal?.outcome !== 'completed' && reveal?.outcome !== 'already_satisfied') {
    return 'caption_controls_unavailable';
  }
  if (menu?.outcome !== 'completed' && menu?.outcome !== 'already_satisfied') return 'caption_menu_unavailable';
  if (!result.dom.chineseOptionVisible && selection?.outcome === 'prerequisite_unmet') return 'chinese_caption_unavailable';
  if (selection?.outcome !== 'completed' && selection?.outcome !== 'already_satisfied') return 'caption_selection_unconfirmed';
  return null;
}

function shouldRefreshOnce(result: BilibiliTranscriptChineseSelectionResult): boolean {
  const dom = result.dom;
  return !dom.authenticationRequired && !dom.verificationRequired && !dom.rateLimited && !dom.sourceUnavailable &&
    !dom.playerAreaPresent && !dom.captionControlAttached;
}

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof BrowserHostError
    ? error.record.code
    : error instanceof Error
      ? error.message
      : '';
  return /^[a-z0-9_]{1,100}$/.test(candidate) ? candidate : 'bilibili_transcript_runner_failed';
}

function failureFor(error: unknown): {
  state: BilibiliTranscriptRunRecord['state'];
  terminalReason: BilibiliTranscriptTerminalReason;
  errorCode: string;
  uncertainPageOutcome: boolean;
} {
  const errorCode = safeErrorCode(error);
  if (
    errorCode === 'navigation_outcome_unknown' ||
    errorCode === 'bilibili_transcript_selection_outcome_unknown' ||
    errorCode === 'managed_page_document_generation_mismatch' ||
    errorCode === 'managed_page_record_version_mismatch' ||
    errorCode === 'managed_page_run_mismatch' ||
    errorCode === 'transcript_strategy_document_context_changed' ||
    errorCode === 'transcript_strategy_binding_context_rejected' ||
    errorCode === 'transcript_managed_page_context_changed'
  ) return { state: 'failed', terminalReason: 'document_context_changed', errorCode, uncertainPageOutcome: true };
  if (errorCode === 'run_deadline_exceeded') {
    return { state: 'failed', terminalReason: 'run_deadline_exceeded', errorCode, uncertainPageOutcome: true };
  }
  if (errorCode === 'transcript_strategy_observer_not_bound') {
    return { state: 'partial', terminalReason: 'observer_not_bound', errorCode, uncertainPageOutcome: false };
  }
  return { state: 'failed', terminalReason: 'response_projection_failed', errorCode, uncertainPageOutcome: false };
}

function remainingDeadline(deadline: number, minimumMs: number): number {
  const remaining = deadline - Date.now();
  if (remaining < minimumMs) throw new Error('run_deadline_exceeded');
  return remaining;
}

export class BilibiliTranscriptHostRunner {
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #browserManager: CollectionBrowserManager;
  readonly #profiles: BrowserProfileRegistry;
  readonly #artifacts: BilibiliTranscriptArtifactStore;

  constructor(input: {
    accountSafety: AccountSafetyRegistry;
    browserManager: CollectionBrowserManager;
    profiles: BrowserProfileRegistry;
    artifacts: BilibiliTranscriptArtifactStore;
  }) {
    this.#accountSafety = input.accountSafety;
    this.#browserManager = input.browserManager;
    this.#profiles = input.profiles;
    this.#artifacts = input.artifacts;
  }

  async run(rawInput: BilibiliTranscriptHostRunInput): Promise<BilibiliTranscriptHostRunResult> {
    const request = input(rawInput);
    const profile = this.#profiles.get(request.profileId);
    if (
      profile.kind !== 'collection' ||
      profile.platform !== 'bilibili' ||
      profile.account.category !== 'user_managed'
    ) throw new Error('bilibili_transcript_collection_profile_required');
    const permit = await this.#accountSafety.beginAuthenticatedRun(
      profile.profileId,
      'bilibili',
      'authenticated_transcript_reconnaissance'
    );
    return await this.#runWithPermit(
      permit,
      request.canonicalVideoUrl,
      bvidFromCanonicalBilibiliTranscriptUrl(request.canonicalVideoUrl)
    );
  }

  async #runWithPermit(
    permit: AccountSafetyRunPermit,
    canonicalVideoUrl: string,
    bvid: string
  ): Promise<BilibiliTranscriptHostRunResult> {
    const navigation = navigationAction(permit.runId);
    const refresh = refreshAction(permit.runId);
    let deadline = 0;
    let acquired: AcquirePageResult | null = null;
    let interaction: BilibiliTranscriptChineseSelectionResult | null = null;
    let trackDirectory: BilibiliTranscriptRunRecord['trackDirectory'] = null;
    let transcriptDocument: BilibiliTranscriptRunRecord['transcriptDocument'] = null;
    let sources: BilibiliTranscriptRunRecord['sources'] = [];
    let state: BilibiliTranscriptRunRecord['state'] = 'failed';
    let terminalReason: BilibiliTranscriptTerminalReason = 'response_projection_failed';
    let errorCode: string | null = null;
    let releaseDisposition: PageReleaseDisposition = 'quarantined';
    let releaseReason = 'bilibili_transcript_run_not_started';
    let uncertainPageOutcome = false;
    let selection: BilibiliTranscriptRunRecord['safeguards']['targetTabSelection'] = 'not_acquired';
    let targetPage: BilibiliTranscriptRunRecord['safeguards']['targetPage'] = 'not_acquired';
    let pageRecovery: BilibiliTranscriptRunRecord['pageRecovery'] = {
      actionId: null,
      attempted: false,
      reason: 'not_needed',
      outcome: 'not_needed',
      initialDom: null,
      initialVisualEvidence: null
    };
    try {
      await this.#browserManager.launch(permit.profileId);
      acquired = await this.#browserManager.acquirePage({
        profileId: permit.profileId,
        taskId: `bilibili_transcript_${permit.runId.replace(/-/g, '_')}`,
        runId: permit.runId,
        platform: 'bilibili',
        pageRole: 'video_detail',
        targetUrl: canonicalVideoUrl,
        leaseDurationMs: RUN_DEADLINE_MS
      });
      selection = targetTabSelection(acquired.selection);
      releaseReason = 'bilibili_transcript_strategy_binding_not_completed';
      deadline = Date.now() + RUN_DEADLINE_MS;
      let observerBindingId = await this.#bindTranscriptObserver({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        runId: permit.runId,
        canonicalVideoUrl,
        bvid
      }, true);

      await this.#attemptNavigation(permit, acquired, navigation, canonicalVideoUrl, deadline);
      releaseDisposition = 'retained_for_review';
      releaseReason = 'bilibili_transcript_review_retained';

      interaction = await this.#selectChineseCaption({
        permit,
        acquired,
        canonicalVideoUrl,
        actionId: `select_bilibili_transcript_chinese_${permit.runId.replace(/-/g, '_')}`,
        deadline
      });
      if (shouldRefreshOnce(interaction)) {
        pageRecovery = {
          actionId: refresh.actionId,
          attempted: true,
          reason: 'player_not_rendered_after_initial_navigation',
          outcome: 'still_unavailable',
          initialDom: { ...interaction.dom },
          initialVisualEvidence: {
            baseline: interaction.visualEvidence.baseline,
            final: interaction.visualEvidence.final
          }
        };
        observerBindingId = await this.#bindTranscriptObserver({
          profileId: permit.profileId,
          pageAlias: acquired.page.pageAlias,
          pageLeaseId: acquired.lease.pageLeaseId,
          runId: permit.runId,
          canonicalVideoUrl,
          bvid
        }, false);
        await this.#attemptNavigation(permit, acquired, refresh, canonicalVideoUrl, deadline);
        interaction = await this.#selectChineseCaption({
          permit,
          acquired,
          canonicalVideoUrl,
          actionId: `select_bilibili_transcript_chinese_after_refresh_${permit.runId.replace(/-/g, '_')}`,
          deadline
        });
        pageRecovery = {
          ...pageRecovery,
          outcome: interaction.dom.playerAreaPresent && interaction.dom.captionControlAttached
            ? 'recovered'
            : 'still_unavailable'
        };
      } else if (
        interaction.dom.authenticationRequired || interaction.dom.verificationRequired ||
        interaction.dom.rateLimited || interaction.dom.sourceUnavailable
      ) {
        pageRecovery = { ...pageRecovery, reason: 'not_attempted_due_risk', outcome: 'not_attempted' };
      }

      const interactionTerminal = terminalForInteraction(interaction);
      if (interactionTerminal) {
        state = 'partial';
        terminalReason = interactionTerminal;
        errorCode = interactionTerminal === 'authentication_required' ||
          interactionTerminal === 'verification_required' ||
          interactionTerminal === 'rate_limited' ||
          interactionTerminal === 'source_unavailable'
          ? interactionTerminal
          : `bilibili_transcript_${interactionTerminal}`;
      } else {
        const observed = await this.#readTranscriptObservation({
          profileId: permit.profileId,
          pageAlias: acquired.page.pageAlias,
          pageLeaseId: acquired.lease.pageLeaseId,
          runId: permit.runId,
          observerBindingId,
          bvid,
          deadline
        });
        trackDirectory = observed.directory;
        transcriptDocument = observed.transcript;
        sources = observed.sources;
        if (!trackDirectory) {
          state = 'partial';
          terminalReason = 'track_directory_missing';
          errorCode = 'bilibili_transcript_track_directory_missing';
        } else if (!transcriptDocument) {
          state = 'partial';
          terminalReason = 'subtitle_document_missing';
          errorCode = 'bilibili_transcript_document_missing';
        } else {
          state = 'completed';
          terminalReason = 'transcript_ready';
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
      if (refresh.attempted && refresh.outcome !== 'completed') {
        refresh.outcome = failure.uncertainPageOutcome ? 'postcondition_unmet' : 'failed';
        refresh.errorCode = failure.errorCode;
      }
      if (failure.uncertainPageOutcome) {
        releaseDisposition = 'quarantined';
        releaseReason = 'bilibili_transcript_outcome_unknown';
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

    const run = createBilibiliTranscriptRunRecord({
      runId: permit.runId,
      collectorVersion: COLLECTOR_EXTENSION_VERSION,
      canonicalVideoUrl,
      bvid,
      startedAt: permit.startedAt,
      completedAt: new Date().toISOString(),
      state,
      errorCode,
      navigation,
      pageRecovery,
      interaction,
      trackDirectory,
      transcriptDocument,
      sources,
      terminalReason,
      targetTabSelection: selection,
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

  async #attemptNavigation(
    permit: AccountSafetyRunPermit,
    acquired: AcquirePageResult,
    action: BilibiliTranscriptNavigationAction,
    canonicalVideoUrl: string,
    deadline: number
  ): Promise<void> {
    await this.#accountSafety.recordActionAttempt(permit.profileId, 'bilibili', permit.runId, action.actionId);
    action.attempted = true;
    action.attemptCount = 1;
    await this.#browserManager.navigatePage({
      profileId: permit.profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      actionId: action.actionId,
      url: canonicalVideoUrl,
      waitUntil: 'domcontentloaded',
      timeoutMs: Math.min(NAVIGATION_TIMEOUT_MS, remainingDeadline(deadline, 1_000))
    });
    action.outcome = 'completed';
  }

  async #selectChineseCaption(input: {
    permit: AccountSafetyRunPermit;
    acquired: AcquirePageResult;
    canonicalVideoUrl: string;
    actionId: string;
    deadline: number;
  }): Promise<BilibiliTranscriptChineseSelectionResult> {
    const context = await this.#leasedPageContext({
      profileId: input.permit.profileId,
      pageAlias: input.acquired.page.pageAlias,
      pageLeaseId: input.acquired.lease.pageLeaseId,
      runId: input.permit.runId
    }, false);
    await this.#accountSafety.recordActionAttempt(input.permit.profileId, 'bilibili', input.permit.runId, input.actionId);
    return await this.#browserManager.selectBilibiliTranscriptChinese({
      schemaVersion: BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION,
      profileId: input.permit.profileId,
      pageAlias: input.acquired.page.pageAlias,
      pageLeaseId: input.acquired.lease.pageLeaseId,
      runId: input.permit.runId,
      expectedRecordVersion: context.recordVersion,
      expectedDocumentGeneration: context.documentGeneration,
      actionId: input.actionId,
      canonicalVideoUrl: input.canonicalVideoUrl,
      timeoutMs: Math.min(INTERACTION_TIMEOUT_MS, remainingDeadline(input.deadline, 1_000))
    });
  }

  async #bindTranscriptObserver(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    canonicalVideoUrl: string;
    bvid: string;
  }, allowPreNavigationState: boolean): Promise<string> {
    const context = await this.#leasedPageContext(input, allowPreNavigationState);
    const observerBindingId = randomUUID();
    await this.#browserManager.bindStrategyObserver({
      schemaVersion: 1,
      profileId: input.profileId,
      pageAlias: input.pageAlias,
      pageLeaseId: input.pageLeaseId,
      expectedRecordVersion: context.recordVersion,
      runId: input.runId,
      observerBindingId,
      strategyId: BILIBILI_TRANSCRIPT_STRATEGY_ID,
      target: { canonicalUrl: input.canonicalVideoUrl, bvid: input.bvid },
      expiresAt: new Date(Date.now() + 55_000).toISOString(),
      maximumResponseObservations: 2,
      maximumPayloadBytes: 192 * 1024,
      documentBindingMode: 'next_navigation_only'
    });
    return observerBindingId;
  }

  async #readTranscriptObservation(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    observerBindingId: string;
    bvid: string;
    deadline: number;
  }): Promise<ReturnType<typeof bilibiliTranscriptStrategyObservation>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const context = await this.#leasedPageContext(input, false);
      try {
        const result = await this.#browserManager.readStrategyObservation({
          schemaVersion: 1,
          profileId: input.profileId,
          pageAlias: input.pageAlias,
          pageLeaseId: input.pageLeaseId,
          expectedRecordVersion: context.recordVersion,
          runId: input.runId,
          observerBindingId: input.observerBindingId,
          strategyId: BILIBILI_TRANSCRIPT_STRATEGY_ID,
          deadlineMs: Math.min(OBSERVATION_TIMEOUT_MS, remainingDeadline(input.deadline, 100))
        });
        return bilibiliTranscriptStrategyObservation(result, input.bvid);
      } catch (error) {
        if (!(error instanceof BrowserHostError) || error.record.code !== 'managed_page_record_version_mismatch' || attempt === 1) {
          throw error;
        }
      }
    }
    throw new Error('transcript_strategy_local_version_unavailable');
  }

  async #leasedPageContext(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
  }, allowPreNavigationState: boolean): Promise<LeasedPageContext> {
    const snapshot = await this.#browserManager.snapshot();
    const profile = snapshot.profiles.find((candidate) => candidate.profileId === input.profileId);
    const page = profile?.pages.find((candidate) => candidate.pageAlias === input.pageAlias);
    const stateAccepted = page?.state === 'leased' ||
      (allowPreNavigationState && page?.state === 'leased_pre_navigation');
    if (
      !page ||
      !stateAccepted ||
      page.activeLease?.pageLeaseId !== input.pageLeaseId ||
      page.activeLease.runId !== input.runId
    ) throw new Error('transcript_managed_page_context_changed');
    return { recordVersion: page.recordVersion, documentGeneration: page.documentGeneration };
  }
}
