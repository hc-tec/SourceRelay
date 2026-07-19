import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  GatewayEvidenceBatchSummary,
  GatewayEvidenceSubmission
} from '../../collector-extension/src/shared/control-plane';
import {
  ACQUISITION_MECHANISMS,
  EVIDENCE_OBJECTIVES,
  STRATEGY_MATURITIES,
  isSupportedPlatform,
  type LiveValidationReference,
  type StrategyProvenance
} from '../../collector-extension/src/shared/collection-contracts';
import type {
  VisibleCollectionResult,
  VisibleDetailCollectionResult,
  VisiblePageState,
  VisibleSearchCollectionResult,
  VisibleSearchItem,
  VisibleVideoDetail
} from '../../collector-extension/src/shared/protocol';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';

const MAX_VISIBLE_ITEMS = 100;
const MAX_TITLE_LENGTH = 500;
const MAX_URL_LENGTH = 2_000;
const MAX_WARNINGS = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const VISIBLE_PAGE_STATES: readonly VisiblePageState[] = [
  'results_visible',
  'no_results_visible',
  'authentication_required',
  'verification_required',
  'rate_limited',
  'source_unavailable',
  'layout_unrecognized'
];

const VISIBLE_CONTENT_TYPES: readonly VisibleSearchItem['contentType'][] = [
  'video',
  'answer_or_question',
  'article',
  'post',
  'note'
];

interface PersistedEvidenceBatch extends GatewayEvidenceBatchSummary {
  collectorVersion: string;
  leaseId: string;
  extensionInstanceId: string;
  platform: GatewayEvidenceSubmission['platform'];
  strategy: StrategyProvenance;
  capturedAt: string;
  result: VisibleCollectionResult;
  safety: {
    browserSurface: 'user_controlled_collection_profile';
    acquisition: 'visible_dom';
    responseObservation: 'disabled';
    browserCredentialData: 'not_collected';
  };
}

interface EvidenceManifest {
  schemaVersion: 1;
  taskId: string;
  batches: GatewayEvidenceBatchSummary[];
  updatedAt: string;
}

export interface GatewayEvidenceBatchView extends GatewayEvidenceBatchSummary {
  collectorVersion: string;
  platform: GatewayEvidenceSubmission['platform'];
  strategy: StrategyProvenance;
  capturedAt: string;
  result: VisibleCollectionResult;
  safety: PersistedEvidenceBatch['safety'];
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function boundedCleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned !== value || cleaned.length > maximum || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    return url.href === value ? value : null;
  } catch {
    return null;
  }
}

function sanitiseLiveValidation(value: unknown): LiveValidationReference | null {
  if (!value || typeof value !== 'object' || !hasOnlyKeys(value, [
    'category', 'recordId', 'verifiedAt', 'environment'
  ])) return null;
  const candidate = value as Partial<LiveValidationReference>;
  if (
    (candidate.category !== 'anonymous' && candidate.category !== 'authenticated') ||
    !isUuid(candidate.recordId) ||
    !isIsoDate(candidate.verifiedAt) ||
    candidate.environment !== 'local_user_controlled_validation_profile'
  ) return null;
  return {
    category: candidate.category,
    recordId: candidate.recordId,
    verifiedAt: candidate.verifiedAt,
    environment: candidate.environment
  };
}

function sanitiseStrategy(value: unknown): StrategyProvenance | null {
  if (!value || typeof value !== 'object' || !hasOnlyKeys(value, [
    'strategyId', 'version', 'platform', 'evidenceObjectives', 'acquisition', 'maturity', 'liveValidation'
  ])) return null;
  const candidate = value as Partial<StrategyProvenance>;
  if (
    typeof candidate.strategyId !== 'string' || !/^[a-z0-9_.-]{1,120}$/.test(candidate.strategyId) ||
    typeof candidate.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(candidate.version) ||
    !isSupportedPlatform(candidate.platform) ||
    !Array.isArray(candidate.evidenceObjectives) || candidate.evidenceObjectives.length === 0 ||
    candidate.evidenceObjectives.length > EVIDENCE_OBJECTIVES.length ||
    !candidate.evidenceObjectives.every((item) => EVIDENCE_OBJECTIVES.includes(item)) ||
    new Set(candidate.evidenceObjectives).size !== candidate.evidenceObjectives.length ||
    !Array.isArray(candidate.acquisition) || candidate.acquisition.length === 0 ||
    candidate.acquisition.length > ACQUISITION_MECHANISMS.length ||
    !candidate.acquisition.every((item) => ACQUISITION_MECHANISMS.includes(item)) ||
    new Set(candidate.acquisition).size !== candidate.acquisition.length ||
    !STRATEGY_MATURITIES.includes(candidate.maturity as never)
  ) return null;
  const liveValidation = candidate.liveValidation === null
    ? null
    : sanitiseLiveValidation(candidate.liveValidation);
  if (candidate.liveValidation !== null && !liveValidation) return null;
  return {
    strategyId: candidate.strategyId,
    version: candidate.version,
    platform: candidate.platform,
    evidenceObjectives: [...candidate.evidenceObjectives],
    acquisition: [...candidate.acquisition],
    maturity: candidate.maturity!,
    liveValidation
  };
}

