import type {
  ExtensionDiagnosticEvent,
  ExtensionWorkItem,
  ExtensionWorkResult,
  GatewayPairingRecord
} from '@intelligence/collector-contracts';
import {
  isExtensionDiagnosticEvent,
  extensionWorkSigningPayload,
  isExtensionWorkItem,
  isExtensionWorkResult
} from '@intelligence/collector-contracts';
import { verifyGatewaySignature } from '../shared/cryptography';
import { authenticatedGatewayJson } from './user-browser-gateway-client';
import { USER_BROWSER_DIRECT_WORK_CAPABILITIES } from './user-browser-gateway-types';

/** Fixed, paired Gateway work read.  It does not expose arbitrary fetch. */
export async function claimNextExtensionWork(record: GatewayPairingRecord): Promise<ExtensionWorkItem | null> {
  const payload = await authenticatedGatewayJson(record, {
    method: 'POST',
    pathname: '/v1/extension/work-items/next',
    body: ''
  });
  const item = workItemFromPayload(payload);
  if (item === null) return null;
  if (!USER_BROWSER_DIRECT_WORK_CAPABILITIES.includes(item.capability as never)) {
    throw new Error('extension_work_capability_rejected');
  }
  if (item.browserBindingId !== record.browserBindingId) throw new Error('extension_work_binding_identity_mismatch');
  const verified = await verifyGatewaySignature({
    publicKeyJwk: record.signingPublicKeyJwk,
    payload: extensionWorkSigningPayload(item),
    signature: item.gatewaySignature
  });
  if (!verified) throw new Error('extension_work_signature_invalid');
  return item;
}

/** A result submission is idempotent local delivery only; it cannot issue another platform action. */
export async function submitExtensionWorkResult(
  record: GatewayPairingRecord,
  result: ExtensionWorkResult
): Promise<void> {
  if (!isExtensionWorkResult(result) || result.browserBindingId !== record.browserBindingId) {
    throw new Error('extension_work_result_invalid');
  }
  const body = JSON.stringify(result);
  const payload = await authenticatedGatewayJson(record, {
    method: 'POST',
    pathname: '/v1/extension/work-items/result',
    body
  });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
    (payload as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    !('operation' in payload)) {
    throw new Error('extension_work_result_response_invalid');
  }
}

/** Best-effort phase telemetry; it never issues browser/platform actions. */
export async function submitExtensionDiagnostic(
  record: GatewayPairingRecord,
  event: ExtensionDiagnosticEvent
): Promise<void> {
  if (!isExtensionDiagnosticEvent(event) || event.browserBindingId !== record.browserBindingId) {
    throw new Error('extension_diagnostic_invalid');
  }
  const payload = await authenticatedGatewayJson(record, {
    method: 'POST',
    pathname: '/v1/extension/diagnostics',
    body: JSON.stringify(event)
  });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
    (payload as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    (payload as { ok?: unknown }).ok !== true) {
    throw new Error('extension_diagnostic_response_invalid');
  }
}

function workItemFromPayload(value: unknown): ExtensionWorkItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('extension_work_response_invalid');
  const payload = value as { schemaVersion?: unknown; workItem?: unknown };
  if (payload.schemaVersion !== 1 || !Object.prototype.hasOwnProperty.call(payload, 'workItem')) {
    throw new Error('extension_work_response_invalid');
  }
  if (payload.workItem === null) return null;
  if (!isExtensionWorkItem(payload.workItem)) throw new Error('extension_work_item_invalid');
  return payload.workItem;
}
