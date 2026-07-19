import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  TranscriptCapabilityValidationRunSnapshot,
  TranscriptInteractionActionResult
} from '../../collector-extension/src/shared/protocol';
import {
  bilibiliTranscriptResearchRouteIds,
  sanitiseNetworkCaptureObservation,
  type NetworkCaptureObservation
} from '../../collector-extension/src/shared/network-capture';
import type {
  BilibiliTranscriptDirectoryProjection,
  BilibiliTranscriptDocumentProjection
} from '../../collector-extension/src/shared/transcript-capture';

const INDEX_SCHEMA_VERSION = 1;
const MAX_INDEX_RECORDS = 500;

export interface BilibiliTranscriptValidationInput {
  canonicalUrl: string;
}

export function bilibiliTranscriptValidationInput(value: unknown): BilibiliTranscriptValidationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('transcript_validation_input_invalid');
  }
  const candidate = value as Partial<BilibiliTranscriptValidationInput>;
  if (Object.keys(candidate).some((key) => key !== 'canonicalUrl')) {
    throw new Error('transcript_validation_input_invalid');
  }
  if (
    typeof candidate.canonicalUrl !== 'string' ||
    !/^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}$/.test(candidate.canonicalUrl)
  ) throw new Error('transcript_validation_url_invalid');
  return { canonicalUrl: candidate.canonicalUrl };
}

export interface TranscriptArtifactManifest {
  schemaVersion: 1;
  artifactKind: 'bilibili_transcript_evidence_package';
  recordId: string;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  targetUrlDigest: string;
  state: TranscriptCapabilityValidationRunSnapshot['state'];
  terminalStatus: TranscriptCapabilityValidationRunSnapshot['terminalStatus'];
  errorCode: string | null;
  objectiveStatus: 'satisfied' | 'partial' | 'not_satisfied' | 'unavailable';
  actions: TranscriptInteractionActionResult[];
  language: string | null;
  segmentCount: number;
  transcriptPartial: boolean;
  captureCount: number;
  trackDirectorySha256: string | null;
  transcriptDocumentSha256: string | null;
  startedAt: string;
  completedAt: string;
  recordedAt: string;
  safeguards: {
    admissionEligible: false;
    productionResponseRoutes: 'unchanged_empty';
    browserCredentialData: 'not_collected';
    queryAndFragmentValues: 'discarded';
    profileAndBrowserRuntimeIds: 'omitted';
    storage: 'local_raw_public_transcript_json';
  };
}

export interface TranscriptArtifactRecord {
  manifest: TranscriptArtifactManifest;
  trackDirectory: BilibiliTranscriptDirectoryProjection | null;
  transcriptDocument: BilibiliTranscriptDocumentProjection | null;
  sources: Array<{
    routeId: string;
    responseUrl: string;
    contentType: string;
    httpStatus: number;
    capturedAt: number;
  }>;
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeCode(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9_]{1,100}$/.test(value) ? value : null;
}

function safeIso(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function safeActions(value: unknown): TranscriptInteractionActionResult[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const action = candidate as Partial<TranscriptInteractionActionResult>;
    if (
      (action.action !== 'reveal_player_controls' &&
        action.action !== 'open_caption_menu' &&
        action.action !== 'select_caption_language') ||
      typeof action.attempted !== 'boolean' ||
      !['completed', 'control_missing', 'option_unavailable', 'prerequisite_unmet',
        'postcondition_unmet', 'page_unavailable', 'context_changed',
        'network_unavailable', 'risk_detected'].includes(action.outcome ?? '')
    ) return [];
    return [{
      action: action.action,
      attempted: action.attempted,
      outcome: action.outcome!,
      visibleLabels: Array.isArray(action.visibleLabels)
        ? action.visibleLabels.filter((label): label is string =>
          typeof label === 'string' && label.length > 0 && label.length <= 300
        ).slice(0, 40)
        : [],
      selectedLabel: typeof action.selectedLabel === 'string' &&
        /^(?:中文|汉语)(?:[（(].{1,30}[）)])?$/.test(action.selectedLabel)
        ? action.selectedLabel
        : null,
      postconditionAcknowledged: typeof action.postconditionAcknowledged === 'boolean'
        ? action.postconditionAcknowledged
        : null
    }];
  });
}

