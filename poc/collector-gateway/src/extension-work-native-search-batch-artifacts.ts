import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  BilibiliNativeSearchBatchPageObservation,
  BilibiliNativeSearchBatchWorkItem,
  BilibiliNativeSearchBatchWorkResult
} from '@intelligence/collector-contracts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ARTIFACT_BYTES = 128 * 1024;

export interface NativeSearchBatchDirectArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  operationId: string;
  capability: 'bilibili.native_search_batch';
  state: BilibiliNativeSearchBatchWorkResult['state'];
  capturedAt: string;
  itemCount: number;
  capturedPages: number;
  sha256: string;
}

export interface NativeSearchBatchDirectArtifactView {
  schemaVersion: 1;
  summary: NativeSearchBatchDirectArtifactSummary;
  provenance: {
    environment: 'user_owned_browser_extension';
    executionTarget: 'collector_work_tab';
    captureMode: 'bounded_multi_page_dom_projection';
    responseBodies: 'not_read';
    semanticActions: 0;
    platformNavigations: 0 | 1 | 2;
    workTabAcquisition: BilibiliNativeSearchBatchWorkResult['workTabAcquisition'];
    workTabDisposition: BilibiliNativeSearchBatchWorkResult['workTabDisposition'];
  };
  search: {
    resultType: 'comprehensive';
    sort: 'relevance';
    requestedPages: [1, 2];
    observedPages: Array<1 | 2>;
    queryDigest: string;
  };
  actions: Array<{
    actionId: 'open_fixed_native_search_page_1' | 'open_fixed_native_search_page_2';
    page: 1 | 2;
    attempted: boolean;
    attemptCount: 0 | 1;
    outcome: 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
    errorCode: string | null;
  }>;
  result: {
    state: BilibiliNativeSearchBatchWorkResult['state'];
    errorCode: string | null;
    terminalReason: BilibiliNativeSearchBatchWorkResult['terminalReason'];
    completedAt: string;
    navigation: BilibiliNativeSearchBatchWorkResult['navigation'];
    observation: BilibiliNativeSearchBatchWorkResult['observation'];
  };
}

interface StoredArtifact extends NativeSearchBatchDirectArtifactView {}

/**
 * Direct deployment owns a separate batch-artifact family so an upper
 * application cannot accidentally receive an isolated Browser Host artifact.
 */
export class ExtensionWorkNativeSearchBatchArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, NativeSearchBatchDirectArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'extension-work-native-search-batch-artifacts');
    this.#indexPath = resolve(stateDirectory, 'extension-work-native-search-batch-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<ExtensionWorkNativeSearchBatchArtifactStore> {
    const store = new ExtensionWorkNativeSearchBatchArtifactStore(stateDirectory);
    await mkdir(store.#rootDirectory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(store.#indexPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        for (const summary of parsed) if (isSummary(summary)) store.#summaries.set(summary.artifactId, summary);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  list(): NativeSearchBatchDirectArtifactSummary[] {
    return [...this.#summaries.values()]
      .map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(input: {
    item: BilibiliNativeSearchBatchWorkItem;
    result: BilibiliNativeSearchBatchWorkResult;
  }): Promise<NativeSearchBatchDirectArtifactSummary> {
    const existing = this.list().find((summary) => summary.operationId === input.item.operationId);
    if (existing) return existing;
    if (input.item.operationId !== input.result.operationId || input.item.capability !== input.result.capability) {
      throw new Error('extension_work_native_search_batch_artifact_binding_invalid');
    }
    const artifactId = randomUUID();
    const observedPages = input.result.observation?.pages.map((page) => page.page) ?? [];
    const draft = {
      schemaVersion: 1 as const,
      artifactId,
      operationId: input.item.operationId,
      capability: 'bilibili.native_search_batch' as const,
      state: input.result.state,
      capturedAt: input.result.completedAt,
      itemCount: uniqueResolvedBvidCount(input.result.observation),
      capturedPages: observedPages.length,
      provenance: {
        environment: 'user_owned_browser_extension' as const,
        executionTarget: 'collector_work_tab' as const,
        captureMode: 'bounded_multi_page_dom_projection' as const,
        responseBodies: 'not_read' as const,
        semanticActions: 0 as const,
        platformNavigations: input.result.navigation.attemptCount,
        workTabAcquisition: input.result.workTabAcquisition,
        workTabDisposition: input.result.workTabDisposition
      },
      search: {
        resultType: 'comprehensive' as const,
        sort: 'relevance' as const,
        requestedPages: [1, 2] as [1, 2],
        observedPages,
        queryDigest: sha256(input.item.input.query)
      },
      actions: actionLedger(input.item, input.result),
      result: {
        state: input.result.state,
        errorCode: input.result.errorCode,
        terminalReason: input.result.terminalReason,
        completedAt: input.result.completedAt,
        navigation: structuredClone(input.result.navigation),
        observation: structuredClone(input.result.observation)
      }
    };
    const digest = sha256(canonicalJson(draft));
    const stored: StoredArtifact = {
      ...draft,
      summary: {
        schemaVersion: 1,
        artifactId,
        operationId: input.item.operationId,
        capability: 'bilibili.native_search_batch',
        state: input.result.state,
        capturedAt: input.result.completedAt,
        itemCount: uniqueResolvedBvidCount(input.result.observation),
        capturedPages: observedPages.length,
        sha256: digest
      }
    };
    const serialized = `${JSON.stringify(stored, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_ARTIFACT_BYTES) {
      throw new Error('extension_work_native_search_batch_artifact_payload_too_large');
    }
    await atomicWrite(resolve(this.#rootDirectory, `${artifactId}.json`), stored);
    this.#summaries.set(artifactId, stored.summary);
    await this.#saveIndex();
    return structuredClone(stored.summary);
  }

  async get(artifactId: string): Promise<NativeSearchBatchDirectArtifactView | null> {
    if (!UUID_PATTERN.test(artifactId)) throw new Error('extension_work_native_search_batch_artifact_invalid');
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const path = resolve(this.#rootDirectory, `${artifactId}.json`);
    const stored = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!isStoredArtifact(stored) || stored.summary.artifactId !== artifactId) {
      throw new Error('extension_work_native_search_batch_artifact_corrupt');
    }
    const { summary: storedSummary, ...draft } = stored;
    if (sha256(canonicalJson(draft)) !== storedSummary.sha256) {
      throw new Error('extension_work_native_search_batch_artifact_digest_mismatch');
    }
    return structuredClone(stored);
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}

function actionLedger(
  item: BilibiliNativeSearchBatchWorkItem,
  result: BilibiliNativeSearchBatchWorkResult
): NativeSearchBatchDirectArtifactView['actions'] {
  return item.input.targets.map((target, index) => {
    const attempted = result.navigation.attemptCount > index;
    const observed = result.observation?.pages.find((page) => page.page === target.page) ?? null;
    return {
      actionId: target.page === 1 ? 'open_fixed_native_search_page_1' as const : 'open_fixed_native_search_page_2' as const,
      page: target.page,
      attempted,
      attemptCount: attempted ? 1 as const : 0 as const,
      outcome: actionOutcome(result, observed, attempted),
      errorCode: attempted && observed === null && result.errorCode ? result.errorCode : null
    };
  });
}

function actionOutcome(
  result: BilibiliNativeSearchBatchWorkResult,
  observed: BilibiliNativeSearchBatchPageObservation | null,
  attempted: boolean
): NativeSearchBatchDirectArtifactView['actions'][number]['outcome'] {
  if (!attempted) return 'prerequisite_unmet';
  if (result.terminalReason === 'verification_required' || result.terminalReason === 'rate_limited') return 'risk_stopped';
  if (observed && (observed.resultListVisible || observed.emptyStateVisible)) return 'completed';
  if (result.terminalReason === 'source_unavailable' || result.terminalReason === 'search_batch_page_partial' ||
    result.terminalReason === 'dom_projection_failed' || result.terminalReason === 'document_context_changed' ||
    result.terminalReason === 'run_deadline_exceeded'
  ) return 'postcondition_unmet';
  return 'failed';
}

function uniqueResolvedBvidCount(observation: BilibiliNativeSearchBatchWorkResult['observation']): number {
  return new Set(observation?.pages.flatMap((page) => page.cards.map((card) => card.bvid).filter((bvid): bvid is string => bvid !== null)) ?? []).size;
}

function isSummary(value: unknown): value is NativeSearchBatchDirectArtifactSummary {
  return isRecord(value) && value.schemaVersion === 1 && typeof value.artifactId === 'string' && UUID_PATTERN.test(value.artifactId) &&
    typeof value.operationId === 'string' && UUID_PATTERN.test(value.operationId) && value.capability === 'bilibili.native_search_batch' &&
    isState(value.state) && isTimestamp(value.capturedAt) && isNonNegativeInteger(value.itemCount) &&
    isNonNegativeInteger(value.capturedPages) && value.capturedPages <= 2 && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256);
}

function isStoredArtifact(value: unknown): value is StoredArtifact {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isSummary(value.summary) || !isRecord(value.provenance) ||
    !isRecord(value.search) || !Array.isArray(value.actions) || !isRecord(value.result)
  ) return false;
  return value.artifactId === value.summary.artifactId && value.operationId === value.summary.operationId &&
    value.capability === 'bilibili.native_search_batch' && value.state === value.summary.state &&
    value.capturedAt === value.summary.capturedAt && value.provenance.environment === 'user_owned_browser_extension' &&
    value.provenance.executionTarget === 'collector_work_tab' && value.provenance.captureMode === 'bounded_multi_page_dom_projection' &&
    value.provenance.responseBodies === 'not_read' && value.provenance.semanticActions === 0 &&
    (value.provenance.platformNavigations === 0 || value.provenance.platformNavigations === 1 || value.provenance.platformNavigations === 2) &&
    value.search.resultType === 'comprehensive' && value.search.sort === 'relevance' &&
    Array.isArray(value.search.requestedPages) && value.search.requestedPages.length === 2 &&
    value.search.requestedPages[0] === 1 && value.search.requestedPages[1] === 2 &&
    Array.isArray(value.search.observedPages) && value.search.observedPages.every((page: unknown) => page === 1 || page === 2) &&
    typeof value.search.queryDigest === 'string' && /^[a-f0-9]{64}$/.test(value.search.queryDigest);
}

function isState(value: unknown): value is BilibiliNativeSearchBatchWorkResult['state'] {
  return value === 'completed' || value === 'partial' || value === 'stopped' || value === 'failed';
}

function isTimestamp(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}
