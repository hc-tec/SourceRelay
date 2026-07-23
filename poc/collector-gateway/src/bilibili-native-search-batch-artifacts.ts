import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type {
  BilibiliNativeSearchBatchPageRun,
  BilibiliNativeSearchBatchRunRecord
} from './bilibili-native-search-batch-contract';
import type { BilibiliNativeSearchItem } from './bilibili-native-search-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MERGED_FILE = 'merged.json';

export interface BilibiliNativeSearchBatchArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  batchId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliNativeSearchBatchRunRecord['state'];
  search: BilibiliNativeSearchBatchRunRecord['search'];
  queryDigest: string;
  requestedPages: number;
  capturedPages: number;
  uniqueItems: number;
  duplicateCount: number;
  terminalReason: BilibiliNativeSearchBatchRunRecord['coverage']['terminalReason'];
  manifestSha256: string;
}

export interface BilibiliNativeSearchBatchArtifactManifest
  extends Omit<BilibiliNativeSearchBatchArtifactSummary, 'manifestSha256'> {
  collectorVersion: string;
  strategyCandidate: BilibiliNativeSearchBatchRunRecord['strategyCandidate'];
  pageRuns: BilibiliNativeSearchBatchPageRun[];
  coverage: BilibiliNativeSearchBatchRunRecord['coverage'];
  mergedFile: typeof MERGED_FILE;
  mergedFileSha256: string;
  safeguards: BilibiliNativeSearchBatchRunRecord['safeguards'];
}

export interface BilibiliNativeSearchBatchArtifactView {
  summary: BilibiliNativeSearchBatchArtifactSummary;
  manifest: BilibiliNativeSearchBatchArtifactManifest;
  mergedItems: BilibiliNativeSearchItem[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSearchSelection(value: unknown): value is BilibiliNativeSearchBatchRunRecord['search'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliNativeSearchBatchRunRecord['search']>;
  return (candidate.resultType === 'comprehensive' || candidate.resultType === 'video') &&
    (candidate.sort === 'relevance' || candidate.sort === 'newest') &&
    Array.isArray(candidate.pages) && candidate.pages.length >= 1 && candidate.pages.length <= 2 &&
    candidate.pages.every((page) => Number.isSafeInteger(page) && Number(page) >= 1 && Number(page) <= 2);
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

function isSummary(value: unknown): value is BilibiliNativeSearchBatchArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliNativeSearchBatchArtifactSummary>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId) &&
    typeof candidate.batchId === 'string' && UUID_PATTERN.test(candidate.batchId) &&
    candidate.platform === 'bilibili' &&
    typeof candidate.capturedAt === 'string' && Number.isFinite(Date.parse(candidate.capturedAt)) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    isSearchSelection(candidate.search) &&
    typeof candidate.queryDigest === 'string' && SHA256_PATTERN.test(candidate.queryDigest) &&
    Number.isSafeInteger(candidate.requestedPages) && Number(candidate.requestedPages) >= 1 &&
    Number.isSafeInteger(candidate.capturedPages) && Number(candidate.capturedPages) >= 0 &&
    Number.isSafeInteger(candidate.uniqueItems) && Number(candidate.uniqueItems) >= 0 &&
    Number.isSafeInteger(candidate.duplicateCount) && Number(candidate.duplicateCount) >= 0 &&
    typeof candidate.terminalReason === 'string' &&
    typeof candidate.manifestSha256 === 'string' && SHA256_PATTERN.test(candidate.manifestSha256);
}

function compactSummary(
  manifest: BilibiliNativeSearchBatchArtifactManifest,
  manifestSha256: string
): BilibiliNativeSearchBatchArtifactSummary {
  return {
    schemaVersion: 1,
    artifactId: manifest.artifactId,
    batchId: manifest.batchId,
    platform: manifest.platform,
    capturedAt: manifest.capturedAt,
    state: manifest.state,
    search: manifest.search,
    queryDigest: manifest.queryDigest,
    requestedPages: manifest.requestedPages,
    capturedPages: manifest.capturedPages,
    uniqueItems: manifest.uniqueItems,
    duplicateCount: manifest.duplicateCount,
    terminalReason: manifest.terminalReason,
    manifestSha256
  };
}

export class BilibiliNativeSearchBatchArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliNativeSearchBatchArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-native-search-batches');
    this.#indexPath = resolve(stateDirectory, 'bilibili-native-search-batch-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliNativeSearchBatchArtifactStore> {
    const store = new BilibiliNativeSearchBatchArtifactStore(stateDirectory);
    await mkdir(store.#rootDirectory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(store.#indexPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        for (const summary of parsed.filter(isSummary)) store.#summaries.set(summary.artifactId, summary);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  list(): BilibiliNativeSearchBatchArtifactSummary[] {
    return [...this.#summaries.values()]
      .map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(run: BilibiliNativeSearchBatchRunRecord): Promise<BilibiliNativeSearchBatchArtifactSummary> {
    const existing = this.list().find((summary) => summary.batchId === run.batchId);
    if (existing) return existing;
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const mergedPayload = { schemaVersion: 1, mergedItems: run.mergedItems };
    const mergedFileSha256 = sha256(canonicalJson(mergedPayload));
    await atomicWrite(resolve(directory, MERGED_FILE), mergedPayload);
    const manifest: BilibiliNativeSearchBatchArtifactManifest = {
      schemaVersion: 1,
      artifactId,
      batchId: run.batchId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      search: run.search,
      queryDigest: run.queryDigest,
      requestedPages: run.coverage.requestedPages,
      capturedPages: run.coverage.capturedPages,
      uniqueItems: run.coverage.uniqueItems,
      duplicateCount: run.coverage.duplicateCount,
      terminalReason: run.coverage.terminalReason,
      collectorVersion: run.collectorVersion,
      strategyCandidate: run.strategyCandidate,
      pageRuns: run.pageRuns,
      coverage: run.coverage,
      mergedFile: MERGED_FILE,
      mergedFileSha256,
      safeguards: run.safeguards
    };
    const manifestSha256 = sha256(canonicalJson(manifest));
    await atomicWrite(resolve(directory, 'manifest.json'), manifest);
    const summary = compactSummary(manifest, manifestSha256);
    this.#summaries.set(summary.artifactId, summary);
    await this.#saveIndex();
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<BilibiliNativeSearchBatchArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const directory = resolve(this.#rootDirectory, artifactId);
    const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')) as BilibiliNativeSearchBatchArtifactManifest;
    if (sha256(canonicalJson(manifest)) !== summary.manifestSha256) {
      throw new Error('bilibili_native_search_batch_manifest_digest_mismatch');
    }
    if (manifest.mergedFile !== MERGED_FILE || !manifest.mergedFileSha256) {
      throw new Error('bilibili_native_search_batch_reference_invalid');
    }
    const payload = JSON.parse(await readFile(resolve(directory, manifest.mergedFile), 'utf8')) as {
      schemaVersion?: unknown;
      mergedItems?: BilibiliNativeSearchItem[];
    };
    if (payload.schemaVersion !== 1 || !Array.isArray(payload.mergedItems) ||
      sha256(canonicalJson(payload)) !== manifest.mergedFileSha256) {
      throw new Error('bilibili_native_search_batch_merged_digest_mismatch');
    }
    return {
      summary: structuredClone(summary),
      manifest: structuredClone(manifest),
      mergedItems: structuredClone(payload.mergedItems)
    };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
