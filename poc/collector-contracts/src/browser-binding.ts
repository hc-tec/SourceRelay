/**
 * Contracts for the production Collector execution boundary.
 *
 * A BrowserBinding identifies a paired extension installation in a browser the
 * user owns and uses. It deliberately does not identify a Chromium profile,
 * profile directory, browser process, tab ID, account, or credential.
 */
export const BROWSER_BINDING_SCHEMA_VERSION = 1 as const;
export const COLLECTOR_CONTROL_PROTOCOL_VERSION = 1 as const;

export interface GatewayIdentity {
  schemaVersion: typeof BROWSER_BINDING_SCHEMA_VERSION;
  protocolVersion: typeof COLLECTOR_CONTROL_PROTOCOL_VERSION;
  gatewayInstanceId: string;
  displayName: string;
  loopbackOrigin: string;
  signingPublicKeyJwk: JsonWebKey;
  identityFingerprint: string;
}

export interface GatewayPairingChallenge {
  schemaVersion: typeof BROWSER_BINDING_SCHEMA_VERSION;
  protocolVersion: typeof COLLECTOR_CONTROL_PROTOCOL_VERSION;
  pairingSessionId: string;
  gateway: GatewayIdentity;
  extensionChallenge: string;
  pairingCodeChallenge: string;
  pairingAuthorizationFingerprint: string;
  issuedAt: string;
  expiresAt: string;
  gatewaySignature: string;
}

export interface GatewayPairingClaimResponse {
  schemaVersion: typeof BROWSER_BINDING_SCHEMA_VERSION;
  browserBindingId: string;
  challenge: GatewayPairingChallenge;
  pairingAuthorization: string;
}

/**
 * Stored only inside the paired extension. The pairing authorization must not
 * be exposed through Console, service API, audit, or extension status UI.
 */
export interface GatewayPairingRecord {
  schemaVersion: typeof BROWSER_BINDING_SCHEMA_VERSION;
  browserBindingId: string;
  gatewayInstanceId: string;
  displayName: string;
  loopbackOrigin: string;
  signingPublicKeyJwk: JsonWebKey;
  identityFingerprint: string;
  extensionInstanceId: string;
  pairingAuthorization: string;
  pairedAt: string;
}

export type GatewayPairingSummary = Omit<GatewayPairingRecord, 'pairingAuthorization' | 'signingPublicKeyJwk'>;

export type BrowserBindingState = 'paired' | 'online';

/**
 * Safe to show in the local Console and, eventually, to a scoped local API
 * client. It intentionally contains no browser profile, account, tab, URL,
 * credential, extension secret, or extension-instance identifier.
 */
export interface BrowserBindingSummary {
  schemaVersion: typeof BROWSER_BINDING_SCHEMA_VERSION;
  browserBindingId: string;
  extensionId: string;
  state: BrowserBindingState;
  pairedAt: string;
  lastSeenAt: string | null;
}

export type BrowserExecutionTarget = 'collector_work_tab' | 'user_selected_tab';
