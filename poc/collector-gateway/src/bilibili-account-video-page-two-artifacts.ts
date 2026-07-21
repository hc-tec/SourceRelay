import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type {
  BilibiliAccountVideoPageTwoRunRecord
} from './bilibili-account-video-page-two-contract';
import type { BilibiliAccountVideoInventoryProjection } from './bilibili-account-video-inventory-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PAGE_FILE = 'page-two.json';

export interface BilibiliAccountVideoPageTwoArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  runId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliAccountVideoPageTwoRunRecord['state'];
  targetUrlDigest: string;
  stableAccountId: string;
  capturedItems: number;
  unresolvedCardCount: number;
  bvidSetChanged: boolean;
  terminalReason: BilibiliAccountVideoPageTwoRunRecord['coverage']['terminalReason'];
  manifestSha256: string;
}

export interface BilibiliAccountVideoPageTwoArtifactManifest
  extends Omit<BilibiliAccountVideoPageTwoArtifactSummary, 'manifestSha256'> {
  collectorVersion: string;
  strategyCandidate: BilibiliAccountVideoPageTwoRunRecord['strategyCandidate'];
  beforeBvidSetDigest: string | null;
  afterBvidSetDigest: string | null;
  pagination: BilibiliAccountVideoPageTwoRunRecord['pagination'];
  visualEvidence: BilibiliAccountVideoPageTwoRunRecord['visualEvidence'];
  actions: BilibiliAccountVideoPageTwoRunRecord['actions'];
  coverage: BilibiliAccountVideoPageTwoRunRecord['coverage'];
  safeguards: BilibiliAccountVideoPageTwoRunRecord['safeguards'];
  pageFile: typeof PAGE_FILE | null;
  pageFileSha256: string | null;
}

export interface BilibiliAccountVideoPageTwoArtifactView {
  summary: BilibiliAccountVideoPageTwoArtifactSummary;
  manifest: BilibiliAccountVideoPageTwoArtifactManifest;
  pageTwo: BilibiliAccountVideoInventoryProjection | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

function isSummary(value: unknown): value is BilibiliAccountVideoPageTwoArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliAccountVideoPageTwoArtifactSummary>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId) &&
    typeof candidate.runId === 'string' && UUID_PATTERN.test(candidate.runId) &&
    candidate.platform === 'bilibili' &&
    typeof candidate.capturedAt === 'string' && Number.isFinite(Date.parse(candidate.capturedAt)) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.targetUrlDigest === 'string' && SHA256_PATTERN.test(candidate.targetUrlDigest) &&
    typeof candidate.stableAccountId === 'string' && /^\d{1,20}$/.test(candidate.stableAccountId) &&
    typeof candidate.capturedItems === 'number' && Number.isSafeInteger(candidate.capturedItems) && candidate.capturedItems >= 0 &&
    typeof candidate.unresolvedCardCount === 'number' && Number.isSafeInteger(candidate.unresolvedCardCount) && candidate.unresolvedCardCount >= 0 &&
    typeof candidate.bvidSetChanged === 'boolean' &&
    typeof candidate.terminalReason === 'string' &&
    typeof candidate.manifestSha256 === 'string' && SHA256_PATTERN.test(candidate.manifestSha256);
}

function compactSummary(
  manifest: BilibiliAccountVideoPageTwoArtifactManifest,
  manifestSha256: string
): BilibiliAccountVideoPageTwoArtifactSummary {
  return {
    schemaVersion: manifest.schemaVersion,
    artifactId: manifest.artifactId,
    runId: manifest.runId,
    platform: manifest.platform,
    capturedAt: manifest.capturedAt,
    state: manifest.state,
    targetUrlDigest: manifest.targetUrlDigest,
    stableAccountId: manifest.stableAccountId,
    capturedItems: manifest.capturedItems,
    unresolvedCardCount: manifest.unresolvedCardCount,
    bvidSetChanged: manifest.bvidSetChanged,
    terminalReason: manifest.terminalReason,
    manifestSha256
  };
}

export class BilibiliAccountVideoPageTwoArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliAccountVideoPageTwoArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-account-video-page-two');
    this.#indexPath = resolve(stateDirectory, 'bilibili-account-video-page-two-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliAccountVideoPageTwoArtifactStore> {
    const store = new BilibiliAccountVideoPageTwoArtifactStore(stateDirectory);
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

  list(): BilibiliAccountVideoPageTwoArtifactSummary[] {
    return [...this.#summaries.values()]
      .map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(run: BilibiliAccountVideoPageTwoRunRecord): Promise<BilibiliAccountVideoPageTwoArtifactSummary> {
    const existing = this.list().find((summary) => summary.runId === run.runId);
    if (existing) return existing;
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    let pageFile: typeof PAGE_FILE | null = null;
    let pageFileSha256: string | null = null;
    if (run.pageTwo) {
      const payload = { schemaVersion: 1, pageTwo: run.pageTwo };
      pageFile = PAGE_FILE;
      pageFileSha256 = sha256(canonicalJson(payload));
      await atomicWrite(resolve(directory, pageFile), payload);
    }
    const manifest: BilibiliAccountVideoPageTwoArtifactManifest = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      stableAccountId: run.stableAccountId,
      capturedItems: run.coverage.pageTwoCapturedItems,
      unresolvedCardCount: run.coverage.pageTwoUnresolvedCardCount,
      bvidSetChanged: run.coverage.bvidSetChanged,
      terminalReason: run.coverage.terminalReason,
      collectorVersion: run.collectorVersion,
      strategyCandidate: run.strategyCandidate,
      beforeBvidSetDigest: run.beforeBvidSetDigest,
      afterBvidSetDigest: run.afterBvidSetDigest,
      pagination: run.pagination,
      visualEvidence: run.visualEvidence,
      actions: run.actions,
      coverage: run.coverage,
      safeguards: run.safeguards,
      pageFile,
      pageFileSha256
    };
    const manifestSha256 = sha256(canonicalJson(manifest));
    await atomicWrite(resolve(directory, 'manifest.json'), manifest);
    const summary = compactSummary(manifest, manifestSha256);
    this.#summaries.set(summary.artifactId, summary);
    await this.#saveIndex();
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<BilibiliAccountVideoPageTwoArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const directory = resolve(this.#rootDirectory, artifactId);
    const manifest = JSON.parse(
      await readFile(resolve(directory, 'manifest.json'), 'utf8')
    ) as BilibiliAccountVideoPageTwoArtifactManifest;
    if (sha256(canonicalJson(manifest)) !== summary.manifestSha256) {
      throw new Error('bilibili_account_video_page_two_manifest_digest_mismatch');
    }
    let pageTwo: BilibiliAccountVideoInventoryProjection | null = null;
    if (manifest.pageFile) {
      if (manifest.pageFile !== PAGE_FILE || !manifest.pageFileSha256) {
        throw new Error('bilibili_account_video_page_two_reference_invalid');
      }
      const payload = JSON.parse(await readFile(resolve(directory, manifest.pageFile), 'utf8')) as {
        schemaVersion?: unknown;
        pageTwo?: BilibiliAccountVideoInventoryProjection;
      };
      if (
        payload.schemaVersion !== 1 ||
        !payload.pageTwo ||
        sha256(canonicalJson(payload)) !== manifest.pageFileSha256
      ) throw new Error('bilibili_account_video_page_two_page_digest_mismatch');
      pageTwo = payload.pageTwo;
    } else if (manifest.pageFileSha256 !== null) {
      throw new Error('bilibili_account_video_page_two_reference_invalid');
    }
    return {
      summary: structuredClone(summary),
      manifest: structuredClone(manifest),
      pageTwo: structuredClone(pageTwo)
    };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
