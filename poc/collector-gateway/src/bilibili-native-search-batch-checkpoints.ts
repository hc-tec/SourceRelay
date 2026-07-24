import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  BilibiliNativeSearchBatchPageRun,
  BilibiliNativeSearchBatchRunRecord,
  BilibiliNativeSearchBatchTerminalReason,
  BilibiliNativeSearchBatchCheckpointResolutionInput
} from './bilibili-native-search-batch-contract';
import { BILIBILI_NATIVE_SEARCH_BATCH_CHECKPOINT_RESOLUTION_ACKNOWLEDGEMENT } from './bilibili-native-search-batch-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type BilibiliNativeSearchBatchCheckpointState =
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'outcome_unknown';

export interface BilibiliNativeSearchBatchCheckpoint {
  schemaVersion: 1;
  batchId: string;
  profileId: string;
  platform: 'bilibili';
  search: BilibiliNativeSearchBatchRunRecord['search'];
  queryDigest: string;
  state: BilibiliNativeSearchBatchCheckpointState;
  terminalReason: BilibiliNativeSearchBatchTerminalReason | null;
  inFlightPage: number | null;
  pageRuns: BilibiliNativeSearchBatchPageRun[];
  artifactId: string | null;
  /**
   * Local-only disposition for an unknown platform action. Keeping this
   * separate from `state` preserves the fact that the platform outcome was
   * never observed while making the checkpoint terminal and non-resumable.
   */
  resolution: BilibiliNativeSearchBatchCheckpointResolution | null;
  startedAt: string;
  updatedAt: string;
}

export interface BilibiliNativeSearchBatchCheckpointResolution {
  disposition: 'abandon';
  acknowledgement: typeof BILIBILI_NATIVE_SEARCH_BATCH_CHECKPOINT_RESOLUTION_ACKNOWLEDGEMENT;
  resolvedAt: string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function atomicPath(path: string): string {
  return `${path}.${process.pid}.${randomUUID()}.tmp`;
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = atomicPath(path);
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

function isSearch(value: unknown): value is BilibiliNativeSearchBatchRunRecord['search'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliNativeSearchBatchRunRecord['search']>;
  return (candidate.resultType === 'comprehensive' || candidate.resultType === 'video') &&
    (candidate.sort === 'relevance' || candidate.sort === 'newest') &&
    Array.isArray(candidate.pages) && candidate.pages.length >= 1 && candidate.pages.length <= 2 &&
    candidate.pages.every((page) => Number.isSafeInteger(page) && Number(page) >= 1 && Number(page) <= 2);
}

function isPageRun(value: unknown): value is BilibiliNativeSearchBatchPageRun {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliNativeSearchBatchPageRun>;
  return Number.isSafeInteger(candidate.page) && Number(candidate.page) >= 1 && Number(candidate.page) <= 2 &&
    typeof candidate.runId === 'string' && UUID_PATTERN.test(candidate.runId) &&
    typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.terminalReason === 'string' &&
    Number.isSafeInteger(candidate.capturedItems) && Number(candidate.capturedItems) >= 0 &&
    Number.isSafeInteger(candidate.unresolvedCardCount) && Number(candidate.unresolvedCardCount) >= 0;
}

function isResolution(value: unknown): value is BilibiliNativeSearchBatchCheckpointResolution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliNativeSearchBatchCheckpointResolution>;
  return Object.keys(candidate).length === 3 &&
    candidate.disposition === 'abandon' &&
    candidate.acknowledgement === 'acknowledge_unknown_platform_action' &&
    typeof candidate.resolvedAt === 'string' && Number.isFinite(Date.parse(candidate.resolvedAt));
}

function isCheckpoint(value: unknown): value is BilibiliNativeSearchBatchCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliNativeSearchBatchCheckpoint>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.batchId === 'string' && UUID_PATTERN.test(candidate.batchId) &&
    typeof candidate.profileId === 'string' && UUID_PATTERN.test(candidate.profileId) &&
    candidate.platform === 'bilibili' &&
    isSearch(candidate.search) &&
    typeof candidate.queryDigest === 'string' && SHA256_PATTERN.test(candidate.queryDigest) &&
    (candidate.state === 'running' || candidate.state === 'completed' || candidate.state === 'partial' ||
      candidate.state === 'failed' || candidate.state === 'outcome_unknown') &&
    (candidate.terminalReason === null || typeof candidate.terminalReason === 'string') &&
    candidate.inFlightPage !== undefined &&
    (candidate.inFlightPage === null || (Number.isSafeInteger(candidate.inFlightPage) && candidate.inFlightPage >= 1 && candidate.inFlightPage <= 2)) &&
    Array.isArray(candidate.pageRuns) && candidate.pageRuns.every(isPageRun) &&
    (candidate.artifactId === null || (typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId))) &&
    (candidate.resolution === undefined || candidate.resolution === null || isResolution(candidate.resolution)) &&
    typeof candidate.startedAt === 'string' && Number.isFinite(Date.parse(candidate.startedAt)) &&
    typeof candidate.updatedAt === 'string' && Number.isFinite(Date.parse(candidate.updatedAt));
}

