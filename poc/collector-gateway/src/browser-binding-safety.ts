import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { ExtensionWorkResult } from '@intelligence/collector-contracts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ERROR_CODE = /^[a-z0-9_]{1,100}$/;

export type BrowserBindingSafetyState = 'ready' | 'running' | 'locked';
export type BrowserBindingPlatform = 'bilibili' | 'xiaohongshu';
type BrowserBindingSafetyFinishResult = Pick<ExtensionWorkResult, 'terminalReason' | 'errorCode' | 'navigation'> & {
  platform?: 'bilibili' | 'xiaohongshu';
  state?: ExtensionWorkResult['state'];
  semanticAction?: { attempted: boolean; attemptCount: number };
};

export interface BrowserBindingSafetyRecord {
  schemaVersion: 1;
  browserBindingId: string;
  platform: BrowserBindingPlatform;
  state: BrowserBindingSafetyState;
  reasonCode: string | null;
  manualUnlockRequired: boolean;
  activeOperation: {
    operationId: string;
    startedAt: string;
    navigationIntentRecorded: boolean;
  } | null;
  lastOperationAt: string | null;
  updatedAt: string;
}

/**
 * Production account-safety state is keyed by a paired browser binding, never
 * by a Chrome Profile or its filesystem location.  It is deliberately kept
 * separate from the legacy Browser Host profile safety registry while both
 * execution lanes coexist.
 */
