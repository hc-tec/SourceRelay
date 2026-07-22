import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson } from '../../collector-extension/src/shared/cryptography';
import type {
  BilibiliNativeSearchProjection,
  BilibiliNativeSearchRunRecord
} from './bilibili-native-search-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RESULTS_FILE = 'results.json';

export interface BilibiliNativeSearchArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  runId: string;
  platform: 'bilibili';
  capturedAt: string;
  state: BilibiliNativeSearchRunRecord['state'];
  queryDigest: string;
  targetUrlDigest: string;
  visibleVideoCardCount: number;
  capturedItems: number;
  unresolvedCardCount: number;
  resultState: BilibiliNativeSearchRunRecord['coverage']['resultState'];
  loginOverlayVisible: boolean;
  terminalReason: BilibiliNativeSearchRunRecord['coverage']['terminalReason'];
  manifestSha256: string;
}

export interface BilibiliNativeSearchArtifactManifest
  extends Omit<BilibiliNativeSearchArtifactSummary, 'manifestSha256'> {
  collectorVersion: string;
  strategyCandidate: BilibiliNativeSearchRunRecord['strategyCandidate'];
  actions: BilibiliNativeSearchRunRecord['actions'];
  coverage: BilibiliNativeSearchRunRecord['coverage'];
  resultsFile: typeof RESULTS_FILE | null;
  resultsFileSha256: string | null;
  visualEvidence: BilibiliNativeSearchRunRecord['visualEvidence'];
  bindingDiagnostics?: BilibiliNativeSearchRunRecord['bindingDiagnostics'];
  safeguards: BilibiliNativeSearchRunRecord['safeguards'];
}

export interface BilibiliNativeSearchArtifactView {
  summary: BilibiliNativeSearchArtifactSummary;
  manifest: BilibiliNativeSearchArtifactManifest;
  results: BilibiliNativeSearchProjection | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

function isSummary(value: unknown): value is BilibiliNativeSearchArtifactSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliNativeSearchArtifactSummary>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId) &&
    typeof candidate.runId === 'string' && UUID_PATTERN.test(candidate.runId) &&
    candidate.platform === 'bilibili' &&
    typeof candidate.capturedAt === 'string' && Number.isFinite(Date.parse(candidate.capturedAt)) &&
    (candidate.state === 'completed' || candidate.state === 'partial' || candidate.state === 'failed') &&
    typeof candidate.queryDigest === 'string' && SHA256_PATTERN.test(candidate.queryDigest) &&
    typeof candidate.targetUrlDigest === 'string' && SHA256_PATTERN.test(candidate.targetUrlDigest) &&
    typeof candidate.visibleVideoCardCount === 'number' && Number.isSafeInteger(candidate.visibleVideoCardCount) && candidate.visibleVideoCardCount >= 0 &&
    typeof candidate.capturedItems === 'number' && Number.isSafeInteger(candidate.capturedItems) && candidate.capturedItems >= 0 &&
    typeof candidate.unresolvedCardCount === 'number' && Number.isSafeInteger(candidate.unresolvedCardCount) && candidate.unresolvedCardCount >= 0 &&
    (candidate.resultState === 'video_results' || candidate.resultState === 'no_video_results' || candidate.resultState === null) &&
    typeof candidate.loginOverlayVisible === 'boolean' &&
    typeof candidate.terminalReason === 'string' &&
    typeof candidate.manifestSha256 === 'string' && SHA256_PATTERN.test(candidate.manifestSha256);
}