function normalizeCheckpoint(value: BilibiliNativeSearchBatchCheckpoint): BilibiliNativeSearchBatchCheckpoint {
  return {
    ...clone(value),
    resolution: value.resolution ?? null
  };
}

export class BilibiliNativeSearchBatchCheckpointStore {
  readonly #indexPath: string;
  readonly #checkpoints = new Map<string, BilibiliNativeSearchBatchCheckpoint>();
  readonly #activeBatchIds = new Set<string>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#indexPath = resolve(stateDirectory, 'bilibili-native-search-batch-checkpoints.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliNativeSearchBatchCheckpointStore> {
    const store = new BilibiliNativeSearchBatchCheckpointStore(stateDirectory);
    await mkdir(resolve(stateDirectory), { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(store.#indexPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        for (const value of parsed) {
          if (isCheckpoint(value)) store.#checkpoints.set(value.batchId, normalizeCheckpoint(value));
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  list(): BilibiliNativeSearchBatchCheckpoint[] {
    return [...this.#checkpoints.values()]
      .map(clone)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  get(batchId: string): BilibiliNativeSearchBatchCheckpoint | null {
    const checkpoint = this.#checkpoints.get(batchId);
    return checkpoint ? clone(checkpoint) : null;
  }

  async start(input: {
    batchId: string;
    profileId: string;
    search: BilibiliNativeSearchBatchRunRecord['search'];
    queryDigest: string;
    startedAt: string;
  }): Promise<BilibiliNativeSearchBatchCheckpoint> {
    if (!UUID_PATTERN.test(input.batchId) || !UUID_PATTERN.test(input.profileId) ||
      !isSearch(input.search) || !SHA256_PATTERN.test(input.queryDigest)) {
      throw new Error('bilibili_native_search_batch_checkpoint_input_invalid');
    }
    if (this.#checkpoints.has(input.batchId)) throw new Error('bilibili_native_search_batch_checkpoint_exists');
    const checkpoint: BilibiliNativeSearchBatchCheckpoint = {
      schemaVersion: 1,
      batchId: input.batchId,
      profileId: input.profileId,
      platform: 'bilibili',
      search: clone(input.search),
      queryDigest: input.queryDigest,
      state: 'running',
      terminalReason: null,
      inFlightPage: null,
      pageRuns: [],
      artifactId: null,
      resolution: null,
      startedAt: input.startedAt,
      updatedAt: input.startedAt
    };
    this.#checkpoints.set(checkpoint.batchId, checkpoint);
    await this.#saveIndex();
    this.#activeBatchIds.add(checkpoint.batchId);
    return clone(checkpoint);
  }

  async markPageStarted(batchId: string, page: number): Promise<BilibiliNativeSearchBatchCheckpoint> {
    return this.#update(batchId, (checkpoint) => {
      if (checkpoint.state !== 'running') throw new Error('bilibili_native_search_batch_checkpoint_not_running');
      if (checkpoint.inFlightPage !== null) throw new Error('bilibili_native_search_batch_checkpoint_in_flight');
      if (!checkpoint.search.pages.includes(page)) throw new Error('bilibili_native_search_batch_checkpoint_page_invalid');
      if (checkpoint.pageRuns.some((run) => run.page === page)) {
        throw new Error('bilibili_native_search_batch_checkpoint_page_already_recorded');
      }
      checkpoint.inFlightPage = page;
    });
  }

  activate(batchId: string): void {
    const checkpoint = this.#checkpoints.get(batchId);
    if (!checkpoint) throw new Error('bilibili_native_search_batch_checkpoint_not_found');
    if (checkpoint.state !== 'running' || checkpoint.inFlightPage !== null) {
      throw new Error('bilibili_native_search_batch_checkpoint_not_running');
    }
    if (this.#activeBatchIds.has(batchId)) {
      throw new Error('bilibili_native_search_batch_checkpoint_active');
    }
    this.#activeBatchIds.add(batchId);
  }

  async recordPage(batchId: string, pageRun: BilibiliNativeSearchBatchPageRun): Promise<BilibiliNativeSearchBatchCheckpoint> {
    return this.#update(batchId, (checkpoint) => {
      if (checkpoint.state !== 'running' || checkpoint.inFlightPage !== pageRun.page) {
        throw new Error('bilibili_native_search_batch_checkpoint_page_state_invalid');
      }
      checkpoint.pageRuns.push(clone(pageRun));
      checkpoint.pageRuns.sort((left, right) => left.page - right.page);
      checkpoint.inFlightPage = null;
    });
  }

  async finish(input: {
    batchId: string;
    state: BilibiliNativeSearchBatchCheckpointState;
    terminalReason: BilibiliNativeSearchBatchTerminalReason;
    artifactId: string | null;
    preserveInFlightPage?: boolean;
  }): Promise<BilibiliNativeSearchBatchCheckpoint> {
    const checkpoint = await this.#update(input.batchId, (checkpoint) => {
      checkpoint.state = input.state;
      checkpoint.terminalReason = input.terminalReason;
      checkpoint.artifactId = input.artifactId;
      if (!input.preserveInFlightPage) checkpoint.inFlightPage = null;
    });
    this.#activeBatchIds.delete(input.batchId);
    return checkpoint;
  }

