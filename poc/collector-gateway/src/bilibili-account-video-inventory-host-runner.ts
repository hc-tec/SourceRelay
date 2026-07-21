import {
  BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
  BrowserHostError,
  COLLECTOR_EXTENSION_VERSION,
  type AcquirePageResult,
  type PageReleaseDisposition
} from '@intelligence/collector-contracts';
import { randomUUID } from 'node:crypto';
import type { AccountSafetyRegistry, AccountSafetyRunPermit } from './account-safety';
import type {
  BilibiliAccountVideoInventoryArtifactStore,
  BilibiliAccountVideoInventoryArtifactSummary
} from './bilibili-account-video-inventory-artifacts';
import {
  accountVideoInventoryUrl,
  bilibiliAccountVideoInventoryInput,
  projectBilibiliAccountVideoInventoryDom,
  stableAccountIdFromCanonicalBilibiliProfileUrl,
  type BilibiliAccountVideoInventoryAction,
  type BilibiliAccountVideoInventoryProjection,
  type BilibiliAccountVideoInventoryRunRecord,
  type BilibiliAccountVideoInventoryTerminalReason,
  type BilibiliAccountVideoInventoryVisualEvidence
} from './bilibili-account-video-inventory-contract';
import { bilibiliAccountVideoInventoryStrategyObservation } from './bilibili-account-video-inventory-observation';
import { createBilibiliAccountVideoInventoryRunRecord } from './bilibili-account-video-inventory-run-record';
import type { CollectionBrowserManager } from './browser-manager';
import type { BrowserProfileRegistry } from './profiles';

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_DEADLINE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const OBSERVATION_DEADLINE_MS = 15_000;

export interface BilibiliAccountVideoInventoryHostRunInput {
  profileId: string;
  canonicalProfileUrl: string;
}

export interface BilibiliAccountVideoInventoryHostRunResult {
  run: BilibiliAccountVideoInventoryRunRecord;
  artifact: BilibiliAccountVideoInventoryArtifactSummary;
}

interface LeasedPageContext {
  recordVersion: number;
}

function input(value: BilibiliAccountVideoInventoryHostRunInput): BilibiliAccountVideoInventoryHostRunInput {
  if (!PROFILE_ID.test(value.profileId)) throw new Error('bilibili_account_video_inventory_profile_invalid');
  return {
    profileId: value.profileId,
    ...bilibiliAccountVideoInventoryInput({ canonicalProfileUrl: value.canonicalProfileUrl })
  };
}

function navigationAction(runId: string): BilibiliAccountVideoInventoryAction {
  return {
    actionId: `navigate_account_video_inventory_${runId.replace(/-/g, '_')}`,
    kind: 'navigation',
    intent: 'Open the canonical public Bilibili account video inventory exactly once.',
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null
  };
}

function pageSelection(selection: AcquirePageResult['selection']):
  BilibiliAccountVideoInventoryRunRecord['safeguards']['targetTabSelection'] {
  if (selection === 'created_new_page') return 'created_new_managed_tab';
  return selection === 'reused_exact_target'
    ? 'reused_matching_managed_tab'
    : 'reused_retained_managed_tab';
}

