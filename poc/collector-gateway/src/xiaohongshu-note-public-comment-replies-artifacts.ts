import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  isXiaohongshuPublicReplyThreadProjection,
  type XiaohongshuNotePublicCommentRepliesWorkItem,
  type XiaohongshuNotePublicCommentRepliesWorkResult
} from '@intelligence/collector-contracts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ARTIFACT_BYTES = 512 * 1024;

export interface XiaohongshuReplyArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  operationId: string;
  capability: 'xiaohongshu.note.public_comment_replies.v1';
  state: 'completed' | 'stopped';
  capturedAt: string;
  captureMode: 'network_projection' | 'dom_fallback' | 'hybrid' | 'none';
  replyCount: number;
  sha256: string;
}

export interface XiaohongshuReplyArtifactView {
  schemaVersion: 1;
  summary: XiaohongshuReplyArtifactSummary;
  provenance: {
    environment: 'user_owned_browser_extension';
    executionTarget: 'existing_public_note_overlay';
    platformNavigations: 0;
    pageReloads: 0;
    pageInitiatedNewTabs: 0;
    semanticActions: 0 | 1 | 2 | 3;
    rawPayloadStored: false;
    responseUrlsStored: false;
    debuggerDetached: boolean;
  };
  result: {
    state: 'completed' | 'stopped';
    errorCode: string | null;
    terminalReason: XiaohongshuNotePublicCommentRepliesWorkResult['terminalReason'];
    completedAt: string;
    navigation: XiaohongshuNotePublicCommentRepliesWorkResult['navigation'];
    semanticAction: XiaohongshuNotePublicCommentRepliesWorkResult['semanticAction'];
    thread: XiaohongshuNotePublicCommentRepliesWorkResult['thread'];
    page: XiaohongshuNotePublicCommentRepliesWorkResult['page'];
    projection: XiaohongshuNotePublicCommentRepliesWorkResult['projection'];
    projections?: XiaohongshuNotePublicCommentRepliesWorkResult['projections'];
  };
}

type ArtifactDraft = Omit<XiaohongshuReplyArtifactView, 'summary'>;

