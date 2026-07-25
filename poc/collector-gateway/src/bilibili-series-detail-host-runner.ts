import { createHash, randomUUID } from 'node:crypto';
import {
  BILIBILI_COLLECTION_SERIES_DETAIL_STRATEGY_ID,
  COLLECTOR_EXTENSION_VERSION,
  type AcquirePageResult,
  type BilibiliCollectionSeriesPageClickResult,
  type StrategyObservationResult
} from '@intelligence/collector-contracts';
import type { AccountSafetyRegistry, AccountSafetyRunPermit } from './account-safety';
import type { CollectionBrowserManager } from './browser-manager';
import type { BrowserProfileRegistry } from './profiles';
import type {
  BilibiliSeriesDetailArtifactSummary,
  BilibiliSeriesDetailArtifactStore
} from './bilibili-series-detail-artifacts';
import {
  BILIBILI_SERIES_DETAIL_PATH,
  BILIBILI_SERIES_MAX_PAGES,
  bilibiliSeriesDetailInput,
  canonicalBilibiliSeriesDetailUrl,
  projectBilibiliSeriesMetadataResponse,
  stableAccountIdForSeries,
  type BilibiliSeriesAction,
  type BilibiliSeriesDetailInput,
  type BilibiliSeriesDetailRunRecord,
  type BilibiliSeriesMetadataProjection,
  type BilibiliSeriesMetadataResponseEvidence,
  type BilibiliSeriesPageProjection,
  type BilibiliSeriesPageResponseEvidence,
  type BilibiliSeriesTerminalReason
} from './bilibili-series-detail-contract';
import {
  projectBilibiliSeriesPageResponse,
  type BilibiliSeriesDomSnapshot
} from './bilibili-series-detail-contract';
import { projectBilibiliSeriesPageWithDom } from './bilibili-series-detail-response';
import { responseSchema } from './interaction-response-projector';

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_DEADLINE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const CLICK_TIMEOUT_MS = 15_000;
const OBSERVATION_TIMEOUT_MS = 12_000;

function targetUrlDigest(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.searchParams.sort();
  return createHash('sha256').update(url.toString()).digest('hex');
}

export interface BilibiliSeriesDetailHostRunInput extends BilibiliSeriesDetailInput {
  profileId: string;
}

export interface BilibiliSeriesDetailHostRunResult {
  run: BilibiliSeriesDetailRunRecord;
  artifact: BilibiliSeriesDetailArtifactSummary;
}

interface DetailPayload {
  strategyId: typeof BILIBILI_COLLECTION_SERIES_DETAIL_STRATEGY_ID;
  stableAccountId: string;
  stableSeriesId: string;
  listType: 'series' | 'season';
  dom: BilibiliSeriesDomSnapshot;
  responses: Array<{
    routeId: string;
    status: 'captured' | 'payload_rejected';
    httpStatus: number;
    body?: unknown;
    bodyBytes?: number;
    bodySha256?: string;
    queryKeyNames?: string[];
  }>;
}

function input(value: BilibiliSeriesDetailHostRunInput): BilibiliSeriesDetailHostRunInput {
  if (!PROFILE_ID.test(value.profileId)) throw new Error('bilibili_series_detail_profile_invalid');
  return {
    profileId: value.profileId,
    ...bilibiliSeriesDetailInput({
      canonicalProfileUrl: value.canonicalProfileUrl,
      stableSeriesId: value.stableSeriesId,
      listType: value.listType,
      maxPages: value.maxPages
    })
  };
}

function action(actionId: string, intent: string, expectedPageNumber: number): BilibiliSeriesAction {
  return {
    actionId,
    intent,
    expectedPageNumber,
    attempted: false,
    attemptCount: 0,
    outcome: 'failed',
    errorCode: null,
    observedPageNumber: null
  };
}

function safeCode(error: unknown): string {
  const value = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(value) ? value : 'bilibili_series_detail_failed';
}

