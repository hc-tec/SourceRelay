import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_MAX_DETAILS,
  isXiaohongshuManagedSearchProjectionResult,
  type ExtensionWorkTabAcquisition,
  type ExtensionWorkTabDisposition,
  type XiaohongshuPublicNotesSearchWorkItem,
  type XiaohongshuPublicNotesSearchWorkResult
} from '@intelligence/collector-contracts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
// Search can now carry the already-observed public description projection for
// each card. Keep the cap bounded, but large enough that a high-coverage page
// does not fail merely because its public text is longer than a card title.
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

export interface XiaohongshuPublicNotesArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  operationId: string;
  capability: 'xiaohongshu.search.public_notes.v1';
  state: 'completed' | 'stopped';
  capturedAt: string;
  itemCount: number;
  queryDigest: string;
  sha256: string;
}

export interface XiaohongshuPublicNotesArtifactView {
  schemaVersion: 1;
  summary: XiaohongshuPublicNotesArtifactSummary;
  provenance: {
    environment: 'user_owned_browser_extension';
    executionTarget: 'existing_public_explore_tab';
    captureMode: 'current_document_main_world_public_projection';
    platformNavigations: 0 | 1;
    pageReloads: 0;
    pageInitiatedNewTabs: 0;
    semanticActions: 0 | 1;
    responseBodies: 'temporarily_read_projected_not_stored';
    rawPayloadStored: false;
    responseUrlsStored: false;
    debuggerDetached: boolean;
    workTabAcquisition?: ExtensionWorkTabAcquisition;
    workTabDisposition?: ExtensionWorkTabDisposition;
  };
  queryDigest: string;
  result: {
    state: 'completed' | 'stopped';
    errorCode: string | null;
    terminalReason: XiaohongshuPublicNotesSearchWorkResult['terminalReason'];
    completedAt: string;
    navigation: { attempted: boolean; attemptCount: 0 | 1 };
    semanticAction: { attempted: boolean; attemptCount: 0 | 1 };
    input: { queryEchoed: boolean; enterAttempted: boolean };
    detailActions?: XiaohongshuPublicNotesSearchWorkResult['detailActions'];
    page: XiaohongshuPublicNotesSearchWorkResult['page'];
    projection: XiaohongshuPublicNotesSearchWorkResult['projection'];
    workTabAcquisition?: ExtensionWorkTabAcquisition;
    workTabDisposition?: ExtensionWorkTabDisposition;
  };
}

interface StoredArtifact extends XiaohongshuPublicNotesArtifactView {}

export class XiaohongshuPublicNotesArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, XiaohongshuPublicNotesArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'xiaohongshu-public-notes-artifacts');
    this.#indexPath = resolve(stateDirectory, 'xiaohongshu-public-notes-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<XiaohongshuPublicNotesArtifactStore> {
    const store = new XiaohongshuPublicNotesArtifactStore(stateDirectory);
    await mkdir(store.#rootDirectory, { recursive: true, mode: 0o700 });
    try {
      const value = JSON.parse(await readFile(store.#indexPath, 'utf8')) as unknown;
      if (Array.isArray(value)) {
        for (const summary of value) if (isSummary(summary)) store.#summaries.set(summary.artifactId, summary);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  list(): XiaohongshuPublicNotesArtifactSummary[] {
    return [...this.#summaries.values()].map((value) => structuredClone(value))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(input: {
    item: XiaohongshuPublicNotesSearchWorkItem;
    result: XiaohongshuPublicNotesSearchWorkResult;
  }): Promise<XiaohongshuPublicNotesArtifactSummary> {
    const existing = this.list().find((summary) => summary.operationId === input.item.operationId);
    if (existing) return existing;
    if (input.item.operationId !== input.result.operationId || input.item.workId !== input.result.workId ||
      input.item.browserBindingId !== input.result.browserBindingId) {
      throw new Error('xiaohongshu_public_notes_artifact_binding_invalid');
    }
    const artifactId = randomUUID();
    const queryDigest = sha256(input.item.input.query);
    const draft = {
      schemaVersion: 1 as const,
      artifactId,
      operationId: input.item.operationId,
      capability: 'xiaohongshu.search.public_notes.v1' as const,
      state: input.result.state,
      capturedAt: input.result.completedAt,
      provenance: {
        environment: 'user_owned_browser_extension' as const,
        executionTarget: 'existing_public_explore_tab' as const,
        captureMode: 'current_document_main_world_public_projection' as const,
        platformNavigations: input.result.navigation.attemptCount,
        pageReloads: 0 as const,
        pageInitiatedNewTabs: 0 as const,
        semanticActions: input.result.semanticAction.attemptCount,
        responseBodies: 'temporarily_read_projected_not_stored' as const,
        rawPayloadStored: false as const,
        responseUrlsStored: false as const,
        debuggerDetached: input.result.debuggerDetached,
        ...(input.result.workTabAcquisition === undefined ? {} : {
          workTabAcquisition: input.result.workTabAcquisition,
          workTabDisposition: input.result.workTabDisposition!
        })
      },
      queryDigest,
      result: {
        state: input.result.state,
        errorCode: input.result.errorCode,
        terminalReason: input.result.terminalReason,
        completedAt: input.result.completedAt,
        navigation: structuredClone(input.result.navigation),
        semanticAction: structuredClone(input.result.semanticAction),
        input: structuredClone(input.result.input),
        ...(input.result.detailActions
          ? { detailActions: structuredClone(input.result.detailActions) }
          : {}),
        page: structuredClone(input.result.page),
        projection: structuredClone(input.result.projection),
        ...(input.result.workTabAcquisition === undefined ? {} : {
          workTabAcquisition: input.result.workTabAcquisition,
          workTabDisposition: input.result.workTabDisposition!
        })
      }
    };
    const stored: StoredArtifact = {
      ...draft,
      summary: {
        schemaVersion: 1,
        artifactId,
        operationId: input.item.operationId,
        capability: 'xiaohongshu.search.public_notes.v1',
        state: input.result.state,
        capturedAt: input.result.completedAt,
        itemCount: input.result.projection?.items.length ?? 0,
        queryDigest,
        sha256: sha256(canonicalJson(draft))
      }
    };
    const serialized = `${JSON.stringify(stored, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_ARTIFACT_BYTES) {
      throw new Error('xiaohongshu_public_notes_artifact_payload_too_large');
    }
    await atomicWrite(resolve(this.#rootDirectory, `${artifactId}.json`), stored);
    this.#summaries.set(artifactId, stored.summary);
    await this.#saveIndex();
    return structuredClone(stored.summary);
  }

  async get(artifactId: string): Promise<XiaohongshuPublicNotesArtifactView | null> {
    if (!UUID.test(artifactId)) throw new Error('xiaohongshu_public_notes_artifact_invalid');
    const summary = this.#summaries.get(artifactId);
    if (!summary) return null;
    const value = JSON.parse(await readFile(resolve(this.#rootDirectory, `${artifactId}.json`), 'utf8')) as unknown;
    if (!isStoredArtifact(value) || value.summary.artifactId !== artifactId) {
      throw new Error('xiaohongshu_public_notes_artifact_corrupt');
    }
    const { summary: storedSummary, ...draft } = value;
    if (sha256(canonicalJson(draft)) !== storedSummary.sha256) {
      throw new Error('xiaohongshu_public_notes_artifact_digest_mismatch');
    }
    return structuredClone(value);
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}

function isSummary(value: unknown): value is XiaohongshuPublicNotesArtifactSummary {
  return record(value) && exactKeys(value, [
    'schemaVersion', 'artifactId', 'operationId', 'capability', 'state', 'capturedAt', 'itemCount',
    'queryDigest', 'sha256'
  ]) && value.schemaVersion === 1 && uuid(value.artifactId) && uuid(value.operationId) &&
    value.capability === 'xiaohongshu.search.public_notes.v1' &&
    (value.state === 'completed' || value.state === 'stopped') && timestamp(value.capturedAt) &&
    Number.isSafeInteger(value.itemCount) && Number(value.itemCount) >= 0 && Number(value.itemCount) <= 40 &&
    typeof value.queryDigest === 'string' && SHA256.test(value.queryDigest) &&
    typeof value.sha256 === 'string' && SHA256.test(value.sha256);
}

function isStoredArtifact(value: unknown): value is StoredArtifact {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'artifactId', 'operationId', 'capability', 'state', 'capturedAt', 'provenance',
    'queryDigest', 'result', 'summary'
  ]) || !isSummary(value.summary) || !record(value.provenance) || !record(value.result) ||
    containsForbiddenMaterial(value)) return false;
  const provenance = value.provenance;
  const result = value.result;
  return value.schemaVersion === 1 && value.artifactId === value.summary.artifactId &&
    value.operationId === value.summary.operationId && value.capability === value.summary.capability &&
    value.state === value.summary.state && value.capturedAt === value.summary.capturedAt &&
    value.queryDigest === value.summary.queryDigest && provenanceKeys(provenance) &&
    provenance.environment === 'user_owned_browser_extension' &&
    provenance.executionTarget === 'existing_public_explore_tab' &&
    provenance.captureMode === 'current_document_main_world_public_projection' &&
    (provenance.platformNavigations === 0 || provenance.platformNavigations === 1) &&
    provenance.pageReloads === 0 && provenance.pageInitiatedNewTabs === 0 &&
    (provenance.semanticActions === 0 || provenance.semanticActions === 1) &&
    provenance.responseBodies === 'temporarily_read_projected_not_stored' &&
    provenance.rawPayloadStored === false && provenance.responseUrlsStored === false &&
    typeof provenance.debuggerDetached === 'boolean' && workTabFields(provenance) && storedResultKeys(result) &&
    navigation(result.navigation) && workTabFields(result) &&
    validDetailActions(result.detailActions) &&
    (result.projection === null || isXiaohongshuManagedSearchProjectionResult(result.projection));
}

function provenanceKeys(value: Record<string, unknown>): boolean {
  const base = [
      'environment', 'executionTarget', 'captureMode', 'platformNavigations', 'pageReloads',
      'pageInitiatedNewTabs', 'semanticActions', 'responseBodies', 'rawPayloadStored', 'responseUrlsStored',
      'debuggerDetached'
  ] as const;
  return exactKeys(value, base) || exactKeys(value, [...base, 'workTabAcquisition', 'workTabDisposition']);
}

function storedResultKeys(value: Record<string, any>): boolean {
  const base = ['state', 'errorCode', 'terminalReason', 'completedAt', 'navigation', 'semanticAction', 'input', 'page', 'projection'] as const;
  const withDetails = [...base.slice(0, 6), 'detailActions', ...base.slice(6)];
  const withWorkTab = [...base, 'workTabAcquisition', 'workTabDisposition'];
  const withDetailsAndWorkTab = [...withDetails, 'workTabAcquisition', 'workTabDisposition'];
  return exactKeys(value, base) || exactKeys(value, withDetails) || exactKeys(value, withWorkTab) ||
    exactKeys(value, withDetailsAndWorkTab);
}

function navigation(value: unknown): boolean {
  return record(value) && exactKeys(value, ['attempted', 'attemptCount']) &&
    typeof value.attempted === 'boolean' && (value.attemptCount === 0 || value.attemptCount === 1) &&
    value.attemptCount === (value.attempted ? 1 : 0);
}

function workTabFields(value: Record<string, unknown>): boolean {
  const hasAcquisition = Object.hasOwn(value, 'workTabAcquisition');
  const hasDisposition = Object.hasOwn(value, 'workTabDisposition');
  if (hasAcquisition !== hasDisposition) return false;
  if (!hasAcquisition) return true;
  return (value.workTabAcquisition === 'created' || value.workTabAcquisition === 'reused' ||
      value.workTabAcquisition === 'not_acquired') &&
    (value.workTabDisposition === 'idle_reusable' || value.workTabDisposition === 'retained_not_reusable' ||
      value.workTabDisposition === 'user_taken_over' || value.workTabDisposition === 'closed_or_missing');
}

function validDetailActions(value: unknown): boolean {
  if (value === undefined) return true;
  if (!record(value) || !exactKeys(value, ['requestedCount', 'attemptedCount', 'completedCount', 'stoppedReason'])) return false;
  return Number.isSafeInteger(value.requestedCount) && Number(value.requestedCount) >= 1 &&
    Number(value.requestedCount) <= XIAOHONGSHU_PUBLIC_NOTES_SEARCH_MAX_DETAILS &&
    Number.isSafeInteger(value.attemptedCount) && Number(value.attemptedCount) >= 0 &&
    Number(value.attemptedCount) <= Number(value.requestedCount) &&
    Number.isSafeInteger(value.completedCount) && Number(value.completedCount) >= 0 &&
    Number(value.completedCount) <= Number(value.attemptedCount) &&
    (value.stoppedReason === null || (typeof value.stoppedReason === 'string' && /^[a-z0-9_]{1,100}$/.test(value.stoppedReason)));
}

function containsForbiddenMaterial(value: unknown): boolean {
  const text = JSON.stringify(value);
  return /"(?:url|responseUrl|route|query|queryString|header|cookie|token|rawPayload|tabId|documentId)"\s*:/i.test(text);
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
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
