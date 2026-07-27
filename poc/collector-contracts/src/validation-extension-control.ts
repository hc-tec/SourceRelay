/**
 * A deliberately narrow verification-only workflow for the managed
 * validation browser.  It exists so the real MV3 control surface can be
 * exercised programmatically without exposing arbitrary browser automation
 * through Browser Host.
 */
export const VALIDATION_EXTENSION_CONTROL_SCHEMA_VERSION = 1 as const;

export const VALIDATION_EXTENSION_CONTROL_SELECTIONS = [
  'bilibili_discussion_current_active_tab'
] as const;

export type ValidationExtensionControlSelection =
  typeof VALIDATION_EXTENSION_CONTROL_SELECTIONS[number];

export interface ValidationExtensionControlRequest {
  schemaVersion: typeof VALIDATION_EXTENSION_CONTROL_SCHEMA_VERSION;
  profileId: string;
  loopbackOrigin: string;
  identityFingerprint: string;
  pairingSessionId: string;
  pairingCode: string;
  selection: ValidationExtensionControlSelection;
}

export interface ValidationExtensionControlResult {
  schemaVersion: typeof VALIDATION_EXTENSION_CONTROL_SCHEMA_VERSION;
  profileId: string;
  browserBindingId: string;
  connectionState: 'online';
  discussionSelection: 'available';
  controlTargetDisposed: true;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAIRING_CODE = /^\d{8}$/;

/**
 * Runtime validation is intentionally strict because this request crosses the
 * authenticated Browser Host IPC boundary.  In particular it has no field
 * for a URL, selector, script, tab ID, document ID, or arbitrary action.
 */
export function validationExtensionControlRequest(value: unknown): ValidationExtensionControlRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('validation_extension_control_request_invalid');
  }
  const candidate = value as Partial<ValidationExtensionControlRequest>;
  const allowed = new Set([
    'schemaVersion',
    'profileId',
    'loopbackOrigin',
    'identityFingerprint',
    'pairingSessionId',
    'pairingCode',
    'selection'
  ]);
  if (
    Object.keys(candidate).length !== allowed.size ||
    Object.keys(candidate).some((key) => !allowed.has(key)) ||
    candidate.schemaVersion !== VALIDATION_EXTENSION_CONTROL_SCHEMA_VERSION ||
    typeof candidate.profileId !== 'string' || !IDENTIFIER.test(candidate.profileId) ||
    typeof candidate.loopbackOrigin !== 'string' || !isLoopbackOrigin(candidate.loopbackOrigin) ||
    typeof candidate.identityFingerprint !== 'string' || !FINGERPRINT.test(candidate.identityFingerprint) ||
    typeof candidate.pairingSessionId !== 'string' || !UUID.test(candidate.pairingSessionId) ||
    typeof candidate.pairingCode !== 'string' || !PAIRING_CODE.test(candidate.pairingCode) ||
    candidate.selection !== 'bilibili_discussion_current_active_tab'
  ) {
    throw new Error('validation_extension_control_request_invalid');
  }
  return {
    schemaVersion: VALIDATION_EXTENSION_CONTROL_SCHEMA_VERSION,
    profileId: candidate.profileId,
    loopbackOrigin: candidate.loopbackOrigin,
    identityFingerprint: candidate.identityFingerprint,
    pairingSessionId: candidate.pairingSessionId,
    pairingCode: candidate.pairingCode,
    selection: candidate.selection
  };
}

function isLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && Boolean(url.port) &&
      url.username === '' && url.password === '' && url.pathname === '/' && url.search === '' &&
      url.hash === '' && url.origin === value;
  } catch {
    return false;
  }
}
