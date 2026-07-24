import { createHash, randomUUID } from 'node:crypto';
import {
  BILIBILI_COLLECTION_SERIES_STRATEGY_ID,
  COLLECTOR_EXTENSION_VERSION,
  type AcquirePageResult,
  type PageReleaseDisposition,
  type StrategyObservationResult
} from '@intelligence/collector-contracts';
import type { AccountSafetyRegistry, AccountSafetyRunPermit } from './account-safety';
import type {
  BilibiliCollectionSeriesArtifactStore,
  BilibiliCollectionSeriesArtifactSummary
} from './bilibili-collection-series-artifacts';
import {
  BILIBILI_COLLECTION_SERIES_OVERVIEW_PATH,
  bilibiliCollectionSeriesInput,
  collectionSeriesOverviewUrl,
  crossCheckBilibiliCollectionSeriesOverview,
  projectBilibiliCollectionSeriesOverviewResponse,
  safeBilibiliCollectionSeriesErrorCode,
  type BilibiliCollectionSeriesDomSnapshot,
  type BilibiliCollectionSeriesResponseEvidence,
  type BilibiliCollectionSeriesRunRecord,
  type BilibiliCollectionSeriesTerminalReason
} from './bilibili-collection-series-contract';
import { stableAccountIdFromProfileUrl } from './bilibili-account-archive-contract';
import { responseSchema } from './interaction-response-projector';
import type { CollectionBrowserManager } from './browser-manager';
import type { BrowserProfileRegistry } from './profiles';

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_DEADLINE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const OBSERVATION_TIMEOUT_MS = 15_000;

export interface BilibiliCollectionSeriesHostRunInput {
  profileId: string;
  canonicalProfileUrl: string;
}

export interface BilibiliCollectionSeriesHostRunResult {
  run: BilibiliCollectionSeriesRunRecord;
  artifact: BilibiliCollectionSeriesArtifactSummary;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function pageSelection(
  selection: AcquirePageResult['selection']
): BilibiliCollectionSeriesRunRecord['safeguards']['targetTabSelection'] {
  if (selection === 'created_new_page') return 'created_new_managed_tab';
  return selection === 'reused_exact_target' ? 'reused_matching_managed_tab' : 'reused_retained_managed_tab';
}

function riskOutcome(dom: BilibiliCollectionSeriesDomSnapshot): {
  state: BilibiliCollectionSeriesRunRecord['state'];
  terminalReason: BilibiliCollectionSeriesTerminalReason;
  errorCode: string;
} | null {
  if (dom.risk.verificationRequired) return { state: 'partial', terminalReason: 'verification_required', errorCode: 'verification_required' };
  if (dom.risk.rateLimited) return { state: 'partial', terminalReason: 'rate_limited', errorCode: 'rate_limited' };
  if (dom.risk.sourceUnavailable) return { state: 'partial', terminalReason: 'source_unavailable', errorCode: 'source_unavailable' };
  return null;
}

function failureFor(error: unknown): { terminalReason: BilibiliCollectionSeriesTerminalReason; errorCode: string; uncertain: boolean } {
  const errorCode = safeBilibiliCollectionSeriesErrorCode(error);
  const uncertain = /navigation_outcome_unknown|managed_page_document_generation_mismatch|managed_page_document_context_changed|collection_series_strategy_document_context_changed|collection_series_strategy_binding_context_rejected|managed_page_record_version_mismatch|managed_page_run_mismatch|run_deadline_exceeded/.test(errorCode);
  return {
    terminalReason: uncertain ? (errorCode === 'run_deadline_exceeded' ? 'run_deadline_exceeded' : 'context_changed') : 'source_unavailable',
    errorCode,
    uncertain
  };
}

function observationPayload(result: StrategyObservationResult): {
  dom: BilibiliCollectionSeriesDomSnapshot;
  responses: Array<Record<string, unknown>>;
} {
  if (result.strategyId !== BILIBILI_COLLECTION_SERIES_STRATEGY_ID || !result.payload || typeof result.payload !== 'object') {
    throw new Error('collection_series_observation_invalid');
  }
  const payload = result.payload as Record<string, unknown>;
  if (!payload.dom || typeof payload.dom !== 'object' || !Array.isArray(payload.responses)) {
    throw new Error('collection_series_observation_invalid');
  }
  return { dom: payload.dom as BilibiliCollectionSeriesDomSnapshot, responses: payload.responses as Array<Record<string, unknown>> };
}

function responseEvidence(response: Record<string, unknown>): BilibiliCollectionSeriesResponseEvidence {
  const body = response.body;
  const schema = body === undefined ? { schemaPaths: [], sensitiveFieldPathsOmitted: 0 } : responseSchema(body);
  return {
    pathname: BILIBILI_COLLECTION_SERIES_OVERVIEW_PATH,
    responseStatus: typeof response.httpStatus === 'number' ? response.httpStatus : 0,
    responseBodyBytes: typeof response.bodyBytes === 'number' ? response.bodyBytes : 0,
    responseBodySha256: typeof response.bodySha256 === 'string' ? response.bodySha256 : digest(JSON.stringify(body ?? null)),
    queryKeyNames: Array.isArray(response.queryKeyNames)
      ? response.queryKeyNames.filter((key): key is string => typeof key === 'string').slice(0, 100)
      : [],
    schemaPaths: schema.schemaPaths,
    sensitiveFieldPathsOmitted: schema.sensitiveFieldPathsOmitted,
    projectionFailureCode: null
  };
}

export class BilibiliCollectionSeriesHostRunner {
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #browserManager: CollectionBrowserManager;
  readonly #profiles: BrowserProfileRegistry;
  readonly #artifacts: BilibiliCollectionSeriesArtifactStore;

