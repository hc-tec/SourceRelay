import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type {
  BilibiliArticleFeedResponseEvidence,
  BilibiliArticleInventoryPageProjection,
  BilibiliArticleInventoryRunRecord
} from './bilibili-article-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FAILED_RESPONSE_FILE = 'failed-response-schema.json';

export interface BilibiliArticleInventoryPageFile {
  pageNumber: number;
  file: string;
  sha256: string;
  itemCount: number;
}

export interface BilibiliArticleInventoryArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  runId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliArticleInventoryRunRecord['state'];
  targetUrlDigest: string;
  stableAccountId: string;
  pageCount: number;
  itemCount: number;
  completeWithinArticleFacet: boolean;
  terminalReason: BilibiliArticleInventoryRunRecord['coverage']['terminalReason'];
  manifestSha256: string;
}

export interface BilibiliArticleInventoryArtifactManifest
  extends Omit<BilibiliArticleInventoryArtifactSummary, 'manifestSha256'> {
  collectorVersion: string;
  strategyCandidate: BilibiliArticleInventoryRunRecord['strategyCandidate'];
  actions: BilibiliArticleInventoryRunRecord['actions'];
  coverage: BilibiliArticleInventoryRunRecord['coverage'];
  pageFiles: BilibiliArticleInventoryPageFile[];
  failedResponseFile: typeof FAILED_RESPONSE_FILE | null;
  failedResponseFileSha256: string | null;
  safeguards: BilibiliArticleInventoryRunRecord['safeguards'];
}

export interface BilibiliArticleInventoryArtifactView {
  summary: BilibiliArticleInventoryArtifactSummary;
  manifest: BilibiliArticleInventoryArtifactManifest;
  pages: BilibiliArticleInventoryPageProjection[];
  failedResponseEvidence: BilibiliArticleFeedResponseEvidence | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

function isSummary(value: unknown): value is BilibiliArticleInventoryArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliArticleInventoryArtifactSummary>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId) &&
    typeof candidate.runId === 'string' && UUID_PATTERN.test(candidate.runId) &&
    candidate.platform === 'bilibili' &&
    typeof candidate.capturedAt === 'string' && Number.isFinite(Date.parse(candidate.capturedAt)) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.targetUrlDigest === 'string' && SHA256_PATTERN.test(candidate.targetUrlDigest) &&
    typeof candidate.stableAccountId === 'string' && /^\d{1,20}$/.test(candidate.stableAccountId) &&
    typeof candidate.pageCount === 'number' && Number.isSafeInteger(candidate.pageCount) && candidate.pageCount >= 0 &&
    typeof candidate.itemCount === 'number' && Number.isSafeInteger(candidate.itemCount) && candidate.itemCount >= 0 &&
    typeof candidate.completeWithinArticleFacet === 'boolean' &&
    typeof candidate.terminalReason === 'string' &&
    typeof candidate.manifestSha256 === 'string' && SHA256_PATTERN.test(candidate.manifestSha256);
}

function compactSummary(
  manifest: BilibiliArticleInventoryArtifactManifest,
  manifestSha256: string
): BilibiliArticleInventoryArtifactSummary {
  return {
    schemaVersion: manifest.schemaVersion,
    artifactId: manifest.artifactId,
    runId: manifest.runId,
    platform: manifest.platform,
    capturedAt: manifest.capturedAt,
    state: manifest.state,
    targetUrlDigest: manifest.targetUrlDigest,
    stableAccountId: manifest.stableAccountId,
    pageCount: manifest.pageCount,
    itemCount: manifest.itemCount,
    completeWithinArticleFacet: manifest.completeWithinArticleFacet,
    terminalReason: manifest.terminalReason,
    manifestSha256
  };
}

export class BilibiliArticleInventoryArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliArticleInventoryArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-article-inventory');
    this.#indexPath = resolve(stateDirectory, 'bilibili-article-inventory-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliArticleInventoryArtifactStore> {
    const store = new BilibiliArticleInventoryArtifactStore(stateDirectory);
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

  list(): BilibiliArticleInventoryArtifactSummary[] {
    return [...this.#summaries.values()].map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(run: BilibiliArticleInventoryRunRecord): Promise<BilibiliArticleInventoryArtifactSummary> {
    const existing = this.list().find((summary) => summary.runId === run.runId);
    if (existing) return existing;
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const pageFiles: BilibiliArticleInventoryPageFile[] = [];
    const seenPages = new Set<number>();
    for (const page of [...run.pages].sort((left, right) => left.pageNumber - right.pageNumber)) {
      if (seenPages.has(page.pageNumber)) throw new Error('bilibili_article_inventory_page_duplicate');
      seenPages.add(page.pageNumber);
      const file = `page-${String(page.pageNumber).padStart(3, '0')}.json`;
      const payload = { schemaVersion: 1, page };
      const digest = sha256(canonicalJson(payload));
      await atomicWrite(resolve(directory, file), payload);
      pageFiles.push({ pageNumber: page.pageNumber, file, sha256: digest, itemCount: page.items.length });
    }
    let failedResponseFile: typeof FAILED_RESPONSE_FILE | null = null;
    let failedResponseFileSha256: string | null = null;
    if (run.failedResponseEvidence) {
      const payload = { schemaVersion: 1, failedResponseEvidence: run.failedResponseEvidence };
      failedResponseFile = FAILED_RESPONSE_FILE;
      failedResponseFileSha256 = sha256(canonicalJson(payload));
      await atomicWrite(resolve(directory, failedResponseFile), payload);
    }
    const manifest: BilibiliArticleInventoryArtifactManifest = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      stableAccountId: run.stableAccountId,
      pageCount: run.pages.length,
      itemCount: run.coverage.uniqueItems,
      completeWithinArticleFacet: run.coverage.completeWithinArticleFacet,
      terminalReason: run.coverage.terminalReason,
      collectorVersion: run.collectorVersion,
      strategyCandidate: run.strategyCandidate,
      actions: run.actions,
      coverage: run.coverage,
      pageFiles,
      failedResponseFile,
      failedResponseFileSha256,
      safeguards: run.safeguards
    };
    const manifestSha256 = sha256(canonicalJson(manifest));
    await atomicWrite(resolve(directory, 'manifest.json'), manifest);
    const summary = compactSummary(manifest, manifestSha256);
    this.#summaries.set(artifactId, summary);
    await this.#saveIndex();
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<BilibiliArticleInventoryArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const directory = resolve(this.#rootDirectory, artifactId);
    const manifest = JSON.parse(
      await readFile(resolve(directory, 'manifest.json'), 'utf8')
    ) as BilibiliArticleInventoryArtifactManifest;
    if (sha256(canonicalJson(manifest)) !== summary.manifestSha256) {
      throw new Error('bilibili_article_inventory_manifest_digest_mismatch');
    }
    const pages: BilibiliArticleInventoryPageProjection[] = [];
    for (const pageFile of manifest.pageFiles) {
      if (pageFile.file !== `page-${String(pageFile.pageNumber).padStart(3, '0')}.json`) {
        throw new Error('bilibili_article_inventory_page_file_invalid');
      }
      const payload = JSON.parse(await readFile(resolve(directory, pageFile.file), 'utf8')) as {
        schemaVersion?: unknown;
        page?: BilibiliArticleInventoryPageProjection;
      };
      if (
        payload.schemaVersion !== 1 ||
        !payload.page ||
        payload.page.pageNumber !== pageFile.pageNumber ||
        payload.page.items.length !== pageFile.itemCount ||
        sha256(canonicalJson(payload)) !== pageFile.sha256
      ) throw new Error('bilibili_article_inventory_page_digest_mismatch');
      pages.push(payload.page);
    }
    let failedResponseEvidence: BilibiliArticleFeedResponseEvidence | null = null;
    if (manifest.failedResponseFile) {
      if (manifest.failedResponseFile !== FAILED_RESPONSE_FILE || !manifest.failedResponseFileSha256) {
        throw new Error('bilibili_article_inventory_failed_response_reference_invalid');
      }
      const payload = JSON.parse(
        await readFile(resolve(directory, manifest.failedResponseFile), 'utf8')
      ) as { schemaVersion?: unknown; failedResponseEvidence?: BilibiliArticleFeedResponseEvidence };
      if (
        payload.schemaVersion !== 1 ||
        !payload.failedResponseEvidence ||
        sha256(canonicalJson(payload)) !== manifest.failedResponseFileSha256
      ) throw new Error('bilibili_article_inventory_failed_response_digest_mismatch');
      failedResponseEvidence = payload.failedResponseEvidence;
    } else if (manifest.failedResponseFileSha256 !== null) {
      throw new Error('bilibili_article_inventory_failed_response_reference_invalid');
    }
    return {
      summary: structuredClone(summary),
      manifest: structuredClone(manifest),
      pages: structuredClone(pages),
      failedResponseEvidence: structuredClone(failedResponseEvidence)
    };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
