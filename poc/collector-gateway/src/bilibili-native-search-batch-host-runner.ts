import { createHash, randomUUID } from 'node:crypto';
import {
  BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
  BrowserHostError,
  COLLECTOR_EXTENSION_VERSION
} from '@intelligence/collector-contracts';
import type { BilibiliNativeSearchHostRunResult, BilibiliNativeSearchHostRunner } from './bilibili-native-search-host-runner';
import {
  bilibiliNativeSearchBatchInput,
  type BilibiliNativeSearchBatchInput,
  type BilibiliNativeSearchBatchPageRun,
  type BilibiliNativeSearchBatchRunRecord,
  type BilibiliNativeSearchBatchTerminalReason
} from './bilibili-native-search-batch-contract';
import type {
  BilibiliNativeSearchBatchArtifactStore,
  BilibiliNativeSearchBatchArtifactSummary
} from './bilibili-native-search-batch-artifacts';
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
  return { state: 'completed', terminalReason: 'search_batch_ready', errorCode: null };
}

export class BilibiliNativeSearchBatchHostRunner {
  readonly #singleRunner: BilibiliNativeSearchHostRunner;
  readonly #artifacts: BilibiliNativeSearchBatchArtifactStore;

  constructor(input: {
    singleRunner: BilibiliNativeSearchHostRunner;
    artifacts: BilibiliNativeSearchBatchArtifactStore;
  }) {
    this.#singleRunner = input.singleRunner;
    this.#artifacts = input.artifacts;
  }

  async run(rawInput: unknown): Promise<BilibiliNativeSearchBatchHostRunResult> {
    const request = bilibiliNativeSearchBatchInput(rawInput);
    const batchId = randomUUID();
    const startedAt = new Date().toISOString();
    const pageRuns: BilibiliNativeSearchBatchPageRun[] = [];
    const projections: Array<{ page: number; projection: NonNullable<BilibiliNativeSearchHostRunResult['run']['results']> }> = [];
    let state: BilibiliNativeSearchBatchRunRecord['state'] = 'completed';
    let terminalReason: BilibiliNativeSearchBatchTerminalReason = 'search_batch_ready';
    let errorCode: string | null = null;

    for (const page of request.pages) {
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
        break;
      }
      pageRuns.push(pageRun(result));
      if (result.run.results) projections.push({ page, projection: result.run.results });
      const pageTerminal = terminalForPage(result);
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
      batchId,
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
      startedAt,
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
    return { run, artifact };
  }
}
