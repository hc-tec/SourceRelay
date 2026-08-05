import type { GatewayPairingRecord } from '@intelligence/collector-contracts';
import {
  claimGatewayPairing,
  readGatewayBinding,
  readGatewayDirectCapabilityCatalog
} from './user-browser-gateway-client';
import {
  clearGatewayPairingRecord,
  clearGatewayPairingDraft,
  gatewayPairingSummary,
  loadExtensionInstanceId,
  loadGatewayPairingRecord,
  requestSaveGatewayPairingDraft,
  saveGatewayPairingRecord
} from './user-browser-gateway-storage';
import {
  pairingInput,
  safeGatewayErrorCode
} from './user-browser-gateway-validation';
import {
  EXTENSION_ID,
  LOOPBACK_PERMISSION,
  type PairUserBrowserGatewayInput,
  type UserBrowserGatewayCapabilityDescriptor,
  type UserBrowserGatewayConnection
} from './user-browser-gateway-types';

export type {
  PairUserBrowserGatewayInput,
  UserBrowserGatewayConnection,
  UserBrowserGatewayConnectionState
} from './user-browser-gateway-types';

/**
 * Pair this installed extension with exactly one verified loopback Gateway.
 * Pairing grants no platform access and never reads browser credential data.
 */
export async function pairUserBrowserGateway(
  rawInput: PairUserBrowserGatewayInput
): Promise<UserBrowserGatewayConnection> {
  const pairing = pairingInput(rawInput);
  // Persist before requesting optional host permission. Chrome may destroy the
  // popup while showing its native confirmation dialog.
  await requestSaveGatewayPairingDraft(pairing);
  if (!await ensureLoopbackPermission()) throw new Error('gateway_loopback_permission_required');

  const extensionId = chrome.runtime.id;
  if (!EXTENSION_ID.test(extensionId)) throw new Error('extension_id_invalid');
  const extensionInstanceId = await loadExtensionInstanceId();
  const claim = await claimGatewayPairing({ pairing, extensionId, extensionInstanceId });
  const record: GatewayPairingRecord = {
    schemaVersion: 1,
    browserBindingId: claim.browserBindingId,
    gatewayInstanceId: claim.challenge.gateway.gatewayInstanceId,
    displayName: claim.challenge.gateway.displayName,
    loopbackOrigin: pairing.loopbackOrigin,
    signingPublicKeyJwk: structuredClone(claim.challenge.gateway.signingPublicKeyJwk),
    identityFingerprint: claim.challenge.gateway.identityFingerprint,
    extensionInstanceId,
    pairingAuthorization: claim.pairingAuthorization,
    pairedAt: new Date().toISOString()
  };
  await saveGatewayPairingRecord(record);
  await clearGatewayPairingDraft();
  return await connectionFor(record);
}

/**
 * One authenticated health read for the control page. There is deliberately no
 * background retry loop and no platform work dispatch in this module.
 */
export async function getUserBrowserGatewayConnection(): Promise<UserBrowserGatewayConnection> {
  const record = await loadGatewayPairingRecord();
  return record ? await connectionFor(record) : {
    state: 'unpaired',
    pairing: null,
    binding: null,
    errorCode: null
  };
}

/**
 * Read the Gateway's signed-work catalog for this already paired loopback
 * origin. This is a local UI read, not a browser-control or platform action.
 */
export async function getUserBrowserGatewayDirectCapabilityCatalog(): Promise<
  readonly UserBrowserGatewayCapabilityDescriptor[]
> {
  const record = await loadGatewayPairingRecord();
  if (!record) throw new Error('gateway_unpaired');
  return await readGatewayDirectCapabilityCatalog(record);
}

export async function clearUserBrowserGatewayPairing(): Promise<void> {
  await clearGatewayPairingRecord();
}

async function connectionFor(record: GatewayPairingRecord): Promise<UserBrowserGatewayConnection> {
  const pairing = gatewayPairingSummary(record);
  try {
    return {
      state: 'online',
      pairing,
      binding: await readGatewayBinding(record),
      errorCode: null
    };
  } catch (error) {
    return {
      state: 'offline',
      pairing,
      binding: null,
      errorCode: safeGatewayErrorCode(error)
    };
  }
}

async function ensureLoopbackPermission(): Promise<boolean> {
  const request = { origins: [LOOPBACK_PERMISSION] };
  if (await chrome.permissions.contains(request)) return true;
  return await chrome.permissions.request(request);
}