function sanitiseVisibleItem(value: unknown, expectedRank: number): VisibleSearchItem | null {
  if (!value || typeof value !== 'object' || !hasOnlyKeys(value, [
    'rank', 'title', 'url', 'contentType'
  ])) return null;
  const candidate = value as Partial<VisibleSearchItem>;
  const title = boundedCleanText(candidate.title, MAX_TITLE_LENGTH);
  const url = safeHttpsUrl(candidate.url);
  if (
    candidate.rank !== expectedRank ||
    !title ||
    !url ||
    !VISIBLE_CONTENT_TYPES.includes(candidate.contentType as never)
  ) return null;
  return {
    rank: expectedRank,
    title,
    url,
    contentType: candidate.contentType!
  };
}

function sanitiseVisibleSearchResult(value: unknown): VisibleSearchCollectionResult | null {
  if (!value || typeof value !== 'object' || !hasOnlyKeys(value, [
    'schemaVersion', 'platform', 'operation', 'strategy', 'sourceUrl', 'pageState',
    'partial', 'itemCount', 'items', 'warnings'
  ])) return null;
  const candidate = value as Partial<VisibleCollectionResult>;
  if (
    candidate.schemaVersion !== 1 ||
    !isSupportedPlatform(candidate.platform) ||
    candidate.operation !== 'breadth_search' ||
    candidate.partial !== true ||
    !VISIBLE_PAGE_STATES.includes(candidate.pageState as never) ||
    !Array.isArray(candidate.items) || candidate.items.length > MAX_VISIBLE_ITEMS ||
    candidate.itemCount !== candidate.items.length ||
    !Array.isArray(candidate.warnings) || candidate.warnings.length > MAX_WARNINGS
  ) return null;
  const strategy = sanitiseStrategy(candidate.strategy);
  const sourceUrl = safeHttpsUrl(candidate.sourceUrl);
  if (!strategy || !sourceUrl || strategy.platform !== candidate.platform) return null;
  const items = candidate.items.map((item, index) => sanitiseVisibleItem(item, index + 1));
  if (items.some((item) => item === null)) return null;
  const warnings = candidate.warnings.map((warning) => boundedCleanText(warning, 500));
  if (warnings.some((warning) => warning === null)) return null;
  if ((candidate.pageState === 'results_visible') !== (items.length > 0)) return null;
  return {
    schemaVersion: 1,
    platform: candidate.platform,
    operation: 'breadth_search',
    strategy,
    sourceUrl,
    pageState: candidate.pageState!,
    partial: true,
    itemCount: items.length,
    items: items as VisibleSearchItem[],
    warnings: warnings as string[]
  };
}

function nullableCleanText(value: unknown, maximum: number): string | null | undefined {
  if (value === null) return null;
  return boundedCleanText(value, maximum) ?? undefined;
}