  constructor(input: {
    accountSafety: AccountSafetyRegistry;
    browserManager: CollectionBrowserManager;
    profiles: BrowserProfileRegistry;
    artifacts: BilibiliCollectionSeriesArtifactStore;
  }) {
    this.#accountSafety = input.accountSafety;
    this.#browserManager = input.browserManager;
    this.#profiles = input.profiles;
    this.#artifacts = input.artifacts;
  }

  async run(rawInput: BilibiliCollectionSeriesHostRunInput): Promise<BilibiliCollectionSeriesHostRunResult> {
    if (!PROFILE_ID.test(rawInput.profileId)) throw new Error('bilibili_collection_series_profile_invalid');
    const input = bilibiliCollectionSeriesInput({ canonicalProfileUrl: rawInput.canonicalProfileUrl });
    const profile = this.#profiles.get(rawInput.profileId);
    if (profile.kind !== 'collection' || profile.platform !== 'bilibili' || profile.account.category !== 'user_managed') {
      throw new Error('bilibili_collection_series_collection_profile_required');
    }
    const permit = await this.#accountSafety.beginAuthenticatedRun(
      profile.profileId,
      'bilibili',
      'authenticated_collection_series_reconnaissance'
    );
    return await this.#runWithPermit(permit, input.canonicalProfileUrl);
  }