  async resolveUnknown(
    input: BilibiliNativeSearchBatchCheckpointResolutionInput
  ): Promise<BilibiliNativeSearchBatchCheckpoint> {
    if (this.#activeBatchIds.has(input.batchId)) {
      throw new Error('bilibili_native_search_batch_checkpoint_active');
    }
    return this.#update(input.batchId, (checkpoint) => {
      if (checkpoint.profileId !== input.profileId) {
        throw new Error('bilibili_native_search_batch_checkpoint_profile_mismatch');
      }
      const unresolvedInFlight = checkpoint.state === 'outcome_unknown' ||
        (checkpoint.state === 'running' && checkpoint.inFlightPage !== null);
      if (!unresolvedInFlight || checkpoint.resolution !== null) {
        throw new Error('bilibili_native_search_batch_checkpoint_not_resolvable');
      }
      if (checkpoint.inFlightPage === null) {
        throw new Error('bilibili_native_search_batch_checkpoint_resolution_state_invalid');
      }
      checkpoint.state = 'outcome_unknown';
      checkpoint.resolution = {
        disposition: input.disposition,
        acknowledgement: input.acknowledgement,
        resolvedAt: new Date().toISOString()
      };
    });
  }

  async #update(
    batchId: string,
    update: (checkpoint: BilibiliNativeSearchBatchCheckpoint) => void
  ): Promise<BilibiliNativeSearchBatchCheckpoint> {
    const current = this.#checkpoints.get(batchId);
    if (!current) throw new Error('bilibili_native_search_batch_checkpoint_not_found');
    const next = clone(current);
    update(next);
    next.updatedAt = new Date().toISOString();
    this.#checkpoints.set(batchId, next);
    await this.#saveIndex();
    return clone(next);
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
