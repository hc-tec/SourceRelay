import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SCHEMA_VERSION = 1 as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ERROR_CODE = /^[a-z0-9_.-]{1,120}$/i;

export type CollectorServiceIdempotencyState = 'reserved' | 'accepted' | 'rejected';

export interface CollectorServiceIdempotencyRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  clientRequestId: string;
  requestSha256: string;
  operationId: string;
  state: CollectorServiceIdempotencyState;
  errorCode: string | null;
  errorStatus: 400 | 409 | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A restart-safe reservation ledger for side-effecting `/v2/collect` calls.
 *
 * The caller's canonical request is represented only by SHA-256. Persisting a
 * reservation before dispatch closes the unsafe replay window: after a crash,
 * Core may report an unknown outcome, but it never silently submits the same
 * platform action again.
 */
export class CollectorServiceIdempotencyLedger {
  readonly #statePath: string;
  #records = new Map<string, CollectorServiceIdempotencyRecord>();
  #mutationChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#statePath = resolve(stateDirectory, 'collector-service-idempotency.json');
  }

  static async create(stateDirectory: string): Promise<CollectorServiceIdempotencyLedger> {
    const ledger = new CollectorServiceIdempotencyLedger(stateDirectory);
    await mkdir(stateDirectory, { recursive: true });
    try {
      const value = JSON.parse(await readFile(ledger.#statePath, 'utf8')) as unknown;
      if (Array.isArray(value)) {
        for (const candidate of value) {
          if (!isRecord(candidate) || ledger.#records.has(candidate.clientRequestId)) continue;
          ledger.#records.set(candidate.clientRequestId, candidate);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return ledger;
  }

  async reserve(
    clientRequestId: string,
    requestSha256: string,
    now = new Date()
  ): Promise<{ created: boolean; record: CollectorServiceIdempotencyRecord }> {
    return await this.#serialise(async () => {
      requireIdentity(clientRequestId, requestSha256);
      const existing = this.#records.get(clientRequestId);
      if (existing) {
        if (existing.requestSha256 !== requestSha256) {
          throw new Error('collector_service_idempotency_conflict');
        }
        return { created: false, record: clone(existing) };
      }
      const timestamp = now.toISOString();
      const record: CollectorServiceIdempotencyRecord = {
        schemaVersion: SCHEMA_VERSION,
        clientRequestId,
        requestSha256,
        operationId: randomUUID(),
        state: 'reserved',
        errorCode: null,
        errorStatus: null,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      this.#records.set(clientRequestId, record);
      await this.#save();
      return { created: true, record: clone(record) };
    });
  }

  async accept(clientRequestId: string, operationId: string, now = new Date()): Promise<void> {
    await this.#serialise(async () => {
      const record = this.#required(clientRequestId, operationId);
      if (record.state === 'rejected') throw new Error('collector_service_idempotency_state_invalid');
      if (record.state === 'accepted') return;
      record.state = 'accepted';
      record.updatedAt = now.toISOString();
      await this.#save();
    });
  }

  async reject(
    clientRequestId: string,
    operationId: string,
    errorCode: string,
    errorStatus: 400 | 409,
    now = new Date()
  ): Promise<void> {
    await this.#serialise(async () => {
      if (!SAFE_ERROR_CODE.test(errorCode)) throw new Error('collector_service_idempotency_error_invalid');
      const record = this.#required(clientRequestId, operationId);
      if (record.state === 'accepted') throw new Error('collector_service_idempotency_state_invalid');
      if (record.state === 'rejected') return;
      record.state = 'rejected';
      record.errorCode = errorCode;
      record.errorStatus = errorStatus;
      record.updatedAt = now.toISOString();
      await this.#save();
    });
  }

  list(): CollectorServiceIdempotencyRecord[] {
    return [...this.#records.values()]
      .map(clone)
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  }

  #required(clientRequestId: string, operationId: string): CollectorServiceIdempotencyRecord {
    const record = this.#records.get(clientRequestId);
    if (!record || record.operationId !== operationId) {
      throw new Error('collector_service_idempotency_record_missing');
    }
    return record;
  }

  async #serialise<T>(action: () => Promise<T>): Promise<T> {
    const run = this.#mutationChain.then(action, action);
    this.#mutationChain = run.then(() => undefined, () => undefined);
    return await run;
  }

  async #save(): Promise<void> {
    const temporaryPath = `${this.#statePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.list(), null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temporaryPath, this.#statePath);
  }
}

function requireIdentity(clientRequestId: string, requestSha256: string): void {
  if (!UUID_PATTERN.test(clientRequestId)) throw new Error('collector_service_client_request_id_invalid');
  if (!SHA256_PATTERN.test(requestSha256)) throw new Error('collector_service_request_digest_invalid');
}

function isRecord(value: unknown): value is CollectorServiceIdempotencyRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<CollectorServiceIdempotencyRecord>;
  return candidate.schemaVersion === SCHEMA_VERSION &&
    typeof candidate.clientRequestId === 'string' && UUID_PATTERN.test(candidate.clientRequestId) &&
    typeof candidate.requestSha256 === 'string' && SHA256_PATTERN.test(candidate.requestSha256) &&
    typeof candidate.operationId === 'string' && UUID_PATTERN.test(candidate.operationId) &&
    (candidate.state === 'reserved' || candidate.state === 'accepted' || candidate.state === 'rejected') &&
    (candidate.errorCode === null || (typeof candidate.errorCode === 'string' && SAFE_ERROR_CODE.test(candidate.errorCode))) &&
    (candidate.errorStatus === null || candidate.errorStatus === 400 || candidate.errorStatus === 409) &&
    isTimestamp(candidate.createdAt) && isTimestamp(candidate.updatedAt) &&
    Date.parse(candidate.updatedAt) >= Date.parse(candidate.createdAt) &&
    (candidate.state === 'rejected'
      ? candidate.errorCode !== null && candidate.errorStatus !== null
      : candidate.errorCode === null && candidate.errorStatus === null);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function clone(record: CollectorServiceIdempotencyRecord): CollectorServiceIdempotencyRecord {
  return structuredClone(record);
}
