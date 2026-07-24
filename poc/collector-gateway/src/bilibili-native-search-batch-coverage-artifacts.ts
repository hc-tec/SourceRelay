import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type { BilibiliNativeSearchBatchRunRecord } from './bilibili-native-search-batch-contract';
import type {
  BilibiliNativeSearchBatchCoverageArtifactManifest,
  BilibiliNativeSearchBatchCoverageArtifactSummary,
  BilibiliNativeSearchBatchCoverageArtifactView,
  BilibiliNativeSearchBatchCoverageComputation
} from './bilibili-native-search-batch-coverage';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSearch(value: unknown): value is BilibiliNativeSearchBatchRunRecord['search'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliNativeSearchBatchRunRecord['search']>;
  return (candidate.resultType === 'comprehensive' || candidate.resultType === 'video') &&
    (candidate.sort === 'relevance' || candidate.sort === 'newest') &&
    Array.isArray(candidate.pages) && candidate.pages.length >= 1 && candidate.pages.length <= 2 &&
    candidate.pages.every((page) => Number.isSafeInteger(page) && page >= 1 && page <= 2);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isSummary(value: unknown): value is BilibiliNativeSearchBatchCoverageArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliNativeSearchBatchCoverageArtifactSummary>;
  return candidate.schemaVersion === 1 && typeof candidate.coverageId === 'string' && UUID_PATTERN.test(candidate.coverageId) &&
    candidate.platform === 'bilibili' && typeof candidate.capturedAt === 'string' && Number.isFinite(Date.parse(candidate.capturedAt)) &&
    typeof candidate.queryDigest === 'string' && SHA256_PATTERN.test(candidate.queryDigest) && isSearch(candidate.search) &&
    Array.isArray(candidate.sampleArtifactIds) && candidate.sampleArtifactIds.length >= 2 && candidate.sampleArtifactIds.length <= 5 &&
    candidate.sampleArtifactIds.every((artifactId) => typeof artifactId === 'string' && UUID_PATTERN.test(artifactId)) &&
    typeof candidate.sampleCount === 'number' && Number.isSafeInteger(candidate.sampleCount) && candidate.sampleCount >= 2 && candidate.sampleCount <= 5 &&
    typeof candidate.pairCount === 'number' && Number.isSafeInteger(candidate.pairCount) && candidate.pairCount >= 1 &&
    isNumber(candidate.meanOverlapRate) && isNumber(candidate.meanJaccardRate) && isNumber(candidate.meanDriftRate) &&
    typeof candidate.manifestSha256 === 'string' && SHA256_PATTERN.test(candidate.manifestSha256);
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

export class BilibiliNativeSearchBatchCoverageArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliNativeSearchBatchCoverageArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-native-search-batch-coverages');
    this.#indexPath = resolve(stateDirectory, 'bilibili-native-search-batch-coverage-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliNativeSearchBatchCoverageArtifactStore> {
    const store = new BilibiliNativeSearchBatchCoverageArtifactStore(stateDirectory);
    await mkdir(store.#rootDirectory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(store.#indexPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        for (const summary of parsed.filter(isSummary)) store.#summaries.set(summary.coverageId, summary);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  list(): BilibiliNativeSearchBatchCoverageArtifactSummary[] {
    return [...this.#summaries.values()]
      .map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(
    computation: BilibiliNativeSearchBatchCoverageComputation
  ): Promise<BilibiliNativeSearchBatchCoverageArtifactSummary> {
    const coverageId = randomUUID();
    const directory = resolve(this.#rootDirectory, coverageId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const manifest: BilibiliNativeSearchBatchCoverageArtifactManifest = {
      ...structuredClone(computation),
      coverageId
    };
    const manifestSha256 = sha256(canonicalJson(manifest));
    const summary: BilibiliNativeSearchBatchCoverageArtifactSummary = {
      schemaVersion: 1,
      coverageId,
      platform: manifest.platform,
      capturedAt: manifest.capturedAt,
      queryDigest: manifest.queryDigest,
      search: manifest.search,
      sampleArtifactIds: manifest.sampleArtifactIds,
      sampleCount: manifest.sampleCount,
      pairCount: manifest.pairCount,
      meanOverlapRate: manifest.aggregate.meanOverlapRate,
      meanJaccardRate: manifest.aggregate.meanJaccardRate,
      meanDriftRate: manifest.aggregate.meanDriftRate,
      manifestSha256
    };
    await atomicWrite(resolve(directory, 'manifest.json'), manifest);
    this.#summaries.set(coverageId, summary);
    await this.#saveIndex();
    return structuredClone(summary);
  }

  async get(coverageId: string): Promise<BilibiliNativeSearchBatchCoverageArtifactView | null> {
    const summary = this.#summaries.get(coverageId);
    if (!summary) return null;
    const manifest = JSON.parse(await readFile(
      resolve(this.#rootDirectory, coverageId, 'manifest.json'), 'utf8'
    )) as BilibiliNativeSearchBatchCoverageArtifactManifest;
    if (sha256(canonicalJson(manifest)) !== summary.manifestSha256) {
      throw new Error('bilibili_native_search_batch_coverage_manifest_digest_mismatch');
    }
    return { summary: structuredClone(summary), manifest: structuredClone(manifest) };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
