import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  CapabilityValidationRunSnapshot,
  VisibleCollectionResult
} from '../../collector-extension/src/shared/protocol';
import { COLLECTOR_CORE_VERSION } from '../../collector-extension/src/shared/protocol';
import type { StrategyProvenance } from '../../collector-extension/src/shared/collection-contracts';
import {
  resolveNativeSearchStrategy,
  strategyProvenance
} from '../../collector-extension/src/shared/strategy-registry';

export interface CapabilityValidationRecord {
  schemaVersion: 1;
  collectorVersion: string;
  recordId: string;
  runId: string;
  profileId: string;
  platform: 'bilibili';
  accountCategory: 'anonymous';
  evidenceObjective: 'breadth_search';
  strategy: StrategyProvenance;
  queryDigest: string;
  navigationUrlDigest: string;
  state: 'completed' | 'inconclusive' | 'failed';
  terminalStatus: NonNullable<CapabilityValidationRunSnapshot['terminalStatus']>;
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  recordedAt: string;
  result: VisibleCollectionResult | null;
  safeguards: {
    environment: 'local_user_controlled_validation_profile';
    browser: 'visible_playwright_chromium';
    responseObservation: 'disabled';
    readOnlyActions: 0;
    firstRenderedPageOnly: true;
    maximumRecords: 20;
  };
  review: {
    status: 'pending' | 'accepted' | 'rejected';
    admittedToStrategyRegistry: boolean;
    decisionCode?: string;
    reviewedAt?: string;
  };
}

export interface CapabilityValidationInput {
  query: string;
}

export function capabilityValidationInput(value: unknown): CapabilityValidationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('validation_input_invalid');
  const candidate = value as Partial<CapabilityValidationInput>;
  if (Object.keys(candidate).some((key) => key !== 'query')) throw new Error('validation_input_invalid');
  if (typeof candidate.query !== 'string') throw new Error('validation_query_invalid');
  const query = candidate.query.replace(/\s+/g, ' ').trim();
  if (!query || query.length > 200) throw new Error('validation_query_invalid');
  return { query };
}

export interface CapabilityValidationReviewInput {
  decision: 'accept' | 'reject';
  decisionCode: string;
}

export function capabilityValidationReviewInput(value: unknown): CapabilityValidationReviewInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('validation_review_input_invalid');
  const candidate = value as Partial<CapabilityValidationReviewInput>;
  if (Object.keys(candidate).some((key) => key !== 'decision' && key !== 'decisionCode')) {
    throw new Error('validation_review_input_invalid');
  }
  if (candidate.decision !== 'accept' && candidate.decision !== 'reject') {
    throw new Error('validation_review_decision_invalid');
  }
  if (typeof candidate.decisionCode !== 'string' || !/^[a-z0-9_]{3,100}$/.test(candidate.decisionCode)) {
    throw new Error('validation_review_code_invalid');
  }
  return { decision: candidate.decision, decisionCode: candidate.decisionCode };
}

function isCapabilityValidationRecord(value: unknown): value is CapabilityValidationRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CapabilityValidationRecord>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.collectorVersion === 'string' &&
    typeof candidate.recordId === 'string' &&
    typeof candidate.runId === 'string' &&
    typeof candidate.profileId === 'string' &&
    candidate.platform === 'bilibili' &&
    candidate.accountCategory === 'anonymous' &&
    candidate.evidenceObjective === 'breadth_search' &&
    Boolean(candidate.strategy) &&
    (candidate.state === 'completed' || candidate.state === 'inconclusive' || candidate.state === 'failed') &&
    typeof candidate.terminalStatus === 'string' &&
    typeof candidate.startedAt === 'string' &&
    typeof candidate.completedAt === 'string' &&
    typeof candidate.recordedAt === 'string' &&
    (candidate.review?.status === 'pending' || candidate.review?.status === 'accepted' || candidate.review?.status === 'rejected') &&
    typeof candidate.review.admittedToStrategyRegistry === 'boolean'
  );
}

