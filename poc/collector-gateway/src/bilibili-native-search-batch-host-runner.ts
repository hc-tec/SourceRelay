import { createHash, randomUUID } from 'node:crypto';
import {
  BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
  BrowserHostError,
  COLLECTOR_EXTENSION_VERSION
} from '@intelligence/collector-contracts';
import type { BilibiliNativeSearchHostRunResult, BilibiliNativeSearchHostRunner } from './bilibili-native-search-host-runner';
import {
  bilibiliNativeSearchBatchInput,
  bilibiliNativeSearchBatchResumeInput,
  type BilibiliNativeSearchBatchInput,
  type BilibiliNativeSearchBatchPageRun,
  type BilibiliNativeSearchBatchRunRecord,
  type BilibiliNativeSearchBatchTerminalReason
} from './bilibili-native-search-batch-contract';
import type {
  BilibiliNativeSearchBatchArtifactStore,
  BilibiliNativeSearchBatchArtifactSummary
} from './bilibili-native-search-batch-artifacts';
import type { BilibiliNativeSearchArtifactStore } from './bilibili-native-search-artifacts';
import {
  BilibiliNativeSearchBatchCheckpointStore
} from './bilibili-native-search-batch-checkpoints';
import { mergeBilibiliNativeSearchPages } from './bilibili-native-search-pagination';

export interface BilibiliNativeSearchBatchHostRunResult {
  run: BilibiliNativeSearchBatchRunRecord;
  artifact: BilibiliNativeSearchBatchArtifactSummary;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof BrowserHostError
    ? error.record.code
    : error instanceof Error
      ? error.message
      : '';
  return /^[a-z0-9_]{1,100}$/.test(candidate) ? candidate : 'bilibili_native_search_batch_run_failed';
}

function pageRun(result: BilibiliNativeSearchHostRunResult): BilibiliNativeSearchBatchPageRun {
  return {
    page: result.run.search.page,
    runId: result.run.runId,
    artifactId: result.artifact.artifactId,
    state: result.run.state,
    terminalReason: result.run.coverage.terminalReason,
    capturedItems: result.run.coverage.capturedItems,
    unresolvedCardCount: result.run.coverage.unresolvedCardCount
  };
}

function terminalForPage(result: BilibiliNativeSearchHostRunResult): {
  state: BilibiliNativeSearchBatchRunRecord['state'];
  terminalReason: BilibiliNativeSearchBatchTerminalReason;
  errorCode: string | null;
} {
  if (result.run.state === 'failed') {
    return {
      state: 'failed',
      terminalReason: 'search_batch_page_failed',
      errorCode: result.run.errorCode ?? 'bilibili_native_search_batch_page_failed'
    };
  }
  if (result.run.state !== 'completed') {
    return {
      state: 'partial',
      terminalReason: 'search_batch_page_partial',
      errorCode: result.run.errorCode
    };
  }
  if (result.run.coverage.terminalReason === 'search_empty') {
    return { state: 'completed', terminalReason: 'search_batch_empty', errorCode: null };
  }
  return { state: 'completed', terminalReason: 'search_batch_ready', errorCode: null };
}

export class BilibiliNativeSearchBatchHostRunner {
  readonly #singleRunner: BilibiliNativeSearchHostRunner;
  readonly #singleArtifacts: BilibiliNativeSearchArtifactStore;
  readonly #artifacts: BilibiliNativeSearchBatchArtifactStore;
  readonly #checkpoints: BilibiliNativeSearchBatchCheckpointStore;

  constructor(input: {
    singleRunner: BilibiliNativeSearchHostRunner;
    singleArtifacts: BilibiliNativeSearchArtifactStore;
    artifacts: BilibiliNativeSearchBatchArtifactStore;
    checkpoints: BilibiliNativeSearchBatchCheckpointStore;
  }) {
    this.#singleRunner = input.singleRunner;
    this.#singleArtifacts = input.singleArtifacts;
    this.#artifacts = input.artifacts;
    this.#checkpoints = input.checkpoints;
  }

