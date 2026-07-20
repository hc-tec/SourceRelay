import { createHash } from 'node:crypto';
import {
  canonicalJson,
  type BrowserHostCommandEnvelope,
  type BrowserHostHandshakeRequest
} from '@intelligence/collector-contracts';

export function withoutHandshakeAuthentication(
  request: BrowserHostHandshakeRequest
): Omit<BrowserHostHandshakeRequest, 'authenticationDigest'> {
  const { authenticationDigest: _authenticationDigest, ...unsigned } = request;
  return unsigned;
}

export function withoutCommandAuthentication(
  envelope: BrowserHostCommandEnvelope
): Omit<BrowserHostCommandEnvelope, 'authenticationDigest'> {
  const { authenticationDigest: _authenticationDigest, ...unsigned } = envelope;
  return unsigned;
}

export function commandIntentDigest(envelope: BrowserHostCommandEnvelope): string {
  return createHash('sha256').update(canonicalJson({
    protocolVersion: envelope.protocolVersion,
    hostInstanceId: envelope.hostInstanceId,
    controllerGeneration: envelope.controllerGeneration,
    gatewayInstanceId: envelope.gatewayInstanceId,
    commandId: envelope.commandId,
    body: envelope.body
  })).digest('hex');
}
