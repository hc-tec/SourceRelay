import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type {
  BilibiliVideoDetailProjection,
  BilibiliVideoDetailRunRecord
} from './bilibili-video-detail-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DETAIL_FILE = 'detail.json';

export interface BilibiliVideoDetailArtifactSummary {
  schemaVersion: 2;
  artifactId: string;
  runId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliVideoDetailRunRecord['state'];
  targetUrlDigest: string;
  bvid: string;
  titleCaptured: boolean;
  descriptionCaptured: boolean;
  creatorCaptured: boolean;
  tagCount: number;
  episodeSummaryCaptured: boolean;
  accessStatus: BilibiliVideoDetailRunRecord['coverage']['accessStatus'];
  loginOverlayVisible: boolean;
  terminalReason: BilibiliVideoDetailRunRecord['coverage']['terminalReason'];
  manifestSha256: string;
}

export interface BilibiliVideoDetailArtifactManifest
  extends Omit<BilibiliVideoDetailArtifactSummary, 'manifestSha256'> {
  collectorVersion: string;
  strategyCandidate: BilibiliVideoDetailRunRecord['strategyCandidate'];
  actions: BilibiliVideoDetailRunRecord['actions'];
  coverage: BilibiliVideoDetailRunRecord['coverage'];
  detailFile: typeof DETAIL_FILE | null;
  detailFileSha256: string | null;
  visualEvidence: BilibiliVideoDetailRunRecord['visualEvidence'];
  bindingDiagnostics?: BilibiliVideoDetailRunRecord['bindingDiagnostics'];
  safeguards: BilibiliVideoDetailRunRecord['safeguards'];
}

export interface BilibiliVideoDetailArtifactView {
  summary: BilibiliVideoDetailArtifactSummary;
  manifest: BilibiliVideoDetailArtifactManifest;
  detail: BilibiliVideoDetailProjection | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

function isSummary(value: unknown): value is BilibiliVideoDetailArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliVideoDetailArtifactSummary>;
  return candidate.schemaVersion === 2 &&
    typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId) &&
    typeof candidate.runId === 'string' && UUID_PATTERN.test(candidate.runId) &&
    candidate.platform === 'bilibili' &&
    typeof candidate.capturedAt === 'string' && Number.isFinite(Date.parse(candidate.capturedAt)) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.targetUrlDigest === 'string' && SHA256_PATTERN.test(candidate.targetUrlDigest) &&
    typeof candidate.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(candidate.bvid) &&
    typeof candidate.titleCaptured === 'boolean' &&
    typeof candidate.descriptionCaptured === 'boolean' &&
    typeof candidate.creatorCaptured === 'boolean' &&
    typeof candidate.tagCount === 'number' && Number.isSafeInteger(candidate.tagCount) && candidate.tagCount >= 0 &&
    typeof candidate.episodeSummaryCaptured === 'boolean' &&
    (candidate.accessStatus === null ||
      candidate.accessStatus === 'charge_exclusive_trial' ||
      candidate.accessStatus === 'login_required' ||
      candidate.accessStatus === 'indeterminate') &&
    typeof candidate.loginOverlayVisible === 'boolean' &&
    typeof candidate.terminalReason === 'string' &&
    typeof candidate.manifestSha256 === 'string' && SHA256_PATTERN.test(candidate.manifestSha256);
}

function compactSummary(
  manifest: BilibiliVideoDetailArtifactManifest,
  manifestSha256: string
): BilibiliVideoDetailArtifactSummary {
  return {
    schemaVersion: manifest.schemaVersion,
    artifactId: manifest.artifactId,
    runId: manifest.runId,
    platform: manifest.platform,
    capturedAt: manifest.capturedAt,
    state: manifest.state,
    targetUrlDigest: manifest.targetUrlDigest,
    bvid: manifest.bvid,
    titleCaptured: manifest.titleCaptured,
    descriptionCaptured: manifest.descriptionCaptured,
    creatorCaptured: manifest.creatorCaptured,
    tagCount: manifest.tagCount,
    episodeSummaryCaptured: manifest.episodeSummaryCaptured,
    accessStatus: manifest.accessStatus,
    loginOverlayVisible: manifest.loginOverlayVisible,
    terminalReason: manifest.terminalReason,
    manifestSha256
  };
}

