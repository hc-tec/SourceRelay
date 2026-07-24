import {
  BILIBILI_DANMAKU_INTERACTION_SCHEMA_VERSION,
  BILIBILI_DANMAKU_STRATEGY_ID,
  COLLECTOR_EXTENSION_VERSION,
  BrowserHostError,
  type AcquirePageResult,
  type BilibiliDanmakuInteractionAction,
  type BilibiliDanmakuInteractionResult,
  type PageReleaseDisposition
} from '@intelligence/collector-contracts';
import { randomUUID } from 'node:crypto';
import type { AccountSafetyRegistry, AccountSafetyRunPermit } from './account-safety';
import type { CollectionBrowserManager } from './browser-manager';
import type { BrowserProfileRegistry } from './profiles';
import {
  bvidFromCanonicalBilibiliDanmakuUrl,
  BILIBILI_DANMAKU_MAX_SCROLL_WINDOWS,
  type BilibiliDanmakuNavigationAction,
  type BilibiliDanmakuRunRecord,
  type BilibiliDanmakuTerminalReason
} from './bilibili-danmaku-contract';
import { bilibiliDanmakuStrategyObservation } from './bilibili-danmaku-observation';
import { createBilibiliDanmakuRunRecord } from './bilibili-danmaku-run-record';
import type { BilibiliDanmakuArtifactStore, BilibiliDanmakuArtifactSummary } from './bilibili-danmaku-artifacts';

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_DEADLINE_MS = 90_000;

export interface BilibiliDanmakuHostRunInput {
  profileId: string;
  canonicalVideoUrl: string;
}

export interface BilibiliDanmakuHostRunResult {
  run: BilibiliDanmakuRunRecord;
  artifact: BilibiliDanmakuArtifactSummary;
}

function targetTabSelection(selection: AcquirePageResult['selection']): BilibiliDanmakuRunRecord['safeguards']['targetTabSelection'] {
  if (selection === 'created_new_page') return 'created_new_managed_tab';
  return selection === 'reused_exact_target' ? 'reused_matching_managed_tab' : 'reused_retained_managed_tab';
}

function navigationAction(runId: string): BilibiliDanmakuNavigationAction {
  return {
    actionId: `navigate_bilibili_danmaku_${runId.replace(/-/g, '_')}`,
    attempted: false,
    attemptCount: 0,
    outcome: 'prerequisite_unmet',
    errorCode: null
  };
}

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof BrowserHostError ? error.record.code : error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(candidate) ? candidate : 'bilibili_danmaku_runner_failed';
}

function failureFor(error: unknown): { state: BilibiliDanmakuRunRecord['state']; terminalReason: BilibiliDanmakuTerminalReason; errorCode: string; uncertain: boolean } {
  const errorCode = safeErrorCode(error);
  if (errorCode.includes('outcome_unknown') || errorCode.includes('document_generation_mismatch') || errorCode.includes('run_mismatch')) {
    return { state: 'failed', terminalReason: 'document_context_changed', errorCode, uncertain: true };
  }
  if (errorCode === 'run_deadline_exceeded' || errorCode.includes('deadline_exceeded')) {
    return { state: 'failed', terminalReason: 'run_deadline_exceeded', errorCode, uncertain: true };
  }
  if (errorCode === 'bilibili_danmaku_strategy_observer_not_bound') {
    return { state: 'partial', terminalReason: 'observer_not_bound', errorCode, uncertain: false };
  }
  return { state: 'failed', terminalReason: 'dom_projection_failed', errorCode, uncertain: false };
}

export class BilibiliDanmakuHostRunner {
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #browserManager: CollectionBrowserManager;
  readonly #profiles: BrowserProfileRegistry;
  readonly #artifacts: BilibiliDanmakuArtifactStore;

  constructor(input: {
    accountSafety: AccountSafetyRegistry;
    browserManager: CollectionBrowserManager;
    profiles: BrowserProfileRegistry;
    artifacts: BilibiliDanmakuArtifactStore;
  }) {
    this.#accountSafety = input.accountSafety;
    this.#browserManager = input.browserManager;
    this.#profiles = input.profiles;
    this.#artifacts = input.artifacts;
  }

