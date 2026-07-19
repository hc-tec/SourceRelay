import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  DetailCapabilityValidationRunSnapshot,
  VisibleDetailCollectionResult
} from '../../collector-extension/src/shared/protocol';
import { COLLECTOR_CORE_VERSION } from '../../collector-extension/src/shared/protocol';
import type { StrategyProvenance } from '../../collector-extension/src/shared/collection-contracts';
import { resolveDetailStrategy, strategyProvenance } from '../../collector-extension/src/shared/strategy-registry';
import { sanitiseVisibleCollectionResult } from './evidence';
import type { CapabilityValidationReviewInput } from './validations';

export interface DetailCapabilityValidationRecord {
  schemaVersion: 1;
  collectorVersion: string;
  recordId: string;
  runId: string;
  profileId: string;
  platform: 'bilibili';
  accountCategory: 'anonymous';
  evidenceObjective: 'detail_read';
  strategy: StrategyProvenance;
  targetUrlDigest: string;
  navigationUrlDigest: string;
  state: 'completed' | 'inconclusive' | 'failed';
  terminalStatus: NonNullable<DetailCapabilityValidationRunSnapshot['terminalStatus']>;
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  recordedAt: string;
  result: VisibleDetailCollectionResult | null;
  safeguards: {
    environment: 'local_user_controlled_validation_profile';
    browser: 'visible_playwright_chromium';
    responseObservation: 'disabled';
    readOnlyActions: 0;
    firstRenderedPageOnly: true;
    maximumRecords: 1;
    commentCollection: 'disabled';
    recommendationCollection: 'disabled';
  };
  review: {
    status: 'pending' | 'accepted' | 'rejected';
    admittedToStrategyRegistry: boolean;
    decisionCode?: string;
    reviewedAt?: string;
  };
}

export interface DetailCapabilityValidationInput {
  canonicalUrl: string;
}

export function detailCapabilityValidationInput(value: unknown): DetailCapabilityValidationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('detail_validation_input_invalid');
  }
  const candidate = value as Partial<DetailCapabilityValidationInput>;
  if (Object.keys(candidate).some((key) => key !== 'canonicalUrl')) {
    throw new Error('detail_validation_input_invalid');
  }
  if (
    typeof candidate.canonicalUrl !== 'string' ||
    !/^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}$/.test(candidate.canonicalUrl)
  ) throw new Error('detail_validation_url_invalid');
  return { canonicalUrl: candidate.canonicalUrl };
}

function isRecord(value: unknown): value is DetailCapabilityValidationRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DetailCapabilityValidationRecord>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.collectorVersion === 'string' &&
    typeof candidate.recordId === 'string' &&
    typeof candidate.runId === 'string' &&
    typeof candidate.profileId === 'string' &&
    candidate.platform === 'bilibili' &&
    candidate.accountCategory === 'anonymous' &&
    candidate.evidenceObjective === 'detail_read' &&
    Boolean(candidate.strategy) &&
    typeof candidate.targetUrlDigest === 'string' &&
    typeof candidate.navigationUrlDigest === 'string' &&
    (candidate.state === 'completed' || candidate.state === 'inconclusive' || candidate.state === 'failed') &&
    typeof candidate.terminalStatus === 'string' &&
    typeof candidate.completedAt === 'string' &&
    (candidate.review?.status === 'pending' || candidate.review?.status === 'accepted' || candidate.review?.status === 'rejected') &&
    typeof candidate.review.admittedToStrategyRegistry === 'boolean'
  );
}

function sameStrategy(left: StrategyProvenance, right: StrategyProvenance): boolean {
  return (
    left.strategyId === right.strategyId &&
    left.version === right.version &&
    left.platform === right.platform &&
    left.maturity === right.maturity &&
    left.liveValidation === null && right.liveValidation === null &&
    left.evidenceObjectives.length === right.evidenceObjectives.length &&
    left.evidenceObjectives.every((value, index) => value === right.evidenceObjectives[index]) &&
    left.acquisition.length === right.acquisition.length &&
    left.acquisition.every((value, index) => value === right.acquisition[index])
  );
}

