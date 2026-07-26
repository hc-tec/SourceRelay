import type {
  BrowserBindingSummary,
  GatewayPairingClaimResponse,
  GatewayPairingRecord
} from '@intelligence/collector-contracts';
import {
  canonicalJson,
  hmacSha256Base64Url,
  randomBase64Url,
  sha256Hex,
  verifyGatewaySignature
} from '../shared/cryptography';
import {
  browserBindingSummary,
  userBrowserGatewayDirectCapabilityCatalog,
  pairingClaimResponse
} from './user-browser-gateway-validation';
import type { UserBrowserGatewayCapabilityDescriptor } from './user-browser-gateway-types';
import {
  EXTENSION_ID,
  SAFE_ERROR,
  type PairUserBrowserGatewayInput
} from './user-browser-gateway-types';

export async function claimGatewayPairing(input: {
  pairing: PairUserBrowserGatewayInput;
  extensionId: string;
  extensionInstanceId: string;
}): Promise<GatewayPairingClaimResponse> {
  const extensionChallenge = randomBase64Url(32);
  const response = await fetchJson(`${input.pairing.loopbackOrigin}/v1/extension/pairing/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      pairingSessionId: input.pairing.pairingSessionId,
      pairingCode: input.pairing.pairingCode,
      extensionId: input.extensionId,
      extensionInstanceId: input.extensionInstanceId,
      extensionChallenge
    })
  });
  const claim = pairingClaimResponse(response);
  await verifyPairingClaim({
    claim,
    pairing: input.pairing,
    extensionChallenge
  });
  return claim;
}

export async function readGatewayBinding(record: GatewayPairingRecord): Promise<BrowserBindingSummary> {
  const payload = await authenticatedGatewayJson(record, {
    method: 'GET',
    pathname: '/v1/extension/browser-binding',
    body: ''
  });
  const binding = browserBindingSummary((payload as { binding?: unknown }).binding);
  if (binding.browserBindingId !== record.browserBindingId) throw new Error('gateway_binding_identity_mismatch');
  return binding;
}

/**
 * A fixed, read-only public catalog request used only by the extension control
 * page. The caller supplies neither a host nor a pathname: both are bound to
 * the verified pairing record and this exact `/v2/capabilities` endpoint.
 */
export async function readGatewayDirectCapabilityCatalog(
  record: GatewayPairingRecord
): Promise<readonly UserBrowserGatewayCapabilityDescriptor[]> {
  const payload = await fetchJson(`${record.loopbackOrigin}/v2/capabilities`, {
    method: 'GET',
    headers: { accept: 'application/json' }
  });
  return userBrowserGatewayDirectCapabilityCatalog(payload);
}

/**
 * Internal-only authenticated transport for the three fixed extension routes.
 * The caller cannot choose a Gateway host, arbitrary path, headers, or body
 * digest; those remain bound to the verified pairing record.
 */
export async function authenticatedGatewayJson(
  record: GatewayPairingRecord,
  request: {
    method: 'GET' | 'POST';
    pathname:
      | '/v1/extension/browser-binding'
      | '/v1/extension/work-items/next'
      | '/v1/extension/work-items/result';
    body: string;
  }
): Promise<unknown> {
  const { method, pathname, body } = request;
  const timestamp = String(Date.now());
  const nonce = randomBase64Url(32);
  const bodySha256 = await sha256Hex(body);
  const authorization = await hmacSha256Base64Url(
    record.pairingAuthorization,
    [method, pathname, timestamp, nonce, bodySha256].join('\n')
  );
  const headers: Record<string, string> = {
    authorization,
    'x-collector-extension-id': chrome.runtime.id,
    'x-collector-extension-instance-id': record.extensionInstanceId,
    'x-collector-timestamp': timestamp,
    'x-collector-nonce': nonce,
    'x-collector-body-sha256': bodySha256
  };
  if (body) headers['content-type'] = 'application/json';
  const payload = await fetchJson(`${record.loopbackOrigin}${pathname}`, {
    method,
    headers,
    ...(body ? { body } : {})
  });
  return payload;
}

async function verifyPairingClaim(input: {
  claim: GatewayPairingClaimResponse;
  pairing: PairUserBrowserGatewayInput;
  extensionChallenge: string;
}): Promise<void> {
  const { claim } = input;
  const challenge = claim.challenge;
  if (
    challenge.pairingSessionId !== input.pairing.pairingSessionId ||
    challenge.extensionChallenge !== input.extensionChallenge ||
    challenge.gateway.loopbackOrigin !== input.pairing.loopbackOrigin ||
    challenge.gateway.identityFingerprint !== input.pairing.identityFingerprint ||
    Date.parse(challenge.issuedAt) > Date.now() ||
    Date.parse(challenge.expiresAt) <= Date.now()
  ) throw new Error('gateway_pairing_claim_mismatch');
  if (
    input.pairing.identityFingerprint !== await sha256Hex(canonicalJson(challenge.gateway.signingPublicKeyJwk))
  ) throw new Error('gateway_identity_fingerprint_invalid');
  if (challenge.pairingCodeChallenge !== await sha256Hex(`${input.pairing.pairingSessionId}:${input.pairing.pairingCode}`)) {
    throw new Error('gateway_pairing_code_challenge_invalid');
  }
  if (challenge.pairingAuthorizationFingerprint !== await sha256Hex(claim.pairingAuthorization)) {
    throw new Error('gateway_pairing_authorization_fingerprint_invalid');
  }
  const unsigned = {
    schemaVersion: challenge.schemaVersion,
    protocolVersion: challenge.protocolVersion,
    pairingSessionId: challenge.pairingSessionId,
    gateway: challenge.gateway,
    extensionChallenge: challenge.extensionChallenge,
    pairingCodeChallenge: challenge.pairingCodeChallenge,
    pairingAuthorizationFingerprint: challenge.pairingAuthorizationFingerprint,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt
  };
  const validSignature = await verifyGatewaySignature({
    publicKeyJwk: challenge.gateway.signingPublicKeyJwk,
    payload: canonicalJson(unsigned),
    signature: challenge.gatewaySignature
  });
  if (!validSignature) throw new Error('gateway_pairing_signature_invalid');
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: 'no-store',
      credentials: 'omit'
    });
  } catch {
    throw new Error('gateway_unreachable');
  }
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) {
    const error = typeof payload?.error === 'string' && SAFE_ERROR.test(payload.error)
      ? payload.error
      : 'gateway_request_rejected';
    throw new Error(error);
  }
  if (payload === null) throw new Error('gateway_response_invalid');
  return payload;
}