function riskOutcome(
  dom: ReturnType<typeof bilibiliAccountVideoInventoryStrategyObservation>['dom'],
  page: BilibiliAccountVideoInventoryProjection | null
): {
  state: BilibiliAccountVideoInventoryRunRecord['state'];
  terminalReason: BilibiliAccountVideoInventoryTerminalReason;
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
  if (!page && dom.loginOverlayVisible) {
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
  return /^[a-z0-9_]{1,100}$/.test(candidate) ? candidate : 'account_video_inventory_runner_failed';
}

function failureFor(error: unknown): {
  state: BilibiliAccountVideoInventoryRunRecord['state'];
  terminalReason: BilibiliAccountVideoInventoryTerminalReason;
  errorCode: string;
  uncertainPageOutcome: boolean;
} {
  const errorCode = safeErrorCode(error);
  if (
    errorCode === 'navigation_outcome_unknown' ||
    errorCode === 'managed_page_document_generation_mismatch' ||
    errorCode === 'managed_page_record_version_mismatch' ||
    errorCode === 'managed_page_run_mismatch' ||
    errorCode === 'account_video_inventory_strategy_document_context_changed' ||
    errorCode === 'account_video_inventory_strategy_binding_context_rejected' ||
    errorCode === 'account_video_inventory_managed_page_context_changed'
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

export class BilibiliAccountVideoInventoryHostRunner {
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #browserManager: CollectionBrowserManager;
  readonly #profiles: BrowserProfileRegistry;
  readonly #artifacts: BilibiliAccountVideoInventoryArtifactStore;

  constructor(input: {
    accountSafety: AccountSafetyRegistry;
    browserManager: CollectionBrowserManager;
    profiles: BrowserProfileRegistry;
    artifacts: BilibiliAccountVideoInventoryArtifactStore;
  }) {
    this.#accountSafety = input.accountSafety;
    this.#browserManager = input.browserManager;
    this.#profiles = input.profiles;
    this.#artifacts = input.artifacts;
  }

  async run(rawInput: BilibiliAccountVideoInventoryHostRunInput): Promise<BilibiliAccountVideoInventoryHostRunResult> {
    const request = input(rawInput);
    const profile = this.#profiles.get(request.profileId);
    if (
      profile.kind !== 'collection' ||
      profile.platform !== 'bilibili' ||
      profile.account.category !== 'user_managed'
    ) throw new Error('bilibili_account_video_inventory_collection_profile_required');
    const permit = await this.#accountSafety.beginAuthenticatedRun(
      profile.profileId,
      'bilibili',
      'authenticated_account_video_inventory_reconnaissance'
    );
    const stableAccountId = stableAccountIdFromCanonicalBilibiliProfileUrl(request.canonicalProfileUrl);
    return await this.#runWithPermit(
      permit,
      accountVideoInventoryUrl(request.canonicalProfileUrl),
      stableAccountId
    );
  }

  async #runWithPermit(
    permit: AccountSafetyRunPermit,
    canonicalInventoryUrl: string,
    stableAccountId: string
  ): Promise<BilibiliAccountVideoInventoryHostRunResult> {
    const navigation = navigationAction(permit.runId);
    const actions = [navigation];
    let deadline = 0;
    let acquired: AcquirePageResult | null = null;
    let page: BilibiliAccountVideoInventoryProjection | null = null;
    let visualEvidence: BilibiliAccountVideoInventoryVisualEvidence | null = null;
    let state: BilibiliAccountVideoInventoryRunRecord['state'] = 'failed';
    let terminalReason: BilibiliAccountVideoInventoryTerminalReason = 'dom_projection_failed';
    let errorCode: string | null = null;
    let releaseDisposition: PageReleaseDisposition = 'quarantined';
    let releaseReason = 'account_video_inventory_run_not_started';
    let uncertainPageOutcome = false;
    let targetTabSelection: BilibiliAccountVideoInventoryRunRecord['safeguards']['targetTabSelection'] = 'not_acquired';
    let targetPage: BilibiliAccountVideoInventoryRunRecord['safeguards']['targetPage'] = 'not_acquired';
    try {
      await this.#browserManager.launch(permit.profileId);
      acquired = await this.#browserManager.acquirePage({
        profileId: permit.profileId,
        taskId: `bilibili_account_video_inventory_${permit.runId.replace(/-/g, '_')}`,
        runId: permit.runId,
        platform: 'bilibili',
        pageRole: 'account_video_inventory',
        targetUrl: canonicalInventoryUrl,
        leaseDurationMs: RUN_DEADLINE_MS
      });
      targetTabSelection = pageSelection(acquired.selection);
      releaseReason = 'account_video_inventory_strategy_binding_not_completed';
      const observerBindingId = randomUUID();
      await this.#browserManager.bindStrategyObserver({
        schemaVersion: 1,
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        expectedRecordVersion: acquired.page.recordVersion,
        runId: permit.runId,
        observerBindingId,
        strategyId: BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
        target: { canonicalUrl: canonicalInventoryUrl, stableAccountId },
        expiresAt: new Date(Date.now() + 55_000).toISOString(),
        maximumResponseObservations: 0,
        maximumPayloadBytes: 128 * 1024
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
        url: canonicalInventoryUrl,
        waitUntil: 'domcontentloaded',
        timeoutMs: Math.min(NAVIGATION_TIMEOUT_MS, remainingDeadline(deadline, 1_000))
      });
      navigation.outcome = 'completed';
      releaseDisposition = 'retained_for_review';
      releaseReason = 'account_video_inventory_review_retained';
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
        stableAccountId
      });
      page = projectBilibiliAccountVideoInventoryDom(observed.dom, stableAccountId, new Date().toISOString());
      const risk = riskOutcome(observed.dom, page);
      if (risk) {
        state = risk.state;
        terminalReason = risk.terminalReason;
        errorCode = risk.errorCode;
      } else if (!page) {
        state = 'failed';
        terminalReason = 'dom_projection_failed';
        errorCode = 'account_video_inventory_dom_projection_failed';
      } else if (page.unresolvedCardCount > 0) {
        state = 'partial';
        terminalReason = 'page_one_partial';
        errorCode = 'account_video_inventory_unresolved_cards';
      } else {
        state = 'completed';
        terminalReason = 'page_one_ready';
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
        releaseReason = 'account_video_inventory_page_outcome_unknown';
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

    const run = createBilibiliAccountVideoInventoryRunRecord({
      runId: permit.runId,
      collectorVersion: COLLECTOR_EXTENSION_VERSION,
      canonicalInventoryUrl,
      stableAccountId,
      startedAt: permit.startedAt,
      completedAt: new Date().toISOString(),
      state,
      errorCode,
      page,
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
    stableAccountId: string;
  }): Promise<ReturnType<typeof bilibiliAccountVideoInventoryStrategyObservation>> {
    let observed: ReturnType<typeof bilibiliAccountVideoInventoryStrategyObservation> | null = null;
    while (Date.now() < input.deadline) {
      const result = await this.#readStrategyObservation(input);
      observed = bilibiliAccountVideoInventoryStrategyObservation(result, input.stableAccountId);
      const page = projectBilibiliAccountVideoInventoryDom(observed.dom, input.stableAccountId, new Date().toISOString());
      if (riskOutcome(observed.dom, page) || page) return observed;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    if (!observed) throw new Error('account_video_inventory_strategy_observation_unavailable');
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
          strategyId: BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
          deadlineMs: Math.min(OBSERVATION_DEADLINE_MS, remainingDeadline(input.deadline, 100))
        });
      } catch (error) {
        if (!(error instanceof BrowserHostError) || error.record.code !== 'managed_page_record_version_mismatch' || attempt === 1) {
          throw error;
        }
      }
    }
    throw new Error('account_video_inventory_local_version_unavailable');
  }

  async #captureVisualEvidence(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    deadline: number;
    actionId: string;
  }): Promise<BilibiliAccountVideoInventoryVisualEvidence> {
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
    throw new Error('account_video_inventory_visual_local_version_unavailable');
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
    ) throw new Error('account_video_inventory_managed_page_context_changed');
    return { recordVersion: page.recordVersion };
  }
}