  async #runWithPermit(permit: AccountSafetyRunPermit, canonicalProfileUrl: string): Promise<BilibiliCollectionSeriesHostRunResult> {
    const startedAt = new Date().toISOString();
    const stableAccountId = stableAccountIdFromProfileUrl(canonicalProfileUrl);
    const targetUrl = collectionSeriesOverviewUrl(canonicalProfileUrl);
    const action = {
      actionId: `open_collection_series_overview_${permit.runId.replace(/-/g, '_')}`,
      intent: 'Open the canonical public account collection and series overview exactly once.',
      attempted: false,
      attemptCount: 0 as 0 | 1,
      outcome: 'failed' as BilibiliCollectionSeriesRunRecord['actions'][number]['outcome'],
      errorCode: null as string | null
    };
    let state: BilibiliCollectionSeriesRunRecord['state'] = 'failed';
    let errorCode: string | null = null;
    let terminalReason: BilibiliCollectionSeriesTerminalReason = 'source_unavailable';
    let overview = null as BilibiliCollectionSeriesRunRecord['overview'];
    let response = null as BilibiliCollectionSeriesResponseEvidence | null;
    let acquired: AcquirePageResult | null = null;
    let targetTabSelection: BilibiliCollectionSeriesRunRecord['safeguards']['targetTabSelection'] = 'created_new_managed_tab';
    let targetPage: BilibiliCollectionSeriesRunRecord['safeguards']['targetPage'] = 'retained_after_run';
    let releaseDisposition: PageReleaseDisposition = 'quarantined';
    let quarantineReason = 'collection_series_run_not_started';
    let uncertain = false;
    try {
      await this.#browserManager.launch(permit.profileId);
      acquired = await this.#browserManager.acquirePage({
        profileId: permit.profileId,
        taskId: `bilibili_collection_series_${permit.runId.replace(/-/g, '_')}`,
        runId: permit.runId,
        platform: 'bilibili',
        pageRole: 'collection_series_overview',
        targetUrl,
        leaseDurationMs: RUN_DEADLINE_MS
      });
      targetTabSelection = pageSelection(acquired.selection);
      const observerBindingId = randomUUID();
      await this.#browserManager.bindStrategyObserver({
        schemaVersion: 1,
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        expectedRecordVersion: acquired.page.recordVersion,
        runId: permit.runId,
        observerBindingId,
        strategyId: BILIBILI_COLLECTION_SERIES_STRATEGY_ID,
        target: { canonicalUrl: targetUrl, stableAccountId },
        expiresAt: new Date(Date.now() + 55_000).toISOString(),
        maximumResponseObservations: 1,
        maximumPayloadBytes: 192 * 1024,
        documentBindingMode: acquired.selection === 'reused_exact_target' ? 'next_navigation_only' : 'current_document_or_next_navigation'
      });
      await this.#accountSafety.recordActionAttempt(permit.profileId, 'bilibili', permit.runId, action.actionId);
      action.attempted = true;
      action.attemptCount = 1;
      const deadline = Date.now() + RUN_DEADLINE_MS;
      await this.#browserManager.navigatePage({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        actionId: action.actionId,
        url: targetUrl,
        waitUntil: 'domcontentloaded',
        timeoutMs: Math.min(NAVIGATION_TIMEOUT_MS, Math.max(1_000, deadline - Date.now()))
      });
      action.outcome = 'completed';
      releaseDisposition = 'retained_for_review';
      quarantineReason = 'collection_series_review_retained';
      const context = await this.#pageContext(permit.profileId, acquired.page.pageAlias, acquired.lease.pageLeaseId, permit.runId);
      const observed = await this.#observe({
        profileId: permit.profileId,
        pageAlias: acquired.page.pageAlias,
        pageLeaseId: acquired.lease.pageLeaseId,
        runId: permit.runId,
        observerBindingId,
        expectedRecordVersion: context.recordVersion,
        documentGeneration: context.documentGeneration,
        deadline
      });
      const risk = riskOutcome(observed.dom);
      if (risk) {
        state = risk.state;
        terminalReason = risk.terminalReason;
        errorCode = risk.errorCode;
      } else {
        const captured = observed.responses.find((candidate) =>
          candidate.status === 'captured' && candidate.routeId === 'bilibili.collection-series.overview.response.v1'
        );
        if (!captured || captured.body === undefined) {
          terminalReason = 'response_status_unavailable';
          errorCode = 'collection_series_overview_response_missing';
        } else {
          response = responseEvidence(captured);
          const projected = projectBilibiliCollectionSeriesOverviewResponse(captured.body, stableAccountId);
          if (!projected) {
            terminalReason = 'response_projection_failed';
            errorCode = 'collection_series_overview_response_projection_failed';
          } else {
            overview = crossCheckBilibiliCollectionSeriesOverview(projected, observed.dom, canonicalProfileUrl, new Date().toISOString());
            if (!overview || !overview.domCrossCheck.exactItemIdentityMatch) {
              terminalReason = 'dom_response_mismatch';
              errorCode = 'collection_series_overview_dom_response_mismatch';
            } else {
              state = 'completed';
              terminalReason = 'overview_captured';
              errorCode = null;
            }
          }
        }
      }
    } catch (error) {
      const failure = failureFor(error);
      terminalReason = failure.terminalReason;
      errorCode = failure.errorCode;
      uncertain = failure.uncertain;
      action.outcome = uncertain ? 'postcondition_unmet' : 'failed';
      action.errorCode = errorCode;
      if (uncertain) {
        releaseDisposition = 'quarantined';
        quarantineReason = 'collection_series_page_outcome_unknown';
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
          ...(releaseDisposition === 'quarantined' ? { quarantineReason } : {})
        });
        targetPage = released.state === 'retained_for_review' ? 'retained_after_run' : 'quarantined_on_uncertain_outcome';
      } catch (error) {
        const failure = failureFor(error);
        if (!errorCode) { errorCode = failure.errorCode; terminalReason = failure.terminalReason; }
        targetPage = 'quarantined_on_uncertain_outcome';
      }
    }
    const run: BilibiliCollectionSeriesRunRecord = {
      schemaVersion: 1,
      runId: permit.runId,
      collectorVersion: COLLECTOR_EXTENSION_VERSION,
      platform: 'bilibili',
      accountCategory: 'user_managed',
      pageRole: 'collection_series_overview',
      targetUrlDigest: digest(targetUrl),
      strategyCandidate: { strategyId: 'bilibili.collection-series.overview.response.v1', version: '1.0.0', admissionEligible: false },
      state,
      errorCode,
      startedAt,
      completedAt: new Date().toISOString(),
      overview,
      responseEvidence: response,
      actions: [action],
      coverage: {
        declaredListCount: overview?.declaredListCount ?? null,
        capturedLists: overview?.items.length ?? 0,
        seriesCount: overview?.items.filter((item) => item.listType === 'series').length ?? 0,
        seasonCount: overview?.items.filter((item) => item.listType === 'season').length ?? 0,
        previewItems: overview?.items.reduce((sum, item) => sum + item.previews.length, 0) ?? 0,
        exactDomResponseMatch: overview?.domCrossCheck.exactItemIdentityMatch ?? false,
        terminalReason
      },
      safeguards: {
        environment: 'local_user_controlled_collection_profile',
        browser: 'visible_playwright_chromium',
        acquisition: 'trusted_navigation_plus_visible_dom_plus_current_overview_response_projection',
        requestHeaders: 'not_read',
        requestBody: 'not_read',
        cookiesAndTokens: 'not_read',
        networkQueryAndFragmentValues: 'discarded',
        responseProjection: 'public_collection_series_fields_allowlist',
        unknownResponseValues: 'not_persisted',
        semanticActionDelivery: 'at_most_once',
        runDeadlineMs: RUN_DEADLINE_MS,
        targetTabSelection,
        targetPage,
        admissionEligible: false
      }
    };
    try {
      const artifact = await this.#artifacts.record(run);
      await this.#accountSafety.finishAuthenticatedRun(permit.profileId, 'bilibili', permit.runId, errorCode ?? terminalReason);
      return { run, artifact };
    } catch (error) {
      await this.#accountSafety.finishAuthenticatedRun(permit.profileId, 'bilibili', permit.runId, safeBilibiliCollectionSeriesErrorCode(error));
      throw error;
    }
  }

  async #pageContext(profileId: string, pageAlias: string, pageLeaseId: string, runId: string): Promise<{ recordVersion: number; documentGeneration: number }> {
    const snapshot = await this.#browserManager.snapshot();
    const profile = snapshot.profiles.find((candidate) => candidate.profileId === profileId);
    const page = profile?.pages.find((candidate) => candidate.pageAlias === pageAlias);
    if (!page || page.state !== 'leased' || page.activeLease?.pageLeaseId !== pageLeaseId || page.activeLease.runId !== runId) {
      throw new Error('collection_series_managed_page_context_changed');
    }
    return { recordVersion: page.recordVersion, documentGeneration: page.documentGeneration };
  }

  async #observe(input: {
    profileId: string;
    pageAlias: string;
    pageLeaseId: string;
    runId: string;
    observerBindingId: string;
    expectedRecordVersion: number;
    documentGeneration: number;
    deadline: number;
  }): Promise<{ dom: BilibiliCollectionSeriesDomSnapshot; responses: Array<Record<string, unknown>> }> {
    const observationDeadline = Math.min(input.deadline, Date.now() + OBSERVATION_TIMEOUT_MS);
    let latest: { dom: BilibiliCollectionSeriesDomSnapshot; responses: Array<Record<string, unknown>> } | null = null;
    while (Date.now() < observationDeadline) {
      const result = await this.#browserManager.readStrategyObservation({
        schemaVersion: 1,
        profileId: input.profileId,
        pageAlias: input.pageAlias,
        pageLeaseId: input.pageLeaseId,
        expectedRecordVersion: input.expectedRecordVersion,
        runId: input.runId,
        observerBindingId: input.observerBindingId,
        strategyId: BILIBILI_COLLECTION_SERIES_STRATEGY_ID,
        deadlineMs: Math.min(3_000, Math.max(250, observationDeadline - Date.now()))
      });
      latest = observationPayload(result);
      if (latest.dom.risk.verificationRequired || latest.dom.risk.rateLimited || latest.dom.risk.sourceUnavailable ||
        latest.responses.some((candidate) => candidate.status === 'captured')) return latest;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!latest) throw new Error('collection_series_observation_timeout');
    return latest;
  }
}