function payloadFromObservation(result: StrategyObservationResult): DetailPayload {
  if (result.strategyId !== BILIBILI_COLLECTION_SERIES_DETAIL_STRATEGY_ID ||
    !result.payload || typeof result.payload !== 'object' || Array.isArray(result.payload)) {
    throw new Error('bilibili_series_detail_observation_invalid');
  }
  const value = result.payload as unknown as Partial<DetailPayload>;
  if (value.strategyId !== BILIBILI_COLLECTION_SERIES_DETAIL_STRATEGY_ID ||
    !value.dom || !Array.isArray(value.responses) ||
    (value.listType !== 'series' && value.listType !== 'season')) {
    throw new Error('bilibili_series_detail_observation_invalid');
  }
  return value as DetailPayload;
}

function responseEvidence(
  capture: DetailPayload['responses'][number]
): BilibiliSeriesPageResponseEvidence {
  if (!capture.bodySha256 || !/^[0-9a-f]{64}$/.test(capture.bodySha256) ||
    !Array.isArray(capture.queryKeyNames)) throw new Error('bilibili_series_detail_response_evidence_missing');
  const schema = responseSchema(capture.body);
  return {
    pathname: BILIBILI_SERIES_DETAIL_PATH,
    pageNumber: 0,
    responseStatus: capture.httpStatus,
    responseBodyBytes: capture.bodyBytes ?? 0,
    responseBodySha256: capture.bodySha256,
    queryKeyNames: capture.queryKeyNames,
    schemaPaths: schema.schemaPaths,
    sensitiveFieldPathsOmitted: schema.sensitiveFieldPathsOmitted
  };
}

function projectPage(
  payload: DetailPayload,
  accountId: string,
  pageNumber: number,
  capturedAt: string
): { page: BilibiliSeriesPageProjection; evidence: BilibiliSeriesPageResponseEvidence } {
  const capture = payload.responses.find((candidate) =>
    candidate.routeId === 'bilibili.collection-series.detail.response.v1' &&
    candidate.status === 'captured' && candidate.body !== undefined
  );
  if (!capture) {
    const detailRouteSeen = payload.responses.some((candidate) =>
      candidate.routeId === 'bilibili.collection-series.detail.response.v1'
    );
    throw new Error(detailRouteSeen
      ? 'bilibili_series_detail_page_response_payload_rejected'
      : payload.dom.videoIds.length === 0
        ? 'bilibili_series_detail_page_response_and_dom_empty'
        : 'bilibili_series_detail_page_response_missing');
  }
  const candidate = projectBilibiliSeriesPageResponse(capture.body, accountId, pageNumber);
  if (!candidate) throw new Error('bilibili_series_detail_page_projection_failed');
  const evidence = responseEvidence(capture);
  evidence.pageNumber = candidate.pageNumber;
  const page = projectBilibiliSeriesPageWithDom(
    {
      value: capture.body,
      status: capture.httpStatus,
      bodyBytes: capture.bodyBytes ?? 0,
      bodySha256: capture.bodySha256!,
      queryKeyNames: capture.queryKeyNames!,
      schemaPaths: evidence.schemaPaths,
      sensitiveFieldPathsOmitted: evidence.sensitiveFieldPathsOmitted
    },
    accountId,
    pageNumber,
    payload.dom,
    capturedAt
  );
  if (!page) {
    const projectedIds = new Set(candidate.items.map((item) => item.bvid));
    const matched = payload.dom.videoIds.filter((bvid) => projectedIds.has(bvid)).length;
    throw new Error(`bilibili_series_detail_dom_response_mismatch_${candidate.items.length}_${payload.dom.videoIds.length}_${matched}`);
  }
  return { page, evidence };
}

