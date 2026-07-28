import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  isCollectorServiceCapability,
  type CollectorServiceCapability
} from './collector-service-contract';

const AUDIT_SCHEMA_VERSION = 1 as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_DIGEST_PATTERN = /^[0-9a-f]{32}$/;
const ERROR_CODE_PATTERN = /^[a-z0-9_.-]{1,120}$/i;

/** Keep the local operational history bounded instead of becoming a data store. */
export const COLLECTOR_SERVICE_AUDIT_RETENTION = 1_000;

export type CollectorServiceAuditActor =
  | { kind: 'console' | 'unidentified'; clientId: null }
  | { kind: 'client'; clientId: string };

export type CollectorServiceAuditAction =
  | 'profiles_read'
  | 'browser_bindings_read'
  | 'collect'
  | 'operation_read'
  | 'artifact_read';

export type CollectorServiceAuditOutcome =
  | 'completed'
  | 'queued'
  | 'partial'
  | 'failed'
  | 'not_found'
  | 'denied';

export type CollectorServiceAuditCapability =
  | CollectorServiceCapability
  | 'xiaohongshu.search.public_notes.v1'
  | 'xiaohongshu.account.public_notes.v1'
  | 'xiaohongshu.note.public_detail.v1'
  | 'xiaohongshu.note.public_comments.v1';

/**
 * Deliberately small, de-identified call history.  In particular it has no
 * request input, URL, query, raw response, token, header, Cookie, Profile
 * path, or browser identity material.
 */
export interface CollectorServiceAuditEvent {
  schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  auditId: string;
  occurredAt: string;
  actor: CollectorServiceAuditActor;
  action: CollectorServiceAuditAction;
  capability: CollectorServiceAuditCapability | null;
  profileIdDigest: string | null;
  artifactId: string | null;
  operationId: string | null;
  operationKind: 'run' | 'batch' | null;
  outcome: CollectorServiceAuditOutcome;
  errorCode: string | null;
}

export interface CollectorServiceAuditInput {
  actor: CollectorServiceAuditActor;
  action: CollectorServiceAuditAction;
  capability: CollectorServiceAuditCapability | null;
  profileIdDigest: string | null;
  artifactId: string | null;
  operationId: string | null;
  operationKind: 'run' | 'batch' | null;
  outcome: CollectorServiceAuditOutcome;
  errorCode: string | null;
}

/**
 * A digest is sufficient to correlate calls for a single managed Profile in
 * the local audit while keeping the raw Profile UUID out of the audit file.
 */
export function collectorServiceProfileIdDigest(profileId: string): string {
  if (!UUID_PATTERN.test(profileId)) throw new Error('collector_service_audit_profile_invalid');
  return createHash('sha256').update(`collector-service-profile:${profileId}`, 'utf8').digest('hex').slice(0, 32);
}

