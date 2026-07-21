import {
  BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
  BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION,
  BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_TARGET_PAGE,
  BrowserHostError,
  COLLECTOR_EXTENSION_VERSION,
  type AcquirePageResult,
  type BilibiliAccountVideoPageClickResult,
  type PageReleaseDisposition
} from '@intelligence/collector-contracts';
import { randomUUID } from 'node:crypto';
import type { AccountSafetyRegistry, AccountSafetyRunPermit } from './account-safety';
import type {
  BilibiliAccountVideoPageTwoArtifactStore,
  BilibiliAccountVideoPageTwoArtifactSummary
} from './bilibili-account-video-page-two-artifacts';
import {
  bilibiliAccountVideoPageTwoInput,
  bvidSetDigest,
  pageTwoInventoryUrl,
  pageTwoStableAccountId,
  type BilibiliAccountVideoPageTwoAction,
  type BilibiliAccountVideoPageTwoClickAction,
  type BilibiliAccountVideoPageTwoNavigationAction,
  type BilibiliAccountVideoPageTwoRunRecord,
  type BilibiliAccountVideoPageTwoTerminalReason,
  type BilibiliAccountVideoPageTwoVisualEvidence
} from './bilibili-account-video-page-two-contract';
import { createBilibiliAccountVideoPageTwoRunRecord } from './bilibili-account-video-page-two-run-record';
import {
  projectBilibiliAccountVideoInventoryDom,
  type BilibiliAccountVideoInventoryProjection
} from './bilibili-account-video-inventory-contract';
import { bilibiliAccountVideoInventoryStrategyObservation } from './bilibili-account-video-inventory-observation';
import type { CollectionBrowserManager } from './browser-manager';
import type { BrowserProfileRegistry } from './profiles';

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_DEADLINE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const OBSERVATION_DEADLINE_MS = 12_000;
const CLICK_TIMEOUT_MS = 15_000;

export interface BilibiliAccountVideoPageTwoHostRunInput {
  profileId: string;
  canonicalProfileUrl: string;
}

export interface BilibiliAccountVideoPageTwoHostRunResult {
  run: BilibiliAccountVideoPageTwoRunRecord;
  artifact: BilibiliAccountVideoPageTwoArtifactSummary;
}

interface LeasedPageContext {
  recordVersion: number;
  documentGeneration: number;
}

function input(value: BilibiliAccountVideoPageTwoHostRunInput): BilibiliAccountVideoPageTwoHostRunInput {
  if (!PROFILE_ID.test(value.profileId)) throw new Error('bilibili_account_video_page_two_profile_invalid');
  return { profileId: value.profileId, ...bilibiliAccountVideoPageTwoInput({ canonicalProfileUrl: value.canonicalProfileUrl }) };
}

function navigationAction(runId: string): BilibiliAccountVideoPageTwoNavigationAction {
  return {
    actionId: `navigate_account_video_inventory_${runId.replace(/-/g, '_')}`,
    kind: 'navigation',
    intent: 'Open the canonical Bilibili account video inventory exactly once.',
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null
  };
}

function pageTwoClickAction(runId: string): BilibiliAccountVideoPageTwoClickAction {
  return {
    actionId: `select_account_video_page_two_${runId.replace(/-/g, '_')}`,
    kind: 'pagination_click',
    intent: 'Select page two of the Bilibili account video inventory exactly once.',
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null,
    scrollToControlAttempted: false
  };
}

function pageSelection(selection: AcquirePageResult['selection']):
  BilibiliAccountVideoPageTwoRunRecord['safeguards']['targetTabSelection'] {
  if (selection === 'created_new_page') return 'created_new_managed_tab';
  return selection === 'reused_exact_target'
    ? 'reused_matching_managed_tab'
    : 'reused_retained_managed_tab';
}

function riskOutcome(dom: ReturnType<typeof bilibiliAccountVideoInventoryStrategyObservation>['dom']): {
  state: BilibiliAccountVideoPageTwoRunRecord['state'];
  terminalReason: BilibiliAccountVideoPageTwoTerminalReason;
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
  return /^[a-z0-9_]{1,100}$/.test(candidate) ? candidate : 'account_video_page_two_runner_failed';
}