function compactSummary(
  manifest: BilibiliNativeSearchArtifactManifest,
  manifestSha256: string
): BilibiliNativeSearchArtifactSummary {
  return {
    schemaVersion: manifest.schemaVersion,
    artifactId: manifest.artifactId,
    runId: manifest.runId,
    platform: manifest.platform,
    capturedAt: manifest.capturedAt,
    state: manifest.state,
    queryDigest: manifest.queryDigest,
    targetUrlDigest: manifest.targetUrlDigest,
    visibleVideoCardCount: manifest.visibleVideoCardCount,
    capturedItems: manifest.capturedItems,
    unresolvedCardCount: manifest.unresolvedCardCount,
    resultState: manifest.resultState,
    loginOverlayVisible: manifest.loginOverlayVisible,
    terminalReason: manifest.terminalReason,
    manifestSha256
  };
}

export class BilibiliNativeSearchArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, BilibiliNativeSearchArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'bilibili-native-search');
    this.#indexPath = resolve(stateDirectory, 'bilibili-native-search-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<BilibiliNativeSearchArtifactStore> {
    const store = new BilibiliNativeSearchArtifactStore(stateDirectory);
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

  list(): BilibiliNativeSearchArtifactSummary[] {
    return [...this.#summaries.values()].map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(run: BilibiliNativeSearchRunRecord): Promise<BilibiliNativeSearchArtifactSummary> {
    const existing = this.list().find((summary) => summary.runId === run.runId);
    if (existing) return existing;
    const artifactId = randomUUID();
    const directory = resolve(this.#rootDirectory, artifactId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    let resultsFile: typeof RESULTS_FILE | null = null;
    let resultsFileSha256: string | null = null;
    if (run.results) {
      const payload = { schemaVersion: 1, results: run.results };
      resultsFile = RESULTS_FILE;
      resultsFileSha256 = sha256(canonicalJson(payload));
      await atomicWrite(resolve(directory, resultsFile), payload);
    }
    const manifest: BilibiliNativeSearchArtifactManifest = {
      schemaVersion: 1,
      artifactId,
      runId: run.runId,
      platform: 'bilibili',
      capturedAt: run.completedAt,
      state: run.state,
      queryDigest: run.queryDigest,
      targetUrlDigest: run.targetUrlDigest,
      visibleVideoCardCount: run.coverage.visibleVideoCardCount,
      capturedItems: run.coverage.capturedItems,
      unresolvedCardCount: run.coverage.unresolvedCardCount,
      resultState: run.coverage.resultState,
      loginOverlayVisible: run.coverage.loginOverlayVisible,
      terminalReason: run.coverage.terminalReason,
      collectorVersion: run.collectorVersion,
      strategyCandidate: run.strategyCandidate,
      actions: run.actions,
      coverage: run.coverage,
      resultsFile,
      resultsFileSha256,
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

  async get(artifactId: string): Promise<BilibiliNativeSearchArtifactView | null> {
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const directory = resolve(this.#rootDirectory, artifactId);
    const manifest = JSON.parse(
      await readFile(resolve(directory, 'manifest.json'), 'utf8')
    ) as BilibiliNativeSearchArtifactManifest;
    if (sha256(canonicalJson(manifest)) !== summary.manifestSha256) {
      throw new Error('bilibili_native_search_manifest_digest_mismatch');
    }
    let results: BilibiliNativeSearchProjection | null = null;
    if (manifest.resultsFile) {
      if (manifest.resultsFile !== RESULTS_FILE || !manifest.resultsFileSha256) {
        throw new Error('bilibili_native_search_reference_invalid');
      }
      const payload = JSON.parse(await readFile(resolve(directory, manifest.resultsFile), 'utf8')) as {
        schemaVersion?: unknown;
        results?: BilibiliNativeSearchProjection;
      };
      if (
        payload.schemaVersion !== 1 ||
        !payload.results ||
        sha256(canonicalJson(payload)) !== manifest.resultsFileSha256
      ) throw new Error('bilibili_native_search_results_digest_mismatch');
      results = payload.results;
    } else if (manifest.resultsFileSha256 !== null) {
      throw new Error('bilibili_native_search_reference_invalid');
    }
    return {
      summary: structuredClone(summary),
      manifest: structuredClone(manifest),
      results: structuredClone(results)
    };
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
