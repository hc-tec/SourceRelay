import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  isXiaohongshuManagedProfileNotesProjectionResult,
  type XiaohongshuProfileScrollCompletedCount,
  type XiaohongshuAccountPublicNotesWorkItem,
  type XiaohongshuAccountPublicNotesWorkResult
} from '@intelligence/collector-contracts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
// The profile-link capability can return up to 200 bounded note-card
// projections.  This is still only the sanitised projection (never a raw
// response), but the generic 128 KiB limit could reject a valid result near
// the declared item ceiling.
// Profile-link runs may return up to 200 cards plus their already-observed
// public descriptions. This remains a bounded sanitised projection, not a raw
// response archive.
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;

export interface XiaohongshuAccountPublicNotesArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  operationId: string;
  capability: 'xiaohongshu.account.public_notes.v1';
  state: 'completed' | 'stopped';
  capturedAt: string;
  itemCount: number;
  sha256: string;
}

export interface XiaohongshuAccountPublicNotesArtifactView {
  schemaVersion: 1;
  summary: XiaohongshuAccountPublicNotesArtifactSummary;
  provenance: {
    environment: 'user_owned_browser_extension';
    executionTarget: 'existing_public_profile_tab' | 'ephemeral_public_profile_url' | 'discover_public_profile_from_note';
    captureMode: 'current_document_network_projection_plus_trusted_scroll';
    platformNavigations: 0 | 1;
    pageReloads: 0;
    pageInitiatedNewTabs: 0 | 1;
    semanticActions: XiaohongshuProfileScrollCompletedCount;
    responseBodies: 'temporarily_read_projected_not_stored';
    rawPayloadStored: false;
    responseUrlsStored: false;
    debuggerDetached: boolean;
  };
  result: {
    state: 'completed' | 'stopped';
    errorCode: string | null;
    terminalReason: XiaohongshuAccountPublicNotesWorkResult['terminalReason'];
    completedAt: string;
    navigation: { attempted: boolean; attemptCount: 0 | 1 };
    semanticAction: XiaohongshuAccountPublicNotesWorkResult['semanticAction'];
    scroll: XiaohongshuAccountPublicNotesWorkResult['scroll'];
    page: XiaohongshuAccountPublicNotesWorkResult['page'];
    projection: XiaohongshuAccountPublicNotesWorkResult['projection'];
    profileLinkDiscovery: XiaohongshuAccountPublicNotesWorkResult['profileLinkDiscovery'];
  };
}

interface StoredArtifact extends XiaohongshuAccountPublicNotesArtifactView {}

export class XiaohongshuAccountPublicNotesArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, XiaohongshuAccountPublicNotesArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'xiaohongshu-account-public-notes-artifacts');
    this.#indexPath = resolve(stateDirectory, 'xiaohongshu-account-public-notes-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<XiaohongshuAccountPublicNotesArtifactStore> {
    const store = new XiaohongshuAccountPublicNotesArtifactStore(stateDirectory);
    await mkdir(store.#rootDirectory, { recursive: true, mode: 0o700 });
    try {
      const value = JSON.parse(await readFile(store.#indexPath, 'utf8')) as unknown;
      if (Array.isArray(value)) for (const summary of value) {
        if (isSummary(summary)) store.#summaries.set(summary.artifactId, summary);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  list(): XiaohongshuAccountPublicNotesArtifactSummary[] {
    return [...this.#summaries.values()].map((value) => structuredClone(value))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(input: {
    item: XiaohongshuAccountPublicNotesWorkItem;
    result: XiaohongshuAccountPublicNotesWorkResult;
  }): Promise<XiaohongshuAccountPublicNotesArtifactSummary> {
    const existing = this.list().find((summary) => summary.operationId === input.item.operationId);
    if (existing) return existing;
    if (input.item.operationId !== input.result.operationId || input.item.workId !== input.result.workId ||
      input.item.browserBindingId !== input.result.browserBindingId) {
      throw new Error('xiaohongshu_account_public_notes_artifact_binding_invalid');
    }
    const artifactId = randomUUID();
    const draft = {
      schemaVersion: 1 as const,
      artifactId,
      operationId: input.item.operationId,
      capability: 'xiaohongshu.account.public_notes.v1' as const,
      state: input.result.state,
      capturedAt: input.result.completedAt,
      provenance: {
        environment: 'user_owned_browser_extension' as const,
        executionTarget: input.result.executionTarget,
        captureMode: 'current_document_network_projection_plus_trusted_scroll' as const,
        platformNavigations: input.result.navigation.attemptCount,
        pageReloads: 0 as const,
        pageInitiatedNewTabs: (input.result.profileLinkDiscovery?.targetMode === 'new_tab' ? 1 : 0) as 0 | 1,
        semanticActions: input.result.semanticAction.attemptCount,
        responseBodies: 'temporarily_read_projected_not_stored' as const,
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
        scroll: structuredClone(input.result.scroll),
        page: structuredClone(input.result.page),
        projection: structuredClone(input.result.projection),
        profileLinkDiscovery: structuredClone(input.result.profileLinkDiscovery)
      }
    };
    const stored: StoredArtifact = {
      ...draft,
      summary: {
        schemaVersion: 1,
        artifactId,
        operationId: input.item.operationId,
        capability: 'xiaohongshu.account.public_notes.v1',
        state: input.result.state,
        capturedAt: input.result.completedAt,
        itemCount: input.result.projection?.items.length ?? 0,
        sha256: sha256(canonicalJson(draft))
      }
    };
    const serialized = `${JSON.stringify(stored, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_ARTIFACT_BYTES) {
      throw new Error('xiaohongshu_account_public_notes_artifact_payload_too_large');
    }
    await atomicWrite(resolve(this.#rootDirectory, `${artifactId}.json`), stored);
    this.#summaries.set(artifactId, stored.summary);
    await this.#saveIndex();
    return structuredClone(stored.summary);
  }

  async get(artifactId: string): Promise<XiaohongshuAccountPublicNotesArtifactView | null> {
    if (!UUID.test(artifactId)) throw new Error('xiaohongshu_account_public_notes_artifact_invalid');
    if (!this.#summaries.has(artifactId)) return null;
    const value = JSON.parse(await readFile(resolve(this.#rootDirectory, `${artifactId}.json`), 'utf8')) as unknown;
    if (!isStoredArtifact(value) || value.summary.artifactId !== artifactId) {
      throw new Error('xiaohongshu_account_public_notes_artifact_corrupt');
    }
    const { summary, ...draft } = value;
    if (sha256(canonicalJson(draft)) !== summary.sha256) {
      throw new Error('xiaohongshu_account_public_notes_artifact_digest_mismatch');
    }
    return structuredClone(value);
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}

function isSummary(value: unknown): value is XiaohongshuAccountPublicNotesArtifactSummary {
  return record(value) && exactKeys(value, [
    'schemaVersion', 'artifactId', 'operationId', 'capability', 'state', 'capturedAt', 'itemCount', 'sha256'
  ]) && value.schemaVersion === 1 && uuid(value.artifactId) && uuid(value.operationId) &&
    value.capability === 'xiaohongshu.account.public_notes.v1' &&
    (value.state === 'completed' || value.state === 'stopped') && timestamp(value.capturedAt) &&
    Number.isSafeInteger(value.itemCount) && Number(value.itemCount) >= 0 && Number(value.itemCount) <= 200 &&
    typeof value.sha256 === 'string' && SHA256.test(value.sha256);
}

function isStoredArtifact(value: unknown): value is StoredArtifact {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'artifactId', 'operationId', 'capability', 'state', 'capturedAt',
    'provenance', 'result', 'summary'
  ]) || !isSummary(value.summary) || !record(value.provenance) || !record(value.result) ||
    containsForbiddenMaterial(value)) return false;
  const result = value.result;
  return value.schemaVersion === 1 && value.artifactId === value.summary.artifactId &&
    value.operationId === value.summary.operationId && value.capability === value.summary.capability &&
    value.state === value.summary.state && value.capturedAt === value.summary.capturedAt &&
    (result.projection === null || isXiaohongshuManagedProfileNotesProjectionResult(result.projection));
}

function containsForbiddenMaterial(value: unknown): boolean {
  return /"(?:url|responseUrl|route|query|header|cookie|token|rawPayload|tabId|documentId|profileId)"\s*:/i
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

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function record(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, any>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
