import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type { BilibiliTranscriptRunRecord } from './bilibili-transcript-contract';

const RUN_FILE = 'run.json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export interface BilibiliTranscriptArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  runId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliTranscriptRunRecord['state'];
  targetUrlDigest: string;
  bvid: string;
  language: string | null;
  segmentCount: number;
  terminalReason: BilibiliTranscriptRunRecord['coverage']['terminalReason'];
  runFileSha256: string;
  manifestSha256: string;
}

export interface BilibiliTranscriptArtifactManifest extends BilibiliTranscriptArtifactSummary {
  collectorVersion: string;
  strategyCandidate: BilibiliTranscriptRunRecord['strategyCandidate'];
  coverage: BilibiliTranscriptRunRecord['coverage'];
  safeguards: BilibiliTranscriptRunRecord['safeguards'];
  runFile: typeof RUN_FILE;
}

export interface BilibiliTranscriptArtifactView {
  summary: BilibiliTranscriptArtifactSummary;
  manifest: BilibiliTranscriptArtifactManifest;
  run: BilibiliTranscriptRunRecord;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

function isSummary(value: unknown): value is BilibiliTranscriptArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliTranscriptArtifactSummary>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.artifactId === 'string' && UUID.test(candidate.artifactId) &&
    typeof candidate.runId === 'string' && UUID.test(candidate.runId) &&
    candidate.platform === 'bilibili' &&
    typeof candidate.capturedAt === 'string' && Number.isFinite(Date.parse(candidate.capturedAt)) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.targetUrlDigest === 'string' && SHA256.test(candidate.targetUrlDigest) &&
    typeof candidate.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(candidate.bvid) &&
    (candidate.language === null || typeof candidate.language === 'string') &&
    Number.isSafeInteger(candidate.segmentCount) && Number(candidate.segmentCount) >= 0 &&
    typeof candidate.terminalReason === 'string' &&
    typeof candidate.runFileSha256 === 'string' && SHA256.test(candidate.runFileSha256) &&
    typeof candidate.manifestSha256 === 'string' && SHA256.test(candidate.manifestSha256);
}

export class BilibiliTranscriptArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliTranscriptArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-transcript');
    this.#indexPath = resolve(stateDirectory, 'bilibili-transcript-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliTranscriptArtifactStore> {
    const store = new BilibiliTranscriptArtifactStore(stateDirectory);
    await mkdir(store.#rootDirectory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(store.#indexPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        for (const summary of parsed.filter(isSummary).slice(0, 500)) store.#summaries.set(summary.artifactId, summary);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  list(): BilibiliTranscriptArtifactSummary[] {
    return [...this.#summaries.values()]
      .map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(run: BilibiliTranscriptRunRecord): Promise<BilibiliTranscriptArtifactSummary> {
    const existing = this.list().find((summary) => summary.runId === run.runId);
    if (existing) return existing;
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const runPayload = { schemaVersion: 1, run };
    const runFileSha256 = sha256(canonicalJson(runPayload));
    await atomicWrite(resolve(directory, RUN_FILE), runPayload);
    const base = {
      schemaVersion: 1 as const,
      artifactId,
      runId: run.runId,
      platform: 'bilibili' as const,
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      bvid: run.bvid,
      language: run.coverage.language,
      segmentCount: run.coverage.segmentCount,
      terminalReason: run.coverage.terminalReason,
      runFileSha256
    };
    const manifestWithoutHash = {
      ...base,
      collectorVersion: run.collectorVersion,
      strategyCandidate: run.strategyCandidate,
      coverage: run.coverage,
      safeguards: run.safeguards,
      runFile: RUN_FILE
    };
    const manifest: BilibiliTranscriptArtifactManifest = {
      ...manifestWithoutHash,
      manifestSha256: sha256(canonicalJson(manifestWithoutHash))
    };
    await atomicWrite(resolve(directory, 'manifest.json'), manifest);
    const summary: BilibiliTranscriptArtifactSummary = {
      ...base,
      manifestSha256: manifest.manifestSha256
    };
    this.#summaries.set(artifactId, summary);
    await this.#saveIndex();
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<BilibiliTranscriptArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const directory = resolve(this.#rootDirectory, artifactId);
    const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')) as BilibiliTranscriptArtifactManifest;
    const { manifestSha256, ...unsignedManifest } = manifest;
    if (sha256(canonicalJson(unsignedManifest)) !== manifestSha256 || manifestSha256 !== summary.manifestSha256) {
      throw new Error('bilibili_transcript_manifest_digest_mismatch');
    }
    const payload = JSON.parse(await readFile(resolve(directory, RUN_FILE), 'utf8')) as {
      schemaVersion?: unknown;
      run?: BilibiliTranscriptRunRecord;
    };
    if (payload.schemaVersion !== 1 || !payload.run || sha256(canonicalJson(payload)) !== summary.runFileSha256) {
      throw new Error('bilibili_transcript_run_digest_mismatch');
    }
    return {
      summary: structuredClone(summary),
      manifest: structuredClone(manifest),
      run: structuredClone(payload.run)
    };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list().slice(0, 500)));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
