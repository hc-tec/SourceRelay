import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  isXiaohongshuNotePublicDetailProjection,
  type XiaohongshuNotePublicDetailWorkItem,
  type XiaohongshuNotePublicDetailWorkResult
} from '@intelligence/collector-contracts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_BYTES = 64 * 1024;

export interface XiaohongshuNotePublicDetailArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  operationId: string;
  capability: 'xiaohongshu.note.public_detail.v1';
  state: 'completed' | 'stopped';
  capturedAt: string;
  captureMode: 'network_projection' | 'dom_fallback' | 'none';
  sha256: string;
}

export interface XiaohongshuNotePublicDetailArtifactView {
  schemaVersion: 1;
  summary: XiaohongshuNotePublicDetailArtifactSummary;
  provenance: {
    environment: 'user_owned_browser_extension';
    executionTarget: 'existing_public_search_tab' | 'existing_public_profile_tab';
    platformNavigations: 0;
    pageReloads: 0;
    pageInitiatedNewTabs: 0;
    semanticActions: 0 | 1;
    rawPayloadStored: false;
    responseUrlsStored: false;
    debuggerDetached: boolean;
  };
  result: {
    state: 'completed' | 'stopped';
    errorCode: string | null;
    terminalReason: XiaohongshuNotePublicDetailWorkResult['terminalReason'];
    completedAt: string;
    navigation: { attempted: false; attemptCount: 0 };
    semanticAction: XiaohongshuNotePublicDetailWorkResult['semanticAction'];
    page: XiaohongshuNotePublicDetailWorkResult['page'];
    projection: XiaohongshuNotePublicDetailWorkResult['projection'];
  };
}

type StoredArtifact = XiaohongshuNotePublicDetailArtifactView;

export class XiaohongshuNotePublicDetailArtifactStore {
  readonly #root: string;
  readonly #index: string;
  readonly #summaries = new Map<string, XiaohongshuNotePublicDetailArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#root = resolve(stateDirectory, 'xiaohongshu-note-public-detail-artifacts');
    this.#index = resolve(stateDirectory, 'xiaohongshu-note-public-detail-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<XiaohongshuNotePublicDetailArtifactStore> {
    const store = new XiaohongshuNotePublicDetailArtifactStore(stateDirectory);
    await mkdir(store.#root, { recursive: true, mode: 0o700 });
    try {
      const value = JSON.parse(await readFile(store.#index, 'utf8')) as unknown;
      if (Array.isArray(value)) for (const summary of value) if (isSummary(summary)) {
        store.#summaries.set(summary.artifactId, summary);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  list(): XiaohongshuNotePublicDetailArtifactSummary[] {
    return [...this.#summaries.values()].map((value) => structuredClone(value));
  }

  async record(input: {
    item: XiaohongshuNotePublicDetailWorkItem;
    result: XiaohongshuNotePublicDetailWorkResult;
  }): Promise<XiaohongshuNotePublicDetailArtifactSummary> {
    const existing = this.list().find((summary) => summary.operationId === input.item.operationId);
    if (existing) return existing;
    if (input.item.operationId !== input.result.operationId || input.item.workId !== input.result.workId ||
      input.item.browserBindingId !== input.result.browserBindingId) {
      throw new Error('xiaohongshu_note_public_detail_artifact_binding_invalid');
    }
    const artifactId = randomUUID();
    const draft = {
      schemaVersion: 1 as const,
      provenance: {
        environment: 'user_owned_browser_extension' as const,
        executionTarget: input.result.executionTarget,
        platformNavigations: 0 as const,
        pageReloads: 0 as const,
        pageInitiatedNewTabs: 0 as const,
        semanticActions: input.result.semanticAction.attemptCount,
        rawPayloadStored: false as const,
        responseUrlsStored: false as const,
        debuggerDetached: input.result.debuggerDetached
      },
      result: {
        state: input.result.state,
        errorCode: input.result.errorCode,
        terminalReason: input.result.terminalReason,
        completedAt: input.result.completedAt,
        navigation: structuredClone(input.result.navigation),
        semanticAction: structuredClone(input.result.semanticAction),
        page: structuredClone(input.result.page),
        projection: structuredClone(input.result.projection)
      }
    };
    const summary: XiaohongshuNotePublicDetailArtifactSummary = {
      schemaVersion: 1,
      artifactId,
      operationId: input.item.operationId,
      capability: 'xiaohongshu.note.public_detail.v1',
      state: input.result.state,
      capturedAt: input.result.completedAt,
      captureMode: input.result.projection?.captureMode ?? 'none',
      sha256: sha256(canonicalJson(draft))
    };
    const stored: StoredArtifact = { ...draft, summary };
    const serialized = `${JSON.stringify(stored, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) {
      throw new Error('xiaohongshu_note_public_detail_artifact_payload_too_large');
    }
    await atomicWrite(resolve(this.#root, `${artifactId}.json`), stored);
    this.#summaries.set(artifactId, summary);
    const write = this.#writeChain.then(() => atomicWrite(this.#index, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<XiaohongshuNotePublicDetailArtifactView | null> {
    if (!UUID.test(artifactId)) throw new Error('xiaohongshu_note_public_detail_artifact_invalid');
    if (!this.#summaries.has(artifactId)) return null;
    const value = JSON.parse(await readFile(resolve(this.#root, `${artifactId}.json`), 'utf8')) as unknown;
    if (!isStored(value) || value.summary.artifactId !== artifactId) {
      throw new Error('xiaohongshu_note_public_detail_artifact_corrupt');
    }
    const { summary, ...draft } = value;
    if (sha256(canonicalJson(draft)) !== summary.sha256) {
      throw new Error('xiaohongshu_note_public_detail_artifact_digest_mismatch');
    }
    return structuredClone(value);
  }
}

function isSummary(value: unknown): value is XiaohongshuNotePublicDetailArtifactSummary {
  return record(value) && value.schemaVersion === 1 && uuid(value.artifactId) && uuid(value.operationId) &&
    value.capability === 'xiaohongshu.note.public_detail.v1' &&
    (value.state === 'completed' || value.state === 'stopped') && timestamp(value.capturedAt) &&
    (value.captureMode === 'network_projection' || value.captureMode === 'dom_fallback' || value.captureMode === 'none') &&
    typeof value.sha256 === 'string' && SHA256.test(value.sha256);
}

function isStored(value: unknown): value is StoredArtifact {
  if (!record(value) || !isSummary(value.summary) || !record(value.result) || containsForbidden(value)) return false;
  return value.schemaVersion === 1 &&
    (value.result.projection === null || isXiaohongshuNotePublicDetailProjection(value.result.projection));
}

function containsForbidden(value: unknown): boolean {
  return /"(?:url|responseUrl|route|query|header|cookie|token|rawPayload|tabId|documentId|selector|script)"\s*:/i
    .test(JSON.stringify(value));
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function record(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
