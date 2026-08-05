import type {
  GatewayPairingRecord,
  GatewayPairingSummary
} from '@intelligence/collector-contracts';
import { normaliseLoopbackOrigin } from './user-browser-gateway-validation';
import { UUID, type PairUserBrowserGatewayInput } from './user-browser-gateway-types';

const EXTENSION_INSTANCE_KEY = 'collector.user-browser.extension-instance.v1';
const GATEWAY_PAIRING_KEY = 'collector.user-browser.gateway-pairing.v1';
const GATEWAY_PAIRING_DRAFT_KEY = 'collector.user-browser.gateway-pairing-draft.v1';
const GATEWAY_PAIRING_DRAFT_TTL_MS = 30 * 60 * 1000;

export interface GatewayPairingDraft extends PairUserBrowserGatewayInput {
  schemaVersion: 1;
  expiresAt: string;
}

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
  await Promise.all([
    chrome.storage.local.remove(GATEWAY_PAIRING_KEY),
    clearGatewayPairingDraft()
  ]);
}

/**
 * A popup is destroyed when Chrome opens the native optional-permission
 * confirmation. Keep the in-progress form in local extension storage so it
 * survives popup destruction and a short MV3 worker restart, but expire it
 * automatically instead of treating pairing material as durable state.
 */
export async function loadGatewayPairingDraft(): Promise<GatewayPairingDraft | null> {
  const stored = await chrome.storage.local.get(GATEWAY_PAIRING_DRAFT_KEY);
  const draft = gatewayPairingDraft(stored[GATEWAY_PAIRING_DRAFT_KEY]);
  if (!draft) return null;
  if (Date.parse(draft.expiresAt) <= Date.now()) {
    await clearGatewayPairingDraft();
    return null;
  }
  return draft;
}

export async function saveGatewayPairingDraft(input: PairUserBrowserGatewayInput): Promise<void> {
  await chrome.storage.local.set({
    [GATEWAY_PAIRING_DRAFT_KEY]: {
      schemaVersion: 1,
      loopbackOrigin: input.loopbackOrigin,
      identityFingerprint: input.identityFingerprint,
      pairingSessionId: input.pairingSessionId,
      pairingCode: input.pairingCode,
      expiresAt: new Date(Date.now() + GATEWAY_PAIRING_DRAFT_TTL_MS).toISOString()
    } satisfies GatewayPairingDraft
  });
}

export async function clearGatewayPairingDraft(): Promise<void> {
  await chrome.storage.local.remove(GATEWAY_PAIRING_DRAFT_KEY);
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

function gatewayPairingDraft(value: unknown): GatewayPairingDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<GatewayPairingDraft>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.loopbackOrigin !== 'string' || candidate.loopbackOrigin.length > 100 ||
    typeof candidate.identityFingerprint !== 'string' || candidate.identityFingerprint.length > 100 ||
    typeof candidate.pairingSessionId !== 'string' || candidate.pairingSessionId.length > 100 ||
    typeof candidate.pairingCode !== 'string' || candidate.pairingCode.length > 20 ||
    typeof candidate.expiresAt !== 'string' || !Number.isFinite(Date.parse(candidate.expiresAt))
  ) return null;
  return {
    schemaVersion: 1,
    loopbackOrigin: candidate.loopbackOrigin,
    identityFingerprint: candidate.identityFingerprint,
    pairingSessionId: candidate.pairingSessionId,
    pairingCode: candidate.pairingCode,
    expiresAt: candidate.expiresAt
  };
}
