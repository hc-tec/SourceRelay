import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type {
  BilibiliSeriesDetailRunRecord,
  BilibiliSeriesMetadataProjection,
  BilibiliSeriesMetadataResponseEvidence,
  BilibiliSeriesPageProjection,
  BilibiliSeriesPageResponseEvidence
} from './bilibili-series-detail-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const METADATA_FILE = 'metadata.json';
const METADATA_RESPONSE_FILE = 'metadata-response-schema.json';
const FAILED_PAGE_RESPONSE_FILE = 'failed-page-response-schema.json';

export interface BilibiliSeriesDetailPageFile {
  pageNumber: number;
  file: string;
  sha256: string;
  itemCount: number;
}

export interface BilibiliSeriesDetailArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  runId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliSeriesDetailRunRecord['state'];
  targetUrlDigest: string;
  stableAccountId: string | null;
  stableSeriesId: string | null;
  pageCount: number;
  itemCount: number;
  completeWithinDeclaredSeries: boolean;
  terminalReason: BilibiliSeriesDetailRunRecord['coverage']['terminalReason'];
  manifestSha256: string;
}

export interface BilibiliSeriesDetailArtifactManifest
  extends Omit<BilibiliSeriesDetailArtifactSummary, 'manifestSha256'> {
  collectorVersion: string;
  strategyCandidate: BilibiliSeriesDetailRunRecord['strategyCandidate'];
  actions: BilibiliSeriesDetailRunRecord['actions'];
  coverage: BilibiliSeriesDetailRunRecord['coverage'];
  metadataFile: typeof METADATA_FILE;
  metadataFileSha256: string;
  metadataResponseFile: typeof METADATA_RESPONSE_FILE;
  metadataResponseFileSha256: string;
  pageFiles: BilibiliSeriesDetailPageFile[];
  failedPageResponseFile: typeof FAILED_PAGE_RESPONSE_FILE | null;
  failedPageResponseFileSha256: string | null;
  safeguards: BilibiliSeriesDetailRunRecord['safeguards'];
}

export interface BilibiliSeriesDetailArtifactView {
  summary: BilibiliSeriesDetailArtifactSummary;
  manifest: BilibiliSeriesDetailArtifactManifest;
  metadata: BilibiliSeriesMetadataProjection | null;
  metadataResponseEvidence: BilibiliSeriesMetadataResponseEvidence | null;
  pages: BilibiliSeriesPageProjection[];
  failedPageResponseEvidence: BilibiliSeriesPageResponseEvidence | null;
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

function isSummary(value: unknown): value is BilibiliSeriesDetailArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliSeriesDetailArtifactSummary>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId) &&
    typeof candidate.runId === 'string' && UUID_PATTERN.test(candidate.runId) &&
    candidate.platform === 'bilibili' &&
    isIsoDate(candidate.capturedAt) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.targetUrlDigest === 'string' && SHA256_PATTERN.test(candidate.targetUrlDigest) &&
    (candidate.stableAccountId === null ||
      (typeof candidate.stableAccountId === 'string' && /^\d{1,20}$/.test(candidate.stableAccountId))) &&
    (candidate.stableSeriesId === null ||
      (typeof candidate.stableSeriesId === 'string' && /^\d{1,20}$/.test(candidate.stableSeriesId))) &&
    typeof candidate.pageCount === 'number' && Number.isSafeInteger(candidate.pageCount) && candidate.pageCount >= 0 &&
    typeof candidate.itemCount === 'number' && Number.isSafeInteger(candidate.itemCount) && candidate.itemCount >= 0 &&
    typeof candidate.completeWithinDeclaredSeries === 'boolean' &&
    typeof candidate.terminalReason === 'string' &&
    typeof candidate.manifestSha256 === 'string' && SHA256_PATTERN.test(candidate.manifestSha256);
}

