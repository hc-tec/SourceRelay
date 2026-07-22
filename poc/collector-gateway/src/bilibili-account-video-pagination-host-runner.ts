import {
  BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION,
  COLLECTOR_EXTENSION_VERSION,
  type AcquirePageResult,
  type PageReleaseDisposition
} from '@intelligence/collector-contracts';
import type { AccountSafetyRegistry, AccountSafetyRunPermit } from './account-safety';
import type {
  BilibiliAccountVideoPaginationArtifactStore,
  BilibiliAccountVideoPaginationArtifactSummary
} from './bilibili-account-video-pagination-artifacts';
import {
  bilibiliAccountVideoBvidSetDigest,
  bilibiliAccountVideoPaginationInput,
  pageClickNetworkStatuses,
  paginationInventoryUrl,
  paginationStableAccountId,
  type BilibiliAccountVideoPaginationAction,
  type BilibiliAccountVideoPaginationPage,
  type BilibiliAccountVideoPaginationTerminalReason,
  type BilibiliAccountVideoPaginationRunRecord
} from './bilibili-account-video-pagination-contract';
import { createBilibiliAccountVideoPaginationRunRecord } from './bilibili-account-video-pagination-run-record';
import { projectBilibiliAccountVideoInventoryDom } from './bilibili-account-video-inventory-contract';
import {
  hasCrossPageDuplicate,
  paginationClickAction,
  paginationFailure,
  paginationNavigationAction,
  paginationPageSelection,
  paginationRiskOutcome,
  paginationSafeErrorCode
} from './bilibili-account-video-pagination-run-logic';
import {
  BilibiliAccountVideoPaginationSession,
  paginationRemainingDeadline
} from './bilibili-account-video-pagination-session';
import type { CollectionBrowserManager } from './browser-manager';
import type { BrowserProfileRegistry } from './profiles';

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_DEADLINE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const CLICK_TIMEOUT_MS = 15_000;

export interface BilibiliAccountVideoPaginationHostRunInput {
  profileId: string;
  canonicalProfileUrl: string;
  maxPages: number;
}

export interface BilibiliAccountVideoPaginationHostRunResult {
  run: BilibiliAccountVideoPaginationRunRecord;
  artifact: BilibiliAccountVideoPaginationArtifactSummary;
}

function input(value: BilibiliAccountVideoPaginationHostRunInput): BilibiliAccountVideoPaginationHostRunInput {
  if (!PROFILE_ID.test(value.profileId)) throw new Error('bilibili_account_video_pagination_profile_invalid');
  return {
    profileId: value.profileId,
    ...bilibiliAccountVideoPaginationInput({
      canonicalProfileUrl: value.canonicalProfileUrl,
      maxPages: value.maxPages
    })
  };
}

export class BilibiliAccountVideoPaginationHostRunner {
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #browserManager: CollectionBrowserManager;
  readonly #profiles: BrowserProfileRegistry;
  readonly #artifacts: BilibiliAccountVideoPaginationArtifactStore;

  constructor(input: {
    accountSafety: AccountSafetyRegistry;
    browserManager: CollectionBrowserManager;
    profiles: BrowserProfileRegistry;
    artifacts: BilibiliAccountVideoPaginationArtifactStore;
  }) {
    this.#accountSafety = input.accountSafety;
    this.#browserManager = input.browserManager;
    this.#profiles = input.profiles;
    this.#artifacts = input.artifacts;
  }

