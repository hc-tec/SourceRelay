import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type {
  BilibiliCollectionSeriesOverviewProjection,
  BilibiliCollectionSeriesResponseEvidence,
  BilibiliCollectionSeriesRunRecord
} from './bilibili-collection-series-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OVERVIEW_FILE = 'overview.json';
const RESPONSE_EVIDENCE_FILE = 'response-schema.json';

export interface BilibiliCollectionSeriesArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  runId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliCollectionSeriesRunRecord['state'];
  targetUrlDigest: string;
  stableAccountId: string | null;
  declaredListCount: number | null;
  capturedLists: number;
  terminalReason: BilibiliCollectionSeriesRunRecord['coverage']['terminalReason'];
  manifestSha256: string;
}

export interface BilibiliCollectionSeriesArtifactManifest
  extends Omit<BilibiliCollectionSeriesArtifactSummary, 'manifestSha256'> {
  collectorVersion: string;
  strategyCandidate: BilibiliCollectionSeriesRunRecord['strategyCandidate'];
  actions: BilibiliCollectionSeriesRunRecord['actions'];
  coverage: BilibiliCollectionSeriesRunRecord['coverage'];
  overviewFile: typeof OVERVIEW_FILE;
  overviewFileSha256: string;
  responseEvidenceFile: typeof RESPONSE_EVIDENCE_FILE;
  responseEvidenceFileSha256: string;
  safeguards: BilibiliCollectionSeriesRunRecord['safeguards'];
}

export interface BilibiliCollectionSeriesArtifactView {
  summary: BilibiliCollectionSeriesArtifactSummary;
  manifest: BilibiliCollectionSeriesArtifactManifest;
  overview: BilibiliCollectionSeriesOverviewProjection | null;
  responseEvidence: BilibiliCollectionSeriesResponseEvidence | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isSummary(value: unknown): value is BilibiliCollectionSeriesArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliCollectionSeriesArtifactSummary>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId) &&
    typeof candidate.runId === 'string' && UUID_PATTERN.test(candidate.runId) &&
    candidate.platform === 'bilibili' &&
    isIsoDate(candidate.capturedAt) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.targetUrlDigest === 'string' && SHA256_PATTERN.test(candidate.targetUrlDigest) &&
    (candidate.stableAccountId === null ||
      (typeof candidate.stableAccountId === 'string' && /^\d{1,20}$/.test(candidate.stableAccountId))) &&
    (candidate.declaredListCount === null ||
      (typeof candidate.declaredListCount === 'number' && Number.isSafeInteger(candidate.declaredListCount) &&
        candidate.declaredListCount >= 0)) &&
    typeof candidate.capturedLists === 'number' && Number.isSafeInteger(candidate.capturedLists) &&
    candidate.capturedLists >= 0 &&
    typeof candidate.terminalReason === 'string' &&
    typeof candidate.manifestSha256 === 'string' && SHA256_PATTERN.test(candidate.manifestSha256);
}

export class BilibiliCollectionSeriesArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliCollectionSeriesArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-collection-series');
    this.#indexPath = resolve(stateDirectory, 'bilibili-collection-series-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliCollectionSeriesArtifactStore> {
    const store = new BilibiliCollectionSeriesArtifactStore(stateDirectory);
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

  list(): BilibiliCollectionSeriesArtifactSummary[] {
    return [...this.#summaries.values()]
      .map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(run: BilibiliCollectionSeriesRunRecord): Promise<BilibiliCollectionSeriesArtifactSummary> {
    const existing = this.list().find((summary) => summary.runId === run.runId);
    if (existing) return existing;
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const overviewPayload = { schemaVersion: 1, overview: run.overview };
    const responsePayload = { schemaVersion: 1, responseEvidence: run.responseEvidence };
    const overviewFileSha256 = sha256(canonicalJson(overviewPayload));
    const responseEvidenceFileSha256 = sha256(canonicalJson(responsePayload));
    await atomicWrite(resolve(directory, OVERVIEW_FILE), overviewPayload);
    await atomicWrite(resolve(directory, RESPONSE_EVIDENCE_FILE), responsePayload);
    const manifest: BilibiliCollectionSeriesArtifactManifest = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      stableAccountId: run.overview?.stableAccountId ?? null,
      declaredListCount: run.coverage.declaredListCount,
      capturedLists: run.coverage.capturedLists,
      terminalReason: run.coverage.terminalReason,
      collectorVersion: run.collectorVersion,
      strategyCandidate: run.strategyCandidate,
      actions: run.actions,
      coverage: run.coverage,
      overviewFile: OVERVIEW_FILE,
      overviewFileSha256,
      responseEvidenceFile: RESPONSE_EVIDENCE_FILE,
      responseEvidenceFileSha256,
      safeguards: run.safeguards
    };
    const manifestSha256 = sha256(canonicalJson(manifest));
    await atomicWrite(resolve(directory, 'manifest.json'), manifest);
    const summary: BilibiliCollectionSeriesArtifactSummary = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      stableAccountId: run.overview?.stableAccountId ?? null,
      declaredListCount: run.coverage.declaredListCount,
      capturedLists: run.coverage.capturedLists,
      terminalReason: run.coverage.terminalReason,
      manifestSha256
    };
    this.#summaries.set(artifactId, summary);
    await this.#saveIndex();
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<BilibiliCollectionSeriesArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const directory = resolve(this.#rootDirectory, artifactId);
    const manifest = JSON.parse(
      await readFile(resolve(directory, 'manifest.json'), 'utf8')
    ) as BilibiliCollectionSeriesArtifactManifest;
    if (sha256(canonicalJson(manifest)) !== summary.manifestSha256) {
      throw new Error('bilibili_collection_series_manifest_digest_mismatch');
    }
    const overviewPayload = JSON.parse(
      await readFile(resolve(directory, manifest.overviewFile), 'utf8')
    ) as { schemaVersion?: unknown; overview?: BilibiliCollectionSeriesOverviewProjection | null };
    const responsePayload = JSON.parse(
      await readFile(resolve(directory, manifest.responseEvidenceFile), 'utf8')
    ) as { schemaVersion?: unknown; responseEvidence?: BilibiliCollectionSeriesResponseEvidence | null };
    if (
      overviewPayload.schemaVersion !== 1 ||
      !Object.prototype.hasOwnProperty.call(overviewPayload, 'overview') ||
      sha256(canonicalJson(overviewPayload)) !== manifest.overviewFileSha256
    ) throw new Error('bilibili_collection_series_overview_digest_mismatch');
    if (
      responsePayload.schemaVersion !== 1 ||
      !Object.prototype.hasOwnProperty.call(responsePayload, 'responseEvidence') ||
      sha256(canonicalJson(responsePayload)) !== manifest.responseEvidenceFileSha256
    ) throw new Error('bilibili_collection_series_response_evidence_digest_mismatch');
    return {
      summary: structuredClone(summary),
      manifest: structuredClone(manifest),
      overview: structuredClone(overviewPayload.overview ?? null),
      responseEvidence: structuredClone(responsePayload.responseEvidence ?? null)
    };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
