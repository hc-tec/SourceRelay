import { describe, expect, test } from 'vitest';
import {
  BROWSER_HOST_PROTOCOL_VERSION,
  isBrowserHostErrorRecord,
  type BrowserHostCommandEnvelope
} from '@intelligence/collector-contracts';
import { hostError } from '../src/host-errors.js';
import {
  commandIntentDigest,
  withoutCommandAuthentication,
  withoutHandshakeAuthentication
} from '../src/ipc/wire-auth.js';
import {
  authenticatePayload,
  authenticationMatches,
  createBootstrapSecret,
  timestampIsFresh,
  timestampIsUnexpired
} from '../src/security.js';
import { absolutePath, boundedIdentifier, boundedPositiveInteger, childPath, safeReason } from '../src/validation.js';

function command(body: BrowserHostCommandEnvelope['body'] = { type: 'get_snapshot' }): BrowserHostCommandEnvelope {
  return {
    type: 'command',
    protocolVersion: BROWSER_HOST_PROTOCOL_VERSION,
    hostInstanceId: 'host-1',
    controllerGeneration: 'controller-1',
    gatewayInstanceId: 'gateway-1',
    commandId: 'command-identifier-which-is-long-enough',
    nonce: 'nonce-1',
    issuedAt: '2026-07-22T00:00:00.000Z',
    expiresAt: '2026-07-22T00:01:00.000Z',
    body,
    authenticationDigest: 'ignored-by-intent-digest'
  };
}

describe('Browser Host security primitives', () => {
  test('authenticates the exact signed payload without accepting a changed value', () => {
    const secret = createBootstrapSecret();
    const payload = 'canonical-local-command';
    const digest = authenticatePayload(secret, payload);

    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authenticationMatches(secret, payload, digest)).toBe(true);
    expect(authenticationMatches(secret, `${payload}-changed`, digest)).toBe(false);
    expect(authenticationMatches(secret, payload, `${digest}x`)).toBe(false);
  });

  test('enforces bounded time freshness and command intent identity', () => {
    const at = Date.parse('2026-07-22T00:00:00.000Z');
    expect(timestampIsFresh('2026-07-22T00:00:30.000Z', at)).toBe(true);
    expect(timestampIsFresh('2026-07-22T00:00:30.001Z', at)).toBe(false);
    expect(timestampIsUnexpired('2026-07-22T00:00:00.000Z', at)).toBe(true);
    expect(timestampIsUnexpired('2026-07-21T23:59:59.999Z', at)).toBe(false);

    const initial = command();
    expect(commandIntentDigest({ ...initial, authenticationDigest: 'different-signature' })).toBe(
      commandIntentDigest(initial)
    );
    expect(commandIntentDigest(command({ type: 'shutdown_host' }))).not.toBe(commandIntentDigest(initial));

    expect(withoutCommandAuthentication(initial)).not.toHaveProperty('authenticationDigest');
    expect(initial.authenticationDigest).toBe('ignored-by-intent-digest');
    const handshake = {
      type: 'handshake' as const,
      protocolVersion: BROWSER_HOST_PROTOCOL_VERSION,
      gatewayInstanceId: 'gateway-1',
      nonce: 'nonce-1',
      issuedAt: '2026-07-22T00:00:00.000Z',
      authenticationDigest: 'signature'
    };
    expect(withoutHandshakeAuthentication(handshake)).toEqual({
      type: 'handshake',
      protocolVersion: BROWSER_HOST_PROTOCOL_VERSION,
      gatewayInstanceId: 'gateway-1',
      nonce: 'nonce-1',
      issuedAt: '2026-07-22T00:00:00.000Z'
    });
  });

  test('keeps identifiers and state paths inside the local runtime root', () => {
    expect(boundedIdentifier('profile_1.test', 'profile')).toBe('profile_1.test');
    expect(() => boundedIdentifier('../escape', 'profile')).toThrow('profile_invalid');
    expect(boundedPositiveInteger(3, 'maximum', 3)).toBe(3);
    expect(() => boundedPositiveInteger(0, 'maximum', 3)).toThrow('maximum_invalid');

    const root = process.platform === 'win32' ? 'C:\\collector-runtime' : '/collector-runtime';
    expect(childPath(root, 'state/endpoint.json')).toMatch(/endpoint\.json$/);
    expect(() => childPath(root, '../outside.json')).toThrow('path_outside_root');
    expect(absolutePath(root, 'runtime')).toBeTruthy();
    expect(() => absolutePath('relative/path', 'runtime')).toThrow('runtime_invalid');
    expect(safeReason('trusted_reason', 'fallback')).toBe('trusted_reason');
    expect(safeReason('not safe', 'fallback')).toBe('fallback');
  });
});

describe('Browser Host error wire contract', () => {
  test('accepts a structured local error record and rejects unsafe enum or detail values', () => {
    const record = hostError({
      code: 'page_lease_expired',
      category: 'lease',
      scope: 'lease',
      retryClass: 'new_run_required',
      pageDisposition: 'quarantined',
      profileSafetyDisposition: 'stop_run_no_retry',
      safeDetails: { attemptCount: 1, reason: 'expired' }
    }).record;
    expect(isBrowserHostErrorRecord(record)).toBe(true);
    expect(isBrowserHostErrorRecord({ ...record, scope: 'anything' })).toBe(false);
    expect(isBrowserHostErrorRecord({ ...record, retryClass: 'retry_forever' })).toBe(false);
    expect(isBrowserHostErrorRecord({ ...record, safeDetails: { requestBody: { unsafe: true } } })).toBe(false);
    expect(isBrowserHostErrorRecord({ ...record, occurredAt: 'not-a-date' })).toBe(false);
  });
});
