import {
  normaliseLoopbackGatewayOrigin,
  type GatewayPairingRecord
} from '../shared/control-plane';

const GATEWAY_PAIRING_STORAGE_KEY = 'collector.gateway-pairing.v1';

function isGatewayPairingRecord(value: unknown): value is GatewayPairingRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GatewayPairingRecord>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.gatewayInstanceId === 'string' &&
    candidate.gatewayInstanceId.length > 0 &&
    typeof candidate.displayName === 'string' &&
    candidate.displayName.length > 0 &&
    typeof candidate.loopbackOrigin === 'string' &&
    normaliseLoopbackGatewayOrigin(candidate.loopbackOrigin) === candidate.loopbackOrigin &&
    Boolean(candidate.signingPublicKeyJwk) &&
    typeof candidate.identityFingerprint === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate.identityFingerprint) &&
    typeof candidate.extensionInstanceId === 'string' &&
    candidate.extensionInstanceId.length > 0 &&
    typeof candidate.pairingAuthorization === 'string' &&
    /^[A-Za-z0-9_-]{40,}$/.test(candidate.pairingAuthorization) &&
    typeof candidate.pairedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.pairedAt))
  );
}

export async function getGatewayPairing(): Promise<GatewayPairingRecord | null> {
  const value = (await chrome.storage.local.get(GATEWAY_PAIRING_STORAGE_KEY))[GATEWAY_PAIRING_STORAGE_KEY];
  if (value === undefined) return null;
  if (isGatewayPairingRecord(value)) return value;
  await chrome.storage.local.remove(GATEWAY_PAIRING_STORAGE_KEY);
  return null;
}

export async function saveGatewayPairing(pairing: GatewayPairingRecord): Promise<void> {
  if (!isGatewayPairingRecord(pairing)) throw new Error('The Gateway pairing record is invalid.');
  await chrome.storage.local.set({ [GATEWAY_PAIRING_STORAGE_KEY]: pairing });
}

export async function revokeGatewayPairing(): Promise<void> {
  await chrome.storage.local.remove(GATEWAY_PAIRING_STORAGE_KEY);
}

export async function gatewayPairingSummary() {
  const pairing = await getGatewayPairing();
  if (!pairing) return null;
  const { pairingAuthorization: _pairingAuthorization, signingPublicKeyJwk: _signingPublicKeyJwk, ...summary } = pairing;
  return summary;
}