function compactSummary(
  manifest: BilibiliSeriesDetailArtifactManifest,
  manifestSha256: string
): BilibiliSeriesDetailArtifactSummary {
  return {
    schemaVersion: manifest.schemaVersion,
    artifactId: manifest.artifactId,
    runId: manifest.runId,
    platform: manifest.platform,
    capturedAt: manifest.capturedAt,
    state: manifest.state,
    targetUrlDigest: manifest.targetUrlDigest,
    stableAccountId: manifest.stableAccountId,
    stableSeriesId: manifest.stableSeriesId,
    pageCount: manifest.pageCount,
    itemCount: manifest.itemCount,
    completeWithinDeclaredSeries: manifest.completeWithinDeclaredSeries,
    terminalReason: manifest.terminalReason,
    manifestSha256
  };
}

export class BilibiliSeriesDetailArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliSeriesDetailArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-series-detail');
    this.#indexPath = resolve(stateDirectory, 'bilibili-series-detail-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliSeriesDetailArtifactStore> {
    const store = new BilibiliSeriesDetailArtifactStore(stateDirectory);
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

  list(): BilibiliSeriesDetailArtifactSummary[] {
    return [...this.#summaries.values()]
      .map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(run: BilibiliSeriesDetailRunRecord): Promise<BilibiliSeriesDetailArtifactSummary> {
    const existing = this.list().find((summary) => summary.runId === run.runId);
    if (existing) return existing;
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });

    const metadataPayload = { schemaVersion: 1, metadata: run.metadata };
    const metadataFileSha256 = sha256(canonicalJson(metadataPayload));
    await atomicWrite(resolve(directory, METADATA_FILE), metadataPayload);

    const metadataResponsePayload = {
      schemaVersion: 1,
      metadataResponseEvidence: run.metadataResponseEvidence
    };
    const metadataResponseFileSha256 = sha256(canonicalJson(metadataResponsePayload));
    await atomicWrite(resolve(directory, METADATA_RESPONSE_FILE), metadataResponsePayload);

    const pageFiles: BilibiliSeriesDetailPageFile[] = [];
    const seenPageNumbers = new Set<number>();
    for (const page of [...run.pages].sort((left, right) => left.pageNumber - right.pageNumber)) {
      if (seenPageNumbers.has(page.pageNumber)) throw new Error('bilibili_series_detail_page_duplicate');
      seenPageNumbers.add(page.pageNumber);
      const file = `page-${String(page.pageNumber).padStart(3, '0')}.json`;
      const payload = { schemaVersion: 1, page };
      const digest = sha256(canonicalJson(payload));
      await atomicWrite(resolve(directory, file), payload);
      pageFiles.push({ pageNumber: page.pageNumber, file, sha256: digest, itemCount: page.items.length });
    }

    let failedPageResponseFile: typeof FAILED_PAGE_RESPONSE_FILE | null = null;
    let failedPageResponseFileSha256: string | null = null;
    if (run.failedPageResponseEvidence) {
      const payload = {
        schemaVersion: 1,
        failedPageResponseEvidence: run.failedPageResponseEvidence
      };
      failedPageResponseFile = FAILED_PAGE_RESPONSE_FILE;
      failedPageResponseFileSha256 = sha256(canonicalJson(payload));
      await atomicWrite(resolve(directory, failedPageResponseFile), payload);
    }

    const manifest: BilibiliSeriesDetailArtifactManifest = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      stableAccountId: run.metadata?.stableAccountId ?? null,
      stableSeriesId: run.metadata?.stableSeriesId ?? null,
      pageCount: run.pages.length,
      itemCount: run.coverage.uniqueItems,
      completeWithinDeclaredSeries: run.coverage.completeWithinDeclaredSeries,
      terminalReason: run.coverage.terminalReason,
      collectorVersion: run.collectorVersion,
      strategyCandidate: run.strategyCandidate,
      actions: run.actions,
      coverage: run.coverage,
      metadataFile: METADATA_FILE,
      metadataFileSha256,
      metadataResponseFile: METADATA_RESPONSE_FILE,
      metadataResponseFileSha256,
      pageFiles,
      failedPageResponseFile,
      failedPageResponseFileSha256,
      safeguards: run.safeguards
    };
    const manifestSha256 = sha256(canonicalJson(manifest));
    await atomicWrite(resolve(directory, 'manifest.json'), manifest);
    const summary = compactSummary(manifest, manifestSha256);
    this.#summaries.set(artifactId, summary);
    await this.#saveIndex();
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<BilibiliSeriesDetailArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const directory = resolve(this.#rootDirectory, artifactId);
    const manifest = JSON.parse(
      await readFile(resolve(directory, 'manifest.json'), 'utf8')
    ) as BilibiliSeriesDetailArtifactManifest;
    if (sha256(canonicalJson(manifest)) !== summary.manifestSha256) {
      throw new Error('bilibili_series_detail_manifest_digest_mismatch');
    }

    const metadataPayload = JSON.parse(
      await readFile(resolve(directory, manifest.metadataFile), 'utf8')
    ) as { schemaVersion?: unknown; metadata?: BilibiliSeriesMetadataProjection | null };
    if (
      metadataPayload.schemaVersion !== 1 ||
      !Object.prototype.hasOwnProperty.call(metadataPayload, 'metadata') ||
      sha256(canonicalJson(metadataPayload)) !== manifest.metadataFileSha256
    ) throw new Error('bilibili_series_detail_metadata_digest_mismatch');

    const metadataResponsePayload = JSON.parse(
      await readFile(resolve(directory, manifest.metadataResponseFile), 'utf8')
    ) as {
      schemaVersion?: unknown;
      metadataResponseEvidence?: BilibiliSeriesMetadataResponseEvidence | null;
    };
    if (
      metadataResponsePayload.schemaVersion !== 1 ||
      !Object.prototype.hasOwnProperty.call(metadataResponsePayload, 'metadataResponseEvidence') ||
      sha256(canonicalJson(metadataResponsePayload)) !== manifest.metadataResponseFileSha256
    ) throw new Error('bilibili_series_detail_metadata_response_digest_mismatch');

    const pages: BilibiliSeriesPageProjection[] = [];
    for (const pageFile of manifest.pageFiles) {
      if (pageFile.file !== `page-${String(pageFile.pageNumber).padStart(3, '0')}.json`) {
        throw new Error('bilibili_series_detail_page_file_invalid');
      }
      const payload = JSON.parse(await readFile(resolve(directory, pageFile.file), 'utf8')) as {
        schemaVersion?: unknown;
        page?: BilibiliSeriesPageProjection;
      };
      if (
        payload.schemaVersion !== 1 ||
        !payload.page ||
        payload.page.pageNumber !== pageFile.pageNumber ||
        payload.page.items.length !== pageFile.itemCount ||
        sha256(canonicalJson(payload)) !== pageFile.sha256
      ) throw new Error('bilibili_series_detail_page_digest_mismatch');
      pages.push(payload.page);
    }

    let failedPageResponseEvidence: BilibiliSeriesPageResponseEvidence | null = null;
    if (manifest.failedPageResponseFile) {
      if (
        manifest.failedPageResponseFile !== FAILED_PAGE_RESPONSE_FILE ||
        !manifest.failedPageResponseFileSha256
      ) throw new Error('bilibili_series_detail_failed_page_reference_invalid');
      const payload = JSON.parse(
        await readFile(resolve(directory, manifest.failedPageResponseFile), 'utf8')
      ) as {
        schemaVersion?: unknown;
        failedPageResponseEvidence?: BilibiliSeriesPageResponseEvidence | null;
      };
      if (
        payload.schemaVersion !== 1 ||
        !payload.failedPageResponseEvidence ||
        sha256(canonicalJson(payload)) !== manifest.failedPageResponseFileSha256
      ) throw new Error('bilibili_series_detail_failed_page_digest_mismatch');
      failedPageResponseEvidence = payload.failedPageResponseEvidence;
    } else if (manifest.failedPageResponseFileSha256 !== null) {
      throw new Error('bilibili_series_detail_failed_page_reference_invalid');
    }

    return {
      summary: structuredClone(summary),
      manifest: structuredClone(manifest),
      metadata: structuredClone(metadataPayload.metadata ?? null),
      metadataResponseEvidence: structuredClone(metadataResponsePayload.metadataResponseEvidence ?? null),
      pages: structuredClone(pages),
      failedPageResponseEvidence: structuredClone(failedPageResponseEvidence)
    };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