export class XiaohongshuReplyArtifactStore {
  readonly #root: string;
  readonly #index: string;
  readonly #summaries = new Map<string, XiaohongshuReplyArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(directory: string) {
    this.#root = resolve(directory, 'xiaohongshu-comment-reply-artifacts');
    this.#index = resolve(directory, 'xiaohongshu-comment-reply-artifacts.json');
  }

  static async create(directory: string): Promise<XiaohongshuReplyArtifactStore> {
    const store = new XiaohongshuReplyArtifactStore(directory);
    await mkdir(store.#root, { recursive: true, mode: 0o700 });
    try {
      const value = JSON.parse(await readFile(store.#index, 'utf8')) as unknown;
      if (Array.isArray(value)) {
        for (const summary of value) {
          if (isArtifactSummary(summary)) store.#summaries.set(summary.artifactId, summary);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  list(): XiaohongshuReplyArtifactSummary[] {
    return [...this.#summaries.values()].map((value) => structuredClone(value));
  }

  async record(input: {
    item: XiaohongshuNotePublicCommentRepliesWorkItem;
    result: XiaohongshuNotePublicCommentRepliesWorkResult;
  }): Promise<XiaohongshuReplyArtifactSummary> {
    const existing = this.list().find((summary) => summary.operationId === input.item.operationId);
    if (existing) return existing;
    assertBinding(input.item, input.result);

    const artifactId = randomUUID();
    const draft = createArtifactDraft(input.result);
    const summary: XiaohongshuReplyArtifactSummary = {
      schemaVersion: 1,
      artifactId,
      operationId: input.item.operationId,
      capability: 'xiaohongshu.note.public_comment_replies.v1',
      state: input.result.state,
      capturedAt: input.result.completedAt,
      captureMode: input.result.projection?.captureMode ?? 'none',
      replyCount: input.result.projections
        ? input.result.projections.reduce((total, thread) => total + thread.replies.length, 0)
        : input.result.projection?.replies.length ?? 0,
      sha256: digest(canonicalJson(draft))
    };
    const stored: XiaohongshuReplyArtifactView = { ...draft, summary };
    const serialized = `${JSON.stringify(stored, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_ARTIFACT_BYTES) {
      throw new Error('xiaohongshu_reply_artifact_too_large');
    }

    await atomicWrite(resolve(this.#root, `${artifactId}.json`), stored);
    this.#summaries.set(artifactId, summary);
    const pendingWrite = this.#writeChain.then(() => atomicWrite(this.#index, this.list()));
    this.#writeChain = pendingWrite.catch(() => undefined);
    await pendingWrite;
    return structuredClone(summary);
  }

  async get(artifactId: string): Promise<XiaohongshuReplyArtifactView | null> {
    if (!UUID.test(artifactId)) throw new Error('xiaohongshu_reply_artifact_invalid');
    if (!this.#summaries.has(artifactId)) return null;
    const value = JSON.parse(
      await readFile(resolve(this.#root, `${artifactId}.json`), 'utf8')
    ) as unknown;
    if (!isStoredArtifact(value) || value.summary.artifactId !== artifactId) {
      throw new Error('xiaohongshu_reply_artifact_corrupt');
    }
    const { summary, ...draft } = value;
    if (digest(canonicalJson(draft)) !== summary.sha256) {
      throw new Error('xiaohongshu_reply_artifact_digest_mismatch');
    }
    return structuredClone(value);
  }
}

function assertBinding(
  item: XiaohongshuNotePublicCommentRepliesWorkItem,
  result: XiaohongshuNotePublicCommentRepliesWorkResult
): void {
  if (
    item.workId !== result.workId ||
    item.operationId !== result.operationId ||
    item.browserBindingId !== result.browserBindingId
  ) {
    throw new Error('xiaohongshu_reply_artifact_binding_invalid');
  }
}

function createArtifactDraft(result: XiaohongshuNotePublicCommentRepliesWorkResult): ArtifactDraft {
  return {
    schemaVersion: 1,
    provenance: {
      environment: 'user_owned_browser_extension',
      executionTarget: 'existing_public_note_overlay',
      platformNavigations: 0,
      pageReloads: 0,
      pageInitiatedNewTabs: 0,
      semanticActions: result.semanticAction.attemptCount,
      rawPayloadStored: false,
      responseUrlsStored: false,
      debuggerDetached: result.debuggerDetached
    },
    result: {
      state: result.state,
      errorCode: result.errorCode,
      terminalReason: result.terminalReason,
      completedAt: result.completedAt,
      navigation: structuredClone(result.navigation),
      semanticAction: structuredClone(result.semanticAction),
      thread: structuredClone(result.thread),
      page: structuredClone(result.page),
      projection: structuredClone(result.projection),
      ...(result.projections ? { projections: structuredClone(result.projections) } : {})
    }
  };
}

function isArtifactSummary(value: unknown): value is XiaohongshuReplyArtifactSummary {
  return isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.artifactId === 'string' && UUID.test(value.artifactId) &&
    typeof value.operationId === 'string' && UUID.test(value.operationId) &&
    value.capability === 'xiaohongshu.note.public_comment_replies.v1' &&
    (value.state === 'completed' || value.state === 'stopped') &&
    typeof value.capturedAt === 'string' && Number.isFinite(Date.parse(value.capturedAt)) &&
    ['network_projection', 'dom_fallback', 'hybrid', 'none'].includes(String(value.captureMode)) &&
    Number.isSafeInteger(value.replyCount) && Number(value.replyCount) >= 0 && Number(value.replyCount) <= 120 &&
    typeof value.sha256 === 'string' && SHA256.test(value.sha256);
}

function isStoredArtifact(value: unknown): value is XiaohongshuReplyArtifactView {
  return isRecord(value) &&
    isArtifactSummary(value.summary) &&
    isRecord(value.result) &&
    !containsForbiddenPrivateFields(value) &&
    (value.result.projection === null || isXiaohongshuPublicReplyThreadProjection(value.result.projection)) &&
    (value.result.projections === undefined || (Array.isArray(value.result.projections) &&
      value.result.projections.length >= 1 && value.result.projections.length <= 3 &&
      value.result.projections.every(isXiaohongshuPublicReplyThreadProjection)));
}

function containsForbiddenPrivateFields(value: unknown): boolean {
  return /"(?:url|responseUrl|route|query|header|cookie|token|rawPayload|tabId|documentId|selector|script|noteId|profileId)"\s*:/i
    .test(JSON.stringify(value));
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await rename(temporaryPath, path);
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
