import { describe, expect, test } from 'vitest';
import {
  VALIDATION_EXTENSION_CONTROL_SCHEMA_VERSION,
  validationExtensionControlRequest
} from '../src/index.js';

const request = {
  schemaVersion: VALIDATION_EXTENSION_CONTROL_SCHEMA_VERSION,
  profileId: 'validation',
  loopbackOrigin: 'http://127.0.0.1:43127',
  identityFingerprint: 'a'.repeat(64),
  pairingSessionId: '11111111-1111-4111-8111-111111111111',
  pairingCode: '12345678',
  selection: 'bilibili_discussion_current_active_tab'
} as const;

describe('validation extension control contract', () => {
  test('allows exactly the fixed loopback pairing and current-discussion selection workflow', () => {
    expect(validationExtensionControlRequest(request)).toEqual(request);
    expect(validationExtensionControlRequest({ ...request, selection: 'pair_only' })).toEqual({
      ...request,
      selection: 'pair_only'
    });
  });

  test('rejects broad browser-control fields and non-loopback origins', () => {
    expect(() => validationExtensionControlRequest({ ...request, selector: '#anything' })).toThrow(
      'validation_extension_control_request_invalid'
    );
    expect(() => validationExtensionControlRequest({
      ...request,
      loopbackOrigin: 'https://example.com'
    })).toThrow('validation_extension_control_request_invalid');
  });
});