function mergeDetailDomSnapshots(
  left: BilibiliSeriesDomSnapshot,
  right: BilibiliSeriesDomSnapshot
): BilibiliSeriesDomSnapshot {
  const videoIds = [...new Set([...left.videoIds, ...right.videoIds])];
  const titleCandidates: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const bvid of videoIds) {
    titleCandidates[bvid] = [...new Set([
      ...(left.titleCandidates[bvid] ?? []),
      ...(right.titleCandidates[bvid] ?? [])
    ])];
  }
  return {
    stableAccountId: right.stableAccountId ?? left.stableAccountId,
    stableSeriesId: right.stableSeriesId ?? left.stableSeriesId,
    visibleTitle: right.visibleTitle ?? left.visibleTitle,
    declaredItemCount: right.declaredItemCount ?? left.declaredItemCount,
    activePageNumber: right.activePageNumber ?? left.activePageNumber,
    videoIds,
    titleCandidates,
    sortLabels: [...new Set([...left.sortLabels, ...right.sortLabels])],
    risk: {
      verificationRequired: left.risk.verificationRequired || right.risk.verificationRequired,
      rateLimited: left.risk.rateLimited || right.risk.rateLimited,
      sourceUnavailable: left.risk.sourceUnavailable || right.risk.sourceUnavailable
    }
  };
}

export class BilibiliSeriesDetailHostRunner {
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #browserManager: CollectionBrowserManager;
  readonly #profiles: BrowserProfileRegistry;
  readonly #artifacts: BilibiliSeriesDetailArtifactStore;

  constructor(input: {
    accountSafety: AccountSafetyRegistry;
    browserManager: CollectionBrowserManager;
    profiles: BrowserProfileRegistry;
    artifacts: BilibiliSeriesDetailArtifactStore;
  }) {
    this.#accountSafety = input.accountSafety;
    this.#browserManager = input.browserManager;
    this.#profiles = input.profiles;
    this.#artifacts = input.artifacts;
  }