  async run(rawInput: BilibiliAccountVideoPaginationHostRunInput): Promise<BilibiliAccountVideoPaginationHostRunResult> {
    const request = input(rawInput);
    const profile = this.#profiles.get(request.profileId);
    if (
      profile.kind !== 'collection' ||
      profile.platform !== 'bilibili' ||
      profile.account.category !== 'user_managed'
    ) throw new Error('bilibili_account_video_pagination_collection_profile_required');
    const permit = await this.#accountSafety.beginAuthenticatedRun(
      profile.profileId,
      'bilibili',
      'authenticated_account_video_pagination_reconnaissance'
    );
    return await this.#runWithPermit(
      permit,
      paginationInventoryUrl(request.canonicalProfileUrl),
      paginationStableAccountId(request.canonicalProfileUrl),
      request.maxPages
    );
  }

  async #runWithPermit(
    permit: AccountSafetyRunPermit,
    canonicalInventoryUrl: string,
    stableAccountId: string,
    requestedPages: number
  ): Promise<BilibiliAccountVideoPaginationHostRunResult> {
    const navigation = paginationNavigationAction(permit.runId);
    const actions: BilibiliAccountVideoPaginationAction[] = [navigation];
    const pages: BilibiliAccountVideoPaginationPage[] = [];
    let deadline = 0;
    let acquired: AcquirePageResult | null = null;
    let state: BilibiliAccountVideoPaginationRunRecord['state'] = 'failed';
    let terminalReason: BilibiliAccountVideoPaginationTerminalReason = 'dom_projection_failed';
    let errorCode: string | null = null;
    let releaseDisposition: PageReleaseDisposition = 'quarantined';
    let releaseReason = 'account_video_pagination_run_not_started';
    let uncertainPageOutcome = false;
    let targetTabSelection: BilibiliAccountVideoPaginationRunRecord['safeguards']['targetTabSelection'] = 'not_acquired';
    let targetPage: BilibiliAccountVideoPaginationRunRecord['safeguards']['targetPage'] = 'not_acquired';
    try {
      await this.#browserManager.launch(permit.profileId);
      acquired = await this.#browserManager.acquirePage({
        profileId: permit.profileId,
        taskId: `bilibili_account_video_pagination_${permit.runId.replace(/-/g, '_')}`,
        runId: permit.runId,
        platform: 'bilibili',
        pageRole: 'account_video_inventory',
        targetUrl: canonicalInventoryUrl,
        leaseDurationMs: RUN_DEADLINE_MS
      });
      targetTabSelection = paginationPageSelection(acquired.selection);
      releaseReason = 'account_video_pagination_initial_binding_not_completed';
      deadline = Date.now() + RUN_DEADLINE_MS;
      const session = new BilibiliAccountVideoPaginationSession({
        browserManager: this.#browserManager,
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        runId: permit.runId,
        canonicalInventoryUrl,
        stableAccountId,
        deadline,
        documentBindingMode: acquired.selection === 'reused_exact_target'
          ? 'next_navigation_only'
          : 'current_document_or_next_navigation'
      });
      await session.bindBeforeNavigation();
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
        timeoutMs: Math.min(NAVIGATION_TIMEOUT_MS, paginationRemainingDeadline(deadline, 1_000))
      });
      navigation.outcome = 'completed';
      releaseDisposition = 'retained_for_review';
      releaseReason = 'account_video_pagination_review_retained';
      navigation.visualEvidence = await session.captureVisualEvidence();

      const initial = await session.observeInitial();
      let currentPage = projectBilibiliAccountVideoInventoryDom(initial.dom, stableAccountId, new Date().toISOString());
      const initialRisk = paginationRiskOutcome(initial.dom, currentPage);
      if (initialRisk) {
        state = initialRisk.state;
        terminalReason = initialRisk.terminalReason;
        errorCode = initialRisk.errorCode;
      } else if (!currentPage) {
        state = 'failed';
        terminalReason = 'dom_projection_failed';
        errorCode = 'account_video_pagination_initial_dom_projection_failed';
      } else {
        pages.push({ pageNumber: 1, projection: currentPage, bvidSetDigest: bilibiliAccountVideoBvidSetDigest(currentPage) });
        state = 'completed';
        terminalReason = 'requested_page_budget_reached';
        errorCode = null;
        for (let pageNumber = 2; pageNumber <= requestedPages; pageNumber += 1) {
          const click = paginationClickAction(permit.runId, pageNumber - 1);
          actions.push(click);
          let clickResult: Awaited<ReturnType<CollectionBrowserManager['clickBilibiliAccountVideoPage']>>;
          try {
            const context = await session.leaseContext();
            await this.#accountSafety.recordActionAttempt(permit.profileId, 'bilibili', permit.runId, click.actionId);
            click.attempted = true;
            click.attemptCount = 1;
            clickResult = await this.#browserManager.clickBilibiliAccountVideoPage({
              schemaVersion: BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION,
              profileId: permit.profileId,
              pageAlias: acquired.page.pageAlias,
              pageLeaseId: acquired.lease.pageLeaseId,
              runId: permit.runId,
              expectedRecordVersion: context.recordVersion,
              expectedDocumentGeneration: context.documentGeneration,
              actionId: click.actionId,
              expectedActivePage: click.expectedActivePage,
              targetPage: click.targetPage,
              timeoutMs: Math.min(CLICK_TIMEOUT_MS, paginationRemainingDeadline(deadline, 1_000))
            });
            click.outcome = 'completed';
          } catch (error) {
            const code = paginationSafeErrorCode(error);
            if (code === 'bilibili_page_click_precondition_unmet' && !click.attempted) {
              state = 'partial';
              terminalReason = 'pagination_precondition_unmet';
              errorCode = code;
              click.outcome = 'prerequisite_unmet';
              click.errorCode = code;
              break;
            }
            throw error;
          }
          click.scrollToControlAttempted = clickResult.scrollToControl.attempted;
          click.targetBounds = clickResult.before.targetBounds;
          click.matchedRouteStatuses = pageClickNetworkStatuses(clickResult.network.observations);
          click.visualEvidence = {
            before: clickResult.before.visualEvidence,
            after: clickResult.after.visualEvidence
          };
          if (clickResult.after.activePage !== click.targetPage) {
            state = 'partial';
            terminalReason = 'page_selection_unconfirmed';
            errorCode = 'account_video_pagination_selection_unconfirmed';
            click.outcome = 'postcondition_unmet';
            click.errorCode = errorCode;
            break;
          }
          if (!clickResult.network.observations.some((observation) => observation.status >= 200 && observation.status < 300)) {
            state = 'partial';
            terminalReason = 'page_source_rejected';
            errorCode = 'account_video_pagination_source_rejected';
            click.outcome = 'postcondition_unmet';
            click.errorCode = errorCode;
            break;
          }
          const observed = await session.observeChange(bilibiliAccountVideoBvidSetDigest(currentPage));
          const nextPage = projectBilibiliAccountVideoInventoryDom(observed.dom, stableAccountId, new Date().toISOString());
          const nextRisk = paginationRiskOutcome(observed.dom, nextPage);
          if (nextRisk) {
            state = nextRisk.state;
            terminalReason = nextRisk.terminalReason;
            errorCode = nextRisk.errorCode;
            break;
          }
          if (!nextPage) {
            state = 'failed';
            terminalReason = 'dom_projection_failed';
            errorCode = 'account_video_pagination_dom_projection_failed';
            break;
          }
          const nextDigest = bilibiliAccountVideoBvidSetDigest(nextPage);
          if (nextDigest === bilibiliAccountVideoBvidSetDigest(currentPage)) {
            state = 'partial';
            terminalReason = 'page_cards_unchanged';
            errorCode = 'account_video_pagination_cards_unchanged';
            break;
          }
          const duplicate = hasCrossPageDuplicate(pages, nextPage);
          pages.push({ pageNumber, projection: nextPage, bvidSetDigest: nextDigest });
          currentPage = nextPage;
          if (duplicate) {
            state = 'partial';
            terminalReason = 'duplicate_video_detected';
            errorCode = 'account_video_pagination_duplicate_video_detected';
            break;
          }
        }
      }
    } catch (error) {
      const failure = paginationFailure(error);
      state = failure.state;
      terminalReason = failure.terminalReason;
      errorCode = failure.errorCode;
      uncertainPageOutcome = failure.uncertainPageOutcome;
      const activeAction = [...actions].reverse().find((action) => action.attempted && action.outcome !== 'completed');
      if (activeAction) {
        activeAction.outcome = failure.uncertainPageOutcome ? 'postcondition_unmet' : 'failed';
        activeAction.errorCode = failure.errorCode;
      }
      if (failure.uncertainPageOutcome) {
        releaseDisposition = 'quarantined';
        releaseReason = 'account_video_pagination_page_outcome_unknown';
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
          const failure = paginationFailure(error);
          state = failure.state;
          terminalReason = failure.terminalReason;
          errorCode = failure.errorCode;
        }
        targetPage = 'quarantined_on_uncertain_outcome';
      }
    }

    const run = createBilibiliAccountVideoPaginationRunRecord({
      runId: permit.runId,
      collectorVersion: COLLECTOR_EXTENSION_VERSION,
      canonicalInventoryUrl,
      stableAccountId,
      startedAt: permit.startedAt,
      completedAt: new Date().toISOString(),
      requestedPages,
      state,
      errorCode,
      pages,
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

}
