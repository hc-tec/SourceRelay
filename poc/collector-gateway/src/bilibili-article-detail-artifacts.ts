import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type { BilibiliArticleDetailRunRecord, BilibiliArticleDetailSnapshot } from './bilibili-article-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTICLE_FILE = 'article.json';

export interface BilibiliArticleDetailArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  runId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliArticleDetailRunRecord['state'];
  targetUrlDigest: string;
  stableAccountId: string | null;
  stableOpusId: string | null;
  contentCharacters: number;
  mediaRefs: number;
  terminalReason: BilibiliArticleDetailRunRecord['coverage']['terminalReason'];
  manifestSha256: string;
}

export interface BilibiliArticleDetailArtifactManifest
  extends Omit<BilibiliArticleDetailArtifactSummary, 'manifestSha256'> {
  collectorVersion: string;
  strategyCandidate: BilibiliArticleDetailRunRecord['strategyCandidate'];
  sourceInventory: BilibiliArticleDetailRunRecord['sourceInventory'];
  actions: BilibiliArticleDetailRunRecord['actions'];
  coverage: BilibiliArticleDetailRunRecord['coverage'];
  articleFile: typeof ARTICLE_FILE;
  articleFileSha256: string;
  safeguards: BilibiliArticleDetailRunRecord['safeguards'];
}

export interface BilibiliArticleDetailArtifactView {
  summary: BilibiliArticleDetailArtifactSummary;
  manifest: BilibiliArticleDetailArtifactManifest;
  snapshot: BilibiliArticleDetailSnapshot | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

function isSummary(value: unknown): value is BilibiliArticleDetailArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliArticleDetailArtifactSummary>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId) &&
    typeof candidate.runId === 'string' && UUID_PATTERN.test(candidate.runId) &&
    candidate.platform === 'bilibili' &&
    typeof candidate.capturedAt === 'string' && Number.isFinite(Date.parse(candidate.capturedAt)) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.targetUrlDigest === 'string' && SHA256_PATTERN.test(candidate.targetUrlDigest) &&
    (candidate.stableAccountId === null ||
      (typeof candidate.stableAccountId === 'string' && /^\d{1,20}$/.test(candidate.stableAccountId))) &&
    (candidate.stableOpusId === null ||
      (typeof candidate.stableOpusId === 'string' && /^\d{1,20}$/.test(candidate.stableOpusId))) &&
    typeof candidate.contentCharacters === 'number' && Number.isSafeInteger(candidate.contentCharacters) &&
    candidate.contentCharacters >= 0 &&
    typeof candidate.mediaRefs === 'number' && Number.isSafeInteger(candidate.mediaRefs) && candidate.mediaRefs >= 0 &&
    typeof candidate.terminalReason === 'string' &&
    typeof candidate.manifestSha256 === 'string' && SHA256_PATTERN.test(candidate.manifestSha256);
}

export class BilibiliArticleDetailArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliArticleDetailArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-article-details');
    this.#indexPath = resolve(stateDirectory, 'bilibili-article-detail-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliArticleDetailArtifactStore> {
    const store = new BilibiliArticleDetailArtifactStore(stateDirectory);
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

  list(): BilibiliArticleDetailArtifactSummary[] {
    return [...this.#summaries.values()].map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(run: BilibiliArticleDetailRunRecord): Promise<BilibiliArticleDetailArtifactSummary> {
    const existing = this.list().find((summary) => summary.runId === run.runId);
    if (existing) return existing;
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const articlePayload = { schemaVersion: 1, snapshot: run.snapshot };
    const articleFileSha256 = sha256(canonicalJson(articlePayload));
    await atomicWrite(resolve(directory, ARTICLE_FILE), articlePayload);
    const manifest: BilibiliArticleDetailArtifactManifest = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      stableAccountId: run.snapshot?.stableAccountId ?? null,
      stableOpusId: run.snapshot?.stableOpusId ?? null,
      contentCharacters: run.coverage.contentCharacters,
      mediaRefs: run.coverage.mediaRefs,
      terminalReason: run.coverage.terminalReason,
      collectorVersion: run.collectorVersion,
      strategyCandidate: run.strategyCandidate,
      sourceInventory: run.sourceInventory,
      actions: run.actions,
      coverage: run.coverage,
      articleFile: ARTICLE_FILE,
      articleFileSha256,
      safeguards: run.safeguards
    };
    const manifestSha256 = sha256(canonicalJson(manifest));
    await atomicWrite(resolve(directory, 'manifest.json'), manifest);
    const summary: BilibiliArticleDetailArtifactSummary = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      stableAccountId: manifest.stableAccountId,
      stableOpusId: manifest.stableOpusId,
      contentCharacters: manifest.contentCharacters,
      mediaRefs: manifest.mediaRefs,
      terminalReason: manifest.terminalReason,
      manifestSha256
    };
    this.#summaries.set(artifactId, summary);
    await this.#saveIndex();
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<BilibiliArticleDetailArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const directory = resolve(this.#rootDirectory, artifactId);
    const manifest = JSON.parse(
      await readFile(resolve(directory, 'manifest.json'), 'utf8')
    ) as BilibiliArticleDetailArtifactManifest;
    if (sha256(canonicalJson(manifest)) !== summary.manifestSha256) {
      throw new Error('bilibili_article_detail_manifest_digest_mismatch');
    }
    const payload = JSON.parse(await readFile(resolve(directory, manifest.articleFile), 'utf8')) as {
      schemaVersion?: unknown;
      snapshot?: BilibiliArticleDetailSnapshot | null;
    };
    if (
      payload.schemaVersion !== 1 ||
      !Object.prototype.hasOwnProperty.call(payload, 'snapshot') ||
      sha256(canonicalJson(payload)) !== manifest.articleFileSha256
    ) throw new Error('bilibili_article_detail_snapshot_digest_mismatch');
    return {
      summary: structuredClone(summary),
      manifest: structuredClone(manifest),
      snapshot: structuredClone(payload.snapshot ?? null)
    };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
