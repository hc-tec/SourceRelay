import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CLIENT_SCHEMA_VERSION = 2 as const;
const TOKEN_PREFIX = 'cst_' as const;
const TOKEN_PATTERN = /^cst_[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_CLIENTS = 32;

export const COLLECTOR_SERVICE_CLIENT_SCOPES = [
  'profiles:read',
  'collect:execute',
  'artifacts:read'
] as const;

export type CollectorServiceClientScope = (typeof COLLECTOR_SERVICE_CLIENT_SCOPES)[number];

const DEFAULT_CLIENT_SCOPES: readonly CollectorServiceClientScope[] = COLLECTOR_SERVICE_CLIENT_SCOPES;

interface CollectorServiceClientRecord {
  schemaVersion: typeof CLIENT_SCHEMA_VERSION;
  clientId: string;
  label: string;
  tokenSha256: string;
  scopes: CollectorServiceClientScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface PersistedCollectorServiceClient {
  schemaVersion: 1 | typeof CLIENT_SCHEMA_VERSION;
  clientId: string;
  label: string;
  tokenSha256: string;
  scopes?: unknown;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CollectorServiceClientSummary {
  schemaVersion: typeof CLIENT_SCHEMA_VERSION;
  clientId: string;
  label: string;
  tokenFingerprint: string;
  scopes: readonly CollectorServiceClientScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CollectorServiceClientCreateInput {
  label: string;
  scopes: readonly CollectorServiceClientScope[];
}

export interface IssuedCollectorServiceClient {
  client: CollectorServiceClientSummary;
  /** Returned exactly once and never persisted by the Gateway. */
  token: string;
}

export interface AuthorisedCollectorServiceClient {
  clientId: string;
  label: string;
  scopes: readonly CollectorServiceClientScope[];
}

export function collectorServiceClientCreateInput(value: unknown): CollectorServiceClientCreateInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('collector_service_client_input_invalid');
  }
  const candidate = value as Partial<CollectorServiceClientCreateInput>;
  if (Object.keys(candidate).some((key) => key !== 'label' && key !== 'scopes') || typeof candidate.label !== 'string') {
    throw new Error('collector_service_client_input_invalid');
  }
  const label = candidate.label.replace(/\s+/g, ' ').trim();
  if (!label || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)) {
    throw new Error('collector_service_client_input_invalid');
  }
  return { label, scopes: clientScopes(candidate.scopes, true) };
}

export class CollectorServiceClientRegistry {
  readonly #registryPath: string;
  #clients: CollectorServiceClientRecord[] = [];
  #writeChain: Promise<void> = Promise.resolve();

  private constructor(stateDirectory: string) {
    this.#registryPath = resolve(stateDirectory, 'collector-service-clients.json');
  }

  static async create(stateDirectory: string): Promise<CollectorServiceClientRegistry> {
    const registry = new CollectorServiceClientRegistry(stateDirectory);
    await mkdir(stateDirectory, { recursive: true });
    let migrated = false;
    try {
      const parsed = JSON.parse(await readFile(registry.#registryPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        for (const candidate of parsed) {
          const client = persistedCollectorServiceClient(candidate);
          if (!client) continue;
          const persisted = candidate as Partial<PersistedCollectorServiceClient>;
          if (persisted.schemaVersion !== CLIENT_SCHEMA_VERSION) migrated = true;
          registry.#clients.push(client);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (migrated) await registry.#save();
    return registry;
  }

  list(): CollectorServiceClientSummary[] {
    return this.#clients
      .map(clientSummary)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  async issue(input: CollectorServiceClientCreateInput, now = new Date()): Promise<IssuedCollectorServiceClient> {
    if (this.#clients.filter((candidate) => candidate.revokedAt === null).length >= MAXIMUM_CLIENTS) {
      throw new Error('collector_service_client_limit_reached');
    }
    const scopes = clientScopes(input.scopes, false);
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const client: CollectorServiceClientRecord = {
      schemaVersion: CLIENT_SCHEMA_VERSION,
      clientId: randomUUID(),
      label: input.label,
      tokenSha256: sha256Hex(token),
      scopes,
      createdAt: now.toISOString(),
      lastUsedAt: null,
      revokedAt: null
    };
    this.#clients.push(client);
    try {
      await this.#save();
    } catch (error) {
      this.#clients = this.#clients.filter((candidate) => candidate.clientId !== client.clientId);
      throw error;
    }
    return { client: clientSummary(client), token };
  }

  async revoke(clientId: string, now = new Date()): Promise<CollectorServiceClientSummary> {
    if (!UUID_PATTERN.test(clientId)) throw new Error('collector_service_client_not_found');
    const client = this.#clients.find((candidate) => candidate.clientId === clientId);
    if (!client) throw new Error('collector_service_client_not_found');
    if (client.revokedAt === null) {
      client.revokedAt = now.toISOString();
      await this.#save();
    }
    return clientSummary(client);
  }

  async authorise(
    authorization: string | undefined,
    requiredScope: CollectorServiceClientScope,
    now = new Date()
  ): Promise<AuthorisedCollectorServiceClient> {
    const token = tokenFromAuthorizationHeader(authorization);
    const received = Buffer.from(sha256Hex(token), 'hex');
    const client = this.#clients.find((candidate) => {
      if (candidate.revokedAt !== null) return false;
      const expected = Buffer.from(candidate.tokenSha256, 'hex');
      return expected.length === received.length && timingSafeEqual(expected, received);
    });
    if (!client) throw new Error('collector_service_client_authorization_rejected');
    if (!client.scopes.includes(requiredScope)) throw new Error('collector_service_client_scope_denied');
    client.lastUsedAt = now.toISOString();
    await this.#save();
    return { clientId: client.clientId, label: client.label, scopes: [...client.scopes] };
  }

  async #save(): Promise<void> {
    const write = this.#writeChain.then(async () => {
      const temporaryPath = `${this.#registryPath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.#clients, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      await rename(temporaryPath, this.#registryPath);
    });
    this.#writeChain = write.catch(() => undefined);
    await write;
  }
}

function tokenFromAuthorizationHeader(value: string | undefined): string {
  const match = /^Bearer (cst_[A-Za-z0-9_-]{43})$/.exec(value ?? '');
  if (!match?.[1] || !TOKEN_PATTERN.test(match[1])) {
    throw new Error('collector_service_client_authorization_rejected');
  }
  return match[1];
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function clientSummary(client: CollectorServiceClientRecord): CollectorServiceClientSummary {
  return {
    schemaVersion: CLIENT_SCHEMA_VERSION,
    clientId: client.clientId,
    label: client.label,
    tokenFingerprint: client.tokenSha256.slice(0, 16),
    scopes: [...client.scopes],
    createdAt: client.createdAt,
    lastUsedAt: client.lastUsedAt,
    revokedAt: client.revokedAt
  };
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function persistedCollectorServiceClient(value: unknown): CollectorServiceClientRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<PersistedCollectorServiceClient>;
  if (!((candidate.schemaVersion === 1 || candidate.schemaVersion === CLIENT_SCHEMA_VERSION) &&
    typeof candidate.clientId === 'string' && UUID_PATTERN.test(candidate.clientId) &&
    typeof candidate.label === 'string' && candidate.label.length > 0 && candidate.label.length <= 80 &&
    typeof candidate.tokenSha256 === 'string' && SHA256_PATTERN.test(candidate.tokenSha256) &&
    isTimestamp(candidate.createdAt) &&
    (candidate.lastUsedAt === null || isTimestamp(candidate.lastUsedAt)) &&
    (candidate.revokedAt === null || isTimestamp(candidate.revokedAt)))) return null;
  let scopes: CollectorServiceClientScope[];
  try {
    // Schema v1 predates scopes.  Its only meaningful permission was the
    // former all-or-nothing client access, so migration must preserve that
    // full-access meaning rather than infer a narrower permission from a
    // malformed or hand-edited legacy field.
    scopes = candidate.schemaVersion === 1
      ? [...DEFAULT_CLIENT_SCOPES]
      : clientScopes(candidate.scopes, false);
  } catch {
    // A bad persisted entry must not prevent the local Gateway from starting.
    // It remains unusable until an operator repairs or removes it, just like
    // other invalid state records are ignored during loading.
    return null;
  }
  return {
    schemaVersion: CLIENT_SCHEMA_VERSION,
    clientId: candidate.clientId,
    label: candidate.label,
    tokenSha256: candidate.tokenSha256,
    scopes,
    createdAt: candidate.createdAt,
    lastUsedAt: candidate.lastUsedAt,
    revokedAt: candidate.revokedAt
  };
}

function clientScopes(value: unknown, legacyDefault: boolean): CollectorServiceClientScope[] {
  if (value === undefined && legacyDefault) return [...DEFAULT_CLIENT_SCOPES];
  if (!Array.isArray(value) || value.length < 1 || value.length > COLLECTOR_SERVICE_CLIENT_SCOPES.length) {
    throw new Error('collector_service_client_scope_invalid');
  }
  if (value.some((scope) => typeof scope !== 'string' ||
    !(COLLECTOR_SERVICE_CLIENT_SCOPES as readonly string[]).includes(scope))) {
    throw new Error('collector_service_client_scope_invalid');
  }
  const requested = new Set(value as CollectorServiceClientScope[]);
  if (requested.size !== value.length) throw new Error('collector_service_client_scope_invalid');
  return COLLECTOR_SERVICE_CLIENT_SCOPES.filter((scope) => requested.has(scope));
}
