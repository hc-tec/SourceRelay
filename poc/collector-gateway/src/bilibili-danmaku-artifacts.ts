import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type { BilibiliDanmakuRunRecord } from './bilibili-danmaku-contract';

const RUN_FILE = 'run.json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export interface BilibiliDanmakuArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  runId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliDanmakuRunRecord['state'];
  targetUrlDigest: string;
  bvid: string;
  rowCount: number;
  totalEstimate: number | null;
  terminalReason: BilibiliDanmakuRunRecord['coverage']['terminalReason'];
  runFileSha256: string;
  manifestSha256: string;
}

export interface BilibiliDanmakuArtifactManifest extends BilibiliDanmakuArtifactSummary {
  collectorVersion: string;
  strategyCandidate: BilibiliDanmakuRunRecord['strategyCandidate'];
  coverage: BilibiliDanmakuRunRecord['coverage'];
  safeguards: BilibiliDanmakuRunRecord['safeguards'];
  runFile: typeof RUN_FILE;
}

export interface BilibiliDanmakuArtifactView {
  summary: BilibiliDanmakuArtifactSummary;
  manifest: BilibiliDanmakuArtifactManifest;
  run: BilibiliDanmakuRunRecord;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

function isSummary(value: unknown): value is BilibiliDanmakuArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliDanmakuArtifactSummary>;
  return candidate.schemaVersion === 1 && typeof candidate.artifactId === 'string' && UUID.test(candidate.artifactId) &&
    typeof candidate.runId === 'string' && UUID.test(candidate.runId) && candidate.platform === 'bilibili' &&
    typeof candidate.capturedAt === 'string' && Number.isFinite(Date.parse(candidate.capturedAt)) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.targetUrlDigest === 'string' && SHA256.test(candidate.targetUrlDigest) &&
    typeof candidate.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(candidate.bvid) &&
    Number.isSafeInteger(candidate.rowCount) && Number(candidate.rowCount) >= 0 &&
    (candidate.totalEstimate === null || (Number.isSafeInteger(candidate.totalEstimate) && Number(candidate.totalEstimate) >= 0)) &&
    typeof candidate.terminalReason === 'string' && typeof candidate.runFileSha256 === 'string' && SHA256.test(candidate.runFileSha256) &&
    typeof candidate.manifestSha256 === 'string' && SHA256.test(candidate.manifestSha256);
}

export class BilibiliDanmakuArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliDanmakuArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-danmaku');
    this.#indexPath = resolve(stateDirectory, 'bilibili-danmaku-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliDanmakuArtifactStore> {
    const store = new BilibiliDanmakuArtifactStore(stateDirectory);
    await mkdir(store.#rootDirectory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(store.#indexPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) for (const summary of parsed.filter(isSummary).slice(0, 500)) store.#summaries.set(summary.artifactId, summary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  list(): BilibiliDanmakuArtifactSummary[] {
    return [...this.#summaries.values()].map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(run: BilibiliDanmakuRunRecord): Promise<BilibiliDanmakuArtifactSummary> {
    const existing = this.list().find((summary) => summary.runId === run.runId);
    if (existing) return existing;
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const runPayload = { schemaVersion: 1, run };
    const runFileSha256 = sha256(canonicalJson(runPayload));
    await atomicWrite(resolve(directory, RUN_FILE), runPayload);
    const unsignedManifest = {
      schemaVersion: 1 as const,
      artifactId,
      runId: run.runId,
      platform: 'bilibili' as const,
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      bvid: run.bvid,
      rowCount: run.rows.length,
      totalEstimate: run.coverage.totalEstimate,
      terminalReason: run.coverage.terminalReason,
      runFileSha256,
      collectorVersion: run.collectorVersion,
      strategyCandidate: run.strategyCandidate,
      coverage: run.coverage,
      safeguards: run.safeguards,
      runFile: RUN_FILE as const
    };
    const manifest: BilibiliDanmakuArtifactManifest = {
      ...unsignedManifest,
      manifestSha256: sha256(canonicalJson(unsignedManifest))
    };
    await atomicWrite(resolve(directory, 'manifest.json'), manifest);
    const summary: BilibiliDanmakuArtifactSummary = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      bvid: run.bvid,
      rowCount: run.rows.length,
      totalEstimate: run.coverage.totalEstimate,
      terminalReason: run.coverage.terminalReason,
      runFileSha256,
      manifestSha256: manifest.manifestSha256
    };
    this.#summaries.set(artifactId, summary);
    await this.#saveIndex();
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<BilibiliDanmakuArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const directory = resolve(this.#rootDirectory, artifactId);
    const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')) as BilibiliDanmakuArtifactManifest;
    const { manifestSha256, ...unsigned } = manifest;
    if (sha256(canonicalJson(unsigned)) !== manifestSha256 || manifestSha256 !== summary.manifestSha256) {
      throw new Error('bilibili_danmaku_manifest_digest_mismatch');
    }
    const payload = JSON.parse(await readFile(resolve(directory, RUN_FILE), 'utf8')) as { schemaVersion?: unknown; run?: BilibiliDanmakuRunRecord };
    if (payload.schemaVersion !== 1 || !payload.run || sha256(canonicalJson(payload)) !== summary.runFileSha256) {
      throw new Error('bilibili_danmaku_run_digest_mismatch');
    }
    return { summary: structuredClone(summary), manifest: structuredClone(manifest), run: structuredClone(payload.run) };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list().slice(0, 500)));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