  async run(rawInput: unknown): Promise<BilibiliNativeSearchBatchHostRunResult> {
    const request = bilibiliNativeSearchBatchInput(rawInput);
    const batchId = randomUUID();
    const startedAt = new Date().toISOString();
    await this.#checkpoints.start({
      batchId,
      profileId: request.profileId,
      search: { resultType: request.resultType, sort: request.sort, pages: request.pages },
      queryDigest: sha256(request.query),
      startedAt
    });
    return this.#execute(request, { batchId, startedAt, pageRuns: [], projections: [] });
  }

  async resume(rawInput: unknown): Promise<BilibiliNativeSearchBatchHostRunResult> {
    const input = bilibiliNativeSearchBatchResumeInput(rawInput);
    const checkpoint = this.#checkpoints.get(input.batchId);
    if (!checkpoint) throw new Error('bilibili_native_search_batch_checkpoint_not_found');
    if (checkpoint.profileId !== input.profileId) throw new Error('bilibili_native_search_batch_profile_mismatch');
    if (checkpoint.state !== 'running') throw new Error('bilibili_native_search_batch_checkpoint_not_resumable');
    if (checkpoint.inFlightPage !== null) throw new Error('bilibili_native_search_batch_recovery_outcome_unknown');
    if (checkpoint.queryDigest !== sha256(input.query)) throw new Error('bilibili_native_search_batch_query_mismatch');

    const projections: Array<{ page: number; projection: NonNullable<BilibiliNativeSearchHostRunResult['run']['results']> }> = [];
    for (const pageRun of checkpoint.pageRuns) {
      const artifact = await this.#singleArtifacts.get(pageRun.artifactId);
      if (!artifact || artifact.summary.runId !== pageRun.runId || artifact.summary.queryDigest !== checkpoint.queryDigest ||
        artifact.summary.search.resultType !== checkpoint.search.resultType ||
        artifact.summary.search.sort !== checkpoint.search.sort || artifact.summary.search.page !== pageRun.page ||
        artifact.results === null) {
        throw new Error('bilibili_native_search_batch_checkpoint_artifact_invalid');
      }
      projections.push({ page: pageRun.page, projection: artifact.results });
    }
    this.#checkpoints.activate(input.batchId);
    return this.#execute({
      profileId: checkpoint.profileId,
      query: input.query,
      resultType: checkpoint.search.resultType,
      sort: checkpoint.search.sort,
      pages: checkpoint.search.pages
    }, {
      batchId: checkpoint.batchId,
      startedAt: checkpoint.startedAt,
      pageRuns: checkpoint.pageRuns,
      projections
    });
  }

  async #execute(
    request: BilibiliNativeSearchBatchInput,
    initial: {
      batchId: string;
      startedAt: string;
      pageRuns: BilibiliNativeSearchBatchPageRun[];
      projections: Array<{ page: number; projection: NonNullable<BilibiliNativeSearchHostRunResult['run']['results']> }>;
    }
  ): Promise<BilibiliNativeSearchBatchHostRunResult> {
    const pageRuns = initial.pageRuns.map((pageRun) => structuredClone(pageRun));
    const projections = initial.projections.map((entry) => ({ page: entry.page, projection: structuredClone(entry.projection) }));
    const completedPages = new Set(pageRuns.map((pageRun) => pageRun.page));
    let state: BilibiliNativeSearchBatchRunRecord['state'] = 'completed';
    let terminalReason: BilibiliNativeSearchBatchTerminalReason = this.#terminalFromPageRuns(pageRuns);
    let errorCode: string | null = null;
    let preserveInFlightPage = false;

    for (const page of request.pages) {
      if (completedPages.has(page)) continue;
      await this.#checkpoints.markPageStarted(initial.batchId, page);
      let result: BilibiliNativeSearchHostRunResult;
      try {
        result = await this.#singleRunner.run({
          profileId: request.profileId,
          query: request.query,
          resultType: request.resultType,
          sort: request.sort,
          page
        });
      } catch (error) {
        state = 'failed';
        terminalReason = 'search_batch_run_failed';
        errorCode = safeErrorCode(error);
        preserveInFlightPage = true;
        break;
      }
      const capturedPageRun = pageRun(result);
      pageRuns.push(capturedPageRun);
      completedPages.add(page);
      if (result.run.results) projections.push({ page, projection: result.run.results });
      await this.#checkpoints.recordPage(initial.batchId, capturedPageRun);
      const pageTerminal = terminalForPage(result);
      if (pageTerminal.terminalReason === 'search_batch_empty') {
        terminalReason = pageTerminal.terminalReason;
        errorCode = null;
        break;
      }
      if (pageTerminal.state !== 'completed') {
        state = pageTerminal.state;
        terminalReason = pageTerminal.terminalReason;
        errorCode = pageTerminal.errorCode;
        break;
      }
    }

    const merged = mergeBilibiliNativeSearchPages(projections);
    if (state === 'completed' && merged.duplicateCount > 0) {
      state = 'partial';
      terminalReason = 'search_batch_duplicates';
      errorCode = 'search_batch_duplicates';
    }
    const run: BilibiliNativeSearchBatchRunRecord = {
      schemaVersion: 1,
      batchId: initial.batchId,
      collectorVersion: COLLECTOR_EXTENSION_VERSION,
      platform: 'bilibili',
      accountCategory: 'user_managed',
      pageRole: 'native_search_batch',
      search: {
        resultType: request.resultType,
        sort: request.sort,
        pages: request.pages
      },
      queryDigest: sha256(request.query),
      strategyCandidate: {
        strategyId: BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
        version: '0.2.0',
        admissionEligible: false
      },
      state,
      errorCode,
      startedAt: initial.startedAt,
      completedAt: new Date().toISOString(),
      pageRuns,
      mergedItems: merged.uniqueItems,
      coverage: {
        requestedPages: request.pages.length,
        capturedPages: merged.capturedPages,
        uniqueItems: merged.uniqueItems.length,
        duplicateBvids: merged.duplicateBvids,
        duplicateCount: merged.duplicateCount,
        unresolvedCardCount: merged.unresolvedCardCount,
        partial: state !== 'completed' || merged.partial,
        terminalReason
      },
      safeguards: {
        environment: 'local_user_controlled_collection_profile',
        browser: 'visible_playwright_chromium',
        acquisition: 'bounded_sequential_native_search_runs',
        query: 'sha256_only_in_persisted_artifacts',
        requestHeaders: 'not_read',
        requestBody: 'not_read',
        cookiesAndTokens: 'not_read',
        responseBodies: 'not_read',
        pageBudget: 2,
        semanticActionDelivery: 'at_most_once_per_page',
        admissionEligible: false
      }
    };
    const artifact = await this.#artifacts.record(run);
    await this.#checkpoints.finish({
      batchId: initial.batchId,
      state: preserveInFlightPage ? 'outcome_unknown' : state,
      terminalReason,
      artifactId: artifact.artifactId,
      ...(preserveInFlightPage ? { preserveInFlightPage: true } : {})
    });
    return { run, artifact };
  }

  #terminalFromPageRuns(pageRuns: BilibiliNativeSearchBatchPageRun[]): BilibiliNativeSearchBatchTerminalReason {
    const last = pageRuns.at(-1);
    if (!last) return 'search_batch_ready';
    if (last.terminalReason === 'search_empty') return 'search_batch_empty';
    if (last.state === 'failed') return 'search_batch_page_failed';
    if (last.state !== 'completed') return 'search_batch_page_partial';
    return 'search_batch_ready';
  }
}