function failureFor(error: unknown): {
  state: BilibiliAccountVideoPageTwoRunRecord['state'];
  terminalReason: BilibiliAccountVideoPageTwoTerminalReason;
  errorCode: string;
  uncertainPageOutcome: boolean;
} {
  const errorCode = safeErrorCode(error);
  if (
    errorCode === 'navigation_outcome_unknown' ||
    errorCode === 'bilibili_page_click_outcome_unknown' ||
    errorCode === 'managed_page_document_generation_mismatch' ||
    errorCode === 'managed_page_record_version_mismatch' ||
    errorCode === 'managed_page_run_mismatch' ||
    errorCode === 'account_video_inventory_strategy_document_context_changed' ||
    errorCode === 'account_video_inventory_strategy_binding_context_rejected' ||
    errorCode === 'account_video_page_two_managed_page_context_changed'
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

function visualEvidence(
  phase: BilibiliAccountVideoPageTwoVisualEvidence['phase'],
  actionId: string,
  value: BilibiliAccountVideoPageClickResult['before']['visualEvidence']
): BilibiliAccountVideoPageTwoVisualEvidence {
  return {
    phase,
    actionId,
    evidenceId: value.evidenceId,
    capturedAt: value.capturedAt,
    viewport: value.viewport,
    screenshot: value.screenshot
  };
}

export class BilibiliAccountVideoPageTwoHostRunner {
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #browserManager: CollectionBrowserManager;
  readonly #profiles: BrowserProfileRegistry;
  readonly #artifacts: BilibiliAccountVideoPageTwoArtifactStore;

  constructor(input: {
    accountSafety: AccountSafetyRegistry;
    browserManager: CollectionBrowserManager;
    profiles: BrowserProfileRegistry;
    artifacts: BilibiliAccountVideoPageTwoArtifactStore;
  }) {
    this.#accountSafety = input.accountSafety;
    this.#browserManager = input.browserManager;
    this.#profiles = input.profiles;
    this.#artifacts = input.artifacts;
  }

  async run(rawInput: BilibiliAccountVideoPageTwoHostRunInput): Promise<BilibiliAccountVideoPageTwoHostRunResult> {
    const request = input(rawInput);
    const profile = this.#profiles.get(request.profileId);
    if (
      profile.kind !== 'collection' ||
      profile.platform !== 'bilibili' ||
      profile.account.category !== 'user_managed'
    ) throw new Error('bilibili_account_video_page_two_collection_profile_required');
    const permit = await this.#accountSafety.beginAuthenticatedRun(
      profile.profileId,
      'bilibili',
      'authenticated_account_video_page_two_reconnaissance'
    );
    return await this.#runWithPermit(
      permit,
      pageTwoInventoryUrl(request.canonicalProfileUrl),
      pageTwoStableAccountId(request.canonicalProfileUrl)
    );
  }

  async #runWithPermit(
    permit: AccountSafetyRunPermit,
    canonicalInventoryUrl: string,
    stableAccountId: string
  ): Promise<BilibiliAccountVideoPageTwoHostRunResult> {
    const navigation = navigationAction(permit.runId);
    const click = pageTwoClickAction(permit.runId);
    const actions: BilibiliAccountVideoPageTwoAction[] = [navigation, click];
    let deadline = 0;
    let acquired: AcquirePageResult | null = null;
    let pageTwo: BilibiliAccountVideoInventoryProjection | null = null;
    let beforeBvidSetDigest: string | null = null;
    let afterBvidSetDigest: string | null = null;
    let pagination: BilibiliAccountVideoPageTwoRunRecord['pagination'] = null;
    let visual: BilibiliAccountVideoPageTwoRunRecord['visualEvidence'] = { before: null, after: null };
    let state: BilibiliAccountVideoPageTwoRunRecord['state'] = 'failed';
    let terminalReason: BilibiliAccountVideoPageTwoTerminalReason = 'dom_projection_failed';
    let errorCode: string | null = null;
    let releaseDisposition: PageReleaseDisposition = 'quarantined';
    let releaseReason = 'account_video_page_two_run_not_started';
    let uncertainPageOutcome = false;
    let targetTabSelection: BilibiliAccountVideoPageTwoRunRecord['safeguards']['targetTabSelection'] = 'not_acquired';
    let targetPage: BilibiliAccountVideoPageTwoRunRecord['safeguards']['targetPage'] = 'not_acquired';
    try {
      await this.#browserManager.launch(permit.profileId);
      acquired = await this.#browserManager.acquirePage({
        profileId: permit.profileId,
        taskId: `bilibili_account_video_page_two_${permit.runId.replace(/-/g, '_')}`,
        runId: permit.runId,
        platform: 'bilibili',
        pageRole: 'account_video_inventory',
        targetUrl: canonicalInventoryUrl,
        leaseDurationMs: RUN_DEADLINE_MS
      });
      targetTabSelection = pageSelection(acquired.selection);
      releaseReason = 'account_video_page_two_initial_binding_not_completed';
      deadline = Date.now() + RUN_DEADLINE_MS;

      const inventoryBindingId = await this.#bindInventoryObserver({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        runId: permit.runId,
        canonicalInventoryUrl,
        stableAccountId,
        deadline,
        allowPreNavigationState: true
      });
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
      releaseReason = 'account_video_page_two_review_retained';

      const before = await this.#observeInventory({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        runId: permit.runId,
        observerBindingId: inventoryBindingId,
        stableAccountId,
        deadline
      });
      const beforeRisk = riskOutcome(before.dom);
      const pageOne = projectBilibiliAccountVideoInventoryDom(before.dom, stableAccountId, new Date().toISOString());
      if (beforeRisk) {
        state = beforeRisk.state;
        terminalReason = beforeRisk.terminalReason;
        errorCode = beforeRisk.errorCode;
      } else if (!pageOne) {
        state = before.dom.loginOverlayVisible ? 'partial' : 'failed';
        terminalReason = before.dom.loginOverlayVisible ? 'authentication_required' : 'dom_projection_failed';
        errorCode = before.dom.loginOverlayVisible
          ? 'authentication_required'
          : 'account_video_page_two_initial_dom_projection_failed';
      } else {
        beforeBvidSetDigest = bvidSetDigest(pageOne);
        const context = await this.#leasedPageContext({
          profileId: permit.profileId,
          pageAlias: acquired.page.pageAlias,
          pageLeaseId: acquired.lease.pageLeaseId,
          runId: permit.runId
        });
        await this.#accountSafety.recordActionAttempt(permit.profileId, 'bilibili', permit.runId, click.actionId);
        click.attempted = true;
        click.attemptCount = 1;
        const clickResult = await this.#browserManager.clickBilibiliAccountVideoPage({
          schemaVersion: BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION,
          profileId: permit.profileId,
          pageAlias: acquired.page.pageAlias,
          pageLeaseId: acquired.lease.pageLeaseId,
          runId: permit.runId,
          expectedRecordVersion: context.recordVersion,
          expectedDocumentGeneration: context.documentGeneration,
          actionId: click.actionId,
          targetPage: BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_TARGET_PAGE,
          timeoutMs: Math.min(CLICK_TIMEOUT_MS, remainingDeadline(deadline, 1_000))
        });
        click.outcome = 'completed';
        click.scrollToControlAttempted = clickResult.scrollToControl.attempted;
        pagination = {
          targetPage: BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_TARGET_PAGE,
          activePageBefore: clickResult.before.activePage,
          activePageAfter: clickResult.after.activePage,
          targetBounds: clickResult.before.targetBounds,
          scrollToControlAttempted: clickResult.scrollToControl.attempted,
          matchedRouteStatuses: clickResult.network.observations.map((observation) => observation.status)
        };
        visual = {
          before: visualEvidence('pagination_before', click.actionId, clickResult.before.visualEvidence),
          after: visualEvidence('pagination_after', click.actionId, clickResult.after.visualEvidence)
        };
        if (clickResult.after.activePage !== BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_TARGET_PAGE) {
          state = 'partial';
          terminalReason = 'page_two_selection_unconfirmed';
          errorCode = 'account_video_page_two_selection_unconfirmed';
          click.outcome = 'postcondition_unmet';
          click.errorCode = errorCode;
        } else if (!clickResult.network.observations.some((observation) => observation.status >= 200 && observation.status < 300)) {
          state = 'partial';
          terminalReason = 'page_two_source_rejected';
          errorCode = 'account_video_page_two_source_rejected';
          click.outcome = 'postcondition_unmet';
          click.errorCode = errorCode;
        } else {
          // The trusted click proves that pagination stays in the same main
          // document. Reuse its already-bound document observer instead of
          // arming a second observer for a document navigation that will not
          // occur.
          const observedPageTwo = await this.#observeInventoryChange({
            profileId: permit.profileId,
            pageAlias: acquired.page.pageAlias,
            pageLeaseId: acquired.lease.pageLeaseId,
            runId: permit.runId,
            observerBindingId: inventoryBindingId,
            stableAccountId,
            beforeBvidSetDigest,
            deadline
          });
          const afterRisk = riskOutcome(observedPageTwo.dom);
          if (afterRisk) {
            state = afterRisk.state;
            terminalReason = afterRisk.terminalReason;
            errorCode = afterRisk.errorCode;
          } else {
            pageTwo = projectBilibiliAccountVideoInventoryDom(
              observedPageTwo.dom,
              stableAccountId,
              new Date().toISOString()
            );
            if (!pageTwo) {
              state = observedPageTwo.dom.loginOverlayVisible ? 'partial' : 'failed';
              terminalReason = observedPageTwo.dom.loginOverlayVisible ? 'authentication_required' : 'dom_projection_failed';
              errorCode = observedPageTwo.dom.loginOverlayVisible
                ? 'authentication_required'
                : 'account_video_page_two_dom_projection_failed';
            } else {
              afterBvidSetDigest = bvidSetDigest(pageTwo);
              if (afterBvidSetDigest === beforeBvidSetDigest) {
                state = 'partial';
                terminalReason = 'page_two_cards_unchanged';
                errorCode = 'account_video_page_two_cards_unchanged';
              } else {
                state = 'completed';
                terminalReason = 'page_two_ready';
                errorCode = null;
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
      if (click.attempted && click.outcome !== 'completed') {
        click.outcome = failure.uncertainPageOutcome ? 'postcondition_unmet' : 'failed';
        click.errorCode = failure.errorCode;
      } else if (navigation.attempted && navigation.outcome !== 'completed') {
        navigation.outcome = failure.uncertainPageOutcome ? 'postcondition_unmet' : 'failed';
        navigation.errorCode = failure.errorCode;
      }
      if (failure.uncertainPageOutcome) {
        releaseDisposition = 'quarantined';
        releaseReason = 'account_video_page_two_outcome_unknown';
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

    const run = createBilibiliAccountVideoPageTwoRunRecord({
      runId: permit.runId,
      collectorVersion: COLLECTOR_EXTENSION_VERSION,
      canonicalInventoryUrl,
      stableAccountId,
      startedAt: permit.startedAt,
      completedAt: new Date().toISOString(),
      state,
      errorCode,
      pageTwo,
      beforeBvidSetDigest,
      afterBvidSetDigest,
      pagination,
      visualEvidence: visual,
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

  async #bindInventoryObserver(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    canonicalInventoryUrl: string;
    stableAccountId: string;
    deadline: number;
    allowPreNavigationState?: boolean;
  }): Promise<string> {
    const observerBindingId = randomUUID();
    const context = await this.#leasedPageContext(input, input.allowPreNavigationState === true);
    await this.#browserManager.bindStrategyObserver({
      schemaVersion: 1,
      profileId: input.profileId,
      pageAlias: input.pageAlias,
      pageLeaseId: input.pageLeaseId,
      expectedRecordVersion: context.recordVersion,
      runId: input.runId,
      observerBindingId,
      strategyId: BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
      target: { canonicalUrl: input.canonicalInventoryUrl, stableAccountId: input.stableAccountId },
      expiresAt: new Date(Date.now() + Math.min(55_000, remainingDeadline(input.deadline, 1_000))).toISOString(),
      maximumResponseObservations: 0,
      maximumPayloadBytes: 128 * 1024
    });
    return observerBindingId;
  }

  async #observeInventory(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    observerBindingId: string;
    stableAccountId: string;
    deadline: number;
  }): Promise<ReturnType<typeof bilibiliAccountVideoInventoryStrategyObservation>> {
    let observed: ReturnType<typeof bilibiliAccountVideoInventoryStrategyObservation> | null = null;
    while (Date.now() < input.deadline) {
      const result = await this.#readInventoryObservation(input);
      observed = bilibiliAccountVideoInventoryStrategyObservation(result, input.stableAccountId);
      if (riskOutcome(observed.dom) || projectBilibiliAccountVideoInventoryDom(observed.dom, input.stableAccountId, new Date().toISOString())) {
        return observed;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    if (!observed) throw new Error('account_video_page_two_initial_observation_unavailable');
    return observed;
  }

  async #observeInventoryChange(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    observerBindingId: string;
    stableAccountId: string;
    beforeBvidSetDigest: string;
    deadline: number;
  }): Promise<ReturnType<typeof bilibiliAccountVideoInventoryStrategyObservation>> {
    let observed: ReturnType<typeof bilibiliAccountVideoInventoryStrategyObservation> | null = null;
    while (Date.now() < input.deadline) {
      const result = await this.#readInventoryObservation(input);
      observed = bilibiliAccountVideoInventoryStrategyObservation(result, input.stableAccountId);
      const page = projectBilibiliAccountVideoInventoryDom(observed.dom, input.stableAccountId, new Date().toISOString());
      if (riskOutcome(observed.dom) || (page && bvidSetDigest(page) !== input.beforeBvidSetDigest)) return observed;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    if (!observed) throw new Error('account_video_page_two_changed_observation_unavailable');
    return observed;
  }

  async #readInventoryObservation(input: {
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
    throw new Error('account_video_page_two_local_version_unavailable');
  }

  async #leasedPageContext(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
  }, allowPreNavigationState = false): Promise<LeasedPageContext> {
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
    ) throw new Error('account_video_page_two_managed_page_context_changed');
    return { recordVersion: page.recordVersion, documentGeneration: page.documentGeneration };
  }
}
