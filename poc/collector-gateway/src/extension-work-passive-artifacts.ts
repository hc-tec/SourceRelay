import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  BilibiliPassiveExtensionWorkItem,
  BilibiliPassiveExtensionWorkResult,
  BilibiliVideoDiscussionUserSelectedTabWorkItem,
  BilibiliVideoDiscussionUserSelectedTabWorkResult
} from '@intelligence/collector-contracts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ARTIFACT_BYTES = 128 * 1024;

type PassiveDirectWorkItem =
  | BilibiliPassiveExtensionWorkItem
  | BilibiliVideoDiscussionUserSelectedTabWorkItem;
type PassiveDirectWorkResult =
  | BilibiliPassiveExtensionWorkResult
  | BilibiliVideoDiscussionUserSelectedTabWorkResult;

export type PassiveDirectCapability = PassiveDirectWorkItem['capability'];

type PassiveDirectArtifactProvenance =
  | {
    environment: 'user_owned_browser_extension';
    executionTarget: 'collector_work_tab';
    captureMode: 'passive_dom_projection' | 'fixed_network_metadata_projection';
    responseBodies: 'not_read' | 'transient_allowlisted_projection';
    semanticActions: 0;
    platformNavigations: 1;
    workTabAcquisition: BilibiliPassiveExtensionWorkResult['workTabAcquisition'];
    workTabDisposition: BilibiliPassiveExtensionWorkResult['workTabDisposition'];
  }
  | {
    environment: 'user_owned_browser_extension';
    executionTarget: 'user_selected_tab';
    captureMode: 'passive_dom_projection';
    responseBodies: 'not_read';
    semanticActions: 0;
    platformNavigations: 0;
    userSelectedTabDisposition: BilibiliVideoDiscussionUserSelectedTabWorkResult['userSelectedTabDisposition'];
  };

export interface PassiveDirectArtifactSummary {
  schemaVersion: 1;
  artifactId: string;
  operationId: string;
  capability: PassiveDirectCapability;
  state: BilibiliPassiveExtensionWorkResult['state'];
  capturedAt: string;
  itemCount: number;
  sha256: string;
}

export interface PassiveDirectArtifactView {
  schemaVersion: 1;
  summary: PassiveDirectArtifactSummary;
  provenance: PassiveDirectArtifactProvenance;
  input: PassiveDirectWorkItem['input'];
  result: {
    state: PassiveDirectWorkResult['state'];
    errorCode: string | null;
    terminalReason: PassiveDirectWorkResult['terminalReason'];
    completedAt: string;
    navigation: PassiveDirectWorkResult['navigation'];
    observation: PassiveDirectWorkResult['observation'];
  };
}

interface StoredArtifact extends PassiveDirectArtifactView {}

/**
 * A compact, direct-only artifact store.  It keeps a public DOM projection
 * and its bounded provenance together, without importing any legacy Browser
 * Host artifact model into the user-owned-browser deployment.
 */
