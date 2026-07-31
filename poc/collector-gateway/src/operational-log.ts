import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  isOperationalLogEvent,
  OPERATIONAL_LOG_SCHEMA_VERSION,
  sanitiseOperationalDetails,
  type OperationalLogComponent,
  type OperationalLogEvent,
  type OperationalLogInput,
  type OperationalLogLevel
} from '@intelligence/collector-contracts';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAXIMUM_TOTAL_BYTES = 64 * 1024 * 1024;
const MAXIMUM_ACTIVE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_EVENTS = 5_000;

export interface OperationalLogListOptions {
  limit?: number;
  level?: OperationalLogLevel;
  eventType?: string;
  operationId?: string;
}

/**
 * Bounded JSONL operational log.  A write failure never takes down a
 * collection request; diagnostics are best-effort and are never allowed to
 * become a new availability dependency.
 */
export class OperationalLog {
  readonly #directory: string;
  readonly #component: OperationalLogComponent;
  readonly #activePath: string;
  #events: OperationalLogEvent[] = [];
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(directory: string, component: OperationalLogComponent) {
    this.#directory = resolve(directory);
    this.#component = component;
    this.#activePath = resolve(this.#directory, `${component}.active.jsonl`);
  }

  static async create(stateDirectory: string, component: OperationalLogComponent = 'gateway'): Promise<OperationalLog> {
    const log = new OperationalLog(resolve(stateDirectory, 'operational-logs'), component);
    await mkdir(log.#directory, { recursive: true, mode: 0o700 });
    await log.#load();
    await log.#prune();
    return log;
  }

  record(input: Partial<OperationalLogInput> & { eventType: string; component?: OperationalLogComponent }): Promise<OperationalLogEvent | null> {
    const event: OperationalLogEvent = {
      schemaVersion: OPERATIONAL_LOG_SCHEMA_VERSION,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      component: input.component ?? this.#component,
      level: input.level ?? 'info',
      eventType: input.eventType,
      requestId: input.requestId ?? null,
      commandId: input.commandId ?? null,
      operationId: input.operationId ?? null,
      workId: input.workId ?? null,
      capability: input.capability ?? null,
      durationMs: input.durationMs ?? null,
      outcome: input.outcome ?? 'unknown',
      errorCode: input.errorCode ?? null,
      details: sanitiseOperationalDetails(input.details)
    };
    if (event.component !== this.#component || !isOperationalLogEvent(event)) {
      return Promise.resolve(null);
    }
    const write = this.#writeChain.then(async () => {
      this.#events = [event, ...this.#events].slice(0, MAXIMUM_EVENTS);
      try {
        await appendFile(this.#activePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
        await this.#rotateIfNeeded();
      } catch (error) {
        this.#events = this.#events.filter((candidate) => candidate.eventId !== event.eventId);
        throw error;
      }
    });
    this.#writeChain = write.catch((error) => {
      process.stderr.write(`[operational_log_write_failed] ${error instanceof Error ? error.message : String(error)}\n`);
    });
    return write.then(() => structuredClone(event)).catch(() => null);
  }

  list(options: OperationalLogListOptions = {}): OperationalLogEvent[] {
    const limit = Number.isSafeInteger(options.limit) && (options.limit as number) > 0
      ? Math.min(options.limit as number, 500)
      : 100;
    return this.#events
      .filter((event) => (options.level === undefined || event.level === options.level) &&
        (options.eventType === undefined || event.eventType === options.eventType) &&
        (options.operationId === undefined || event.operationId === options.operationId))
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

  async flush(): Promise<void> {
    await this.#writeChain;
  }

  async seal(): Promise<void> {
    await this.flush();
    await this.#sealActive();
    await this.#prune();
  }

  async #load(): Promise<void> {
    const names = (await readdir(this.#directory).catch(() => [] as string[]))
      .filter((name) => name === `${this.#component}.active.jsonl` ||
        (name.startsWith(`${this.#component}.`) && name.endsWith('.sealed.jsonl')))
      .sort();
    const events: OperationalLogEvent[] = [];
    for (const name of names) {
      const content = await readFile(resolve(this.#directory, name), 'utf8').catch(() => '');
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const value: unknown = JSON.parse(line);
          if (isOperationalLogEvent(value) && value.component === this.#component) {
            events.push({ ...value, details: sanitiseOperationalDetails(value.details) });
          }
        } catch {
          // One malformed line must not make the Gateway unable to start.
        }
      }
    }
    this.#events = events
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
      .slice(0, MAXIMUM_EVENTS);
  }

  async #rotateIfNeeded(): Promise<void> {
    const metadata = await stat(this.#activePath).catch(() => null);
    if (!metadata || metadata.size <= MAXIMUM_ACTIVE_BYTES) return;
    await this.#sealActive();
  }

  async #sealActive(): Promise<void> {
    const sealedPath = resolve(
      this.#directory,
      `${this.#component}.${new Date().toISOString().replace(/[:.]/g, '-')}.${randomUUID()}.sealed.jsonl`
    );
    await rename(this.#activePath, sealedPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  async #prune(now = Date.now()): Promise<void> {
    const candidates: Array<{ path: string; modifiedAt: number; size: number }> = [];
    for (const name of await readdir(this.#directory).catch(() => [] as string[])) {
      if (!(name.startsWith(`${this.#component}.`) && name.endsWith('.sealed.jsonl'))) continue;
      const path = resolve(this.#directory, name);
      const metadata = await stat(path).catch(() => null);
      if (!metadata) continue;
      if (now - metadata.mtimeMs > RETENTION_MS) {
        await rm(path, { force: true });
        continue;
      }
      candidates.push({ path, modifiedAt: metadata.mtimeMs, size: metadata.size });
    }
    candidates.sort((left, right) => left.modifiedAt - right.modifiedAt);
    let total = candidates.reduce((sum, item) => sum + item.size, 0);
    for (const candidate of candidates) {
      if (total <= MAXIMUM_TOTAL_BYTES) break;
      await rm(candidate.path, { force: true });
      total -= candidate.size;
    }
  }
}

export type OperationalLogRecord = Pick<OperationalLogEvent,
  'level' | 'eventType' | 'requestId' | 'commandId' | 'operationId' | 'workId' | 'capability' |
  'durationMs' | 'outcome' | 'errorCode' | 'details'>;

export function operationalLogRecord(
  input: Partial<OperationalLogRecord> & Pick<OperationalLogRecord, 'eventType'>
): OperationalLogRecord {
  return {
    level: input.level ?? 'info',
    eventType: input.eventType,
    requestId: input.requestId ?? null,
    commandId: input.commandId ?? null,
    operationId: input.operationId ?? null,
    workId: input.workId ?? null,
    capability: input.capability ?? null,
    durationMs: input.durationMs ?? null,
    outcome: input.outcome ?? 'unknown',
    errorCode: input.errorCode ?? null,
    details: input.details ?? {}
  };
}
