import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type {
  BilibiliAccountProfileAction,
  BilibiliAccountProfileRunRecord,
  BilibiliAccountProfileSnapshot,
  BilibiliAccountProfileVisualEvidence
} from './bilibili-account-profile-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PROFILE_FILE = 'profile-snapshot.json';

export interface BilibiliAccountProfileArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  runId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliAccountProfileRunRecord['state'];
  targetUrlDigest: string;
  stableAccountId: string | null;
  publicFieldCount: number;
  highlightCount: number;
  terminalReason: BilibiliAccountProfileRunRecord['coverage']['terminalReason'];
  manifestSha256: string;
}

export interface BilibiliAccountProfileArtifactManifest
  extends Omit<BilibiliAccountProfileArtifactSummary, 'manifestSha256'> {
  collectorVersion: string;
  strategyCandidate: BilibiliAccountProfileRunRecord['strategyCandidate'];
  actions: BilibiliAccountProfileAction[];
  coverage: BilibiliAccountProfileRunRecord['coverage'];
  visualEvidence: BilibiliAccountProfileVisualEvidence | null;
  profileFile: typeof PROFILE_FILE;
  profileFileSha256: string;
  safeguards: BilibiliAccountProfileRunRecord['safeguards'];
}

export interface BilibiliAccountProfileArtifactView {
  summary: BilibiliAccountProfileArtifactSummary;
  manifest: BilibiliAccountProfileArtifactManifest;
  snapshot: BilibiliAccountProfileSnapshot | null;
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

function isSummary(value: unknown): value is BilibiliAccountProfileArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliAccountProfileArtifactSummary>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId) &&
    typeof candidate.runId === 'string' && UUID_PATTERN.test(candidate.runId) &&
    candidate.platform === 'bilibili' &&
    isIsoDate(candidate.capturedAt) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.targetUrlDigest === 'string' && SHA256_PATTERN.test(candidate.targetUrlDigest) &&
    (candidate.stableAccountId === null ||
      (typeof candidate.stableAccountId === 'string' && /^\d{1,20}$/.test(candidate.stableAccountId))) &&
    typeof candidate.publicFieldCount === 'number' && Number.isSafeInteger(candidate.publicFieldCount) &&
    candidate.publicFieldCount >= 0 &&
    typeof candidate.highlightCount === 'number' && Number.isSafeInteger(candidate.highlightCount) &&
    candidate.highlightCount >= 0 &&
    typeof candidate.terminalReason === 'string' &&
    typeof candidate.manifestSha256 === 'string' && SHA256_PATTERN.test(candidate.manifestSha256);
}

export class BilibiliAccountProfileArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliAccountProfileArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-account-profiles');
    this.#indexPath = resolve(stateDirectory, 'bilibili-account-profile-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliAccountProfileArtifactStore> {
    const store = new BilibiliAccountProfileArtifactStore(stateDirectory);
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

  list(): BilibiliAccountProfileArtifactSummary[] {
    return [...this.#summaries.values()]
      .map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(run: BilibiliAccountProfileRunRecord): Promise<BilibiliAccountProfileArtifactSummary> {
    const existing = this.list().find((summary) => summary.runId === run.runId);
    if (existing) return existing;
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const profilePayload = { schemaVersion: 1, snapshot: run.snapshot };
    const profileFileSha256 = sha256(canonicalJson(profilePayload));
    await atomicWrite(resolve(directory, PROFILE_FILE), profilePayload);
    const manifest: BilibiliAccountProfileArtifactManifest = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      stableAccountId: run.snapshot?.stableAccountId ?? null,
      publicFieldCount: run.coverage.publicFieldCount,
      highlightCount: run.coverage.highlightCount,
      terminalReason: run.coverage.terminalReason,
      collectorVersion: run.collectorVersion,
      strategyCandidate: run.strategyCandidate,
      actions: run.actions,
      coverage: run.coverage,
      visualEvidence: run.visualEvidence,
      profileFile: PROFILE_FILE,
      profileFileSha256,
      safeguards: run.safeguards
    };
    const manifestSha256 = sha256(canonicalJson(manifest));
    await atomicWrite(resolve(directory, 'manifest.json'), manifest);
    const summary: BilibiliAccountProfileArtifactSummary = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      stableAccountId: run.snapshot?.stableAccountId ?? null,
      publicFieldCount: run.coverage.publicFieldCount,
      highlightCount: run.coverage.highlightCount,
      terminalReason: run.coverage.terminalReason,
      manifestSha256
    };
    this.#summaries.set(artifactId, summary);
    await this.#saveIndex();
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<BilibiliAccountProfileArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const directory = resolve(this.#rootDirectory, artifactId);
    const manifest = JSON.parse(
      await readFile(resolve(directory, 'manifest.json'), 'utf8')
    ) as BilibiliAccountProfileArtifactManifest;
    if (sha256(canonicalJson(manifest)) !== summary.manifestSha256) {
      throw new Error('bilibili_account_profile_manifest_digest_mismatch');
    }
    const profilePayload = JSON.parse(
      await readFile(resolve(directory, manifest.profileFile), 'utf8')
    ) as { schemaVersion?: unknown; snapshot?: BilibiliAccountProfileSnapshot | null };
    if (
      profilePayload.schemaVersion !== 1 ||
      !Object.prototype.hasOwnProperty.call(profilePayload, 'snapshot') ||
      sha256(canonicalJson(profilePayload)) !== manifest.profileFileSha256
    ) throw new Error('bilibili_account_profile_snapshot_digest_mismatch');
    return {
      summary: structuredClone(summary),
      manifest: structuredClone(manifest),
      snapshot: structuredClone(profilePayload.snapshot ?? null)
    };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