export class ExtensionWorkPassiveArtifactStore {
  readonly #rootDirectory: string;
  readonly #indexPath: string;
  readonly #summaries = new Map<string, PassiveDirectArtifactSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#rootDirectory = resolve(stateDirectory, 'extension-work-passive-artifacts');
    this.#indexPath = resolve(stateDirectory, 'extension-work-passive-artifacts.json');
  }

  static async create(stateDirectory: string): Promise<ExtensionWorkPassiveArtifactStore> {
    const store = new ExtensionWorkPassiveArtifactStore(stateDirectory);
    await mkdir(store.#rootDirectory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(store.#indexPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        for (const summary of parsed) {
          if (isSummary(summary)) store.#summaries.set(summary.artifactId, summary);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  list(): PassiveDirectArtifactSummary[] {
    return [...this.#summaries.values()]
      .map((summary) => structuredClone(summary))
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  }

  async record(input: {
    item: PassiveDirectWorkItem;
    result: PassiveDirectWorkResult;
  }): Promise<PassiveDirectArtifactSummary> {
    const existing = this.list().find((summary) => summary.operationId === input.item.operationId);
    if (existing) return existing;
    if (input.item.capability !== input.result.capability || input.item.operationId !== input.result.operationId) {
      throw new Error('extension_work_passive_artifact_binding_invalid');
    }
    const artifactId = randomUUID();
    const observation = input.result.observation;
    const provenance: PassiveDirectArtifactProvenance = input.item.executionTarget === 'user_selected_tab'
      ? {
        environment: 'user_owned_browser_extension' as const,
        executionTarget: 'user_selected_tab' as const,
        captureMode: 'passive_dom_projection' as const,
        responseBodies: 'not_read' as const,
        semanticActions: 0 as const,
        platformNavigations: 0 as const,
        userSelectedTabDisposition: (input.result as BilibiliVideoDiscussionUserSelectedTabWorkResult).userSelectedTabDisposition
      }
      : {
        environment: 'user_owned_browser_extension' as const,
        executionTarget: 'collector_work_tab' as const,
        captureMode: input.item.capability === 'bilibili.collection_series.overview'
          ? 'fixed_network_metadata_projection' as const
          : 'passive_dom_projection' as const,
        responseBodies: input.item.capability === 'bilibili.collection_series.overview'
          ? 'transient_allowlisted_projection' as const
          : 'not_read' as const,
        semanticActions: 0 as const,
        platformNavigations: 1 as const,
        workTabAcquisition: (input.result as BilibiliPassiveExtensionWorkResult).workTabAcquisition,
        workTabDisposition: (input.result as BilibiliPassiveExtensionWorkResult).workTabDisposition
      };
    const draft = {
      schemaVersion: 1 as const,
      artifactId,
      operationId: input.item.operationId,
      capability: input.item.capability,
      state: input.result.state,
      capturedAt: input.result.completedAt,
      itemCount: itemCount(observation),
      provenance,
      input: structuredClone(input.item.input),
      result: {
        state: input.result.state,
        errorCode: input.result.errorCode,
        terminalReason: input.result.terminalReason,
        completedAt: input.result.completedAt,
        navigation: structuredClone(input.result.navigation),
        observation: structuredClone(observation)
      }
    };
    const digest = sha256(canonicalJson(draft));
    const stored: StoredArtifact = {
      ...draft,
      summary: {
        schemaVersion: 1,
        artifactId,
        operationId: input.item.operationId,
        capability: input.item.capability,
        state: input.result.state,
        capturedAt: input.result.completedAt,
        itemCount: itemCount(observation),
        sha256: digest
      }
    };
    const serialized = `${JSON.stringify(stored, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_ARTIFACT_BYTES) {
      throw new Error('extension_work_passive_artifact_payload_too_large');
    }
    await atomicWrite(resolve(this.#rootDirectory, `${artifactId}.json`), stored);
    this.#summaries.set(artifactId, stored.summary);
    await this.#saveIndex();
    return structuredClone(stored.summary);
  }

  async get(capability: PassiveDirectCapability, artifactId: string): Promise<PassiveDirectArtifactView | null> {
    if (!UUID_PATTERN.test(artifactId)) throw new Error('extension_work_passive_artifact_invalid');
    const summary = this.#summaries.get(artifactId);
    if (!summary || summary.capability !== capability) return null;
    const path = resolve(this.#rootDirectory, `${artifactId}.json`);
    const stored = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!isStoredArtifact(stored) || stored.summary.artifactId !== artifactId || stored.summary.capability !== capability) {
      throw new Error('extension_work_passive_artifact_corrupt');
    }
    const { summary: storedSummary, ...draft } = stored;
    if (sha256(canonicalJson(draft)) !== storedSummary.sha256) {
      throw new Error('extension_work_passive_artifact_digest_mismatch');
    }
    return structuredClone(stored);
  }

  async #saveIndex(): Promise<void> {
    const write = this.#writeChain.then(() => atomicWrite(this.#indexPath, this.list()));
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}

function itemCount(observation: PassiveDirectWorkResult['observation']): number {
  if (!observation) return 0;
  if ('rootCommentTexts' in observation) return observation.rootCommentTexts.length;
  if ('cards' in observation) return observation.cards.length;
  if ('items' in observation) return observation.items.length;
  if ('overlayItems' in observation) return observation.overlayItems.length;
  return 0;
}

function isSummary(value: unknown): value is PassiveDirectArtifactSummary {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 1 && typeof value.artifactId === 'string' && UUID_PATTERN.test(value.artifactId) &&
    typeof value.operationId === 'string' && UUID_PATTERN.test(value.operationId) && isCapability(value.capability) &&
    isState(value.state) && typeof value.capturedAt === 'string' && Number.isFinite(Date.parse(value.capturedAt)) &&
    typeof value.itemCount === 'number' && Number.isSafeInteger(value.itemCount) && value.itemCount >= 0 &&
    typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256);
}

function isStoredArtifact(value: unknown): value is StoredArtifact {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isSummary(value.summary) || !isRecord(value.provenance) ||
    !isRecord(value.result) || !('input' in value) || containsForbiddenBrowserIdentifier(value)) return false;
  return value.artifactId === value.summary.artifactId && value.operationId === value.summary.operationId &&
    value.capability === value.summary.capability && value.state === value.summary.state && value.capturedAt === value.summary.capturedAt &&
    isProvenance(value.provenance);
}

function isCapability(value: unknown): value is PassiveDirectCapability {
  return value === 'bilibili.dynamic' || value === 'bilibili.collection_series.overview' ||
    value === 'bilibili.collection_series.detail' || value === 'bilibili.danmaku' || value === 'bilibili.discussion';
}

function isState(value: unknown): value is BilibiliPassiveExtensionWorkResult['state'] {
  return value === 'completed' || value === 'partial' || value === 'stopped' || value === 'failed';
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isProvenance(value: Record<string, any>): value is PassiveDirectArtifactProvenance {
  if (value.environment !== 'user_owned_browser_extension' || value.semanticActions !== 0) return false;
  if (value.executionTarget === 'collector_work_tab') {
    return hasExactKeys(value, [
      'environment', 'executionTarget', 'captureMode', 'responseBodies', 'semanticActions', 'platformNavigations',
      'workTabAcquisition', 'workTabDisposition'
    ]) && (value.captureMode === 'passive_dom_projection' || value.captureMode === 'fixed_network_metadata_projection') &&
      (value.responseBodies === 'not_read' || value.responseBodies === 'transient_allowlisted_projection') &&
      value.platformNavigations === 1 && isWorkTabAcquisition(value.workTabAcquisition) &&
      isWorkTabDisposition(value.workTabDisposition);
  }
  return value.executionTarget === 'user_selected_tab' && hasExactKeys(value, [
    'environment', 'executionTarget', 'captureMode', 'responseBodies', 'semanticActions', 'platformNavigations',
    'userSelectedTabDisposition'
  ]) && value.captureMode === 'passive_dom_projection' && value.responseBodies === 'not_read' &&
    value.platformNavigations === 0 && isUserSelectedTabDisposition(value.userSelectedTabDisposition);
}

function isWorkTabAcquisition(value: unknown): boolean {
  return value === 'created' || value === 'reused' || value === 'not_acquired';
}

function isWorkTabDisposition(value: unknown): boolean {
  return value === 'idle_reusable' || value === 'retained_not_reusable' ||
    value === 'user_taken_over' || value === 'closed_or_missing';
}

function isUserSelectedTabDisposition(value: unknown): boolean {
  return value === 'observed' || value === 'selection_unavailable' || value === 'closed_or_missing' ||
    value === 'document_changed' || value === 'target_mismatch';
}

function containsForbiddenBrowserIdentifier(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenBrowserIdentifier);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nested]) =>
    key === 'tabId' || key === 'windowId' || key === 'documentId' || key === 'profileId' ||
    containsForbiddenBrowserIdentifier(nested)
  );
}

function hasExactKeys(value: Record<string, any>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}