function sanitiseSnapshot(snapshot: TranscriptCapabilityValidationRunSnapshot): {
  runId: string;
  collectorVersion: string;
  targetUrlDigest: string;
  state: TranscriptCapabilityValidationRunSnapshot['state'];
  terminalStatus: TranscriptCapabilityValidationRunSnapshot['terminalStatus'];
  errorCode: string | null;
  objectiveStatus: TranscriptArtifactManifest['objectiveStatus'];
  actions: TranscriptInteractionActionResult[];
  captures: NetworkCaptureObservation[];
  startedAt: string;
  completedAt: string;
} {
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.platform !== 'bilibili' ||
    snapshot.accountCategory !== 'user_managed' ||
    snapshot.evidenceObjective !== 'transcript_read' ||
    !/^[0-9a-f-]{36}$/i.test(snapshot.runId) ||
    !/^[0-9a-f]{64}$/.test(snapshot.targetUrlDigest) ||
    !snapshot.safeguards ||
    snapshot.safeguards.admissionEligible !== false ||
    snapshot.safeguards.productionResponseRoutes !== 'unchanged_empty'
  ) throw new Error('transcript_artifact_snapshot_invalid');
  const startedAt = safeIso(snapshot.startedAt);
  const completedAt = safeIso(snapshot.completedAt);
  if (!startedAt || !completedAt) throw new Error('transcript_artifact_timestamp_invalid');
  const routeIds = bilibiliTranscriptResearchRouteIds();
  const captures = Array.isArray(snapshot.captures)
    ? snapshot.captures
        .map((capture) => sanitiseNetworkCaptureObservation(capture, routeIds))
        .filter((capture): capture is NetworkCaptureObservation => capture !== null)
        .slice(0, 3)
    : [];
  const objectiveStatus = snapshot.interaction?.objective?.status;
  return {
    runId: snapshot.runId,
    collectorVersion: snapshot.collectorVersion,
    targetUrlDigest: snapshot.targetUrlDigest,
    state: snapshot.state,
    terminalStatus: snapshot.terminalStatus,
    errorCode: safeCode(snapshot.errorCode),
    objectiveStatus: objectiveStatus === 'satisfied' || objectiveStatus === 'partial' || objectiveStatus === 'not_satisfied'
      ? objectiveStatus
      : 'unavailable',
    actions: safeActions(snapshot.interaction?.actions),
    captures,
    startedAt,
    completedAt
  };
}

function transcriptBodies(captures: readonly NetworkCaptureObservation[]): {
  trackDirectory: BilibiliTranscriptDirectoryProjection | null;
  transcriptDocument: BilibiliTranscriptDocumentProjection | null;
} {
  const directoryBody = captures.find((capture) =>
    capture.status === 'captured' && capture.routeId.includes('track-directory')
  )?.body;
  const transcriptBody = captures.find((capture) =>
    capture.status === 'captured' && capture.routeId.includes('transcript.document')
  )?.body;
  return {
    trackDirectory: directoryBody && typeof directoryBody === 'object' && !Array.isArray(directoryBody) &&
      directoryBody.artifactKind === 'bilibili_transcript_track_directory'
      ? directoryBody as unknown as BilibiliTranscriptDirectoryProjection
      : null,
    transcriptDocument: transcriptBody && typeof transcriptBody === 'object' && !Array.isArray(transcriptBody) &&
      transcriptBody.artifactKind === 'bilibili_public_subtitle_document'
      ? transcriptBody as unknown as BilibiliTranscriptDocumentProjection
      : null
  };
}

function isManifest(value: unknown): value is TranscriptArtifactManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<TranscriptArtifactManifest>;
  return (
    manifest.schemaVersion === 1 &&
    manifest.artifactKind === 'bilibili_transcript_evidence_package' &&
    typeof manifest.recordId === 'string' && /^[0-9a-f-]{36}$/i.test(manifest.recordId) &&
    typeof manifest.runId === 'string' && /^[0-9a-f-]{36}$/i.test(manifest.runId) &&
    typeof manifest.targetUrlDigest === 'string' && /^[0-9a-f]{64}$/.test(manifest.targetUrlDigest) &&
    manifest.platform === 'bilibili' &&
    typeof manifest.segmentCount === 'number' && Number.isSafeInteger(manifest.segmentCount) &&
    typeof manifest.recordedAt === 'string'
  );
}

export class TranscriptArtifactRegistry {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #manifests = new Map<string, TranscriptArtifactManifest>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'transcripts');
    this.#indexPath = resolve(stateDirectory, 'transcript-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<TranscriptArtifactRegistry> {
    const registry = new TranscriptArtifactRegistry(stateDirectory);
    await mkdir(registry.#rootDirectory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(registry.#indexPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        for (const manifest of parsed.filter(isManifest).slice(0, MAX_INDEX_RECORDS)) {
          registry.#manifests.set(manifest.recordId, manifest);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return registry;
  }

