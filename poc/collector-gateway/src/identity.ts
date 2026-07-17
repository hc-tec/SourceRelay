import {
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { GatewayIdentity } from '../../collector-extension/src/shared/control-plane';
import { canonicalJson, sha256Hex } from '../../collector-extension/src/shared/cryptography';
import type { GatewayConfig } from './config';

interface PersistedGatewayIdentity {
  schemaVersion: 1;
  gatewayInstanceId: string;
  privateKeyPem: string;
  publicKeyJwk: JsonWebKey;
}

export interface LoadedGatewayIdentity {
  publicIdentity: GatewayIdentity;
  signPayload(payload: string): string;
}

function isPersistedIdentity(value: unknown): value is PersistedGatewayIdentity {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedGatewayIdentity>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.gatewayInstanceId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(candidate.gatewayInstanceId) &&
    typeof candidate.privateKeyPem === 'string' &&
    candidate.privateKeyPem.includes('BEGIN PRIVATE KEY') &&
    Boolean(candidate.publicKeyJwk)
  );
}

async function writeIdentity(path: string, value: PersistedGatewayIdentity): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

async function persistedIdentity(stateDirectory: string): Promise<PersistedGatewayIdentity> {
  await mkdir(stateDirectory, { recursive: true });
  const path = resolve(stateDirectory, 'gateway-identity.json');
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!isPersistedIdentity(parsed)) throw new Error('Persisted Gateway identity is invalid.');
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const created: PersistedGatewayIdentity = {
    schemaVersion: 1,
    gatewayInstanceId: randomUUID(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyJwk: publicKey.export({ format: 'jwk' }) as JsonWebKey
  };
  await writeIdentity(path, created);
  return created;
}

export async function loadGatewayIdentity(config: GatewayConfig): Promise<LoadedGatewayIdentity> {
  const persisted = await persistedIdentity(config.stateDirectory);
  const privateKey: KeyObject = createPrivateKey(persisted.privateKeyPem);
  const identityFingerprint = await sha256Hex(canonicalJson(persisted.publicKeyJwk));
  const publicIdentity: GatewayIdentity = {
    schemaVersion: 1,
    protocolVersion: 1,
    gatewayInstanceId: persisted.gatewayInstanceId,
    displayName: config.displayName,
    loopbackOrigin: `http://${config.host}:${config.port}`,
    signingPublicKeyJwk: persisted.publicKeyJwk,
    identityFingerprint
  };
  return {
    publicIdentity,
    signPayload(payload) {
      return sign('sha256', Buffer.from(payload, 'utf8'), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363'
      }).toString('base64url');
    }
  };
}