function toRecord(
  run: DetailCapabilityValidationRunSnapshot,
  now = new Date()
): DetailCapabilityValidationRecord {
  const canonicalStrategy = strategyProvenance(resolveDetailStrategy('bilibili'));
  if (run.collectorVersion !== COLLECTOR_CORE_VERSION) throw new Error('detail_validation_record_version_mismatch');
  if (!sameStrategy(run.strategy, canonicalStrategy)) throw new Error('detail_validation_record_strategy_mismatch');
  if (run.state !== 'completed' && run.state !== 'inconclusive' && run.state !== 'failed') {
    throw new Error('detail_validation_record_state_invalid');
  }
  if (!run.terminalStatus || !run.completedAt) throw new Error('detail_validation_record_terminal_metadata_missing');
  if (!/^[0-9a-f]{64}$/.test(run.targetUrlDigest) || !/^[0-9a-f]{64}$/.test(run.navigationUrlDigest)) {
    throw new Error('detail_validation_record_digest_invalid');
  }
  const sanitised = run.result ? sanitiseVisibleCollectionResult(run.result) : null;
  if (sanitised && sanitised.operation !== 'detail_read') throw new Error('detail_validation_result_invalid');
  return {
    schemaVersion: 1,
    collectorVersion: run.collectorVersion,
    recordId: randomUUID(),
    runId: run.runId,
    profileId: run.profileId,
    platform: 'bilibili',
    accountCategory: 'anonymous',
    evidenceObjective: 'detail_read',
    strategy: canonicalStrategy,
    targetUrlDigest: run.targetUrlDigest,
    navigationUrlDigest: run.navigationUrlDigest,
    state: run.state,
    terminalStatus: run.terminalStatus,
    errorCode: run.errorCode,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    recordedAt: now.toISOString(),
    result: sanitised,
    safeguards: {
      environment: 'local_user_controlled_validation_profile',
      browser: 'visible_playwright_chromium',
      responseObservation: 'disabled',
      readOnlyActions: 0,
      firstRenderedPageOnly: true,
      maximumRecords: 1,
      commentCollection: 'disabled',
      recommendationCollection: 'disabled'
    },
    review: { status: 'pending', admittedToStrategyRegistry: false }
  };
}

export class DetailCapabilityValidationRegistry {
  readonly #registryPath: string;
  #records: DetailCapabilityValidationRecord[] = [];
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#registryPath = resolve(stateDirectory, 'detail-capability-validations.json');
  }

  static async create(stateDirectory: string): Promise<DetailCapabilityValidationRegistry> {
    const registry = new DetailCapabilityValidationRegistry(stateDirectory);
    await mkdir(resolve(stateDirectory), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(registry.#registryPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) registry.#records = parsed.filter(isRecord);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await registry.#reconcileAdmissions();
    return registry;
  }

  list(): DetailCapabilityValidationRecord[] {
    return this.#records.map((record) => structuredClone(record));
  }

  has(recordId: string): boolean {
    return this.#records.some((record) => record.recordId === recordId);
  }

  async record(run: DetailCapabilityValidationRunSnapshot): Promise<DetailCapabilityValidationRecord> {
    const existing = this.#records.find((record) => record.runId === run.runId);
    if (existing) return structuredClone(existing);
    const record = toRecord(run);
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
  ): Promise<DetailCapabilityValidationRecord> {
    const record = this.#records.find((candidate) => candidate.recordId === recordId);
    if (!record) throw new Error('detail_validation_record_not_found');
    if (record.review.status !== 'pending') throw new Error('detail_validation_record_already_reviewed');
    if (input.decision === 'accept' && (
      record.state !== 'completed' || !record.result?.detail ||
      !record.result.detail.publishedText || record.result.detail.visibleMetrics.length < 2 ||
      (!record.result.detail.description && !record.result.detail.creator) || record.result.itemCount !== 1
    )) throw new Error('detail_validation_record_not_acceptable');
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
    const strategy = resolveDetailStrategy('bilibili');
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