  list(): TranscriptArtifactManifest[] {
    return [...this.#manifests.values()]
      .sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt))
      .map((manifest) => structuredClone(manifest));
  }

  async record(
    snapshot: TranscriptCapabilityValidationRunSnapshot,
    now = new Date()
  ): Promise<TranscriptArtifactManifest> {
    const existing = [...this.#manifests.values()].find((manifest) => manifest.runId === snapshot.runId);
    if (existing) return structuredClone(existing);
    const safe = sanitiseSnapshot(snapshot);
    const { trackDirectory, transcriptDocument } = transcriptBodies(safe.captures);
    if (!trackDirectory && !transcriptDocument) throw new Error('transcript_artifact_has_no_public_content');
    const recordId = randomUUID();
    const recordDirectory = resolve(this.#rootDirectory, recordId);
    await mkdir(recordDirectory, { recursive: false, mode: 0o700 });
    const sources = safe.captures.map((capture) => ({
      routeId: capture.routeId,
      responseUrl: capture.responseUrl,
      contentType: capture.contentType,
      httpStatus: capture.httpStatus,
      capturedAt: capture.capturedAt
    }));
    const manifest: TranscriptArtifactManifest = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      artifactKind: 'bilibili_transcript_evidence_package',
      recordId,
      runId: safe.runId,
      collectorVersion: safe.collectorVersion,
      platform: 'bilibili',
      targetUrlDigest: safe.targetUrlDigest,
      state: safe.state,
      terminalStatus: safe.terminalStatus,
      errorCode: safe.errorCode,
      objectiveStatus: safe.objectiveStatus,
      actions: safe.actions,
      language: transcriptDocument?.language ?? trackDirectory?.language ?? null,
      segmentCount: transcriptDocument?.storedSegmentCount ?? 0,
      transcriptPartial: transcriptDocument?.partial ?? true,
      captureCount: safe.captures.length,
      trackDirectorySha256: trackDirectory ? sha256Json(trackDirectory) : null,
      transcriptDocumentSha256: transcriptDocument ? sha256Json(transcriptDocument) : null,
      startedAt: safe.startedAt,
      completedAt: safe.completedAt,
      recordedAt: now.toISOString(),
      safeguards: {
        admissionEligible: false,
        productionResponseRoutes: 'unchanged_empty',
        browserCredentialData: 'not_collected',
        queryAndFragmentValues: 'discarded',
        profileAndBrowserRuntimeIds: 'omitted',
        storage: 'local_raw_public_transcript_json'
      }
    };
    await Promise.all([
      this.#atomicWrite(resolve(recordDirectory, 'manifest.json'), manifest),
      this.#atomicWrite(resolve(recordDirectory, 'sources.json'), sources),
      ...(trackDirectory ? [this.#atomicWrite(resolve(recordDirectory, 'track-directory.json'), trackDirectory)] : []),
      ...(transcriptDocument ? [this.#atomicWrite(resolve(recordDirectory, 'transcript-document.json'), transcriptDocument)] : [])
    ]);
    this.#manifests.set(recordId, manifest);
    await this.#saveIndex();
    return structuredClone(manifest);
  }

  async get(recordId: string): Promise<TranscriptArtifactRecord | null> {
    const manifest = this.#manifests.get(recordId);
    if (!manifest) return null;
    const recordDirectory = resolve(this.#rootDirectory, recordId);
    const readOptional = async <T>(name: string): Promise<T | null> => {
      try {
        return JSON.parse(await readFile(resolve(recordDirectory, name), 'utf8')) as T;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    };
    return {
      manifest: structuredClone(manifest),
      trackDirectory: await readOptional<BilibiliTranscriptDirectoryProjection>('track-directory.json'),
      transcriptDocument: await readOptional<BilibiliTranscriptDocumentProjection>('transcript-document.json'),
      sources: await readOptional<TranscriptArtifactRecord['sources']>('sources.json') ?? []
    };
  }

  async #atomicWrite(path: string, value: unknown): Promise<void> {
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, path);
  }

  async #saveIndex(): Promise<void> {
    const manifests = this.list().slice(0, MAX_INDEX_RECORDS);
    const write = this.#writeChain.then(() => this.#atomicWrite(this.#indexPath, manifests));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}
