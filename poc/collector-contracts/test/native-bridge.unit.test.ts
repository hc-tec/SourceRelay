import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  canonicalJson,
  isCollectorExtensionBridgeCommandResult,
  isCollectorExtensionBridgeHello,
  isCollectorHostBridgeCommand,
  isCollectorNativeBridgeConfig,
  isBridgeJsonValue,
  COLLECTOR_CONTROL_SURFACE_REVISION,
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
    collectorVersion: '0.7.17',
    controlSurfaceRevision: COLLECTOR_CONTROL_SURFACE_REVISION,
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

  test('accepts only the de-sensitised strategy-binding diagnostic surface', () => {
    const diagnosticCommand = {
      ...validHostCommand(),
      command: {
        type: 'collector_read_strategy_binding_diagnostics',
        tabId: 17,
        observerBindingId: 'observer-binding-id-123',
        strategyId: 'bilibili.video.detail.dom.v2'
      }
    };
    expect(isCollectorHostBridgeCommand(diagnosticCommand)).toBe(true);
    expect(isCollectorHostBridgeCommand({
      ...diagnosticCommand,
      command: { ...diagnosticCommand.command, tabId: -1 }
    })).toBe(false);
    expect(isCollectorExtensionBridgeCommandResult({
      type: 'collector_extension_bridge_command_result',
      protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
      profileId: 'profile-123',
      browserSessionId: 'browser-session-123',
      commandId: 'command-id-is-long-enough',
      ok: true,
      result: {
        schemaVersion: 1,
        type: 'collector_strategy_binding_diagnostics',
        strategyId: 'bilibili.video.detail.dom.v2',
        observerBindingId: 'observer-binding-id-123',
        bindingState: 'expired',
        documentBindingState: 'not_bound',
        documentBindCount: 0,
        bridgeRegistration: 'registered',
        currentMainFrameState: 'current_document_unbound'
      }
    })).toBe(true);
  });

  test('admits the zero-input Xiaohongshu metadata read but not a hidden tab or URL carrier', () => {
    const command = {
      ...validHostCommand(),
      command: { type: 'collector_read_xiaohongshu_current_page_network_observation' }
    };
    expect(isCollectorHostBridgeCommand(command)).toBe(true);
    expect(isCollectorHostBridgeCommand({
      ...command,
      command: { ...command.command, tabId: 17 }
    })).toBe(false);
    expect(isCollectorExtensionBridgeCommandResult({
      type: 'collector_extension_bridge_command_result',
      protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
      profileId: 'profile-123',
      browserSessionId: 'browser-session-123',
      commandId: 'command-id-is-long-enough',
      ok: true,
      result: {
        schemaVersion: 2,
        type: 'xiaohongshu_current_page_network_observation',
        permissionState: 'permission_required',
        selection: {
          state: 'armed_next_document',
          publicSurface: null,
          selectedAt: '2026-07-28T00:00:00.000Z',
          expiresAt: '2026-07-28T00:01:00.000Z'
        },
        observation: {
          observerState: 'not_armed',
          publicContentRouteCount: 0,
          excludedRouteCounts: {
            authenticationOrIdentity: 0,
            securityOrRisk: 0,
            configurationOrTelemetry: 0,
            other: 0
          },
          responseBodiesRead: false,
          rawPayloadBytesRead: 0,
          risk: {
            loginRequired: false,
            verificationRequired: false,
            rateLimited: false,
            sourceUnavailable: false
          }
        }
      }
    })).toBe(true);
  });

  test('admits the fixed transcript response binding but rejects an arbitrary response budget', () => {
    const transcriptBinding = {
      ...validHostCommand(),
      command: {
        type: 'collector_bind_strategy_observer',
        tabId: 17,
        nextDocumentGeneration: 1,
        binding: {
          schemaVersion: 1,
          profileId: 'profile-123',
          pageAlias: 'managed-page-1',
          pageLeaseId: 'page-lease-id-which-is-long-enough',
          expectedRecordVersion: 1,
          runId: 'run-id-which-is-long-enough',
          observerBindingId: 'observer-binding-id-123',
          strategyId: 'bilibili.video.transcript.trusted-response.v2',
          target: {
            canonicalUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
            bvid: 'BV1qZSLBYEpa'
          },
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          maximumResponseObservations: 2,
          maximumPayloadBytes: 192 * 1024,
          documentBindingMode: 'next_navigation_only'
        }
      }
    };
    expect(isCollectorHostBridgeCommand(transcriptBinding)).toBe(true);
    expect(isCollectorHostBridgeCommand({
      ...transcriptBinding,
      command: {
        ...transcriptBinding.command,
        binding: { ...transcriptBinding.command.binding, maximumResponseObservations: 1 }
      }
    })).toBe(false);
  });

  test('admits the DOM-only danmaku binding without a response budget', () => {
    const danmakuBinding = {
      ...validHostCommand(),
      command: {
        type: 'collector_bind_strategy_observer',
        tabId: 17,
        nextDocumentGeneration: 1,
        binding: {
          schemaVersion: 1,
          profileId: 'profile-123',
          pageAlias: 'managed-page-1',
          pageLeaseId: 'page-lease-id-which-is-long-enough',
          expectedRecordVersion: 1,
          runId: 'run-id-which-is-long-enough',
          observerBindingId: 'observer-binding-id-123',
          strategyId: 'bilibili.video.danmaku.dom.v1',
          target: {
            canonicalUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
            bvid: 'BV1qZSLBYEpa'
          },
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          maximumResponseObservations: 0,
          maximumPayloadBytes: 96 * 1024,
          documentBindingMode: 'next_navigation_only'
        }
      }
    };
    expect(isCollectorHostBridgeCommand(danmakuBinding)).toBe(true);
    expect(isCollectorHostBridgeCommand({
      ...danmakuBinding,
      command: {
        ...danmakuBinding.command,
        binding: { ...danmakuBinding.command.binding, maximumResponseObservations: 1 }
      }
    })).toBe(false);
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