function validationRecord(run: CapabilityValidationRunSnapshot, now = new Date()): CapabilityValidationRecord {
  const canonicalStrategy = strategyProvenance(resolveNativeSearchStrategy('bilibili'));
  if (run.collectorVersion !== COLLECTOR_CORE_VERSION) throw new Error('validation_record_version_mismatch');
  if (run.platform !== 'bilibili' || run.accountCategory !== 'anonymous' || run.evidenceObjective !== 'breadth_search') {
    throw new Error('validation_record_scope_invalid');
  }
  if (run.state !== 'completed' && run.state !== 'inconclusive' && run.state !== 'failed') {
    throw new Error('validation_record_state_invalid');
  }
  if (!run.terminalStatus || !run.completedAt) throw new Error('validation_record_terminal_metadata_missing');
  if (!/^[0-9a-f]{64}$/.test(run.queryDigest) || !/^[0-9a-f]{64}$/.test(run.navigationUrlDigest)) {
    throw new Error('validation_record_digest_invalid');
  }
  if (!sameStrategy(run.strategy, canonicalStrategy)) {
    throw new Error('validation_record_strategy_mismatch');
  }
  const result = run.result ? sanitiseVisibleResult(run.result, canonicalStrategy) : null;
  return {
    schemaVersion: 1,
    collectorVersion: run.collectorVersion,
    recordId: randomUUID(),
    runId: run.runId,
    profileId: run.profileId,
    platform: run.platform,
    accountCategory: run.accountCategory,
    evidenceObjective: run.evidenceObjective,
    strategy: canonicalStrategy,
    queryDigest: run.queryDigest,
    navigationUrlDigest: run.navigationUrlDigest,
    state: run.state,
    terminalStatus: run.terminalStatus,
    errorCode: run.errorCode,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    recordedAt: now.toISOString(),
    result,
    safeguards: {
      environment: 'local_user_controlled_validation_profile',
      browser: 'visible_playwright_chromium',
      responseObservation: 'disabled',
      readOnlyActions: 0,
      firstRenderedPageOnly: true,
      maximumRecords: 20
    },
    review: {
      status: 'pending',
      admittedToStrategyRegistry: false
    }
  };
}

function sameStrategy(left: StrategyProvenance, right: StrategyProvenance): boolean {
  return (
    left.strategyId === right.strategyId &&
    left.version === right.version &&
    left.platform === right.platform &&
    left.maturity === right.maturity &&
    left.liveValidation === null &&
    right.liveValidation === null &&
    left.evidenceObjectives.length === right.evidenceObjectives.length &&
    left.evidenceObjectives.every((value, index) => value === right.evidenceObjectives[index]) &&
    left.acquisition.length === right.acquisition.length &&
    left.acquisition.every((value, index) => value === right.acquisition[index])
  );
}

function sanitiseVisibleResult(
  value: VisibleCollectionResult,
  strategy: StrategyProvenance
): VisibleCollectionResult {
  const pageStates = new Set([
    'results_visible',
    'no_results_visible',
    'authentication_required',
    'verification_required',
    'rate_limited',
    'source_unavailable',
    'layout_unrecognized'
  ]);
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(value.sourceUrl);
  } catch {
    throw new Error('validation_result_invalid');
  }
  if (
    value.schemaVersion !== 1 ||
    value.platform !== 'bilibili' ||
    value.operation !== 'breadth_search' ||
    value.partial !== true ||
    !pageStates.has(value.pageState) ||
    sourceUrl.origin !== 'https://search.bilibili.com' ||
    sourceUrl.pathname !== '/all' ||
    sourceUrl.search !== '' ||
    !Number.isSafeInteger(value.itemCount) ||
    value.itemCount !== value.items.length ||
    value.items.length > 20 ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > 20 ||
    value.warnings.some((warning) => typeof warning !== 'string' || warning.length > 500)
  ) {
    throw new Error('validation_result_invalid');
  }
  const items = value.items.map((item, index) => {
    if (
      item.rank !== index + 1 ||
      item.contentType !== 'video' ||
      typeof item.title !== 'string' ||
      !item.title ||
      item.title.length > 500 ||
      item.title.replace(/稍后再看/g, '').replace(/[\p{N}\p{P}\p{S}\p{Z}]/gu, '').length < 2 ||
      !/^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}$/.test(item.url)
    ) {
      throw new Error('validation_result_invalid');
    }
    return {
      rank: item.rank,
      title: item.title,
      url: item.url,
      contentType: item.contentType
    };
  });
  return {
    schemaVersion: 1,
    platform: 'bilibili',
    operation: 'breadth_search',
    strategy,
    sourceUrl: sourceUrl.href,
    pageState: value.pageState,
    partial: true,
    itemCount: items.length,
    items,
    warnings: [...value.warnings]
  };
}

