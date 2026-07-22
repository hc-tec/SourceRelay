import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  canonicalJson,
  isCollectorExtensionBridgeHello,
  isCollectorHostBridgeCommand,
  isCollectorNativeBridgeConfig,
  isBridgeJsonValue,
  NATIVE_BRIDGE_PROTOCOL_VERSION
} from '@intelligence/collector-contracts';

function validConfig() {
  return {
    schemaVersion: 1,
    protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
    nativeHostName: 'com.personal_intelligence.collector',
    profileId: 'profile-123',
    browserSessionId: 'browser-session-123'
  };
}

function validHello() {
  return {
    type: 'collector_extension_bridge_hello',
    protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
    profileId: 'profile-123',
    browserSessionId: 'browser-session-123',
    extensionId: 'a'.repeat(32),
    collectorVersion: '0.7.11',
    controlSurfaceRevision: 10,
    nonce: 'nonce-which-is-long-enough'
  };
}

function validHostCommand() {
  return {
    type: 'collector_host_bridge_command',
    protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
    profileId: 'profile-123',
    browserSessionId: 'browser-session-123',
    commandId: 'command-id-is-long-enough',
    issuedAt: '2026-07-21T00:00:00.000Z',
    expiresAt: '2026-07-21T00:01:00.000Z',
    command: { type: 'collector_list_extension_tabs' }
  };
}

describe('Native bridge runtime guards', () => {
  test('accept the exact valid baseline', () => {
    expect(isCollectorNativeBridgeConfig(validConfig())).toBe(true);
    expect(isCollectorExtensionBridgeHello(validHello())).toBe(true);
    expect(isCollectorHostBridgeCommand(validHostCommand())).toBe(true);
  });

  test('reject every generated non-current protocol version', () => {
    fc.assert(fc.property(fc.integer(), (protocolVersion) => {
      fc.pre(protocolVersion !== NATIVE_BRIDGE_PROTOCOL_VERSION);
      expect(isCollectorNativeBridgeConfig({ ...validConfig(), protocolVersion })).toBe(false);
      expect(isCollectorExtensionBridgeHello({ ...validHello(), protocolVersion })).toBe(false);
      expect(isCollectorHostBridgeCommand({ ...validHostCommand(), protocolVersion })).toBe(false);
    }));
  });

  test('reject invalid native host names and short command identifiers', () => {
    const hostNamePattern = /^[a-z0-9_.]{1,200}$/;
    fc.assert(fc.property(fc.string(), (nativeHostName) => {
      fc.pre(!hostNamePattern.test(nativeHostName));
      expect(isCollectorNativeBridgeConfig({ ...validConfig(), nativeHostName })).toBe(false);
    }));
    fc.assert(fc.property(fc.string({ maxLength: 15 }), (commandId) => {
      expect(isCollectorHostBridgeCommand({ ...validHostCommand(), commandId })).toBe(false);
    }));
  });

  test('keeps authentication payload canonical across object key order', () => {
    const primitive = fc.oneof(fc.boolean(), fc.integer(), fc.string({ maxLength: 40 }));
    fc.assert(fc.property(fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), primitive), (record) => {
      const reversed = Object.fromEntries(Object.entries(record).reverse());
      expect(canonicalJson(record)).toBe(canonicalJson(reversed));
    }));
  });

  test('never admits prototype-shaped bridge payloads', () => {
    expect(isBridgeJsonValue(JSON.parse('{"__proto__":{"polluted":true}}'))).toBe(false);
    expect(isBridgeJsonValue(JSON.parse('{"constructor":"unsafe"}'))).toBe(false);
    expect(isBridgeJsonValue(JSON.parse('{"prototype":"unsafe"}'))).toBe(false);
  });
});
