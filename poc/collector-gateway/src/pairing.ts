import {
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  GatewayPairingChallenge,
  GatewayPairingClaimResponse
} from '../../collector-extension/src/shared/control-plane';
import { canonicalJson, sha256Hex } from '../../collector-extension/src/shared/cryptography';
import type { LoadedGatewayIdentity } from './identity';

const PAIRING_SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS = 5;
const MAX_ACTIVE_PAIRING_SESSIONS = 8;

interface PairingSession {
  pairingSessionId: string;
  pairingCode: string;
  issuedAt: number;
  expiresAt: number;
  attempts: number;
}

interface PersistedExtensionPairing {
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

export class PairingBroker {
  readonly #sessions = new Map<string, PairingSession>();
  readonly #pairingsPath: string;
  readonly #identity: LoadedGatewayIdentity;
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
      if (Array.isArray(parsed)) broker.#pairings = parsed.filter(isPersistedPairing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return broker;
  }

  get pairedExtensionCount(): number {
    return this.#pairings.length;
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
      pairingCodeChallenge: await sha256Hex(`${session.pairingSessionId}:${session.pairingCode}`),
      pairingAuthorizationFingerprint: await sha256Hex(pairingAuthorization),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString()
    };
    const challenge: GatewayPairingChallenge = {
      ...unsignedChallenge,
      gatewaySignature: this.#identity.signPayload(canonicalJson(unsignedChallenge))
    };
    const pairing: PersistedExtensionPairing = {
      schemaVersion: 1,
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
    return { schemaVersion: 1, challenge, pairingAuthorization };
  }

  #pruneSessions(now: number): void {
    for (const [id, session] of this.#sessions) {
      if (session.expiresAt <= now) this.#sessions.delete(id);
    }
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
