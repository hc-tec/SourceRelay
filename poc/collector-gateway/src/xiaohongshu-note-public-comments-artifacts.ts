import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  isXiaohongshuNotePublicCommentsProjection,
  type XiaohongshuNotePublicCommentsWorkItem,
  type XiaohongshuNotePublicCommentsWorkResult
} from '@intelligence/collector-contracts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_BYTES = 256 * 1024;

export interface XiaohongshuNotePublicCommentsArtifactSummary {
  schemaVersion: 1; artifactId: string; operationId: string;
  capability: 'xiaohongshu.note.public_comments.v1'; state: 'completed' | 'stopped'; capturedAt: string;
  captureMode: 'network_projection' | 'dom_fallback' | 'hybrid' | 'none'; commentCount: number; sha256: string;
}
export interface XiaohongshuNotePublicCommentsArtifactView {
  schemaVersion: 1; summary: XiaohongshuNotePublicCommentsArtifactSummary;
  provenance: { environment: 'user_owned_browser_extension'; executionTarget: 'existing_public_note_overlay';
    platformNavigations: 0; pageReloads: 0; pageInitiatedNewTabs: 0; semanticActions: 0 | 1 | 2 | 3;
    rawPayloadStored: false; responseUrlsStored: false; debuggerDetached: boolean };
  result: { state: 'completed' | 'stopped'; errorCode: string | null;
    terminalReason: XiaohongshuNotePublicCommentsWorkResult['terminalReason']; completedAt: string;
    navigation: { attempted: false; attemptCount: 0 };
    semanticAction: XiaohongshuNotePublicCommentsWorkResult['semanticAction'];
    scroll: XiaohongshuNotePublicCommentsWorkResult['scroll']; page: XiaohongshuNotePublicCommentsWorkResult['page'];
    projection: XiaohongshuNotePublicCommentsWorkResult['projection'] };
}

export class XiaohongshuNotePublicCommentsArtifactStore {
  readonly #root: string; readonly #index: string;
  readonly #summaries = new Map<string, XiaohongshuNotePublicCommentsArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();
  private constructor(stateDirectory: string) {
    this.#root = resolve(stateDirectory, 'xiaohongshu-note-public-comments-artifacts');
    this.#index = resolve(stateDirectory, 'xiaohongshu-note-public-comments-artifacts.json');
  }
  static async create(stateDirectory: string): Promise<XiaohongshuNotePublicCommentsArtifactStore> {
    const store = new XiaohongshuNotePublicCommentsArtifactStore(stateDirectory);
    await mkdir(store.#root, { recursive: true, mode: 0o700 });
    try { const value = JSON.parse(await readFile(store.#index, 'utf8')) as unknown;
      if (Array.isArray(value)) for (const summary of value) if (isSummary(summary)) store.#summaries.set(summary.artifactId, summary);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return store;
  }
  list(): XiaohongshuNotePublicCommentsArtifactSummary[] {
    return [...this.#summaries.values()].map((value) => structuredClone(value));
  }
  async record(input: { item: XiaohongshuNotePublicCommentsWorkItem; result: XiaohongshuNotePublicCommentsWorkResult }):
  Promise<XiaohongshuNotePublicCommentsArtifactSummary> {
    const existing = this.list().find((summary) => summary.operationId === input.item.operationId);
    if (existing) return existing;
    if (input.item.operationId !== input.result.operationId || input.item.workId !== input.result.workId ||
      input.item.browserBindingId !== input.result.browserBindingId) throw new Error('xiaohongshu_note_public_comments_artifact_binding_invalid');
    const artifactId = randomUUID();
    const draft = { schemaVersion: 1 as const, provenance: { environment: 'user_owned_browser_extension' as const,
      executionTarget: 'existing_public_note_overlay' as const, platformNavigations: 0 as const, pageReloads: 0 as const,
      pageInitiatedNewTabs: 0 as const, semanticActions: input.result.semanticAction.attemptCount,
      rawPayloadStored: false as const, responseUrlsStored: false as const, debuggerDetached: input.result.debuggerDetached },
      result: { state: input.result.state, errorCode: input.result.errorCode, terminalReason: input.result.terminalReason,
        completedAt: input.result.completedAt, navigation: structuredClone(input.result.navigation),
        semanticAction: structuredClone(input.result.semanticAction), scroll: structuredClone(input.result.scroll),
        page: structuredClone(input.result.page), projection: structuredClone(input.result.projection) } };
    const summary: XiaohongshuNotePublicCommentsArtifactSummary = { schemaVersion: 1, artifactId,
      operationId: input.item.operationId, capability: 'xiaohongshu.note.public_comments.v1', state: input.result.state,
      capturedAt: input.result.completedAt, captureMode: input.result.projection?.captureMode ?? 'none',
      commentCount: input.result.projection?.comments.length ?? 0, sha256: sha256(canonicalJson(draft)) };
    const stored: XiaohongshuNotePublicCommentsArtifactView = { ...draft, summary };
    const serialized = `${JSON.stringify(stored, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) throw new Error('xiaohongshu_note_public_comments_artifact_payload_too_large');
    await atomicWrite(resolve(this.#root, `${artifactId}.json`), stored); this.#summaries.set(artifactId, summary);
    const write = this.#writeChain.then(() => atomicWrite(this.#index, this.list())); this.#writeChain = write.catch(() => undefined);
    await write; return structuredClone(summary);
  }
  async get(artifactId: string): Promise<XiaohongshuNotePublicCommentsArtifactView | null> {
    if (!UUID.test(artifactId)) throw new Error('xiaohongshu_note_public_comments_artifact_invalid');
    if (!this.#summaries.has(artifactId)) return null;
    const value = JSON.parse(await readFile(resolve(this.#root, `${artifactId}.json`), 'utf8')) as unknown;
    if (!isStored(value) || value.summary.artifactId !== artifactId) throw new Error('xiaohongshu_note_public_comments_artifact_corrupt');
    const { summary, ...draft } = value;
    if (sha256(canonicalJson(draft)) !== summary.sha256) throw new Error('xiaohongshu_note_public_comments_artifact_digest_mismatch');
    return structuredClone(value);
  }
}
function isSummary(value: unknown): value is XiaohongshuNotePublicCommentsArtifactSummary { return record(value) && value.schemaVersion === 1 &&
  uuid(value.artifactId) && uuid(value.operationId) && value.capability === 'xiaohongshu.note.public_comments.v1' &&
  (value.state === 'completed' || value.state === 'stopped') && timestamp(value.capturedAt) &&
  ['network_projection', 'dom_fallback', 'hybrid', 'none'].includes(value.captureMode) &&
  Number.isSafeInteger(value.commentCount) && value.commentCount >= 0 && value.commentCount <= 80 &&
  typeof value.sha256 === 'string' && SHA256.test(value.sha256); }
function isStored(value: unknown): value is XiaohongshuNotePublicCommentsArtifactView { return record(value) && isSummary(value.summary) &&
  record(value.result) && !containsForbidden(value) && (value.result.projection === null ||
    isXiaohongshuNotePublicCommentsProjection(value.result.projection)); }
function containsForbidden(value: unknown): boolean { return /"(?:url|responseUrl|route|query|header|cookie|token|rawPayload|tabId|documentId|selector|script|noteId|profileId)"\s*:/i.test(JSON.stringify(value)); }
async function atomicWrite(path: string, value: unknown): Promise<void> { const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); await rename(temporary, path); }
function canonicalJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value); }
function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function record(value: unknown): value is Record<string, any> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