function sanitiseVisibleDetailResult(value: unknown): VisibleDetailCollectionResult | null {
  if (!value || typeof value !== 'object' || !hasOnlyKeys(value, [
    'schemaVersion', 'platform', 'operation', 'strategy', 'sourceUrl', 'pageState',
    'partial', 'itemCount', 'detail', 'warnings'
  ])) return null;
  const candidate = value as Partial<VisibleDetailCollectionResult>;
  if (
    candidate.schemaVersion !== 1 ||
    !isSupportedPlatform(candidate.platform) ||
    candidate.operation !== 'detail_read' ||
    candidate.partial !== true ||
    !VISIBLE_PAGE_STATES.includes(candidate.pageState as never) ||
    !Array.isArray(candidate.warnings) || candidate.warnings.length > MAX_WARNINGS
  ) return null;
  const strategy = sanitiseStrategy(candidate.strategy);
  const sourceUrl = safeHttpsUrl(candidate.sourceUrl);
  const warnings = candidate.warnings.map((warning) => boundedCleanText(warning, 500));
  if (!strategy || !sourceUrl || strategy.platform !== candidate.platform || warnings.some((item) => item === null)) {
    return null;
  }
  if (candidate.detail === null) {
    if (candidate.itemCount !== 0 || candidate.pageState === 'results_visible') return null;
    return {
      schemaVersion: 1,
      platform: candidate.platform,
      operation: 'detail_read',
      strategy,
      sourceUrl,
      pageState: candidate.pageState!,
      partial: true,
      itemCount: 0,
      detail: null,
      warnings: warnings as string[]
    };
  }
  if (!candidate.detail || typeof candidate.detail !== 'object' || candidate.itemCount !== 1) return null;
  const detail = candidate.detail;
  if (!hasOnlyKeys(detail, [
    'contentId', 'contentType', 'canonicalUrl', 'title', 'creator', 'description',
    'publishedText', 'visibleMetrics', 'tags'
  ])) return null;
  const title = boundedCleanText(detail.title, MAX_TITLE_LENGTH);
  const canonicalUrl = safeHttpsUrl(detail.canonicalUrl);
  const description = nullableCleanText(detail.description, 5_000);
  const publishedText = nullableCleanText(detail.publishedText, 200);
  if (
    typeof detail.contentId !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(detail.contentId) ||
    detail.contentType !== 'video' ||
    !canonicalUrl || !title ||
    description === undefined || publishedText === undefined ||
    !Array.isArray(detail.visibleMetrics) || detail.visibleMetrics.length > 20 ||
    !Array.isArray(detail.tags) || detail.tags.length > 20
  ) return null;
  const visibleMetrics = detail.visibleMetrics.map((metric) => {
    if (!metric || typeof metric !== 'object' || !hasOnlyKeys(metric, ['label', 'value'])) return null;
    const label = boundedCleanText(metric.label, 80);
    const metricValue = boundedCleanText(metric.value, 100);
    return label && metricValue ? { label, value: metricValue } : null;
  });
  const tags = detail.tags.map((tag) => boundedCleanText(tag, 100));
  if (
    visibleMetrics.some((metric) => metric === null) ||
    new Set(visibleMetrics.map((metric) => metric?.label)).size !== visibleMetrics.length ||
    tags.some((tag) => tag === null) || new Set(tags).size !== tags.length
  ) return null;
  let creator: VisibleVideoDetail['creator'] = null;
  if (detail.creator !== null) {
    if (!detail.creator || typeof detail.creator !== 'object' || !hasOnlyKeys(detail.creator, [
      'displayName', 'canonicalProfileUrl', 'visibleDescription'
    ])) return null;
    const displayName = boundedCleanText(detail.creator.displayName, 200);
    const canonicalProfileUrl = safeHttpsUrl(detail.creator.canonicalProfileUrl);
    const visibleDescription = nullableCleanText(detail.creator.visibleDescription, 1_000);
    if (
      !displayName || !canonicalProfileUrl || visibleDescription === undefined ||
      !/^https:\/\/space\.bilibili\.com\/\d+\/$/.test(canonicalProfileUrl)
    ) return null;
    creator = { displayName, canonicalProfileUrl, visibleDescription };
  }
  return {
    schemaVersion: 1,
    platform: candidate.platform,
    operation: 'detail_read',
    strategy,
    sourceUrl,
    pageState: candidate.pageState!,
    partial: true,
    itemCount: 1,
    detail: {
      contentId: detail.contentId,
      contentType: 'video',
      canonicalUrl,
      title,
      creator,
      description,
      publishedText,
      visibleMetrics: visibleMetrics as { label: string; value: string }[],
      tags: tags as string[]
    },
    warnings: warnings as string[]
  };
}

export function sanitiseVisibleCollectionResult(value: unknown): VisibleCollectionResult | null {
  if (!value || typeof value !== 'object') return null;
  const operation = (value as { operation?: unknown }).operation;
  if (operation === 'breadth_search') return sanitiseVisibleSearchResult(value);
  if (operation === 'detail_read') return sanitiseVisibleDetailResult(value);
  return null;
}

