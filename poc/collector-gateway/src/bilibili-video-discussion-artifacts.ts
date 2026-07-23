import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type { BilibiliVideoDiscussionRunRecord } from './bilibili-video-discussion-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DISCUSSION_FILE = 'discussion.json';

export interface BilibiliVideoDiscussionArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  runId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliVideoDiscussionRunRecord['state'];
  targetUrlDigest: string;
  bvid: string;
  capturedRootComments: number;
  sort: BilibiliVideoDiscussionRunRecord['coverage']['sort'];
  loginGateVisible: boolean;
  terminalReason: BilibiliVideoDiscussionRunRecord['coverage']['terminalReason'];
  manifestSha256: string;
}

export interface BilibiliVideoDiscussionArtifactManifest
  extends Omit<BilibiliVideoDiscussionArtifactSummary, 'manifestSha256'> {
  collectorVersion: string;
  strategyCandidate: BilibiliVideoDiscussionRunRecord['strategyCandidate'];
  actions: BilibiliVideoDiscussionRunRecord['actions'];
  interactions: BilibiliVideoDiscussionRunRecord['interactions'];
  coverage: BilibiliVideoDiscussionRunRecord['coverage'];
  discussionFile: typeof DISCUSSION_FILE | null;
  discussionFileSha256: string | null;
  visualEvidence: BilibiliVideoDiscussionRunRecord['visualEvidence'];
  bindingDiagnostics?: BilibiliVideoDiscussionRunRecord['bindingDiagnostics'];
  safeguards: BilibiliVideoDiscussionRunRecord['safeguards'];
}

export interface BilibiliVideoDiscussionArtifactView {
  summary: BilibiliVideoDiscussionArtifactSummary;
  manifest: BilibiliVideoDiscussionArtifactManifest;
  discussion: BilibiliVideoDiscussionRunRecord['discussion'];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

function isSummary(value: unknown): value is BilibiliVideoDiscussionArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliVideoDiscussionArtifactSummary>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId) &&
    typeof candidate.runId === 'string' && UUID_PATTERN.test(candidate.runId) &&
    candidate.platform === 'bilibili' &&
    typeof candidate.capturedAt === 'string' && Number.isFinite(Date.parse(candidate.capturedAt)) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.targetUrlDigest === 'string' && SHA256_PATTERN.test(candidate.targetUrlDigest) &&
    typeof candidate.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(candidate.bvid) &&
    typeof candidate.capturedRootComments === 'number' && Number.isSafeInteger(candidate.capturedRootComments) &&
    candidate.capturedRootComments >= 0 &&
    (candidate.sort === null || candidate.sort === 'hot' || candidate.sort === 'latest' || candidate.sort === 'unknown') &&
    typeof candidate.loginGateVisible === 'boolean' &&
    typeof candidate.terminalReason === 'string' &&
    typeof candidate.manifestSha256 === 'string' && SHA256_PATTERN.test(candidate.manifestSha256);
}

function compactSummary(
  manifest: BilibiliVideoDiscussionArtifactManifest,
  manifestSha256: string
): BilibiliVideoDiscussionArtifactSummary {
  return {
    schemaVersion: manifest.schemaVersion,
    artifactId: manifest.artifactId,
    runId: manifest.runId,
    platform: manifest.platform,
    capturedAt: manifest.capturedAt,
    state: manifest.state,
    targetUrlDigest: manifest.targetUrlDigest,
    bvid: manifest.bvid,
    capturedRootComments: manifest.coverage.capturedRootComments,
    sort: manifest.coverage.sort,
    loginGateVisible: manifest.coverage.loginGateVisible,
    terminalReason: manifest.terminalReason,
    manifestSha256
  };
}

export class BilibiliVideoDiscussionArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliVideoDiscussionArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-video-discussion');
    this.#indexPath = resolve(stateDirectory, 'bilibili-video-discussion-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliVideoDiscussionArtifactStore> {
    const store = new BilibiliVideoDiscussionArtifactStore(stateDirectory);
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

  list(): BilibiliVideoDiscussionArtifactSummary[] {
    return [...this.#summaries.values()].map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(run: BilibiliVideoDiscussionRunRecord): Promise<BilibiliVideoDiscussionArtifactSummary> {
    const existing = this.list().find((summary) => summary.runId === run.runId);
    if (existing) return existing;
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    let discussionFile: typeof DISCUSSION_FILE | null = null;
    let discussionFileSha256: string | null = null;
    if (run.discussion) {
      const payload = { schemaVersion: 1, discussion: run.discussion };
      discussionFile = DISCUSSION_FILE;
      discussionFileSha256 = sha256(canonicalJson(payload));
      await atomicWrite(resolve(directory, discussionFile), payload);
    }
    const manifest: BilibiliVideoDiscussionArtifactManifest = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      targetUrlDigest: run.targetUrlDigest,
      bvid: run.bvid,
      capturedRootComments: run.coverage.capturedRootComments,
      sort: run.coverage.sort,
      loginGateVisible: run.coverage.loginGateVisible,
      terminalReason: run.coverage.terminalReason,
      collectorVersion: run.collectorVersion,
      strategyCandidate: run.strategyCandidate,
      actions: run.actions,
      interactions: run.interactions,
      coverage: run.coverage,
      discussionFile,
      discussionFileSha256,
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

  async get(artifactId: string): Promise<BilibiliVideoDiscussionArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const directory = resolve(this.#rootDirectory, artifactId);
    const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')) as BilibiliVideoDiscussionArtifactManifest;
    if (sha256(canonicalJson(manifest)) !== summary.manifestSha256) {
      throw new Error('bilibili_video_discussion_manifest_digest_mismatch');
    }
    let discussion: BilibiliVideoDiscussionRunRecord['discussion'] = null;
    if (manifest.discussionFile) {
      if (manifest.discussionFile !== DISCUSSION_FILE || !manifest.discussionFileSha256) {
        throw new Error('bilibili_video_discussion_reference_invalid');
      }
      const payload = JSON.parse(await readFile(resolve(directory, manifest.discussionFile), 'utf8')) as {
        schemaVersion?: unknown;
        discussion?: BilibiliVideoDiscussionRunRecord['discussion'];
      };
      if (payload.schemaVersion !== 1 || !payload.discussion || sha256(canonicalJson(payload)) !== manifest.discussionFileSha256) {
        throw new Error('bilibili_video_discussion_detail_digest_mismatch');
      }
      discussion = payload.discussion;
    } else if (manifest.discussionFileSha256 !== null) {
      throw new Error('bilibili_video_discussion_reference_invalid');
    }
    return { summary: structuredClone(summary), manifest: structuredClone(manifest), discussion: structuredClone(discussion) };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
