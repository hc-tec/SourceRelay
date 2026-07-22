import {
  BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID,
  BrowserHostError,
  COLLECTOR_EXTENSION_VERSION,
  bilibiliAccountProfileIdFromUrl,
  type AcquirePageResult,
  type PageReleaseDisposition
} from '@intelligence/collector-contracts';
import { createHash, randomUUID } from 'node:crypto';
import type { AccountSafetyRegistry, AccountSafetyRunPermit } from './account-safety';
import type {
  BilibiliAccountProfileArtifactStore,
  BilibiliAccountProfileArtifactSummary
} from './bilibili-account-profile-artifacts';
import {
  bilibiliAccountProfileDomRisk,
  bilibiliAccountProfileInput,
  projectBilibiliAccountProfileDom,
  safeBilibiliAccountProfileErrorCode,
  type BilibiliAccountProfileAction,
  type BilibiliAccountProfileRunRecord,
  type BilibiliAccountProfileTerminalReason,
  type BilibiliAccountProfileVisualEvidence
} from './bilibili-account-profile-contract';
import { bilibiliAccountProfileStrategyObservation } from './bilibili-account-profile-observation';
import type { CollectionBrowserManager } from './browser-manager';
import type { BrowserProfileRegistry } from './profiles';

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_DEADLINE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const OBSERVATION_DEADLINE_MS = 15_000;

export interface BilibiliAccountProfileHostRunInput {
  profileId: string;
  canonicalProfileUrl: string;
}

export interface BilibiliAccountProfileHostRunResult {
  run: BilibiliAccountProfileRunRecord;
  artifact: BilibiliAccountProfileArtifactSummary;
}