  async run(rawInput: BilibiliSeriesDetailHostRunInput): Promise<BilibiliSeriesDetailHostRunResult> {
    const request = input(rawInput);
    const profile = this.#profiles.get(request.profileId);
    if (profile.kind !== 'collection' || profile.platform !== 'bilibili' || profile.account.category !== 'user_managed') {
      throw new Error('bilibili_series_detail_collection_profile_required');
    }
    const permit = await this.#accountSafety.beginAuthenticatedRun(
      profile.profileId,
      'bilibili',
      'authenticated_series_detail_reconnaissance'
    );
    return await this.#runWithPermit(permit, request);
  }

  async #runWithPermit(
    permit: AccountSafetyRunPermit,
    request: BilibiliSeriesDetailHostRunInput
  ): Promise<BilibiliSeriesDetailHostRunResult> {
    const canonicalUrl = canonicalBilibiliSeriesDetailUrl(request.canonicalProfileUrl, request.stableSeriesId, request.listType);
    const stableAccountId = stableAccountIdForSeries(request.canonicalProfileUrl);
    const actionPrefix = permit.runId.replace(/-/g, '_');
    const actions: BilibiliSeriesAction[] = [action(`${actionPrefix}_open`, 'Open the requested collection/series detail.', 1)];
    const pages: BilibiliSeriesPageProjection[] = [];
    let metadata: BilibiliSeriesMetadataProjection | null = null;
    let metadataResponseEvidence: BilibiliSeriesMetadataResponseEvidence | null = null;
    let failedPageResponseEvidence: BilibiliSeriesPageResponseEvidence | null = null;
    let acquired: AcquirePageResult | null = null;
    let state: BilibiliSeriesDetailRunRecord['state'] = 'failed';
    let errorCode: string | null = null;
    let terminalReason: BilibiliSeriesTerminalReason = 'page_projection_failed';
    let releaseDisposition: 'retained_for_review' | 'quarantined' = 'quarantined';
    let targetPage: 'not_acquired' | 'retained_after_run' | 'quarantined_on_uncertain_outcome' = 'not_acquired';
    let observerBindingId: string | null = null;
    const startedAt = permit.startedAt;
    const deadline = Date.now() + RUN_DEADLINE_MS;
    const readPage = async (pageNumber: number): Promise<{
      payload: DetailPayload;
      projected: ReturnType<typeof projectPage>;
    }> => {
      if (!observerBindingId) throw new Error('bilibili_series_detail_observer_not_bound');
      let payload = await this.#readObservation(permit.profileId, acquired!, permit.runId, observerBindingId, deadline);
      let mergedDom = payload.dom;
      for (let scrollAttempt = 0; scrollAttempt <= 2; scrollAttempt += 1) {
        try {
          const projected = projectPage({ ...payload, dom: mergedDom }, stableAccountId, pageNumber, new Date().toISOString());
          return { payload: { ...payload, dom: mergedDom }, projected };
        } catch (error) {
          if (!(error instanceof Error) || !error.message.startsWith('bilibili_series_detail_dom_response_mismatch_') || scrollAttempt === 2) throw error;
        }
        const scrollAction = action(`${actionPrefix}_scroll_${pageNumber}`, `Reveal the remaining collection/series cards for page ${pageNumber}.`, pageNumber);
        scrollAction.actionId = `${actionPrefix}_scroll_${pageNumber}_${scrollAttempt + 1}`;
        scrollAction.intent = `Reveal remaining collection/series cards for page ${pageNumber} (step ${scrollAttempt + 1}).`;
        actions.push(scrollAction);
        const context = await this.#leaseContext(permit.profileId, acquired!, permit.runId);
        await this.#accountSafety.recordActionAttempt(permit.profileId, 'bilibili', permit.runId, scrollAction.actionId);
        scrollAction.attempted = true;
        scrollAction.attemptCount = 1;
        await this.#browserManager.scrollPage({
          profileId: permit.profileId,
          pageAlias: acquired!.page.pageAlias,
          pageLeaseId: acquired!.lease.pageLeaseId,
          runId: permit.runId,
          expectedRecordVersion: context.recordVersion,
          expectedDocumentGeneration: context.documentGeneration,
          actionId: scrollAction.actionId,
          deltaY: 1_000,
          timeoutMs: Math.min(10_000, Math.max(1_000, deadline - Date.now()))
        });
        scrollAction.outcome = 'completed';
        scrollAction.observedPageNumber = pageNumber;
        payload = await this.#readObservation(permit.profileId, acquired!, permit.runId, observerBindingId, deadline);
        mergedDom = mergeDetailDomSnapshots(mergedDom, payload.dom);
      }
      throw new Error('bilibili_series_detail_dom_response_mismatch_unresolved');
    };
    try {
      await this.#browserManager.launch(permit.profileId);
      acquired = await this.#browserManager.acquirePage({
        profileId: permit.profileId,
        taskId: `bilibili_series_detail_${permit.runId.replace(/-/g, '_')}`,
        runId: permit.runId,
        platform: 'bilibili',
        pageRole: 'series_detail',
        targetUrl: canonicalUrl,
        leaseDurationMs: RUN_DEADLINE_MS
      });
      const bindContext = await this.#leaseContext(permit.profileId, acquired, permit.runId, true);
      observerBindingId = randomUUID();
      await this.#browserManager.bindStrategyObserver({
        schemaVersion: 1,
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        expectedRecordVersion: bindContext.recordVersion,
        runId: permit.runId,
        observerBindingId: observerBindingId!,
        strategyId: BILIBILI_COLLECTION_SERIES_DETAIL_STRATEGY_ID,
        target: { canonicalUrl, stableAccountId, stableSeriesId: request.stableSeriesId, listType: request.listType },
        expiresAt: new Date(Math.min(Date.now() + 55_000, deadline - 1_000)).toISOString(),
        maximumResponseObservations: 1,
        maximumPayloadBytes: 180 * 1024,
        documentBindingMode: acquired.selection === 'reused_exact_target' ? 'next_navigation_only' : 'current_document_or_next_navigation'
      });
      await this.#accountSafety.recordActionAttempt(permit.profileId, 'bilibili', permit.runId, actions[0]!.actionId);
      actions[0]!.attempted = true;
      actions[0]!.attemptCount = 1;
      await this.#browserManager.navigatePage({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        actionId: actions[0]!.actionId,
        url: canonicalUrl,
        waitUntil: 'domcontentloaded',
        timeoutMs: NAVIGATION_TIMEOUT_MS
      });
      actions[0]!.outcome = 'completed';
      const firstResult = await readPage(1);
      const first = firstResult.payload;
      const projectedFirst = firstResult.projected;
      pages.push(projectedFirst.page);
      const firstCapture = first.responses.find((candidate) => candidate.status === 'captured' && candidate.body !== undefined);
      if (!firstCapture) throw new Error('bilibili_series_detail_metadata_response_missing');
      metadata = projectBilibiliSeriesMetadataResponse(firstCapture.body, stableAccountId, request.stableSeriesId, request.listType);
      if (!metadata) throw new Error('bilibili_series_detail_metadata_projection_failed');
      metadataResponseEvidence = {
        ...projectedFirst.evidence,
        pathname: BILIBILI_SERIES_DETAIL_PATH
      };
      const declaredPages = Math.ceil(projectedFirst.page.declaredTotal / projectedFirst.page.pageSize);
      const pagesToCapture = Math.min(request.maxPages, Math.max(1, declaredPages), BILIBILI_SERIES_MAX_PAGES);
      for (let pageNumber = 2; pageNumber <= pagesToCapture; pageNumber += 1) {
        const nextAction = action(`${actionPrefix}_page_${pageNumber}`, `Open collection/series detail page ${pageNumber}.`, pageNumber);
        actions.push(nextAction);
        const context = await this.#leaseContext(permit.profileId, acquired, permit.runId);
        await this.#accountSafety.recordActionAttempt(permit.profileId, 'bilibili', permit.runId, nextAction.actionId);
        nextAction.attempted = true;
        nextAction.attemptCount = 1;
        const click: BilibiliCollectionSeriesPageClickResult = await this.#browserManager.clickBilibiliCollectionSeriesPage({
          schemaVersion: 2,
          profileId: permit.profileId,
          pageAlias: acquired.page.pageAlias,
          pageLeaseId: acquired.lease.pageLeaseId,
          runId: permit.runId,
          expectedRecordVersion: context.recordVersion,
          expectedDocumentGeneration: context.documentGeneration,
          actionId: nextAction.actionId,
          expectedActivePage: pageNumber - 1,
          targetPage: pageNumber,
          timeoutMs: Math.min(CLICK_TIMEOUT_MS, Math.max(1_000, deadline - Date.now())),
          pageRole: 'series_detail'
        });
        nextAction.outcome = 'completed';
        nextAction.observedPageNumber = click.after.activePage;
        const projected = (await readPage(pageNumber)).projected;
        pages.push(projected.page);
        if (pages.some((page, index) => index > 0 && page.items.some((item) => pages.slice(0, index).some((prior) => prior.items.some((candidate) => candidate.bvid === item.bvid))))) {
          throw new Error('bilibili_series_detail_duplicate_video_detected');
        }
      }
      const declaredTotal = metadata.declaredItemCount;
      const capturedItems = pages.reduce((sum, page) => sum + page.items.length, 0);
      state = 'completed';
      terminalReason = pages.length >= Math.min(request.maxPages, Math.ceil(declaredTotal / pages[0]!.pageSize))
        ? 'declared_terminal_reached'
        : 'budget_exhausted';
      errorCode = null;
      releaseDisposition = 'retained_for_review';
    } catch (error) {
      state = pages.length > 0 ? 'partial' : 'failed';
      errorCode = safeCode(error);
      terminalReason = errorCode.includes('verification') ? 'verification_required' :
        errorCode.includes('rate') ? 'rate_limited' :
          errorCode.includes('mismatch') ? 'dom_response_mismatch' : 'page_projection_failed';
      const active = [...actions].reverse().find((candidate) => candidate.attempted && candidate.outcome !== 'completed');
      if (active) {
        active.outcome = 'postcondition_unmet';
        active.errorCode = errorCode;
      }
      releaseDisposition = errorCode.includes('outcome_unknown') ? 'quarantined' : 'retained_for_review';
    }
    if (acquired) {
      const released = await this.#browserManager.releasePage({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        disposition: releaseDisposition,
        ...(releaseDisposition === 'quarantined' ? { quarantineReason: 'bilibili_series_detail_outcome_unknown' } : {})
      });
      targetPage = released.state === 'retained_for_review' ? 'retained_after_run' : 'quarantined_on_uncertain_outcome';
    }
    const uniqueItems = new Set(pages.flatMap((page) => page.items.map((item) => item.bvid)));
    const capturedItems = pages.reduce((sum, page) => sum + page.items.length, 0);
    const run: BilibiliSeriesDetailRunRecord = {
      schemaVersion: 1,
      runId: permit.runId,
      collectorVersion: COLLECTOR_EXTENSION_VERSION,
      platform: 'bilibili',
      accountCategory: 'user_managed',
      pageRole: 'series_detail',
      targetUrlDigest: targetUrlDigest(canonicalUrl),
      strategyCandidate: { strategyId: 'bilibili.collection-series.series-detail.response.v1', version: '1.0.0', admissionEligible: false },
      state,
      errorCode,
      startedAt,
      completedAt: new Date().toISOString(),
      metadata,
      metadataResponseEvidence,
      failedPageResponseEvidence,
      pages,
      actions,
      coverage: {
        declaredTotal: metadata?.declaredItemCount ?? null,
        declaredPages: metadata && pages[0] ? Math.ceil(metadata.declaredItemCount / pages[0].pageSize) : null,
        plannedMaximumPages: request.maxPages,
        capturedPages: pages.length,
        capturedItems,
        uniqueItems: uniqueItems.size,
        duplicateItems: capturedItems - uniqueItems.size,
        completeWithinDeclaredSeries: Boolean(metadata && capturedItems === metadata.declaredItemCount),
        terminalReason
      },
      safeguards: {
        environment: 'local_user_controlled_collection_profile',
        browser: 'visible_playwright_chromium',
        acquisition: 'trusted_series_navigation_and_pagination_plus_dom_response_projection',
        requestHeaders: 'not_read',
        requestBody: 'not_read',
        cookiesAndTokens: 'not_read',
        networkQueryAndFragmentValues: 'discarded',
        canonicalPageQuery: 'stable_type_series_or_season',
        responseProjection: 'public_series_metadata_and_card_fields_allowlist',
        unknownResponseValues: 'not_persisted',
        sortRole: 'platform_default',
        semanticActionDelivery: 'at_most_once',
        runDeadlineMs: RUN_DEADLINE_MS,
        targetTabSelection: acquired?.selection === 'reused_exact_target' ? 'reused_matching_managed_tab' : 'created_new_managed_tab',
        targetPage,
        admissionEligible: false
      }
    };
    try {
      const artifact = await this.#artifacts.record(run);
      return { run, artifact };
    } finally {
      await this.#accountSafety.finishAuthenticatedRun(permit.profileId, 'bilibili', permit.runId, errorCode ?? terminalReason);
    }
  }

  async #leaseContext(profileId: string, acquired: AcquirePageResult, runId: string, preNavigation = false): Promise<{ recordVersion: number; documentGeneration: number }> {
    const snapshot = await this.#browserManager.snapshot();
    const profile = snapshot.profiles.find((candidate) => candidate.profileId === profileId);
    const page = profile?.pages.find((candidate) => candidate.pageAlias === acquired.page.pageAlias);
    if (!page || (page.state !== 'leased' && !(preNavigation && page.state === 'leased_pre_navigation')) ||
      page.activeLease?.pageLeaseId !== acquired.lease.pageLeaseId || page.activeLease.runId !== runId) {
      throw new Error('bilibili_series_detail_managed_page_context_changed');
    }
    return { recordVersion: page.recordVersion, documentGeneration: page.documentGeneration };
  }

  async #readObservation(
    profileId: string,
    acquired: AcquirePageResult,
    runId: string,
    observerBindingId: string,
    deadline: number
  ): Promise<DetailPayload> {
    const context = await this.#leaseContext(profileId, acquired, runId);
    const result = await this.#browserManager.readStrategyObservation({
      schemaVersion: 1,
      profileId,
      pageAlias: acquired.page.pageAlias,
      pageLeaseId: acquired.lease.pageLeaseId,
      expectedRecordVersion: context.recordVersion,
      runId,
      observerBindingId,
      strategyId: BILIBILI_COLLECTION_SERIES_DETAIL_STRATEGY_ID,
      deadlineMs: Math.min(OBSERVATION_TIMEOUT_MS, Math.max(1_000, deadline - Date.now()))
    });
    return payloadFromObservation(result);
  }
}
