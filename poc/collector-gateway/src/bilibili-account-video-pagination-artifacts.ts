import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type {
  BilibiliAccountVideoPaginationPage,
  BilibiliAccountVideoPaginationRunRecord
} from './bilibili-account-video-pagination-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PAGE_FILE_PATTERN = /^page-(00[1-7])\.json$/;

export interface BilibiliAccountVideoPaginationArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  runId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliAccountVideoPaginationRunRecord['state'];
  targetUrlDigest: string;
  stableAccountId: string;
  requestedPages: number;
  capturedPages: number;
  capturedItems: number;
  uniqueBvidCount: number;
  duplicateBvidCount: number;
  terminalReason: BilibiliAccountVideoPaginationRunRecord['coverage']['terminalReason'];
  manifestSha256: string;
}

export interface BilibiliAccountVideoPaginationPageReference {
  pageNumber: number;
  fileName: string;
  sha256: string;
}

export interface BilibiliAccountVideoPaginationArtifactManifest
  extends Omit<BilibiliAccountVideoPaginationArtifactSummary, 'manifestSha256'> {
  collectorVersion: string;
  strategyCandidate: BilibiliAccountVideoPaginationRunRecord['strategyCandidate'];
  actions: BilibiliAccountVideoPaginationRunRecord['actions'];
  coverage: BilibiliAccountVideoPaginationRunRecord['coverage'];
  safeguards: BilibiliAccountVideoPaginationRunRecord['safeguards'];
  pageFiles: BilibiliAccountVideoPaginationPageReference[];
}

export interface BilibiliAccountVideoPaginationArtifactView {
  summary: BilibiliAccountVideoPaginationArtifactSummary;
  manifest: BilibiliAccountVideoPaginationArtifactManifest;
  pages: BilibiliAccountVideoPaginationPage[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

function isSummary(value: unknown): value is BilibiliAccountVideoPaginationArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliAccountVideoPaginationArtifactSummary>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId) &&
    typeof candidate.runId === 'string' && UUID_PATTERN.test(candidate.runId) &&
    candidate.platform === 'bilibili' &&
    typeof candidate.capturedAt === 'string' && Number.isFinite(Date.parse(candidate.capturedAt)) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.targetUrlDigest === 'string' && SHA256_PATTERN.test(candidate.targetUrlDigest) &&
    typeof candidate.stableAccountId === 'string' && /^\d{1,20}$/.test(candidate.stableAccountId) &&
    validCount(candidate.requestedPages, 1, 7) &&
    validCount(candidate.capturedPages, 0, candidate.requestedPages) &&
    validCount(candidate.capturedItems, 0, Number.MAX_SAFE_INTEGER) &&
    validCount(candidate.uniqueBvidCount, 0, candidate.capturedItems) &&
    validCount(candidate.duplicateBvidCount, 0, candidate.capturedItems) &&
    typeof candidate.terminalReason === 'string' &&
    typeof candidate.manifestSha256 === 'string' && SHA256_PATTERN.test(candidate.manifestSha256);
}