export class CapabilityValidationRegistry {
  readonly #registryPath: string;
  #records: CapabilityValidationRecord[] = [];
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#registryPath = resolve(stateDirectory, 'capability-validations.json');
  }

  static async create(stateDirectory: string): Promise<CapabilityValidationRegistry> {
    const registry = new CapabilityValidationRegistry(stateDirectory);
    await mkdir(resolve(stateDirectory), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(registry.#registryPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) registry.#records = parsed.filter(isCapabilityValidationRecord);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await registry.#reconcileAdmissions();
    return registry;
  }

  list(): CapabilityValidationRecord[] {
    return this.#records.map((record) => structuredClone(record));
  }

  async record(run: CapabilityValidationRunSnapshot): Promise<CapabilityValidationRecord> {
    const existing = this.#records.find((record) => record.runId === run.runId);
    if (existing) return structuredClone(existing);
    const record = validationRecord(run);
    this.#records.push(record);
    try {
      await this.#save();
    } catch (error) {
      this.#records = this.#records.filter((candidate) => candidate.recordId !== record.recordId);
      throw error;
    }
    return structuredClone(record);
  }

  async review(
    recordId: string,
    input: CapabilityValidationReviewInput,
    now = new Date()
  ): Promise<CapabilityValidationRecord> {
    const record = this.#records.find((candidate) => candidate.recordId === recordId);
    if (!record) throw new Error('validation_record_not_found');
    if (record.review.status !== 'pending') throw new Error('validation_record_already_reviewed');
    if (input.decision === 'accept' && (record.state !== 'completed' || !record.result || record.result.itemCount === 0)) {
      throw new Error('validation_record_not_acceptable');
    }
    const previous = structuredClone(record.review);
    record.review = {
      status: input.decision === 'accept' ? 'accepted' : 'rejected',
      admittedToStrategyRegistry: false,
      decisionCode: input.decisionCode,
      reviewedAt: now.toISOString()
    };
    try {
      await this.#save();
    } catch (error) {
      record.review = previous;
      throw error;
    }
    return structuredClone(record);
  }

  async #save(): Promise<void> {
    const write = this.#writeChain.then(async () => {
      const temporaryPath = `${this.#registryPath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.#records, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      await rename(temporaryPath, this.#registryPath);
    });
    this.#writeChain = write.catch(() => undefined);
    await write;
  }

  async #reconcileAdmissions(): Promise<void> {
    const strategy = resolveNativeSearchStrategy('bilibili');
    const admittedRecordId = strategy.maturity === 'live_anonymous_verified'
      ? strategy.validation.liveRecord?.recordId
      : undefined;
    let changed = false;
    for (const record of this.#records) {
      const admitted = record.review.status === 'accepted' && record.recordId === admittedRecordId;
      if (record.review.admittedToStrategyRegistry !== admitted) {
        record.review.admittedToStrategyRegistry = admitted;
        changed = true;
      }
    }
    if (changed) await this.#save();
  }
}