export class BilibiliVideoDetailArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliVideoDetailArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-video-detail');
    this.#indexPath = resolve(stateDirectory, 'bilibili-video-detail-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliVideoDetailArtifactStore> {
    const store = new BilibiliVideoDetailArtifactStore(stateDirectory);
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

  list(): BilibiliVideoDetailArtifactSummary[] {
    return [...this.#summaries.values()].map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(run: BilibiliVideoDetailRunRecord): Promise<BilibiliVideoDetailArtifactSummary> {
    const existing = this.list().find((summary) => summary.runId === run.runId);
    if (existing) return existing;
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    let detailFile: typeof DETAIL_FILE | null = null;
    let detailFileSha256: string | null = null;
    if (run.detail) {
      const payload = { schemaVersion: 2, detail: run.detail };
      detailFile = DETAIL_FILE;
      detailFileSha256 = sha256(canonicalJson(payload));
      await atomicWrite(resolve(directory, detailFile), payload);
    }
    const manifest: BilibiliVideoDetailArtifactManifest = {
      schemaVersion: 2,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      bvid: run.bvid,
      titleCaptured: run.coverage.titleCaptured,
      descriptionCaptured: run.coverage.descriptionCaptured,
      creatorCaptured: run.coverage.creatorCaptured,
      tagCount: run.coverage.tagCount,
      episodeSummaryCaptured: run.coverage.episodeSummaryCaptured,
      accessStatus: run.coverage.accessStatus,
      loginOverlayVisible: run.coverage.loginOverlayVisible,
      terminalReason: run.coverage.terminalReason,
      collectorVersion: run.collectorVersion,
      strategyCandidate: run.strategyCandidate,
      actions: run.actions,
      coverage: run.coverage,
      detailFile,
      detailFileSha256,
      visualEvidence: run.visualEvidence,
      ...(run.bindingDiagnostics ? { bindingDiagnostics: structuredClone(run.bindingDiagnostics) } : {}),
      safeguards: run.safeguards
    };
    const manifestSha256 = sha256(canonicalJson(manifest));
    await atomicWrite(resolve(directory, 'manifest.json'), manifest);
    const summary = compactSummary(manifest, manifestSha256);
    this.#summaries.set(summary.artifactId, summary);
    await this.#saveIndex();
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<BilibiliVideoDetailArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const directory = resolve(this.#rootDirectory, artifactId);
    const manifest = JSON.parse(
      await readFile(resolve(directory, 'manifest.json'), 'utf8')
    ) as BilibiliVideoDetailArtifactManifest;
    if (sha256(canonicalJson(manifest)) !== summary.manifestSha256) {
      throw new Error('bilibili_video_detail_manifest_digest_mismatch');
    }
    let detail: BilibiliVideoDetailProjection | null = null;
    if (manifest.detailFile) {
      if (manifest.detailFile !== DETAIL_FILE || !manifest.detailFileSha256) {
        throw new Error('bilibili_video_detail_reference_invalid');
      }
      const payload = JSON.parse(await readFile(resolve(directory, manifest.detailFile), 'utf8')) as {
        schemaVersion?: unknown;
        detail?: BilibiliVideoDetailProjection;
      };
      if (
        payload.schemaVersion !== 2 ||
        !payload.detail ||
        sha256(canonicalJson(payload)) !== manifest.detailFileSha256
      ) throw new Error('bilibili_video_detail_detail_digest_mismatch');
      detail = payload.detail;
    } else if (manifest.detailFileSha256 !== null) {
      throw new Error('bilibili_video_detail_reference_invalid');
    }
    return {
      summary: structuredClone(summary),
      manifest: structuredClone(manifest),
      detail: structuredClone(detail)
    };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