export function gatewayEvidenceSubmission(value: unknown): GatewayEvidenceSubmission {
  if (!value || typeof value !== 'object' || !hasOnlyKeys(value, [
    'schemaVersion', 'collectorVersion', 'taskId', 'stageId', 'leaseId',
    'platform', 'strategy', 'capturedAt', 'result'
  ])) throw new Error('evidence_submission_invalid');
  const candidate = value as Partial<GatewayEvidenceSubmission>;
  const strategy = sanitiseStrategy(candidate.strategy);
  const result = sanitiseVisibleCollectionResult(candidate.result);
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.collectorVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(candidate.collectorVersion) ||
    !isUuid(candidate.taskId) ||
    typeof candidate.stageId !== 'string' ||
    candidate.stageId.length > 160 ||
    !isUuid(candidate.leaseId) ||
    !isSupportedPlatform(candidate.platform) ||
    !strategy || strategy.platform !== candidate.platform ||
    !isIsoDate(candidate.capturedAt) ||
    !result || result.platform !== candidate.platform
  ) throw new Error('evidence_submission_invalid');
  return {
    schemaVersion: 1,
    collectorVersion: candidate.collectorVersion,
    taskId: candidate.taskId,
    stageId: candidate.stageId,
    leaseId: candidate.leaseId,
    platform: candidate.platform,
    strategy,
    capturedAt: candidate.capturedAt,
    result
  };
}

function isPersistedBatch(value: unknown): value is PersistedEvidenceBatch {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedEvidenceBatch>;
  return (
    candidate.schemaVersion === 1 &&
    isUuid(candidate.batchId) &&
    isUuid(candidate.taskId) &&
    typeof candidate.stageId === 'string' &&
    isUuid(candidate.leaseId) &&
    isUuid(candidate.extensionInstanceId) &&
    typeof candidate.collectorVersion === 'string' &&
    isSupportedPlatform(candidate.platform) &&
    Boolean(sanitiseStrategy(candidate.strategy)) &&
    isIsoDate(candidate.capturedAt) &&
    isIsoDate(candidate.receivedAt) &&
    typeof candidate.digest === 'string' && SHA256_PATTERN.test(candidate.digest) &&
    Number.isSafeInteger(candidate.itemCount) && candidate.itemCount! >= 0 &&
    Boolean(sanitiseVisibleCollectionResult(candidate.result)) &&
    candidate.safety?.browserSurface === 'user_controlled_collection_profile' &&
    candidate.safety.acquisition === 'visible_dom' &&
    candidate.safety.responseObservation === 'disabled' &&
    candidate.safety.browserCredentialData === 'not_collected'
  );
}

function summary(batch: PersistedEvidenceBatch): GatewayEvidenceBatchSummary {
  return {
    schemaVersion: 1,
    batchId: batch.batchId,
    taskId: batch.taskId,
    stageId: batch.stageId,
    digest: batch.digest,
    itemCount: batch.itemCount,
    receivedAt: batch.receivedAt
  };
}

export class GatewayEvidenceRegistry {
  readonly #evidenceDirectory: string;
  readonly #byIdempotencyKey = new Map<string, GatewayEvidenceBatchSummary>();
  readonly #byTask = new Map<string, GatewayEvidenceBatchSummary[]>();
  readonly #batchById = new Map<string, PersistedEvidenceBatch>();
  readonly #recording = new Map<string, Promise<GatewayEvidenceBatchSummary>>();

  private constructor(stateDirectory: string) {
    this.#evidenceDirectory = resolve(stateDirectory, 'evidence');
  }

