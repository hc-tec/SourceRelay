import type {
  BrowserBindingSummary,
  GatewayIdentity,
  GatewayPairingClaimResponse
} from '@intelligence/collector-contracts';
import {
  EXTENSION_ID,
  SAFE_ERROR,
  UUID,
  type PairUserBrowserGatewayInput
} from './user-browser-gateway-types';

export function pairingInput(value: PairUserBrowserGatewayInput): PairUserBrowserGatewayInput {
  const loopbackOrigin = normaliseLoopbackOrigin(value.loopbackOrigin);
  if (
    !/^[a-f0-9]{64}$/.test(value.identityFingerprint) ||
    !UUID.test(value.pairingSessionId) ||
    !/^\d{8}$/.test(value.pairingCode)
  ) throw new Error('gateway_pairing_input_invalid');
  return {
    loopbackOrigin,
    identityFingerprint: value.identityFingerprint,
    pairingSessionId: value.pairingSessionId,
    pairingCode: value.pairingCode
  };
}

export function normaliseLoopbackOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('gateway_loopback_origin_invalid');
  }
  const port = Number(url.port);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65_535 ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) throw new Error('gateway_loopback_origin_invalid');
  return url.origin;
}

export function pairingClaimResponse(value: unknown): GatewayPairingClaimResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('gateway_pairing_response_invalid');
  const candidate = value as Partial<GatewayPairingClaimResponse>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.browserBindingId !== 'string' ||
    !UUID.test(candidate.browserBindingId) ||
    !gatewayPairingChallenge(candidate.challenge) ||
    typeof candidate.pairingAuthorization !== 'string' ||
    !/^[A-Za-z0-9_-]{40,}$/.test(candidate.pairingAuthorization)
  ) throw new Error('gateway_pairing_response_invalid');
  return {
    schemaVersion: 1,
    browserBindingId: candidate.browserBindingId,
    challenge: candidate.challenge,
    pairingAuthorization: candidate.pairingAuthorization
  };
}

export function browserBindingSummary(value: unknown): BrowserBindingSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('gateway_binding_response_invalid');
  const candidate = value as Partial<BrowserBindingSummary>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.browserBindingId !== 'string' || !UUID.test(candidate.browserBindingId) ||
    typeof candidate.extensionId !== 'string' || !EXTENSION_ID.test(candidate.extensionId) ||
    (candidate.state !== 'paired' && candidate.state !== 'online') ||
    typeof candidate.pairedAt !== 'string' || !Number.isFinite(Date.parse(candidate.pairedAt)) ||
    (candidate.lastSeenAt !== null && (typeof candidate.lastSeenAt !== 'string' || !Number.isFinite(Date.parse(candidate.lastSeenAt))))
  ) throw new Error('gateway_binding_response_invalid');
  return structuredClone(candidate) as BrowserBindingSummary;
}

export function safeGatewayErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : '';
  return SAFE_ERROR.test(value) ? value : 'gateway_connection_failed';
}

function gatewayPairingChallenge(value: unknown): value is GatewayPairingClaimResponse['challenge'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<GatewayPairingClaimResponse['challenge']>;
  return candidate.schemaVersion === 1 &&
    candidate.protocolVersion === 1 &&
    typeof candidate.pairingSessionId === 'string' && UUID.test(candidate.pairingSessionId) &&
    gatewayIdentity(candidate.gateway) &&
    typeof candidate.extensionChallenge === 'string' && /^[A-Za-z0-9_-]{40,}$/.test(candidate.extensionChallenge) &&
    typeof candidate.pairingCodeChallenge === 'string' && /^[a-f0-9]{64}$/.test(candidate.pairingCodeChallenge) &&
    typeof candidate.pairingAuthorizationFingerprint === 'string' && /^[a-f0-9]{64}$/.test(candidate.pairingAuthorizationFingerprint) &&
    typeof candidate.issuedAt === 'string' && Number.isFinite(Date.parse(candidate.issuedAt)) &&
    typeof candidate.expiresAt === 'string' && Number.isFinite(Date.parse(candidate.expiresAt)) &&
    typeof candidate.gatewaySignature === 'string' && /^[A-Za-z0-9_-]{40,}$/.test(candidate.gatewaySignature);
}

function gatewayIdentity(value: unknown): value is GatewayIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<GatewayIdentity>;
  try {
    return candidate.schemaVersion === 1 &&
      candidate.protocolVersion === 1 &&
      typeof candidate.gatewayInstanceId === 'string' && UUID.test(candidate.gatewayInstanceId) &&
      typeof candidate.displayName === 'string' && candidate.displayName.length > 0 && candidate.displayName.length <= 80 &&
      typeof candidate.loopbackOrigin === 'string' && normaliseLoopbackOrigin(candidate.loopbackOrigin) === candidate.loopbackOrigin &&
      Boolean(candidate.signingPublicKeyJwk) &&
      typeof candidate.identityFingerprint === 'string' && /^[a-f0-9]{64}$/.test(candidate.identityFingerprint);
  } catch {
    return false;
  }
}
