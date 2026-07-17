import {
  canonicalJson,
  randomBase64Url,
  sha256Hex,
  verifyGatewaySignature
} from '../shared/cryptography';
import {
  normaliseLoopbackGatewayOrigin,
  type GatewayPairingChallenge,
  type GatewayPairingClaimResponse,
  type GatewayPairingRecord
} from '../shared/control-plane';
import { saveGatewayPairing } from './pairing-store';

const EXTENSION_INSTANCE_ID_KEY = 'collector.extension-instance-id';
const MAX_PAIRING_RESPONSE_BYTES = 64 * 1024;

async function extensionInstanceId(): Promise<string> {
  const stored = await chrome.storage.local.get(EXTENSION_INSTANCE_ID_KEY);
  const existing = stored[EXTENSION_INSTANCE_ID_KEY];
  if (typeof existing === 'string' && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const created = crypto.randomUUID();
  await chrome.storage.local.set({ [EXTENSION_INSTANCE_ID_KEY]: created });
  return created;
}

function isPairingChallenge(value: unknown): value is GatewayPairingChallenge {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GatewayPairingChallenge>;
  return (
    candidate.schemaVersion === 1 &&
    candidate.protocolVersion === 1 &&
    typeof candidate.pairingSessionId === 'string' &&
    Boolean(candidate.gateway) &&
    typeof candidate.extensionChallenge === 'string' &&
    typeof candidate.pairingCodeChallenge === 'string' &&
    typeof candidate.pairingAuthorizationFingerprint === 'string' &&
    typeof candidate.issuedAt === 'string' &&
    typeof candidate.expiresAt === 'string' &&
    typeof candidate.gatewaySignature === 'string'
  );
}

function isPairingClaimResponse(value: unknown): value is GatewayPairingClaimResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GatewayPairingClaimResponse>;
  return (
    candidate.schemaVersion === 1 &&
    isPairingChallenge(candidate.challenge) &&
    typeof candidate.pairingAuthorization === 'string' &&
    /^[A-Za-z0-9_-]{40,}$/.test(candidate.pairingAuthorization)
  );
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PAIRING_RESPONSE_BYTES) {
    throw new Error('Gateway pairing response exceeded the size limit.');
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_PAIRING_RESPONSE_BYTES) {
    throw new Error('Gateway pairing response exceeded the size limit.');
  }
  return JSON.parse(text) as unknown;
}

export async function pairGateway(input: {
  loopbackOrigin: string;
  pairingSessionId: string;
  pairingCode: string;
}): Promise<GatewayPairingRecord> {
  const loopbackOrigin = normaliseLoopbackGatewayOrigin(input.loopbackOrigin);
  if (!loopbackOrigin) throw new Error('Gateway origin must be an explicit http://127.0.0.1:<port> origin.');
  if (!/^[0-9a-f-]{36}$/i.test(input.pairingSessionId)) throw new Error('Pairing session ID is invalid.');
  if (!/^\d{8}$/.test(input.pairingCode)) throw new Error('Pairing code must contain exactly eight digits.');

  const instanceId = await extensionInstanceId();
  const extensionChallenge = randomBase64Url();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`${loopbackOrigin}/v1/pairing/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        pairingSessionId: input.pairingSessionId,
        pairingCode: input.pairingCode,
        extensionId: chrome.runtime.id,
        extensionInstanceId: instanceId,
        extensionChallenge
      }),
      cache: 'no-store',
      credentials: 'omit',
      signal: abortController.signal
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Gateway rejected the pairing claim with status ${response.status}.`);

  const claim = await readBoundedJson(response);
  if (!isPairingClaimResponse(claim)) throw new Error('Gateway returned an invalid pairing claim.');
  const challenge = claim.challenge;
  if (challenge.pairingSessionId !== input.pairingSessionId) throw new Error('Gateway pairing session changed.');
  if (challenge.extensionChallenge !== extensionChallenge) throw new Error('Gateway did not bind the extension challenge.');
  if (challenge.gateway.loopbackOrigin !== loopbackOrigin) throw new Error('Gateway identity origin does not match the approved origin.');
  if (normaliseLoopbackGatewayOrigin(challenge.gateway.loopbackOrigin) !== loopbackOrigin) {
    throw new Error('Gateway identity is not bound to the approved loopback origin.');
  }
  if (Date.parse(challenge.expiresAt) <= Date.now() || Date.parse(challenge.issuedAt) > Date.now() + 30_000) {
    throw new Error('Gateway pairing challenge is expired or not yet valid.');
  }

  const expectedCodeChallenge = await sha256Hex(`${input.pairingSessionId}:${input.pairingCode}`);
  if (challenge.pairingCodeChallenge !== expectedCodeChallenge) throw new Error('Gateway pairing code challenge did not match.');
  if (challenge.pairingAuthorizationFingerprint !== await sha256Hex(claim.pairingAuthorization)) {
    throw new Error('Gateway pairing authorization was not bound to the signed challenge.');
  }
  const identityFingerprint = await sha256Hex(canonicalJson(challenge.gateway.signingPublicKeyJwk));
  if (challenge.gateway.identityFingerprint !== identityFingerprint) throw new Error('Gateway identity fingerprint is invalid.');

  const { gatewaySignature, ...unsignedChallenge } = challenge;
  const signatureValid = await verifyGatewaySignature({
    publicKeyJwk: challenge.gateway.signingPublicKeyJwk,
    payload: canonicalJson(unsignedChallenge),
    signature: gatewaySignature
  });
  if (!signatureValid) throw new Error('Gateway pairing signature is invalid.');

  const pairing: GatewayPairingRecord = {
    schemaVersion: 1,
    gatewayInstanceId: challenge.gateway.gatewayInstanceId,
    displayName: challenge.gateway.displayName,
    loopbackOrigin,
    signingPublicKeyJwk: challenge.gateway.signingPublicKeyJwk,
    identityFingerprint,
    extensionInstanceId: instanceId,
    pairingAuthorization: claim.pairingAuthorization,
    pairedAt: new Date().toISOString()
  };
  await saveGatewayPairing(pairing);
  return pairing;
}