export class CollectorServiceAuditLog {
  readonly #auditPath: string;
  #events: CollectorServiceAuditEvent[] = [];
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#auditPath = resolve(stateDirectory, 'collector-service-audit.json');
  }

  static async create(stateDirectory: string): Promise<CollectorServiceAuditLog> {
    const audit = new CollectorServiceAuditLog(stateDirectory);
    await mkdir(stateDirectory, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(audit.#auditPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        audit.#events = parsed
          .map(persistedAuditEvent)
          .filter((event): event is CollectorServiceAuditEvent => event !== null)
          .sort(compareNewestFirst)
          .slice(0, COLLECTOR_SERVICE_AUDIT_RETENTION);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return audit;
  }

  list(): CollectorServiceAuditEvent[] {
    return this.#events.map((event) => structuredClone(event));
  }

  async record(input: CollectorServiceAuditInput, now = new Date()): Promise<CollectorServiceAuditEvent> {
    const event = auditEvent({
      schemaVersion: AUDIT_SCHEMA_VERSION,
      auditId: randomUUID(),
      occurredAt: now.toISOString(),
      ...input
    });
    const write = this.#writeChain.then(async () => {
      const previous = this.#events;
      this.#events = [event, ...this.#events].slice(0, COLLECTOR_SERVICE_AUDIT_RETENTION);
      try {
        await this.#write();
      } catch (error) {
        this.#events = previous;
        throw error;
      }
    });
    this.#writeChain = write.catch(() => undefined);
    await write;
    return structuredClone(event);
  }

  async #write(): Promise<void> {
    const temporaryPath = `${this.#auditPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.#events, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temporaryPath, this.#auditPath);
  }
}

function persistedAuditEvent(value: unknown): CollectorServiceAuditEvent | null {
  try {
    return auditEvent(value);
  } catch {
    // Corrupt or hand-edited local state must not stop the Gateway.
    return null;
  }
}

function auditEvent(value: unknown): CollectorServiceAuditEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('collector_service_audit_input_invalid');
  }
  const candidate = value as Partial<CollectorServiceAuditEvent>;
  if (
    candidate.schemaVersion !== AUDIT_SCHEMA_VERSION ||
    typeof candidate.auditId !== 'string' || !UUID_PATTERN.test(candidate.auditId) ||
    !isTimestamp(candidate.occurredAt) ||
    !isAuditActor(candidate.actor) ||
    !isAuditAction(candidate.action) ||
    !(candidate.capability === null || isCollectorServiceCapability(candidate.capability) ||
      candidate.capability === 'xiaohongshu.search.public_notes.v1' ||
      candidate.capability === 'xiaohongshu.account.public_notes.v1' ||
      candidate.capability === 'xiaohongshu.note.public_detail.v1') ||
    !(candidate.profileIdDigest === null ||
      (typeof candidate.profileIdDigest === 'string' && PROFILE_DIGEST_PATTERN.test(candidate.profileIdDigest))) ||
    !(candidate.artifactId === null ||
      (typeof candidate.artifactId === 'string' && UUID_PATTERN.test(candidate.artifactId))) ||
    !(candidate.operationId === null ||
      (typeof candidate.operationId === 'string' && UUID_PATTERN.test(candidate.operationId))) ||
    !(candidate.operationKind === null || candidate.operationKind === 'run' || candidate.operationKind === 'batch') ||
    !isAuditOutcome(candidate.outcome) ||
    !(candidate.errorCode === null ||
      (typeof candidate.errorCode === 'string' && ERROR_CODE_PATTERN.test(candidate.errorCode)))
  ) {
    throw new Error('collector_service_audit_input_invalid');
  }
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    auditId: candidate.auditId,
    occurredAt: candidate.occurredAt,
    actor: structuredClone(candidate.actor),
    action: candidate.action,
    capability: candidate.capability,
    profileIdDigest: candidate.profileIdDigest,
    artifactId: candidate.artifactId,
    operationId: candidate.operationId,
    operationKind: candidate.operationKind,
    outcome: candidate.outcome,
    errorCode: candidate.errorCode
  };
}

function isAuditActor(value: unknown): value is CollectorServiceAuditActor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actor = value as Partial<CollectorServiceAuditActor>;
  if (actor.kind === 'client') return typeof actor.clientId === 'string' && UUID_PATTERN.test(actor.clientId);
  return (actor.kind === 'console' || actor.kind === 'unidentified') && actor.clientId === null;
}

function isAuditAction(value: unknown): value is CollectorServiceAuditAction {
  return value === 'profiles_read' || value === 'browser_bindings_read' || value === 'collect' ||
    value === 'operation_read' || value === 'artifact_read';
}

function isAuditOutcome(value: unknown): value is CollectorServiceAuditOutcome {
  return value === 'completed' || value === 'queued' || value === 'partial' || value === 'failed' ||
    value === 'not_found' || value === 'denied';
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function compareNewestFirst(left: CollectorServiceAuditEvent, right: CollectorServiceAuditEvent): number {
  return Date.parse(right.occurredAt) - Date.parse(left.occurredAt) || right.auditId.localeCompare(left.auditId);
}