interface LeasedPageContext {
  recordVersion: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function input(value: BilibiliAccountProfileHostRunInput): BilibiliAccountProfileHostRunInput {
  if (!PROFILE_ID.test(value.profileId)) throw new Error('bilibili_account_profile_profile_invalid');
  return { profileId: value.profileId, ...bilibiliAccountProfileInput({ canonicalProfileUrl: value.canonicalProfileUrl }) };
}

function navigationAction(runId: string): BilibiliAccountProfileAction {
  return {
    actionId: `open_account_profile_${runId.replace(/-/g, '_')}`,
    intent: 'Open the canonical public account profile exactly once.',
    attempted: false,
    attemptCount: 0,
    outcome: 'failed',
    errorCode: null
  };
}

function pageSelection(selection: AcquirePageResult['selection']): BilibiliAccountProfileRunRecord['safeguards']['targetTabSelection'] {
  if (selection === 'created_new_page') return 'created_new_managed_tab';
  return selection === 'reused_exact_target'
    ? 'reused_matching_managed_tab'
    : 'reused_retained_managed_tab';
}

function riskOutcome(dom: ReturnType<typeof bilibiliAccountProfileStrategyObservation>['dom']): {
  state: BilibiliAccountProfileRunRecord['state'];
  terminalReason: BilibiliAccountProfileTerminalReason;
  errorCode: string;
} | null {
  const risk = bilibiliAccountProfileDomRisk(dom);
  if (risk.verificationRequired) return { state: 'partial', terminalReason: 'verification_required', errorCode: 'verification_required' };
  if (risk.rateLimited) return { state: 'partial', terminalReason: 'rate_limited', errorCode: 'rate_limited' };
  if (risk.sourceUnavailable) return { state: 'partial', terminalReason: 'source_unavailable', errorCode: 'source_unavailable' };
  if (dom.loginOverlayVisible) return { state: 'partial', terminalReason: 'authentication_required', errorCode: 'authentication_required' };
  return null;
}

function failureFor(error: unknown): {
  state: BilibiliAccountProfileRunRecord['state'];
  terminalReason: BilibiliAccountProfileTerminalReason;
  errorCode: string;
  uncertainPageOutcome: boolean;
} {
  const errorCode = safeBilibiliAccountProfileErrorCode(error);
  if (
    errorCode === 'navigation_outcome_unknown' ||
    errorCode === 'managed_page_document_generation_mismatch' ||
    errorCode === 'managed_page_record_version_mismatch' ||
    errorCode === 'managed_page_run_mismatch' ||
    errorCode === 'account_profile_strategy_document_context_changed' ||
    errorCode === 'account_profile_strategy_binding_context_rejected' ||
    errorCode === 'account_profile_managed_page_context_changed'
  ) return { state: 'failed', terminalReason: 'context_changed', errorCode, uncertainPageOutcome: true };
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

export class BilibiliAccountProfileHostRunner {
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #browserManager: CollectionBrowserManager;
  readonly #profiles: BrowserProfileRegistry;
  readonly #artifacts: BilibiliAccountProfileArtifactStore;

  constructor(input: {
    accountSafety: AccountSafetyRegistry;
    browserManager: CollectionBrowserManager;
    profiles: BrowserProfileRegistry;
    artifacts: BilibiliAccountProfileArtifactStore;
  }) {
    this.#accountSafety = input.accountSafety;
    this.#browserManager = input.browserManager;
    this.#profiles = input.profiles;
    this.#artifacts = input.artifacts;
  }

  async run(rawInput: BilibiliAccountProfileHostRunInput): Promise<BilibiliAccountProfileHostRunResult> {
    const request = input(rawInput);
    const profile = this.#profiles.get(request.profileId);
    if (
      profile.kind !== 'collection' ||
      profile.platform !== 'bilibili' ||
      profile.account.category !== 'user_managed'
    ) throw new Error('bilibili_account_profile_collection_profile_required');
    const permit = await this.#accountSafety.beginAuthenticatedRun(
      profile.profileId,
      'bilibili',
      'authenticated_account_profile_reconnaissance'
    );
    return await this.#runWithPermit(permit, request.canonicalProfileUrl);
  }

  async #runWithPermit(
    permit: AccountSafetyRunPermit,
    canonicalProfileUrl: string
  ): Promise<BilibiliAccountProfileHostRunResult> {
    const stableAccountId = bilibiliAccountProfileIdFromUrl(canonicalProfileUrl);
    if (!stableAccountId) throw new Error('bilibili_account_profile_target_invalid');
    const navigation = navigationAction(permit.runId);
    const actions = [navigation];
    let acquired: AcquirePageResult | null = null;
    let snapshot: BilibiliAccountProfileRunRecord['snapshot'] = null;
    let visualEvidence: BilibiliAccountProfileVisualEvidence | null = null;
    let state: BilibiliAccountProfileRunRecord['state'] = 'failed';
    let terminalReason: BilibiliAccountProfileTerminalReason = 'dom_projection_failed';
    let errorCode: string | null = null;
    let releaseDisposition: PageReleaseDisposition = 'quarantined';
    let releaseReason = 'account_profile_run_not_started';
    let targetTabSelection: BilibiliAccountProfileRunRecord['safeguards']['targetTabSelection'] = 'not_acquired';
    let targetPage: BilibiliAccountProfileRunRecord['safeguards']['targetPage'] = 'not_acquired';
    let uncertainPageOutcome = false;
    let deadline = 0;
    try {
      await this.#browserManager.launch(permit.profileId);
      acquired = await this.#browserManager.acquirePage({
        profileId: permit.profileId,
        taskId: `bilibili_account_profile_${permit.runId.replace(/-/g, '_')}`,
        runId: permit.runId,
        platform: 'bilibili',
        pageRole: 'account_profile',
        targetUrl: canonicalProfileUrl,
        leaseDurationMs: RUN_DEADLINE_MS
      });
      targetTabSelection = pageSelection(acquired.selection);
      releaseReason = 'account_profile_strategy_binding_not_completed';
      const observerBindingId = randomUUID();
      await this.#browserManager.bindStrategyObserver({
        schemaVersion: 1,
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        expectedRecordVersion: acquired.page.recordVersion,
        runId: permit.runId,
        observerBindingId,
        strategyId: BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID,
        target: { canonicalUrl: canonicalProfileUrl, stableAccountId },
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
        url: canonicalProfileUrl,
        waitUntil: 'domcontentloaded',
        timeoutMs: Math.min(NAVIGATION_TIMEOUT_MS, remainingDeadline(deadline, 1_000))
      });
      navigation.outcome = 'completed';
      releaseDisposition = 'retained_for_review';
      releaseReason = 'account_profile_review_retained';
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
        canonicalProfileUrl,
        deadline
      });
      const risk = riskOutcome(observed.dom);
      snapshot = projectBilibiliAccountProfileDom(observed.dom, canonicalProfileUrl, new Date().toISOString());
      if (risk) {
        state = risk.state;
        terminalReason = risk.terminalReason;
        errorCode = risk.errorCode;
      } else if (!snapshot) {
        state = 'failed';
        terminalReason = 'dom_projection_failed';
        errorCode = 'account_profile_dom_projection_failed';
      } else {
        state = 'completed';
        terminalReason = 'profile_captured';
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
        releaseReason = 'account_profile_page_outcome_unknown';
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

    const run: BilibiliAccountProfileRunRecord = {
      schemaVersion: 1,
      runId: permit.runId,
      collectorVersion: COLLECTOR_EXTENSION_VERSION,
      platform: 'bilibili',
      accountCategory: 'user_managed',
      pageRole: 'account_profile',
      targetUrlDigest: sha256(canonicalProfileUrl),
      strategyCandidate: {
        strategyId: 'bilibili.account.profile.dom.v2',
        version: '0.1.0',
        admissionEligible: false
      },
      state,
      errorCode,
      startedAt: permit.startedAt,
      completedAt: new Date().toISOString(),
      snapshot,
      visualEvidence,
      actions,
      coverage: {
        identityCaptured: Boolean(snapshot),
        avatarCaptured: Boolean(snapshot?.media.avatarUrl),
        bannerCaptured: Boolean(snapshot?.media.bannerUrl),
        badgeCount: snapshot?.badges.length ?? 0,
        publicFieldCount: snapshot?.publicFields.length ?? 0,
        announcementCaptured: Boolean(snapshot?.announcementText),
        chargeSectionCaptured: Boolean(snapshot?.chargeText),
        highlightCount: snapshot?.highlights.length ?? 0,
        terminalReason
      },
      safeguards: {
        environment: 'local_user_controlled_collection_profile',
        browser: 'visible_playwright_chromium',
        acquisition: 'bounded_visible_account_dom',
        responseBody: 'not_read',
        requestHeaders: 'not_read',
        requestBody: 'not_read',
        cookiesAndTokens: 'not_read',
        queryAndFragmentValues: 'discarded',
        currentViewerIdentity: 'excluded',
        semanticActionDelivery: 'at_most_once',
        runDeadlineMs: RUN_DEADLINE_MS,
        targetTabSelection,
        targetPage,
        admissionEligible: false
      }
    };
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
    canonicalProfileUrl: string;
    deadline: number;
  }): Promise<ReturnType<typeof bilibiliAccountProfileStrategyObservation>> {
    let observed: ReturnType<typeof bilibiliAccountProfileStrategyObservation> | null = null;
    while (Date.now() < input.deadline) {
      const result = await this.#readStrategyObservation(input);
      observed = bilibiliAccountProfileStrategyObservation(result);
      if (riskOutcome(observed.dom) || projectBilibiliAccountProfileDom(
        observed.dom,
        input.canonicalProfileUrl,
        new Date().toISOString()
      )) return observed;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    if (!observed) throw new Error('account_profile_strategy_observation_unavailable');
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
          strategyId: BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID,
          deadlineMs: Math.min(OBSERVATION_DEADLINE_MS, remainingDeadline(input.deadline, 100))
        });
      } catch (error) {
        if (!(error instanceof BrowserHostError) || error.record.code !== 'managed_page_record_version_mismatch' || attempt === 1) {
          throw error;
        }
      }
    }
    throw new Error('account_profile_local_version_unavailable');
  }

  async #captureVisualEvidence(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    deadline: number;
    actionId: string;
  }): Promise<BilibiliAccountProfileVisualEvidence> {
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
    throw new Error('account_profile_visual_local_version_unavailable');
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
    ) throw new Error('account_profile_managed_page_context_changed');
    return { recordVersion: page.recordVersion };
  }
}
