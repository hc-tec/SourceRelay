import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  BrowserBindingState,
  BrowserBindingSummary,
  GatewayPairingChallenge,
  GatewayPairingClaimResponse
} from '@intelligence/collector-contracts';
import { canonicalJson, sha256Hex } from './canonical-json';
import type { LoadedGatewayIdentity } from './identity';

const PAIRING_SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS = 5;
const MAX_ACTIVE_PAIRING_SESSIONS = 8;
const REQUEST_CLOCK_SKEW_MS = 30_000;
const REQUEST_NONCE_TTL_MS = 2 * 60 * 1000;
const BROWSER_BINDING_ONLINE_WINDOW_MS = 90_000;

interface PairingSession {
  pairingSessionId: string;
  pairingCode: string;
  issuedAt: number;
  expiresAt: number;
  attempts: number;
}

interface PersistedExtensionPairing {
  schemaVersion: 2;
  browserBindingId: string;
  extensionId: string;
  extensionInstanceId: string;
  pairingAuthorization: string;
  pairedAt: string;
}

interface LegacyPersistedExtensionPairing {
  schemaVersion: 1;
  extensionId: string;
  extensionInstanceId: string;
  pairingAuthorization: string;
  pairedAt: string;
}

export interface PairingSessionForConsole {
  schemaVersion: 1;
  pairingSessionId: string;
  pairingCode: string;
  gatewayInstanceId: string;
  identityFingerprint: string;
  issuedAt: string;
  expiresAt: string;
}

export interface PairingClaimInput {
  schemaVersion: 1;
  pairingSessionId: string;
  pairingCode: string;
  extensionId: string;
  extensionInstanceId: string;
  extensionChallenge: string;
}

export interface AuthorisedExtension {
  browserBindingId: string;
  extensionId: string;
  extensionInstanceId: string;
}

export interface PairingAuthorisationInput {
  origin: string | undefined;
  extensionId: string | undefined;
  extensionInstanceId: string | undefined;
  timestamp: string | undefined;
  nonce: string | undefined;
  bodySha256: string | undefined;
  authorization: string | undefined;
  method: string;
  pathname: string;
  body: string;
}

export class PairingBroker {
  readonly #sessions = new Map<string, PairingSession>();
  readonly #pairingsPath: string;
  readonly #identity: LoadedGatewayIdentity;
  readonly #seenRequestNonces = new Map<string, number>();
  readonly #lastSeenByBindingId = new Map<string, number>();
  #pairings: PersistedExtensionPairing[] = [];

  private constructor(identity: LoadedGatewayIdentity, stateDirectory: string) {
    this.#identity = identity;
    this.#pairingsPath = resolve(stateDirectory, 'extension-pairings.json');
  }

  static async create(identity: LoadedGatewayIdentity, stateDirectory: string): Promise<PairingBroker> {
    const broker = new PairingBroker(identity, stateDirectory);
    await mkdir(stateDirectory, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(broker.#pairingsPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) {
        let migrated = false;
        broker.#pairings = parsed.flatMap((candidate) => {
          if (isPersistedPairing(candidate)) return [candidate];
          if (!isLegacyPersistedPairing(candidate)) return [];
          migrated = true;
          return [{
            schemaVersion: 2,
            browserBindingId: randomUUID(),
            extensionId: candidate.extensionId,
            extensionInstanceId: candidate.extensionInstanceId,
            pairingAuthorization: candidate.pairingAuthorization,
            pairedAt: candidate.pairedAt
          }];
        });
        if (migrated) await broker.#savePairings();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return broker;
  }

  get pairedExtensionCount(): number {
    return this.#pairings.length;
  }

