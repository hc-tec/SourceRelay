import {
  BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
  BrowserHostError,
  COLLECTOR_EXTENSION_VERSION,
  type AcquirePageResult,
  type PageReleaseDisposition,
  type StrategyBindingDiagnostics
} from '@intelligence/collector-contracts';
import { randomUUID } from 'node:crypto';
import type { AccountSafetyRegistry, AccountSafetyRunPermit } from './account-safety';
import type {
  BilibiliVideoDetailArtifactStore,
  BilibiliVideoDetailArtifactSummary
} from './bilibili-video-detail-artifacts';
import {
  bilibiliVideoDetailInput,
  bvidFromCanonicalBilibiliVideoDetailUrl,
  projectBilibiliVideoDetailDom,
  type BilibiliVideoDetailAction,
  type BilibiliVideoDetailProjection,
  type BilibiliVideoDetailRunRecord,
  type BilibiliVideoDetailTerminalReason,
  type BilibiliVideoDetailVisualEvidence
} from './bilibili-video-detail-contract';
import { bilibiliVideoDetailStrategyObservation } from './bilibili-video-detail-observation';
import { createBilibiliVideoDetailRunRecord } from './bilibili-video-detail-run-record';
import type { CollectionBrowserManager } from './browser-manager';
import type { BrowserProfileRegistry } from './profiles';

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_DEADLINE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const OBSERVATION_DEADLINE_MS = 15_000;

export interface BilibiliVideoDetailHostRunInput {
  profileId: string;
  canonicalVideoUrl: string;
}

export interface BilibiliVideoDetailHostRunResult {
  run: BilibiliVideoDetailRunRecord;
  artifact: BilibiliVideoDetailArtifactSummary;
}

interface LeasedPageContext {
  recordVersion: number;
}

/**
 * Carries a bounded, local-only binding diagnosis from the exact leased page
 * that failed to observe.  The underlying error string remains the terminal
 * error code; diagnostics never change platform-action semantics.
 */
class VideoDetailObservationError extends Error {
  readonly bindingDiagnostics: StrategyBindingDiagnostics | null;

  constructor(cause: unknown, bindingDiagnostics: StrategyBindingDiagnostics | null) {
    super(cause instanceof Error ? cause.message : 'video_detail_strategy_observation_failed');
    this.name = 'VideoDetailObservationError';
    this.bindingDiagnostics = bindingDiagnostics;
  }
}

function input(value: BilibiliVideoDetailHostRunInput): BilibiliVideoDetailHostRunInput {
  if (!PROFILE_ID.test(value.profileId)) throw new Error('bilibili_video_detail_profile_invalid');
  return { profileId: value.profileId, ...bilibiliVideoDetailInput({ canonicalVideoUrl: value.canonicalVideoUrl }) };
}

function navigationAction(runId: string): BilibiliVideoDetailAction {
  return {
    actionId: `navigate_video_detail_${runId.replace(/-/g, '_')}`,
    kind: 'navigation',
    intent: 'Open the canonical public Bilibili video page exactly once.',
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null
  };
}

function pageSelection(selection: AcquirePageResult['selection']): BilibiliVideoDetailRunRecord['safeguards']['targetTabSelection'] {
  if (selection === 'created_new_page') return 'created_new_managed_tab';
  return selection === 'reused_exact_target'
    ? 'reused_matching_managed_tab'
    : 'reused_retained_managed_tab';
}

function riskOutcome(dom: ReturnType<typeof bilibiliVideoDetailStrategyObservation>['dom']): {
  state: BilibiliVideoDetailRunRecord['state'];
  terminalReason: BilibiliVideoDetailTerminalReason;
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

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof BrowserHostError
    ? error.record.code
    : error instanceof Error
      ? error.message
      : '';
  return /^[a-z0-9_]{1,100}$/.test(candidate) ? candidate : 'video_detail_runner_failed';
}

