import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  BilibiliPassiveExtensionWorkItem,
  BilibiliPassiveExtensionWorkResult
} from '@intelligence/collector-contracts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ARTIFACT_BYTES = 128 * 1024;

export type PassiveDirectCapability = BilibiliPassiveExtensionWorkItem['capability'];

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
  provenance: {
    environment: 'user_owned_browser_extension';
    executionTarget: 'collector_work_tab';
    captureMode: 'passive_dom_projection';
    responseBodies: 'not_read';
    semanticActions: 0;
    platformNavigations: 1;
    workTabAcquisition: BilibiliPassiveExtensionWorkResult['workTabAcquisition'];
    workTabDisposition: BilibiliPassiveExtensionWorkResult['workTabDisposition'];
  };
  input: BilibiliPassiveExtensionWorkItem['input'];
  result: {
    state: BilibiliPassiveExtensionWorkResult['state'];
    errorCode: string | null;
    terminalReason: BilibiliPassiveExtensionWorkResult['terminalReason'];
    completedAt: string;
    navigation: BilibiliPassiveExtensionWorkResult['navigation'];
    observation: BilibiliPassiveExtensionWorkResult['observation'];
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
    item: BilibiliPassiveExtensionWorkItem;
    result: BilibiliPassiveExtensionWorkResult;
  }): Promise<PassiveDirectArtifactSummary> {
    const existing = this.list().find((summary) => summary.operationId === input.item.operationId);
    if (existing) return existing;
    if (input.item.capability !== input.result.capability || input.item.operationId !== input.result.operationId) {
      throw new Error('extension_work_passive_artifact_binding_invalid');
    }
    const artifactId = randomUUID();
    const observation = input.result.observation;
    const draft = {
      schemaVersion: 1 as const,
      artifactId,
      operationId: input.item.operationId,
      capability: input.item.capability,
      state: input.result.state,
      capturedAt: input.result.completedAt,
      itemCount: itemCount(observation),
      provenance: {
        environment: 'user_owned_browser_extension' as const,
        executionTarget: 'collector_work_tab' as const,
        captureMode: 'passive_dom_projection' as const,
        responseBodies: 'not_read' as const,
        semanticActions: 0 as const,
        platformNavigations: 1 as const,
        workTabAcquisition: input.result.workTabAcquisition,
        workTabDisposition: input.result.workTabDisposition
      },
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

function itemCount(observation: BilibiliPassiveExtensionWorkResult['observation']): number {
  if (!observation) return 0;
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
    !isRecord(value.result) || !('input' in value)) return false;
  return value.artifactId === value.summary.artifactId && value.operationId === value.summary.operationId &&
    value.capability === value.summary.capability && value.state === value.summary.state && value.capturedAt === value.summary.capturedAt &&
    value.provenance.environment === 'user_owned_browser_extension' && value.provenance.executionTarget === 'collector_work_tab' &&
    value.provenance.captureMode === 'passive_dom_projection' && value.provenance.responseBodies === 'not_read' &&
    value.provenance.semanticActions === 0 && value.provenance.platformNavigations === 1;
}

function isCapability(value: unknown): value is PassiveDirectCapability {
  return value === 'bilibili.dynamic' || value === 'bilibili.collection_series.overview' ||
    value === 'bilibili.collection_series.detail' || value === 'bilibili.danmaku';
}

function isState(value: unknown): value is BilibiliPassiveExtensionWorkResult['state'] {
  return value === 'completed' || value === 'partial' || value === 'stopped' || value === 'failed';
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
