import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  BilibiliInteractionReconnaissanceRecord,
  InteractionActionObservation,
  InteractionResponseBodyMapping,
  InteractionRouteSummary
} from './interaction-reconnaissance';

const MAX_PERSISTED_RUNS = 50;
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const SAFE_DOM_KEYS = new Set([
  'captionControlVisible',
  'captionMenuReady',
  'visibleCaptionLabels',
  'selectedLabel',
  'optionVisible',
  'optionVisibleBeforeClick',
  'optionVisibleAfterClick',
  'selectionAcknowledged',
  'visibleSubtitle',
  'commentsHostPresent',
  'visibleDiscussionLabels',
  'latestControlVisible',
  'expandControlVisible',
  'visibleThreadLabels',
  'prerequisite'
]);

export type PersistedInteractionReconnaissanceRecord = Omit<
  BilibiliInteractionReconnaissanceRecord,
  'profileId'
> & {
  artifactKind: 'authenticated_interaction_reconnaissance';
};

export interface InteractionReconnaissanceSummary {
  schemaVersion: 1;
  artifactKind: 'authenticated_interaction_reconnaissance';
  recordId: string;
  runId: string;
  platform: 'bilibili';
  pageRole: 'video_detail';
  targetUrlDigest: string;
  actionScope: BilibiliInteractionReconnaissanceRecord['actionScope'];
  objective: BilibiliInteractionReconnaissanceRecord['objective'];
  state: BilibiliInteractionReconnaissanceRecord['state'];
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  actions: Array<Pick<InteractionActionObservation, 'action' | 'attempted' | 'outcome' | 'errorCode'>>;
  responseBodyMappings: Array<Omit<InteractionResponseBodyMapping, 'schemaPaths'> & {
    schemaPathCount: number;
  }>;
  counters: BilibiliInteractionReconnaissanceRecord['counters'];
  safeguards: BilibiliInteractionReconnaissanceRecord['safeguards'];
}

function safeString(value: unknown, maximum = 160): string | null {
  return typeof value === 'string' && value.length <= maximum ? value : null;
}

function sanitiseDom(dom: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dom)) {
    if (!SAFE_DOM_KEYS.has(key)) continue;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      safe[key] = value;
      continue;
    }
    const string = safeString(value);
    if (string !== null) {
      safe[key] = string;
      continue;
    }
    if (Array.isArray(value)) {
      safe[key] = value
        .map((item) => safeString(item))
        .filter((item): item is string => item !== null)
        .slice(0, 30);
    }
  }
  return safe;
}

function sanitiseRoute(route: InteractionRouteSummary): InteractionRouteSummary {
  return {
    resourceType: route.resourceType,
    method: route.method.slice(0, 12),
    ownership: route.ownership,
    origin: route.origin.slice(0, 240),
    pathname: route.pathname.slice(0, 500),
    queryKeyNames: route.queryKeyNames
      .filter((key) => /^[a-zA-Z0-9_.\-\[\]]{1,100}$/.test(key))
      .slice(0, 100),
    count: Math.max(0, Math.trunc(route.count)),
    statusCodes: route.statusCodes.filter((status) => Number.isInteger(status)).slice(0, 20),
    mimeTypes: route.mimeTypes.filter((mime) => mime.length <= 120).slice(0, 20),
    minimumDeclaredResponseBodyBytes: route.minimumDeclaredResponseBodyBytes,
    maximumDeclaredResponseBodyBytes: route.maximumDeclaredResponseBodyBytes
  };
}

