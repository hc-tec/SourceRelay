import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type {
  BilibiliAccountArchiveAction,
  BilibiliAccountArchivePageProjection,
  BilibiliAccountArchiveRunRecord,
  BilibiliAccountProfileProjection
} from './bilibili-account-archive-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface BilibiliAccountArchivePageFile {
  pageNumber: number;
  file: string;
  sha256: string;
  itemCount: number;
}

export interface BilibiliAccountArchiveArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  runId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliAccountArchiveRunRecord['state'];
  targetUrlDigest: string;
  stableAccountId: string | null;
  pageCount: number;
  itemCount: number;
  completeWithinDeclaredInventory: boolean;
  terminalReason: BilibiliAccountArchiveRunRecord['coverage']['terminalReason'];
  manifestSha256: string;
}

export interface BilibiliAccountArchiveArtifactManifest
  extends Omit<BilibiliAccountArchiveArtifactSummary, 'manifestSha256'> {
  collectorVersion: string;
  strategyCandidate: BilibiliAccountArchiveRunRecord['strategyCandidate'];
  account: BilibiliAccountProfileProjection | null;
  actions: BilibiliAccountArchiveAction[];
  coverage: BilibiliAccountArchiveRunRecord['coverage'];
  pageFiles: BilibiliAccountArchivePageFile[];
  safeguards: BilibiliAccountArchiveRunRecord['safeguards'];
}

export interface BilibiliAccountArchiveArtifactView {
  summary: BilibiliAccountArchiveArtifactSummary;
  manifest: BilibiliAccountArchiveArtifactManifest;
  pages: BilibiliAccountArchivePageProjection[];
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

function isSummary(value: unknown): value is BilibiliAccountArchiveArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliAccountArchiveArtifactSummary>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId) &&
    typeof candidate.runId === 'string' && UUID_PATTERN.test(candidate.runId) &&
    candidate.platform === 'bilibili' &&
    isIsoDate(candidate.capturedAt) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.targetUrlDigest === 'string' && SHA256_PATTERN.test(candidate.targetUrlDigest) &&
    (candidate.stableAccountId === null ||
      (typeof candidate.stableAccountId === 'string' && /^\d{1,20}$/.test(candidate.stableAccountId))) &&
    typeof candidate.pageCount === 'number' && Number.isSafeInteger(candidate.pageCount) && candidate.pageCount >= 0 &&
    typeof candidate.itemCount === 'number' && Number.isSafeInteger(candidate.itemCount) && candidate.itemCount >= 0 &&
    typeof candidate.completeWithinDeclaredInventory === 'boolean' &&
    typeof candidate.terminalReason === 'string' &&
    typeof candidate.manifestSha256 === 'string' && SHA256_PATTERN.test(candidate.manifestSha256);
}

export class BilibiliAccountArchiveArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliAccountArchiveArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-account-archives');
    this.#indexPath = resolve(stateDirectory, 'bilibili-account-archive-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliAccountArchiveArtifactStore> {
    const store = new BilibiliAccountArchiveArtifactStore(stateDirectory);
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

  list(): BilibiliAccountArchiveArtifactSummary[] {
    return [...this.#summaries.values()]
      .map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(run: BilibiliAccountArchiveRunRecord): Promise<BilibiliAccountArchiveArtifactSummary> {
    const existing = this.list().find((summary) => summary.runId === run.runId);
    if (existing) return existing;
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });

    const pageFiles: BilibiliAccountArchivePageFile[] = [];
    for (const page of run.pages) {
      const file = `page-${String(page.pageNumber).padStart(3, '0')}.json`;
      const payload = { schemaVersion: 1, page };
      const digest = sha256(canonicalJson(payload));
      await atomicWrite(resolve(directory, file), payload);
      pageFiles.push({ pageNumber: page.pageNumber, file, sha256: digest, itemCount: page.items.length });
    }

    const manifest: BilibiliAccountArchiveArtifactManifest = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      stableAccountId: run.account?.stableAccountId ?? null,
      pageCount: run.pages.length,
      itemCount: run.coverage.uniqueItems,
      completeWithinDeclaredInventory: run.coverage.completeWithinDeclaredInventory,
      terminalReason: run.coverage.terminalReason,
      collectorVersion: run.collectorVersion,
      strategyCandidate: run.strategyCandidate,
      account: run.account,
      actions: run.actions,
      coverage: run.coverage,
      pageFiles,
      safeguards: run.safeguards
    };
    const manifestSha256 = sha256(canonicalJson(manifest));
    await atomicWrite(resolve(directory, 'manifest.json'), manifest);
    const summary: BilibiliAccountArchiveArtifactSummary = { ...manifest, manifestSha256 };
    const compactSummary: BilibiliAccountArchiveArtifactSummary = {
      schemaVersion: summary.schemaVersion,
      artifactId: summary.artifactId,
      runId: summary.runId,
      platform: summary.platform,
      capturedAt: summary.capturedAt,
      state: summary.state,
      targetUrlDigest: summary.targetUrlDigest,
      stableAccountId: summary.stableAccountId,
      pageCount: summary.pageCount,
      itemCount: summary.itemCount,
      completeWithinDeclaredInventory: summary.completeWithinDeclaredInventory,
      terminalReason: summary.terminalReason,
      manifestSha256: summary.manifestSha256
    };
    this.#summaries.set(artifactId, compactSummary);
    await this.#saveIndex();
    return structuredClone(compactSummary);
  }

  async get(artifactId: string): Promise<BilibiliAccountArchiveArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const directory = resolve(this.#rootDirectory, artifactId);
    const manifest = JSON.parse(
      await readFile(resolve(directory, 'manifest.json'), 'utf8')
    ) as BilibiliAccountArchiveArtifactManifest;
    if (sha256(canonicalJson(manifest)) !== summary.manifestSha256) {
      throw new Error('bilibili_account_archive_manifest_digest_mismatch');
    }
    const pages: BilibiliAccountArchivePageProjection[] = [];
    for (const pageFile of manifest.pageFiles) {
      const payload = JSON.parse(await readFile(resolve(directory, pageFile.file), 'utf8')) as {
        schemaVersion?: unknown;
        page?: BilibiliAccountArchivePageProjection;
      };
      if (
        payload.schemaVersion !== 1 ||
        !payload.page ||
        sha256(canonicalJson(payload)) !== pageFile.sha256
      ) throw new Error('bilibili_account_archive_page_digest_mismatch');
      pages.push(payload.page);
    }
    return {
      summary: structuredClone(summary),
      manifest: structuredClone(manifest),
      pages: structuredClone(pages)
    };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