function validCount(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function compactSummary(
  manifest: BilibiliAccountVideoPaginationArtifactManifest,
  manifestSha256: string
): BilibiliAccountVideoPaginationArtifactSummary {
  return {
    schemaVersion: manifest.schemaVersion,
    artifactId: manifest.artifactId,
    runId: manifest.runId,
    platform: manifest.platform,
    capturedAt: manifest.capturedAt,
    state: manifest.state,
    targetUrlDigest: manifest.targetUrlDigest,
    stableAccountId: manifest.stableAccountId,
    requestedPages: manifest.requestedPages,
    capturedPages: manifest.capturedPages,
    capturedItems: manifest.capturedItems,
    uniqueBvidCount: manifest.uniqueBvidCount,
    duplicateBvidCount: manifest.duplicateBvidCount,
    terminalReason: manifest.terminalReason,
    manifestSha256
  };
}

function pageFileName(pageNumber: number): string {
  return `page-${String(pageNumber).padStart(3, '0')}.json`;
}

function validPage(page: BilibiliAccountVideoPaginationPage, expectedPageNumber: number): boolean {
  return page.pageNumber === expectedPageNumber &&
    SHA256_PATTERN.test(page.bvidSetDigest) &&
    page.projection.stableAccountId.length > 0;
}

export class BilibiliAccountVideoPaginationArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliAccountVideoPaginationArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-account-video-pagination');
    this.#indexPath = resolve(stateDirectory, 'bilibili-account-video-pagination-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliAccountVideoPaginationArtifactStore> {
    const store = new BilibiliAccountVideoPaginationArtifactStore(stateDirectory);
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

  list(): BilibiliAccountVideoPaginationArtifactSummary[] {
    return [...this.#summaries.values()]
      .map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(run: BilibiliAccountVideoPaginationRunRecord): Promise<BilibiliAccountVideoPaginationArtifactSummary> {
    const existing = this.list().find((summary) => summary.runId === run.runId);
    if (existing) return existing;
    if (!validCount(run.requestedPages, 1, 7) || run.pages.length > run.requestedPages) {
      throw new Error('bilibili_account_video_pagination_run_invalid');
    }
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const pageFiles: BilibiliAccountVideoPaginationPageReference[] = [];
    for (const [index, page] of run.pages.entries()) {
      const expectedPageNumber = index + 1;
      if (!validPage(page, expectedPageNumber)) throw new Error('bilibili_account_video_pagination_page_invalid');
      const payload = { schemaVersion: 1, page };
      const fileName = pageFileName(page.pageNumber);
      pageFiles.push({ pageNumber: page.pageNumber, fileName, sha256: sha256(canonicalJson(payload)) });
      await atomicWrite(resolve(directory, fileName), payload);
    }
    const manifest: BilibiliAccountVideoPaginationArtifactManifest = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      stableAccountId: run.stableAccountId,
      requestedPages: run.coverage.requestedPages,
      capturedPages: run.coverage.capturedPages,
      capturedItems: run.coverage.capturedItems,
      uniqueBvidCount: run.coverage.uniqueBvidCount,
      duplicateBvidCount: run.coverage.duplicateBvidCount,
      terminalReason: run.coverage.terminalReason,
      collectorVersion: run.collectorVersion,
      strategyCandidate: run.strategyCandidate,
      actions: run.actions,
      coverage: run.coverage,
      safeguards: run.safeguards,
      pageFiles
    };
    const manifestSha256 = sha256(canonicalJson(manifest));
    await atomicWrite(resolve(directory, 'manifest.json'), manifest);
    const summary = compactSummary(manifest, manifestSha256);
    this.#summaries.set(summary.artifactId, summary);
    await this.#saveIndex();
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<BilibiliAccountVideoPaginationArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const directory = resolve(this.#rootDirectory, artifactId);
    const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')) as BilibiliAccountVideoPaginationArtifactManifest;
    if (sha256(canonicalJson(manifest)) !== summary.manifestSha256) {
      throw new Error('bilibili_account_video_pagination_manifest_digest_mismatch');
    }
    if (!Array.isArray(manifest.pageFiles) || manifest.pageFiles.length !== summary.capturedPages) {
      throw new Error('bilibili_account_video_pagination_references_invalid');
    }
    const pages: BilibiliAccountVideoPaginationPage[] = [];
    for (const [index, reference] of manifest.pageFiles.entries()) {
      const expectedPageNumber = index + 1;
      if (
        !reference ||
        reference.pageNumber !== expectedPageNumber ||
        reference.fileName !== pageFileName(expectedPageNumber) ||
        !PAGE_FILE_PATTERN.test(reference.fileName) ||
        !SHA256_PATTERN.test(reference.sha256)
      ) throw new Error('bilibili_account_video_pagination_reference_invalid');
      const payload = JSON.parse(await readFile(resolve(directory, reference.fileName), 'utf8')) as {
        schemaVersion?: unknown;
        page?: BilibiliAccountVideoPaginationPage;
      };
      if (
        payload.schemaVersion !== 1 ||
        !payload.page ||
        !validPage(payload.page, expectedPageNumber) ||
        sha256(canonicalJson(payload)) !== reference.sha256
      ) throw new Error('bilibili_account_video_pagination_page_digest_mismatch');
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
