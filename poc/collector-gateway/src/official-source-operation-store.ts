import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ExtensionWorkArtifactReference } from './extension-work-queue';
import type { ZhihuOfficialCapability } from './zhihu-official-contract';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RETAINED_OPERATIONS = 500;

export interface OfficialSourceOperationSummary {
  schemaVersion: 1;
  operationId: string;
  browserBindingId: null;
  platform: 'zhihu' | 'web';
  capability: ZhihuOfficialCapability;
  executionTarget: 'official_api';
  state: 'completed';
  queuedAt: string;
  claimedAt: string;
  completedAt: string;
  errorCode: null;
  terminalReason: 'official_api_response_ready';
  artifact: ExtensionWorkArtifactReference;
}

export class OfficialSourceOperationStore {
  readonly #statePath: string;
  #operations = new Map<string, OfficialSourceOperationSummary>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#statePath = resolve(stateDirectory, 'official-source-operations.json');
  }

  static async create(stateDirectory: string): Promise<OfficialSourceOperationStore> {
    const store = new OfficialSourceOperationStore(stateDirectory);
    await mkdir(stateDirectory, { recursive: true });
    try {
      const value = JSON.parse(await readFile(store.#statePath, 'utf8')) as unknown;
      if (Array.isArray(value)) {
        for (const operation of value) {
          if (isOperation(operation) && !store.#operations.has(operation.operationId)) {
            store.#operations.set(operation.operationId, operation);
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return store;
  }

  list(): OfficialSourceOperationSummary[] {
    return [...this.#operations.values()]
      .map((value) => structuredClone(value))
      .sort((left, right) => Date.parse(right.queuedAt) - Date.parse(left.queuedAt))
      .slice(0, MAX_RETAINED_OPERATIONS);
  }

  async record(input: {
    operationId: string;
    platform: 'zhihu' | 'web';
    capability: ZhihuOfficialCapability;
    startedAt: string;
    completedAt: string;
    artifact: ExtensionWorkArtifactReference;
  }): Promise<OfficialSourceOperationSummary> {
    if (!UUID_PATTERN.test(input.operationId) || !timestamp(input.startedAt) ||
      !timestamp(input.completedAt) || Date.parse(input.completedAt) < Date.parse(input.startedAt)) {
      throw new Error('official_source_operation_input_invalid');
    }
    const existing = this.#operations.get(input.operationId);
    if (existing) {
      if (existing.capability !== input.capability || existing.artifact.artifactId !== input.artifact.artifactId) {
        throw new Error('official_source_operation_identity_conflict');
      }
      return structuredClone(existing);
    }
    const operation: OfficialSourceOperationSummary = {
      schemaVersion: 1,
      operationId: input.operationId,
      browserBindingId: null,
      platform: input.platform,
      capability: input.capability,
      executionTarget: 'official_api',
      state: 'completed',
      queuedAt: input.startedAt,
      claimedAt: input.startedAt,
      completedAt: input.completedAt,
      errorCode: null,
      terminalReason: 'official_api_response_ready',
      artifact: structuredClone(input.artifact)
    };
    if (!isOperation(operation)) throw new Error('official_source_operation_input_invalid');
    this.#operations.set(operation.operationId, operation);
    await this.#save();
    return structuredClone(operation);
  }

  async get(operationId: string): Promise<OfficialSourceOperationSummary | null> {
    if (!UUID_PATTERN.test(operationId)) throw new Error('official_source_operation_id_invalid');
    const operation = this.#operations.get(operationId);
    return operation ? structuredClone(operation) : null;
  }

  async #save(): Promise<void> {
    const write = this.#writeChain.then(async () => {
      const temporary = `${this.#statePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.list(), null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      await rename(temporary, this.#statePath);
    });
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}

function isOperation(value: unknown): value is OfficialSourceOperationSummary {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'operationId', 'browserBindingId', 'platform', 'capability', 'executionTarget',
    'state', 'queuedAt', 'claimedAt', 'completedAt', 'errorCode', 'terminalReason', 'artifact'
  ]) || !record(value.artifact)) return false;
  return value.schemaVersion === 1 && UUID_PATTERN.test(value.operationId) && value.browserBindingId === null &&
    ((value.platform === 'zhihu' &&
      (value.capability === 'zhihu.search.public_content.v1' || value.capability === 'zhihu.hot_list.public_content.v1')) ||
      (value.platform === 'web' && value.capability === 'web.search.global.zhihu_provider.v1')) &&
    value.executionTarget === 'official_api' && value.state === 'completed' &&
    timestamp(value.queuedAt) && timestamp(value.claimedAt) && timestamp(value.completedAt) &&
    Date.parse(value.claimedAt) >= Date.parse(value.queuedAt) &&
    Date.parse(value.completedAt) >= Date.parse(value.claimedAt) && value.errorCode === null &&
    value.terminalReason === 'official_api_response_ready' && artifact(value.artifact, value.capability);
}

function artifact(value: Record<string, unknown>, capability: string): boolean {
  return exactKeys(value, ['artifactId', 'retrievalPath', 'summary']) &&
    typeof value.artifactId === 'string' && UUID_PATTERN.test(value.artifactId) &&
    value.retrievalPath === `/v1/collect/artifacts/${capability}/${value.artifactId}` && record(value.summary);
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function record(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