  static async create(stateDirectory: string): Promise<GatewayEvidenceRegistry> {
    const registry = new GatewayEvidenceRegistry(stateDirectory);
    await mkdir(registry.#evidenceDirectory, { recursive: true });
    await registry.#recover();
    return registry;
  }

  list(taskId?: string): GatewayEvidenceBatchSummary[] {
    if (taskId) return structuredClone(this.#byTask.get(taskId) ?? []);
    return structuredClone([...this.#byTask.values()].flat());
  }

  getBatch(batchId: string, taskId?: string): GatewayEvidenceBatchView | null {
    const batch = this.#batchById.get(batchId);
    if (!batch || (taskId && batch.taskId !== taskId)) return null;
    return structuredClone({
      ...summary(batch),
      collectorVersion: batch.collectorVersion,
      platform: batch.platform,
      strategy: batch.strategy,
      capturedAt: batch.capturedAt,
      result: batch.result,
      safety: batch.safety
    });
  }

  async record(
    submission: GatewayEvidenceSubmission,
    extensionInstanceId: string,
    now = new Date()
  ): Promise<GatewayEvidenceBatchSummary> {
    const digest = createHash('sha256').update(canonicalJson(submission.result)).digest('hex');
    const idempotencyKey = `${submission.taskId}:${submission.stageId}:${digest}`;
    const existing = this.#byIdempotencyKey.get(idempotencyKey);
    if (existing) return structuredClone(existing);

    const active = this.#recording.get(idempotencyKey);
    if (active) return structuredClone(await active);
    const operation = this.#persistNewBatch(submission, extensionInstanceId, digest, now);
    this.#recording.set(idempotencyKey, operation);
    try {
      return structuredClone(await operation);
    } finally {
      this.#recording.delete(idempotencyKey);
    }
  }

  async #persistNewBatch(
    submission: GatewayEvidenceSubmission,
    extensionInstanceId: string,
    digest: string,
    now: Date
  ): Promise<GatewayEvidenceBatchSummary> {
    const batch: PersistedEvidenceBatch = {
      schemaVersion: 1,
      batchId: randomUUID(),
      taskId: submission.taskId,
      stageId: submission.stageId,
      digest,
      itemCount: submission.result.itemCount,
      receivedAt: now.toISOString(),
      collectorVersion: submission.collectorVersion,
      leaseId: submission.leaseId,
      extensionInstanceId,
      platform: submission.platform,
      strategy: structuredClone(submission.strategy),
      capturedAt: submission.capturedAt,
      result: structuredClone(submission.result),
      safety: {
        browserSurface: 'user_controlled_collection_profile',
        acquisition: 'visible_dom',
        responseObservation: 'disabled',
        browserCredentialData: 'not_collected'
      }
    };
    const taskDirectory = resolve(this.#evidenceDirectory, submission.taskId);
    await mkdir(taskDirectory, { recursive: true });
    await this.#atomicWrite(resolve(taskDirectory, `${batch.batchId}.json`), batch);

    const batchSummary = summary(batch);
    const batches = [...(this.#byTask.get(submission.taskId) ?? []), batchSummary];
    const manifest: EvidenceManifest = {
      schemaVersion: 1,
      taskId: submission.taskId,
      batches,
      updatedAt: now.toISOString()
    };
    await this.#atomicWrite(resolve(taskDirectory, 'manifest.json'), manifest);
    this.#remember(batch);
    return batchSummary;
  }

  async #recover(): Promise<void> {
    const taskEntries = await readdir(this.#evidenceDirectory, { withFileTypes: true });
    for (const taskEntry of taskEntries) {
      if (!taskEntry.isDirectory() || !UUID_PATTERN.test(taskEntry.name)) continue;
      const taskDirectory = resolve(this.#evidenceDirectory, taskEntry.name);
      const entries = await readdir(taskDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || entry.name === 'manifest.json' || !UUID_PATTERN.test(entry.name.replace(/\.json$/, ''))) {
          continue;
        }
        try {
          const parsed = JSON.parse(await readFile(resolve(taskDirectory, entry.name), 'utf8')) as unknown;
          if (!isPersistedBatch(parsed) || parsed.taskId !== taskEntry.name) continue;
          const digest = createHash('sha256').update(canonicalJson(parsed.result)).digest('hex');
          if (digest !== parsed.digest || parsed.itemCount !== parsed.result.itemCount) continue;
          this.#remember(parsed);
        } catch {
          // A damaged local batch is ignored, never partially trusted.
        }
      }
    }
  }

  #remember(batch: PersistedEvidenceBatch): void {
    const batchSummary = summary(batch);
    const idempotencyKey = `${batch.taskId}:${batch.stageId}:${batch.digest}`;
    if (this.#byIdempotencyKey.has(idempotencyKey)) return;
    this.#byIdempotencyKey.set(idempotencyKey, batchSummary);
    this.#byTask.set(batch.taskId, [...(this.#byTask.get(batch.taskId) ?? []), batchSummary]);
    this.#batchById.set(batch.batchId, batch);
  }

  async #atomicWrite(path: string, value: unknown): Promise<void> {
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temporaryPath, path);
  }
}