export class BrowserBindingSafetyRegistry {
  readonly #statePath: string;
  readonly #records = new Map<string, BrowserBindingSafetyRecord>();
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#statePath = resolve(stateDirectory, 'browser-binding-safety.json');
  }

  static async create(stateDirectory: string, now = new Date()): Promise<BrowserBindingSafetyRegistry> {
    const registry = new BrowserBindingSafetyRegistry(stateDirectory);
    await mkdir(stateDirectory, { recursive: true });
    let changed = false;
    try {
      const parsed = JSON.parse(await readFile(registry.#statePath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        for (const record of parsed.filter(isRecord)) {
          const next = structuredClone(record);
          if (next.state === 'running' || next.state === 'locked' || next.activeOperation) {
            next.state = 'ready';
            next.reasonCode = next.reasonCode ?? null;
            next.manualUnlockRequired = false;
            next.activeOperation = null;
            next.updatedAt = now.toISOString();
            changed = true;
          }
          registry.#records.set(key(next.browserBindingId, next.platform), next);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (changed) await registry.#save();
    return registry;
  }

  get(browserBindingId: string, platform: BrowserBindingPlatform, now = new Date()): BrowserBindingSafetyRecord {
    return structuredClone(this.#getOrCreate(browserBindingId, platform, now));
  }

  async begin(
    browserBindingId: string,
    platform: BrowserBindingPlatform,
    operationId: string,
    now = new Date()
  ): Promise<BrowserBindingSafetyRecord> {
    if (!isUuid(operationId)) throw new Error('browser_binding_safety_operation_invalid');
    const record = this.#getOrCreate(browserBindingId, platform, now);
    if (record.state === 'locked') {
      record.state = 'ready';
      record.reasonCode = null;
      record.manualUnlockRequired = false;
    }
    if (record.state === 'running' || record.activeOperation) throw new Error('browser_binding_safety_operation_active');
    record.state = 'running';
    record.reasonCode = 'browser_binding_work_in_progress';
    record.manualUnlockRequired = false;
    record.activeOperation = {
      operationId,
      startedAt: now.toISOString(),
      navigationIntentRecorded: false
    };
    record.updatedAt = now.toISOString();
    await this.#save();
    return structuredClone(record);
  }

  /** Reserve the one navigation before a work item can leave the Gateway. */
  async recordNavigationIntent(
    browserBindingId: string,
    platform: BrowserBindingPlatform,
    operationId: string,
    now = new Date()
  ): Promise<BrowserBindingSafetyRecord> {
    const record = this.#getOrCreate(browserBindingId, platform, now);
    if (!record.activeOperation) return structuredClone(record);
    if (record.state !== 'running' || record.activeOperation.operationId !== operationId) {
      throw new Error('browser_binding_safety_operation_not_active');
    }
    if (record.activeOperation.navigationIntentRecorded) {
      throw new Error('browser_binding_safety_navigation_already_recorded');
    }
    record.activeOperation.navigationIntentRecorded = true;
    record.updatedAt = now.toISOString();
    await this.#save();
    return structuredClone(record);
  }

  async finish(
    browserBindingId: string,
    platform: BrowserBindingPlatform,
    operationId: string,
    result: BrowserBindingSafetyFinishResult,
    now = new Date()
  ): Promise<BrowserBindingSafetyRecord> {
    const record = this.#getOrCreate(browserBindingId, platform, now);
    if (record.state !== 'running' || record.activeOperation?.operationId !== operationId) {
      throw new Error('browser_binding_safety_operation_not_active');
    }
    const reasonCode = result.errorCode ?? result.terminalReason;
    record.state = 'ready';
    record.reasonCode = reasonCode;
    record.manualUnlockRequired = false;
    record.activeOperation = null;
    record.lastOperationAt = now.toISOString();
    record.updatedAt = now.toISOString();
    await this.#save();
    return structuredClone(record);
  }

  async stopBeforeDelivery(
    browserBindingId: string,
    platform: BrowserBindingPlatform,
    operationId: string,
    reasonCode: string,
    now = new Date()
  ): Promise<BrowserBindingSafetyRecord> {
    if (!SAFE_ERROR_CODE.test(reasonCode)) throw new Error('browser_binding_safety_reason_invalid');
    const record = this.#getOrCreate(browserBindingId, platform, now);
    if (record.state !== 'running' || record.activeOperation?.operationId !== operationId) {
      throw new Error('browser_binding_safety_operation_not_active');
    }
    record.state = 'ready';
    record.reasonCode = reasonCode;
    record.manualUnlockRequired = false;
    record.activeOperation = null;
    record.lastOperationAt = now.toISOString();
    record.updatedAt = now.toISOString();
    await this.#save();
    return structuredClone(record);
  }

  /** A claimed item that reaches its deadline has an unknown page outcome. */
  async expire(
    browserBindingId: string,
    platform: BrowserBindingPlatform,
    operationId: string,
    now = new Date()
  ): Promise<BrowserBindingSafetyRecord> {
    const record = this.#getOrCreate(browserBindingId, platform, now);
    if (record.activeOperation?.operationId !== operationId) return structuredClone(record);
    record.state = 'ready';
    record.reasonCode = 'extension_work_expired';
    record.manualUnlockRequired = false;
    record.activeOperation = null;
    record.lastOperationAt = now.toISOString();
    record.updatedAt = now.toISOString();
    await this.#save();
    return structuredClone(record);
  }

  async unlock(browserBindingId: string, platform: BrowserBindingPlatform, now = new Date()): Promise<BrowserBindingSafetyRecord> {
    const record = this.#getOrCreate(browserBindingId, platform, now);
    if (record.state === 'running' || record.activeOperation) throw new Error('browser_binding_safety_operation_active');
    record.state = 'ready';
    record.reasonCode = null;
    record.manualUnlockRequired = false;
    record.updatedAt = now.toISOString();
    await this.#save();
    return structuredClone(record);
  }

  #getOrCreate(browserBindingId: string, platform: BrowserBindingPlatform, now: Date): BrowserBindingSafetyRecord {
    if (!isUuid(browserBindingId)) throw new Error('browser_binding_safety_binding_invalid');
    const existing = this.#records.get(key(browserBindingId, platform));
    if (existing) return existing;
    const created: BrowserBindingSafetyRecord = {
      schemaVersion: 1,
      browserBindingId,
      platform,
      state: 'ready',
      reasonCode: null,
      manualUnlockRequired: false,
      activeOperation: null,
      lastOperationAt: null,
      updatedAt: now.toISOString()
    };
    this.#records.set(key(browserBindingId, platform), created);
    return created;
  }

  async #save(): Promise<void> {
    const write = this.#writeChain.then(async () => {
      const temporaryPath = `${this.#statePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify([...this.#records.values()], null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      await rename(temporaryPath, this.#statePath);
    });
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}

function isRecord(value: unknown): value is BrowserBindingSafetyRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BrowserBindingSafetyRecord>;
  const active = candidate.activeOperation;
  return candidate.schemaVersion === 1 && isUuid(candidate.browserBindingId) &&
    (candidate.platform === 'bilibili' || candidate.platform === 'xiaohongshu') &&
    (candidate.state === 'ready' || candidate.state === 'running' || candidate.state === 'locked') &&
    (candidate.reasonCode === null || (typeof candidate.reasonCode === 'string' && SAFE_ERROR_CODE.test(candidate.reasonCode))) &&
    typeof candidate.manualUnlockRequired === 'boolean' &&
    (active === null || Boolean(active && isUuid(active.operationId) && isTimestamp(active.startedAt) &&
      typeof active.navigationIntentRecorded === 'boolean')) &&
    (candidate.lastOperationAt === null || isTimestamp(candidate.lastOperationAt)) && isTimestamp(candidate.updatedAt);
}

function key(browserBindingId: string, platform: BrowserBindingPlatform): string {
  return `${browserBindingId}\n${platform}`;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