  async run(input: BilibiliDanmakuHostRunInput): Promise<BilibiliDanmakuHostRunResult> {
    if (!PROFILE_ID.test(input.profileId)) throw new Error('bilibili_danmaku_profile_invalid');
    const profile = this.#profiles.get(input.profileId);
    if (profile.kind !== 'collection' || profile.platform !== 'bilibili' || profile.account.category !== 'user_managed') {
      throw new Error('bilibili_danmaku_collection_profile_required');
    }
    const bvid = bvidFromCanonicalBilibiliDanmakuUrl(input.canonicalVideoUrl);
    const permit = await this.#accountSafety.beginAuthenticatedRun(input.profileId, 'bilibili', 'authenticated_danmaku_reconnaissance');
    return await this.#runWithPermit(permit, input.canonicalVideoUrl, bvid);
  }

  async #runWithPermit(permit: AccountSafetyRunPermit, canonicalVideoUrl: string, bvid: string): Promise<BilibiliDanmakuHostRunResult> {
    const navigation = navigationAction(permit.runId);
    const interactions: BilibiliDanmakuInteractionResult[] = [];
    let rows: ReturnType<typeof bilibiliDanmakuStrategyObservation>['rows'] = [];
    let dom: ReturnType<typeof bilibiliDanmakuStrategyObservation>['dom'] | null = null;
    let acquired: AcquirePageResult | null = null;
    let selection: BilibiliDanmakuRunRecord['safeguards']['targetTabSelection'] = 'not_acquired';
    let targetPage: BilibiliDanmakuRunRecord['safeguards']['targetPage'] = 'not_acquired';
    let state: BilibiliDanmakuRunRecord['state'] = 'failed';
    let terminalReason: BilibiliDanmakuTerminalReason = 'dom_projection_failed';
    let errorCode: string | null = null;
    let releaseDisposition: PageReleaseDisposition = 'quarantined';
    let releaseReason = 'bilibili_danmaku_run_not_started';
    let observerBindingId = '';
    let uncertainPageOutcome = false;
    try {
      await this.#browserManager.launch(permit.profileId);
      acquired = await this.#browserManager.acquirePage({
        profileId: permit.profileId,
        taskId: `bilibili_danmaku_${permit.runId.replace(/-/g, '_')}`,
        runId: permit.runId,
        platform: 'bilibili',
        pageRole: 'video_detail',
        targetUrl: canonicalVideoUrl,
        leaseDurationMs: RUN_DEADLINE_MS
      });
      selection = targetTabSelection(acquired.selection);
      releaseReason = 'bilibili_danmaku_strategy_binding_not_completed';
      observerBindingId = randomUUID();
      const context = await this.#pageContext(permit.profileId, acquired.page.pageAlias, permit.runId, acquired.lease.pageLeaseId, true);
      await this.#browserManager.bindStrategyObserver({
        schemaVersion: 1,
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        expectedRecordVersion: context.recordVersion,
        runId: permit.runId,
        observerBindingId,
        strategyId: BILIBILI_DANMAKU_STRATEGY_ID,
        target: { canonicalUrl: canonicalVideoUrl, bvid },
        expiresAt: new Date(Date.now() + RUN_DEADLINE_MS).toISOString(),
        maximumResponseObservations: 0,
        maximumPayloadBytes: 96 * 1024,
        documentBindingMode: 'next_navigation_only'
      });
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
        timeoutMs: 15_000
      });
      navigation.outcome = 'completed';
      releaseDisposition = 'retained_for_review';
      releaseReason = 'bilibili_danmaku_review_retained';

      await this.#runInteraction(permit, acquired, bvid, 'open_list', interactions);
      const first = await this.#read(permit, acquired, observerBindingId, bvid);
      dom = first.dom;
      rows = first.rows;
      if (!dom.listOpen || rows.length === 0) {
        state = 'partial';
        terminalReason = 'list_unavailable';
      } else {
        let capturedAll = dom.listTotalEstimate !== null && rows.length >= dom.listTotalEstimate;
        for (let windowOrdinal = 1;
          windowOrdinal <= BILIBILI_DANMAKU_MAX_SCROLL_WINDOWS && !capturedAll;
          windowOrdinal += 1) {
          const beforeUniqueRows = rows.length;
          await this.#runInteraction(
            permit,
            acquired,
            bvid,
            'scroll_list',
            interactions,
            windowOrdinal
          );
          const observed = await this.#read(permit, acquired, observerBindingId, bvid);
          dom = observed.dom;
          rows = deduplicateRows([...rows, ...observed.rows]);
          const total = dom.listTotalEstimate;
          if (total !== null && rows.length >= total) {
            capturedAll = true;
            break;
          }
          // A real wheel that leaves the same virtual-list window mounted is
          // a valid stop condition; do not keep sending platform input just
          // to manufacture more rows.
          if (rows.length === beforeUniqueRows) break;
        }
        state = capturedAll ? 'completed' : 'partial';
        terminalReason = capturedAll ? 'danmaku_ready' : 'budget_exhausted';
      }
    } catch (error) {
      const failure = failureFor(error);
      state = failure.state;
      terminalReason = failure.terminalReason;
      errorCode = failure.errorCode;
      uncertainPageOutcome = failure.uncertain;
      if (navigation.attempted && navigation.outcome !== 'completed') {
        navigation.outcome = failure.uncertain ? 'postcondition_unmet' : 'failed';
        navigation.errorCode = failure.errorCode;
      }
      if (failure.uncertain) {
        releaseDisposition = 'quarantined';
        releaseReason = 'bilibili_danmaku_outcome_unknown';
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
        targetPage = released.state === 'retained_for_review' ? 'retained_after_run' : 'quarantined_on_uncertain_outcome';
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
    const run = createBilibiliDanmakuRunRecord({
      runId: permit.runId,
      collectorVersion: COLLECTOR_EXTENSION_VERSION,
      canonicalVideoUrl,
      bvid,
      startedAt: permit.startedAt,
      completedAt: new Date().toISOString(),
      state,
      errorCode,
      navigation,
      interactions,
      dom,
      rows,
      terminalReason,
      targetTabSelection: selection,
      targetPage
    });
    try {
      const artifact = await this.#artifacts.record(run);
      return { run, artifact };
    } finally {
      await this.#accountSafety.finishAuthenticatedRun(permit.profileId, 'bilibili', permit.runId, errorCode ?? terminalReason);
    }
  }

  async #runInteraction(
    permit: AccountSafetyRunPermit,
    acquired: AcquirePageResult,
    bvid: string,
    action: BilibiliDanmakuInteractionAction,
    interactions: BilibiliDanmakuInteractionResult[],
    scrollOrdinal = 1
  ): Promise<void> {
    const actionId = `${action === 'scroll_list' ? `${action}_${scrollOrdinal}` : action}_bilibili_danmaku_${permit.runId.replace(/-/g, '_')}`;
    await this.#accountSafety.recordActionAttempt(permit.profileId, 'bilibili', permit.runId, actionId);
    const context = await this.#pageContext(permit.profileId, acquired.page.pageAlias, permit.runId, acquired.lease.pageLeaseId, false);
    const result = await this.#browserManager.interactBilibiliDanmaku({
      schemaVersion: BILIBILI_DANMAKU_INTERACTION_SCHEMA_VERSION,
      profileId: permit.profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      runId: permit.runId,
      expectedRecordVersion: context.recordVersion,
      expectedDocumentGeneration: context.documentGeneration,
      actionId,
      action,
      bvid,
      timeoutMs: 18_000
    });
    interactions.push(result);
  }

  async #read(permit: AccountSafetyRunPermit, acquired: AcquirePageResult, observerBindingId: string, bvid: string) {
    const context = await this.#pageContext(permit.profileId, acquired.page.pageAlias, permit.runId, acquired.lease.pageLeaseId, false);
    const result = await this.#browserManager.readStrategyObservation({
      schemaVersion: 1,
      profileId: permit.profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      expectedRecordVersion: context.recordVersion,
      runId: permit.runId,
      observerBindingId,
      strategyId: BILIBILI_DANMAKU_STRATEGY_ID,
      deadlineMs: 12_000
    });
    return bilibiliDanmakuStrategyObservation(result, bvid);
  }

  async #pageContext(profileId: string, pageAlias: string, runId: string, pageLeaseId: string, allowPreNavigation: boolean): Promise<{ recordVersion: number; documentGeneration: number }> {
    const snapshot = await this.#browserManager.snapshot();
    const profile = snapshot.profiles.find((candidate) => candidate.profileId === profileId);
    const page = profile?.pages.find((candidate) => candidate.pageAlias === pageAlias);
    const acceptedState = page?.state === 'leased' || (allowPreNavigation && page?.state === 'leased_pre_navigation');
    if (!page || !acceptedState || page.activeLease?.pageLeaseId !== pageLeaseId || page.activeLease.runId !== runId) {
      throw new Error('bilibili_danmaku_managed_page_context_changed');
    }
    return { recordVersion: page.recordVersion, documentGeneration: page.documentGeneration };
  }
}

function deduplicateRows(rows: ReturnType<typeof bilibiliDanmakuStrategyObservation>['rows']) {
  const seen = new Set<number>();
  return rows.filter((row) => !seen.has(row.index) && (seen.add(row.index), true));
}