function sanitiseMapping(mapping: InteractionResponseBodyMapping): InteractionResponseBodyMapping {
  return {
    phase: mapping.phase,
    origin: mapping.origin.slice(0, 240),
    pathname: mapping.pathname.slice(0, 500),
    httpStatus: mapping.httpStatus,
    mimeType: mapping.mimeType.slice(0, 120),
    bodyBytes: mapping.bodyBytes,
    bodySha256: mapping.bodySha256 && SHA256_PATTERN.test(mapping.bodySha256)
      ? mapping.bodySha256.toLowerCase()
      : null,
    contentKind: mapping.contentKind,
    schemaPaths: mapping.schemaPaths.slice(0, 240).map((entry) => ({
      path: entry.path.slice(0, 700),
      type: entry.type,
      ...(entry.arrayLength === undefined ? {} : { arrayLength: Math.max(0, Math.trunc(entry.arrayLength)) })
    })),
    sensitiveFieldPathsOmitted: Math.max(0, Math.trunc(mapping.sensitiveFieldPathsOmitted))
  };
}

function toPersistedRecord(
  record: BilibiliInteractionReconnaissanceRecord
): PersistedInteractionReconnaissanceRecord {
  if (!UUID_PATTERN.test(record.recordId) || !UUID_PATTERN.test(record.runId)) {
    throw new Error('interaction_reconnaissance_record_invalid');
  }
  if (!SHA256_PATTERN.test(record.targetUrlDigest)) {
    throw new Error('interaction_reconnaissance_record_invalid');
  }
  return {
    schemaVersion: 1,
    artifactKind: 'authenticated_interaction_reconnaissance',
    recordId: record.recordId,
    runId: record.runId,
    collectorVersion: record.collectorVersion.slice(0, 80),
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'video_detail',
    targetUrlDigest: record.targetUrlDigest.toLowerCase(),
    actionScope: record.actionScope,
    objective: {
      scope: record.objective.scope,
      status: record.objective.status,
      requiredActions: [...record.objective.requiredActions],
      completedActions: [...record.objective.completedActions]
    },
    state: record.state,
    errorCode: record.errorCode,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    baseline: {
      captionControlVisible: record.baseline.captionControlVisible,
      commentsHostPresent: record.baseline.commentsHostPresent,
      routeSummary: record.baseline.routeSummary.map(sanitiseRoute)
    },
    actions: record.actions.map((action) => ({
      action: action.action,
      attempted: action.attempted,
      outcome: action.outcome,
      errorCode: action.errorCode,
      dom: sanitiseDom(action.dom),
      network: action.network.map(sanitiseRoute)
    })),
    responseBodyMappings: record.responseBodyMappings.map(sanitiseMapping),
    counters: {
      networkObservations: record.counters.networkObservations,
      networkObservationsDroppedByLimit: record.counters.networkObservationsDroppedByLimit,
      failedXhrFetchRequests: record.counters.failedXhrFetchRequests
    },
    safeguards: {
      environment: record.safeguards.environment,
      browser: record.safeguards.browser,
      observationMode: record.safeguards.observationMode,
      productionResponseRoutes: record.safeguards.productionResponseRoutes,
      requestHeaders: record.safeguards.requestHeaders,
      requestBody: record.safeguards.requestBody,
      responseHeaders: record.safeguards.responseHeaders,
      responseBody: record.safeguards.responseBody,
      cookiesAndTokens: record.safeguards.cookiesAndTokens,
      queryAndFragmentValues: record.safeguards.queryAndFragmentValues,
      actionTailMs: record.safeguards.actionTailMs,
      maximumSemanticActions: record.safeguards.maximumSemanticActions,
      runDeadlineMs: record.safeguards.runDeadlineMs,
      semanticActionDelivery: record.safeguards.semanticActionDelivery,
      captchaAndRiskControl: record.safeguards.captchaAndRiskControl,
      networkFailure: record.safeguards.networkFailure,
      observedTargetPages: record.safeguards.observedTargetPages,
      captionMenuReadyTimeoutMs: record.safeguards.captionMenuReadyTimeoutMs,
      admissionEligible: false
    }
  };
}

