import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type {
  BilibiliAccountVideoDetailMaterializationRunRecord,
  BilibiliAccountVideoDetailMaterializationTerminalReason
} from './bilibili-account-video-detail-materialization-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface BilibiliAccountVideoDetailMaterializationArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  runId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliAccountVideoDetailMaterializationRunRecord['state'];
  sourceArtifactId: string;
  sourceManifestSha256: string;
  requestedDetails: number;
  completedDetails: number;
  partialDetails: number;
  failedDetails: number;
  notAttemptedDetails: number;
  terminalReason: BilibiliAccountVideoDetailMaterializationTerminalReason;
  manifestSha256: string;
}

export interface BilibiliAccountVideoDetailMaterializationArtifactManifest
  extends Omit<BilibiliAccountVideoDetailMaterializationArtifactSummary, 'manifestSha256'> {
  collectorVersion: string;
  source: BilibiliAccountVideoDetailMaterializationRunRecord['source'];
  items: BilibiliAccountVideoDetailMaterializationRunRecord['items'];
  coverage: BilibiliAccountVideoDetailMaterializationRunRecord['coverage'];
  safeguards: BilibiliAccountVideoDetailMaterializationRunRecord['safeguards'];
  errorCode: string | null;
  startedAt: string;
}

export interface BilibiliAccountVideoDetailMaterializationArtifactView {
  summary: BilibiliAccountVideoDetailMaterializationArtifactSummary;
  manifest: BilibiliAccountVideoDetailMaterializationArtifactManifest;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 3;
}

function isSummary(value: unknown): value is BilibiliAccountVideoDetailMaterializationArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliAccountVideoDetailMaterializationArtifactSummary>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId) &&
    typeof candidate.runId === 'string' && UUID_PATTERN.test(candidate.runId) &&
    candidate.platform === 'bilibili' &&
    typeof candidate.capturedAt === 'string' && Number.isFinite(Date.parse(candidate.capturedAt)) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.sourceArtifactId === 'string' && UUID_PATTERN.test(candidate.sourceArtifactId) &&
    typeof candidate.sourceManifestSha256 === 'string' && SHA256_PATTERN.test(candidate.sourceManifestSha256) &&
    validCount(candidate.requestedDetails) &&
    validCount(candidate.completedDetails) &&
    validCount(candidate.partialDetails) &&
    validCount(candidate.failedDetails) &&
    validCount(candidate.notAttemptedDetails) &&
    typeof candidate.terminalReason === 'string' &&
    typeof candidate.manifestSha256 === 'string' && SHA256_PATTERN.test(candidate.manifestSha256);
}

function compactSummary(
  manifest: BilibiliAccountVideoDetailMaterializationArtifactManifest,
  manifestSha256: string
): BilibiliAccountVideoDetailMaterializationArtifactSummary {
  return {
    schemaVersion: manifest.schemaVersion,
    artifactId: manifest.artifactId,
    runId: manifest.runId,
    platform: manifest.platform,
    capturedAt: manifest.capturedAt,
    state: manifest.state,
    sourceArtifactId: manifest.sourceArtifactId,
    sourceManifestSha256: manifest.sourceManifestSha256,
    requestedDetails: manifest.requestedDetails,
    completedDetails: manifest.completedDetails,
    partialDetails: manifest.partialDetails,
    failedDetails: manifest.failedDetails,
    notAttemptedDetails: manifest.notAttemptedDetails,
    terminalReason: manifest.terminalReason,
    manifestSha256
  };
}

export class BilibiliAccountVideoDetailMaterializationArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliAccountVideoDetailMaterializationArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-account-video-detail-materializations');
    this.#indexPath = resolve(stateDirectory, 'bilibili-account-video-detail-materialization-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliAccountVideoDetailMaterializationArtifactStore> {
    const store = new BilibiliAccountVideoDetailMaterializationArtifactStore(stateDirectory);
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

  list(): BilibiliAccountVideoDetailMaterializationArtifactSummary[] {
    return [...this.#summaries.values()].map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(
    run: BilibiliAccountVideoDetailMaterializationRunRecord
  ): Promise<BilibiliAccountVideoDetailMaterializationArtifactSummary> {
    const existing = this.list().find((summary) => summary.runId === run.runId);
    if (existing) return existing;
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const manifest: BilibiliAccountVideoDetailMaterializationArtifactManifest = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      sourceArtifactId: run.source.sourceArtifactId,
      sourceManifestSha256: run.source.sourceManifestSha256,
      requestedDetails: run.coverage.requestedDetails,
      completedDetails: run.coverage.completedDetails,
      partialDetails: run.coverage.partialDetails,
      failedDetails: run.coverage.failedDetails,
      notAttemptedDetails: run.coverage.notAttemptedDetails,
      terminalReason: run.coverage.terminalReason,
      collectorVersion: run.collectorVersion,
      source: run.source,
      items: run.items,
      coverage: run.coverage,
      safeguards: run.safeguards,
      errorCode: run.errorCode,
      startedAt: run.startedAt
    };
    const manifestSha256 = sha256(canonicalJson(manifest));
    await atomicWrite(resolve(directory, 'manifest.json'), manifest);
    const summary = compactSummary(manifest, manifestSha256);
    this.#summaries.set(summary.artifactId, summary);
    await this.#saveIndex();
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<BilibiliAccountVideoDetailMaterializationArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const manifest = JSON.parse(
      await readFile(resolve(this.#rootDirectory, artifactId, 'manifest.json'), 'utf8')
    ) as BilibiliAccountVideoDetailMaterializationArtifactManifest;
    if (sha256(canonicalJson(manifest)) !== summary.manifestSha256) {
      throw new Error('bilibili_account_video_detail_materialization_manifest_digest_mismatch');
    }
    return { summary: structuredClone(summary), manifest: structuredClone(manifest) };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
