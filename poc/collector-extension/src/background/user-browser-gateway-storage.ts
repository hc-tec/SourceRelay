import type {
  GatewayPairingRecord,
  GatewayPairingSummary
} from '@intelligence/collector-contracts';
import { normaliseLoopbackOrigin } from './user-browser-gateway-validation';
import { UUID } from './user-browser-gateway-types';

const EXTENSION_INSTANCE_KEY = 'collector.user-browser.extension-instance.v1';
const GATEWAY_PAIRING_KEY = 'collector.user-browser.gateway-pairing.v1';

export async function loadExtensionInstanceId(): Promise<string> {
  const stored = await chrome.storage.local.get(EXTENSION_INSTANCE_KEY);
  const existing = stored[EXTENSION_INSTANCE_KEY];
  if (typeof existing === 'string' && UUID.test(existing)) return existing;
  const created = crypto.randomUUID();
  await chrome.storage.local.set({ [EXTENSION_INSTANCE_KEY]: created });
  return created;
}

export async function loadGatewayPairingRecord(): Promise<GatewayPairingRecord | null> {
  const stored = await chrome.storage.local.get(GATEWAY_PAIRING_KEY);
  return gatewayPairingRecord(stored[GATEWAY_PAIRING_KEY]);
}

export async function saveGatewayPairingRecord(record: GatewayPairingRecord): Promise<void> {
  await chrome.storage.local.set({ [GATEWAY_PAIRING_KEY]: record });
}

export async function clearGatewayPairingRecord(): Promise<void> {
  await chrome.storage.local.remove(GATEWAY_PAIRING_KEY);
}

export function gatewayPairingSummary(record: GatewayPairingRecord): GatewayPairingSummary {
  return {
    schemaVersion: record.schemaVersion,
    browserBindingId: record.browserBindingId,
    gatewayInstanceId: record.gatewayInstanceId,
    displayName: record.displayName,
    loopbackOrigin: record.loopbackOrigin,
    identityFingerprint: record.identityFingerprint,
    extensionInstanceId: record.extensionInstanceId,
    pairedAt: record.pairedAt
  };
}

function gatewayPairingRecord(value: unknown): GatewayPairingRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<GatewayPairingRecord>;
  try {
    if (
      candidate.schemaVersion !== 1 ||
      typeof candidate.browserBindingId !== 'string' || !UUID.test(candidate.browserBindingId) ||
      typeof candidate.gatewayInstanceId !== 'string' || !UUID.test(candidate.gatewayInstanceId) ||
      typeof candidate.displayName !== 'string' || candidate.displayName.length === 0 || candidate.displayName.length > 80 ||
      typeof candidate.loopbackOrigin !== 'string' || normaliseLoopbackOrigin(candidate.loopbackOrigin) !== candidate.loopbackOrigin ||
      !candidate.signingPublicKeyJwk ||
      typeof candidate.identityFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.identityFingerprint) ||
      typeof candidate.extensionInstanceId !== 'string' || !UUID.test(candidate.extensionInstanceId) ||
      typeof candidate.pairingAuthorization !== 'string' || !/^[A-Za-z0-9_-]{40,}$/.test(candidate.pairingAuthorization) ||
      typeof candidate.pairedAt !== 'string' || !Number.isFinite(Date.parse(candidate.pairedAt))
    ) return null;
    return structuredClone(candidate) as GatewayPairingRecord;
  } catch {
    return null;
  }
}