function isPersistedRecord(value: unknown): value is PersistedInteractionReconnaissanceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<PersistedInteractionReconnaissanceRecord> & { profileId?: unknown };
  return (
    candidate.profileId === undefined &&
    candidate.schemaVersion === 1 &&
    candidate.artifactKind === 'authenticated_interaction_reconnaissance' &&
    typeof candidate.recordId === 'string' && UUID_PATTERN.test(candidate.recordId) &&
    typeof candidate.runId === 'string' && UUID_PATTERN.test(candidate.runId) &&
    candidate.platform === 'bilibili' &&
    candidate.accountCategory === 'user_managed' &&
    candidate.pageRole === 'video_detail' &&
    typeof candidate.targetUrlDigest === 'string' && SHA256_PATTERN.test(candidate.targetUrlDigest) &&
    (candidate.actionScope === 'subtitle' || candidate.actionScope === 'discussion' || candidate.actionScope === 'all') &&
    (candidate.state === 'completed' || candidate.state === 'inconclusive' || candidate.state === 'failed') &&
    typeof candidate.startedAt === 'string' &&
    typeof candidate.completedAt === 'string' &&
    Array.isArray(candidate.actions) &&
    Array.isArray(candidate.responseBodyMappings) &&
    Boolean(candidate.baseline) &&
    Boolean(candidate.objective) &&
    candidate.safeguards?.admissionEligible === false &&
    candidate.safeguards?.productionResponseRoutes === 'unchanged_empty' &&
    candidate.safeguards?.cookiesAndTokens === 'not_read'
  );
}

function summary(record: PersistedInteractionReconnaissanceRecord): InteractionReconnaissanceSummary {
  return {
    schemaVersion: 1,
    artifactKind: record.artifactKind,
    recordId: record.recordId,
    runId: record.runId,
    platform: record.platform,
    pageRole: record.pageRole,
    targetUrlDigest: record.targetUrlDigest,
    actionScope: record.actionScope,
    objective: structuredClone(record.objective),
    state: record.state,
    errorCode: record.errorCode,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    actions: record.actions.map((action) => ({
      action: action.action,
      attempted: action.attempted,
      outcome: action.outcome,
      errorCode: action.errorCode
    })),
    responseBodyMappings: record.responseBodyMappings.map((mapping) => {
      const { schemaPaths, ...metadata } = mapping;
      return { ...metadata, schemaPathCount: schemaPaths.length };
    }),
    counters: structuredClone(record.counters),
    safeguards: structuredClone(record.safeguards)
  };
}

export class InteractionReconnaissanceRegistry {
  readonly #registryPath: string;
  #records: PersistedInteractionReconnaissanceRecord[] = [];
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#registryPath = resolve(stateDirectory, 'interaction-reconnaissance-runs.json');
  }

  static async create(stateDirectory: string): Promise<InteractionReconnaissanceRegistry> {
    const registry = new InteractionReconnaissanceRegistry(stateDirectory);
    await mkdir(resolve(stateDirectory), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(registry.#registryPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        registry.#records = parsed.filter(isPersistedRecord).slice(-MAX_PERSISTED_RUNS);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return registry;
  }

  list(): InteractionReconnaissanceSummary[] {
    return this.#records.map(summary);
  }

  get(recordId: string): PersistedInteractionReconnaissanceRecord | null {
    const record = this.#records.find((candidate) => candidate.recordId === recordId);
    return record ? structuredClone(record) : null;
  }

  async record(
    record: BilibiliInteractionReconnaissanceRecord
  ): Promise<PersistedInteractionReconnaissanceRecord> {
    const existing = this.#records.find((candidate) => candidate.runId === record.runId);
    if (existing) return structuredClone(existing);
    const persisted = toPersistedRecord(record);
    const previous = this.#records;
    this.#records = [...this.#records, persisted]
      .sort((left, right) => Date.parse(left.completedAt) - Date.parse(right.completedAt))
      .slice(-MAX_PERSISTED_RUNS);
    try {
      await this.#save();
    } catch (error) {
      this.#records = previous;
      throw error;
    }
    return structuredClone(persisted);
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
}