  listBrowserBindings(now = Date.now()): BrowserBindingSummary[] {
    this.#prunePresence(now);
    return this.#pairings
      .map((pairing) => this.#summary(pairing, now))
      .sort((left, right) => left.pairedAt.localeCompare(right.pairedAt));
  }

  getBrowserBinding(browserBindingId: string, now = Date.now()): BrowserBindingSummary {
    this.#prunePresence(now);
    const pairing = this.#pairings.find((candidate) => candidate.browserBindingId === browserBindingId);
    if (!pairing) throw new Error('browser_binding_not_found');
    return this.#summary(pairing, now);
  }

  async revokeBrowserBinding(browserBindingId: string): Promise<BrowserBindingSummary> {
    const pairing = this.#pairings.find((candidate) => candidate.browserBindingId === browserBindingId);
    if (!pairing) throw new Error('browser_binding_not_found');
    const summary = this.#summary(pairing, Date.now());
    this.#pairings = this.#pairings.filter((candidate) => candidate.browserBindingId !== browserBindingId);
    this.#lastSeenByBindingId.delete(browserBindingId);
    await this.#savePairings();
    return summary;
  }

  createSession(now = Date.now()): PairingSessionForConsole {
    this.#pruneSessions(now);
    if (this.#sessions.size >= MAX_ACTIVE_PAIRING_SESSIONS) {
      const oldest = [...this.#sessions.values()].sort((left, right) => left.issuedAt - right.issuedAt)[0];
      if (oldest) this.#sessions.delete(oldest.pairingSessionId);
    }
    const session: PairingSession = {
      pairingSessionId: randomUUID(),
      pairingCode: randomInt(0, 100_000_000).toString().padStart(8, '0'),
      issuedAt: now,
      expiresAt: now + PAIRING_SESSION_TTL_MS,
      attempts: 0
    };
    this.#sessions.set(session.pairingSessionId, session);
    return {
      schemaVersion: 1,
      pairingSessionId: session.pairingSessionId,
      pairingCode: session.pairingCode,
      gatewayInstanceId: this.#identity.publicIdentity.gatewayInstanceId,
      identityFingerprint: this.#identity.publicIdentity.identityFingerprint,
      issuedAt: new Date(session.issuedAt).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString()
    };
  }

  async claim(input: PairingClaimInput, now = Date.now()): Promise<GatewayPairingClaimResponse> {
    this.#pruneSessions(now);
    const session = this.#sessions.get(input.pairingSessionId);
    if (!session || session.expiresAt <= now) throw new Error('pairing_session_unavailable');
    session.attempts += 1;
    if (session.attempts > MAX_PAIRING_ATTEMPTS) {
      this.#sessions.delete(session.pairingSessionId);
      throw new Error('pairing_attempt_limit_reached');
    }
    const expected = Buffer.from(session.pairingCode, 'utf8');
    const received = Buffer.from(input.pairingCode, 'utf8');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new Error('pairing_code_invalid');
    }
    if (!/^[a-p]{32}$/.test(input.extensionId)) throw new Error('extension_id_invalid');
    if (!/^[0-9a-f-]{36}$/i.test(input.extensionInstanceId)) throw new Error('extension_instance_invalid');
    if (!/^[A-Za-z0-9_-]{40,}$/.test(input.extensionChallenge)) throw new Error('extension_challenge_invalid');

    const pairingAuthorization = randomBytes(32).toString('base64url');
    const unsignedChallenge: Omit<GatewayPairingChallenge, 'gatewaySignature'> = {
      schemaVersion: 1,
      protocolVersion: 1,
      pairingSessionId: session.pairingSessionId,
      gateway: this.#identity.publicIdentity,
      extensionChallenge: input.extensionChallenge,
      pairingCodeChallenge: sha256Hex(`${session.pairingSessionId}:${session.pairingCode}`),
      pairingAuthorizationFingerprint: sha256Hex(pairingAuthorization),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString()
    };
    const challenge: GatewayPairingChallenge = {
      ...unsignedChallenge,
      gatewaySignature: this.#identity.signPayload(canonicalJson(unsignedChallenge))
    };
    const existing = this.#pairings.find(
      (candidate) => candidate.extensionInstanceId === input.extensionInstanceId
    );
    const pairing: PersistedExtensionPairing = {
      schemaVersion: 2,
      browserBindingId: existing?.browserBindingId ?? randomUUID(),
      extensionId: input.extensionId,
      extensionInstanceId: input.extensionInstanceId,
      pairingAuthorization,
      pairedAt: new Date(now).toISOString()
    };
    this.#pairings = [
      ...this.#pairings.filter((candidate) => candidate.extensionInstanceId !== input.extensionInstanceId),
      pairing
    ];
    await this.#savePairings();
    this.#sessions.delete(session.pairingSessionId);
    return {
      schemaVersion: 1,
      browserBindingId: pairing.browserBindingId,
      challenge,
      pairingAuthorization
    };
  }

  async authoriseRequest(input: PairingAuthorisationInput, now = Date.now()): Promise<AuthorisedExtension> {
    const pairing = this.#pairings.find(
      (candidate) => candidate.extensionInstanceId === input.extensionInstanceId
    );
    if (!pairing || input.extensionId !== pairing.extensionId) throw new Error('pairing_authorization_rejected');
    if (input.origin !== undefined && input.origin !== `chrome-extension://${pairing.extensionId}`) {
      throw new Error('pairing_origin_rejected');
    }
    if (!input.timestamp || !/^\d{13}$/.test(input.timestamp)) throw new Error('pairing_timestamp_invalid');
    const requestTime = Number(input.timestamp);
    if (Math.abs(now - requestTime) > REQUEST_CLOCK_SKEW_MS) throw new Error('pairing_timestamp_expired');
    if (!input.nonce || !/^[A-Za-z0-9_-]{40,}$/.test(input.nonce)) throw new Error('pairing_nonce_invalid');
    this.#pruneRequestNonces(now);
    const nonceKey = `${pairing.extensionInstanceId}:${input.nonce}`;
    if (this.#seenRequestNonces.has(nonceKey)) throw new Error('pairing_nonce_replayed');
    if (!input.bodySha256 || input.bodySha256 !== sha256Hex(input.body)) {
      throw new Error('pairing_body_digest_invalid');
    }
    if (!input.authorization || !/^[A-Za-z0-9_-]{40,}$/.test(input.authorization)) {
      throw new Error('pairing_authorization_rejected');
    }
    const payload = [
      input.method.toUpperCase(),
      input.pathname,
      input.timestamp,
      input.nonce,
      input.bodySha256
    ].join('\n');
    const expected = createHmac('sha256', pairing.pairingAuthorization).update(payload).digest();
    let received: Buffer;
    try {
      received = Buffer.from(input.authorization, 'base64url');
    } catch {
      throw new Error('pairing_authorization_rejected');
    }
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new Error('pairing_authorization_rejected');
    }
    this.#seenRequestNonces.set(nonceKey, now + REQUEST_NONCE_TTL_MS);
    this.#lastSeenByBindingId.set(pairing.browserBindingId, now);
    return {
      browserBindingId: pairing.browserBindingId,
      extensionId: pairing.extensionId,
      extensionInstanceId: pairing.extensionInstanceId
    };
  }

  #pruneSessions(now: number): void {
    for (const [id, session] of this.#sessions) {
      if (session.expiresAt <= now) this.#sessions.delete(id);
    }
  }

  #pruneRequestNonces(now: number): void {
    for (const [key, expiresAt] of this.#seenRequestNonces) {
      if (expiresAt <= now) this.#seenRequestNonces.delete(key);
    }
  }

  #prunePresence(now: number): void {
    for (const [bindingId, seenAt] of this.#lastSeenByBindingId) {
      if (seenAt + BROWSER_BINDING_ONLINE_WINDOW_MS <= now) this.#lastSeenByBindingId.delete(bindingId);
    }
  }

  #summary(pairing: PersistedExtensionPairing, now: number): BrowserBindingSummary {
    const seenAt = this.#lastSeenByBindingId.get(pairing.browserBindingId) ?? null;
    const state: BrowserBindingState = seenAt !== null && seenAt + BROWSER_BINDING_ONLINE_WINDOW_MS > now
      ? 'online'
      : 'paired';
    return {
      schemaVersion: 1,
      browserBindingId: pairing.browserBindingId,
      extensionId: pairing.extensionId,
      state,
      pairedAt: pairing.pairedAt,
      lastSeenAt: seenAt === null ? null : new Date(seenAt).toISOString()
    };
  }

  async #savePairings(): Promise<void> {
    const temporaryPath = `${this.#pairingsPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.#pairings, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temporaryPath, this.#pairingsPath);
  }
}

function isPersistedPairing(value: unknown): value is PersistedExtensionPairing {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedExtensionPairing>;
  return (
    candidate.schemaVersion === 2 &&
    typeof candidate.browserBindingId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(candidate.browserBindingId) &&
    typeof candidate.extensionId === 'string' &&
    /^[a-p]{32}$/.test(candidate.extensionId) &&
    typeof candidate.extensionInstanceId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(candidate.extensionInstanceId) &&
    typeof candidate.pairingAuthorization === 'string' &&
    /^[A-Za-z0-9_-]{40,}$/.test(candidate.pairingAuthorization) &&
    typeof candidate.pairedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.pairedAt))
  );
}

function isLegacyPersistedPairing(value: unknown): value is LegacyPersistedExtensionPairing {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LegacyPersistedExtensionPairing>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.extensionId === 'string' &&
    /^[a-p]{32}$/.test(candidate.extensionId) &&
    typeof candidate.extensionInstanceId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(candidate.extensionInstanceId) &&
    typeof candidate.pairingAuthorization === 'string' &&
    /^[A-Za-z0-9_-]{40,}$/.test(candidate.pairingAuthorization) &&
    typeof candidate.pairedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.pairedAt))
  );
}