function failureFor(error: unknown): {
  state: BilibiliVideoDetailRunRecord['state'];
  terminalReason: BilibiliVideoDetailTerminalReason;
  errorCode: string;
  uncertainPageOutcome: boolean;
} {
  const errorCode = safeErrorCode(error);
  if (
    errorCode === 'navigation_outcome_unknown' ||
    errorCode === 'managed_page_document_generation_mismatch' ||
    errorCode === 'managed_page_record_version_mismatch' ||
    errorCode === 'managed_page_run_mismatch' ||
    errorCode === 'video_detail_strategy_document_context_changed' ||
    errorCode === 'video_detail_strategy_binding_context_rejected' ||
    errorCode === 'video_detail_managed_page_context_changed'
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

export class BilibiliVideoDetailHostRunner {
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #browserManager: CollectionBrowserManager;
  readonly #profiles: BrowserProfileRegistry;
  readonly #artifacts: BilibiliVideoDetailArtifactStore;

  constructor(input: {
    accountSafety: AccountSafetyRegistry;
    browserManager: CollectionBrowserManager;
    profiles: BrowserProfileRegistry;
    artifacts: BilibiliVideoDetailArtifactStore;
  }) {
    this.#accountSafety = input.accountSafety;
    this.#browserManager = input.browserManager;
    this.#profiles = input.profiles;
    this.#artifacts = input.artifacts;
  }

  async run(rawInput: BilibiliVideoDetailHostRunInput): Promise<BilibiliVideoDetailHostRunResult> {
    const request = input(rawInput);
    const profile = this.#profiles.get(request.profileId);
    if (
      profile.kind !== 'collection' ||
      profile.platform !== 'bilibili' ||
      profile.account.category !== 'user_managed'
    ) throw new Error('bilibili_video_detail_collection_profile_required');
    const permit = await this.#accountSafety.beginAuthenticatedRun(
      profile.profileId,
      'bilibili',
      'authenticated_video_detail_reconnaissance'
    );
    return await this.#runWithPermit(
      permit,
      request.canonicalVideoUrl,
      bvidFromCanonicalBilibiliVideoDetailUrl(request.canonicalVideoUrl)
    );
  }

  async #runWithPermit(
    permit: AccountSafetyRunPermit,
    canonicalVideoUrl: string,
    bvid: string
  ): Promise<BilibiliVideoDetailHostRunResult> {
    const navigation = navigationAction(permit.runId);
    const actions = [navigation];
    let deadline = 0;
    let acquired: AcquirePageResult | null = null;
    let detail: BilibiliVideoDetailProjection | null = null;
    let visualEvidence: BilibiliVideoDetailVisualEvidence | null = null;
    let state: BilibiliVideoDetailRunRecord['state'] = 'failed';
    let terminalReason: BilibiliVideoDetailTerminalReason = 'dom_projection_failed';
    let errorCode: string | null = null;
    let bindingDiagnostics: StrategyBindingDiagnostics | null = null;
    let releaseDisposition: PageReleaseDisposition = 'quarantined';
    let releaseReason = 'video_detail_run_not_started';
    let uncertainPageOutcome = false;
    let targetTabSelection: BilibiliVideoDetailRunRecord['safeguards']['targetTabSelection'] = 'not_acquired';
    let targetPage: BilibiliVideoDetailRunRecord['safeguards']['targetPage'] = 'not_acquired';
    try {
      await this.#browserManager.launch(permit.profileId);
      acquired = await this.#browserManager.acquirePage({
        profileId: permit.profileId,
        taskId: `bilibili_video_detail_${permit.runId.replace(/-/g, '_')}`,
        runId: permit.runId,
        platform: 'bilibili',
        pageRole: 'video_detail',
        targetUrl: canonicalVideoUrl,
        leaseDurationMs: RUN_DEADLINE_MS
      });
      targetTabSelection = pageSelection(acquired.selection);
      releaseReason = 'video_detail_strategy_binding_not_completed';
      const observerBindingId = randomUUID();
      await this.#browserManager.bindStrategyObserver({
        schemaVersion: 1,
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        expectedRecordVersion: acquired.page.recordVersion,
        runId: permit.runId,
        observerBindingId,
        strategyId: BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
        target: { canonicalUrl: canonicalVideoUrl, bvid },
        expiresAt: new Date(Date.now() + 55_000).toISOString(),
        maximumResponseObservations: 0,
        maximumPayloadBytes: 96 * 1024,
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
        url: canonicalVideoUrl,
        waitUntil: 'domcontentloaded',
        timeoutMs: Math.min(NAVIGATION_TIMEOUT_MS, remainingDeadline(deadline, 1_000))
      });
      navigation.outcome = 'completed';
      releaseDisposition = 'retained_for_review';
      releaseReason = 'video_detail_review_retained';

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
        deadline,
        bvid
      });
      const risk = riskOutcome(observed.dom);
      if (risk) {
        state = risk.state;
        terminalReason = risk.terminalReason;
        errorCode = risk.errorCode;
      } else {
        detail = projectBilibiliVideoDetailDom(observed.dom, bvid, new Date().toISOString());
        if (!detail) {
          state = 'failed';
          terminalReason = 'dom_projection_failed';
          errorCode = 'video_detail_dom_projection_failed';
        } else {
          state = 'completed';
          terminalReason = 'detail_ready';
          errorCode = null;
        }
      }
    } catch (error) {
      if (error instanceof VideoDetailObservationError) bindingDiagnostics = error.bindingDiagnostics;
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
        releaseReason = 'video_detail_page_outcome_unknown';
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

    const run = createBilibiliVideoDetailRunRecord({
      runId: permit.runId,
      collectorVersion: COLLECTOR_EXTENSION_VERSION,
      canonicalVideoUrl,
      bvid,
      startedAt: permit.startedAt,
      completedAt: new Date().toISOString(),
      state,
      errorCode,
      detail,
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
    bvid: string;
  }): Promise<ReturnType<typeof bilibiliVideoDetailStrategyObservation>> {
    let observed: ReturnType<typeof bilibiliVideoDetailStrategyObservation> | null = null;
    while (Date.now() < input.deadline) {
      const result = await this.#readStrategyObservation(input);
      observed = bilibiliVideoDetailStrategyObservation(result, input.bvid);
      const risk = riskOutcome(observed.dom);
      if (risk || projectBilibiliVideoDetailDom(observed.dom, input.bvid, new Date().toISOString())) return observed;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    if (!observed) throw new Error('video_detail_strategy_observation_unavailable');
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
          strategyId: BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
          deadlineMs: Math.min(OBSERVATION_DEADLINE_MS, remainingDeadline(input.deadline, 100))
        });
      } catch (error) {
        if (!(error instanceof BrowserHostError) || error.record.code !== 'managed_page_record_version_mismatch' || attempt === 1) {
          const diagnostics = await this.#readStrategyBindingDiagnostics(input, context).catch(() => null);
          throw new VideoDetailObservationError(error, diagnostics);
        }
      }
    }
    throw new Error('video_detail_strategy_local_version_unavailable');
  }

  async #readStrategyBindingDiagnostics(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    observerBindingId: string;
  }, context: LeasedPageContext): Promise<StrategyBindingDiagnostics> {
    return await this.#browserManager.readStrategyBindingDiagnostics({
      schemaVersion: 1,
      profileId: input.profileId,
      pageAlias: input.pageAlias,
      pageLeaseId: input.pageLeaseId,
      expectedRecordVersion: context.recordVersion,
      runId: input.runId,
      observerBindingId: input.observerBindingId,
      strategyId: BILIBILI_VIDEO_DETAIL_STRATEGY_ID
    });
  }

  async #captureVisualEvidence(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    deadline: number;
    actionId: string;
  }): Promise<BilibiliVideoDetailVisualEvidence> {
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
    throw new Error('video_detail_visual_local_version_unavailable');
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
    ) throw new Error('video_detail_managed_page_context_changed');
    return { recordVersion: page.recordVersion };
  }
}
