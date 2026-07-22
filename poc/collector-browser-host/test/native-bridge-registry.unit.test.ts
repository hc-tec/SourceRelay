import { describe, expect, test } from 'vitest';
import {
  NATIVE_BRIDGE_PROTOCOL_VERSION,
  type CollectorExtensionBridgeCommandResult,
  type CollectorExtensionBridgeHello,
  type CollectorHostBridgeCommand,
  type NativeBridgeHandshakeRequest
} from '@intelligence/collector-contracts';
import { NativeBridgeRegistry } from '../src/native-bridge/native-bridge-registry.js';

interface ExpectedBridge {
  profileId: string;
  browserSessionId: string;
  extensionId: string;
  extensionOrigin: string;
  collectorVersion: string;
  controlSurfaceRevision: number;
}

function bridge(profileId = 'profile-alpha', browserSessionId = 'session-alpha', extensionCharacter = 'a'): ExpectedBridge {
  const extensionId = extensionCharacter.repeat(32);
  return {
    profileId,
    browserSessionId,
    extensionId,
    extensionOrigin: `chrome-extension://${extensionId}/`,
    collectorVersion: '0.7.7',
    controlSurfaceRevision: 10
  };
}

function handshake(input: ExpectedBridge): NativeBridgeHandshakeRequest {
  return {
    type: 'native_bridge_handshake',
    protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
    hostInstanceId: 'host-instance-unit-test',
    profileId: input.profileId,
    browserSessionId: input.browserSessionId,
    extensionOrigin: input.extensionOrigin,
    nonce: 'native-bridge-handshake-nonce',
    issuedAt: '2026-07-22T00:00:00.000Z',
    authenticationDigest: 'already-authenticated-by-server-boundary'
  };
}

function hello(input: ExpectedBridge, overrides: Partial<CollectorExtensionBridgeHello> = {}): CollectorExtensionBridgeHello {
  return {
    type: 'collector_extension_bridge_hello',
    protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
    profileId: input.profileId,
    browserSessionId: input.browserSessionId,
    extensionId: input.extensionId,
    collectorVersion: input.collectorVersion,
    controlSurfaceRevision: input.controlSurfaceRevision,
    nonce: 'native-bridge-hello-nonce',
    ...overrides
  };
}

function commandResult(
  input: ExpectedBridge,
  commandId: string,
  overrides: Partial<CollectorExtensionBridgeCommandResult> = {}
): CollectorExtensionBridgeCommandResult {
  return {
    type: 'collector_extension_bridge_command_result',
    protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
    profileId: input.profileId,
    browserSessionId: input.browserSessionId,
    commandId,
    ok: true,
    result: { type: 'collector_extension_tab_inventory', schemaVersion: 1, tabIds: [7, 11] },
    ...overrides
  } as CollectorExtensionBridgeCommandResult;
}

function admitReady(registry: NativeBridgeRegistry, input: ExpectedBridge) {
  registry.expect(input);
  const admission = registry.acceptHandshake(handshake(input));
  const ready = registry.handleMessage(admission.bridgeConnectionId, hello(input));
  expect(ready).toMatchObject({
    type: 'collector_extension_bridge_ready',
    profileId: input.profileId,
    browserSessionId: input.browserSessionId,
    bridgeConnectionId: admission.bridgeConnectionId
  });
  return admission;
}

function expectHostCode(callback: () => unknown, code: string) {
  try {
    callback();
  } catch (error) {
    expect(error).toMatchObject({ record: { code } });
    return;
  }
  throw new Error(`Expected Browser Host error ${code}`);
}

describe('Native Bridge Registry', () => {
  test('admits only the expected worker identity and resolves readiness waiters', async () => {
    const registry = new NativeBridgeRegistry();
    const expected = bridge();
    registry.expect(expected);

    expectHostCode(
      () => registry.acceptHandshake({ ...handshake(expected), browserSessionId: 'session-attacker' }),
      'native_bridge_context_rejected'
    );

    const waiting = registry.waitForReady(expected.profileId, expected.browserSessionId, 1_000);
    const admission = registry.acceptHandshake(handshake(expected));
    expectHostCode(
      () => registry.handleMessage(admission.bridgeConnectionId, hello(expected, { extensionId: 'b'.repeat(32) })),
      'native_bridge_extension_identity_mismatch'
    );
    expect(registry.isReady(expected.profileId, expected.browserSessionId)).toBe(false);

    // Re-handshaking replaces the rejected connection. The exact same hello
    // remains idempotent, while a different hello after readiness is a hard
    // conflict rather than an implicit re-pair.
    const replacement = registry.acceptHandshake(handshake(expected));
    const ready = registry.handleMessage(replacement.bridgeConnectionId, hello(expected));
    await expect(waiting).resolves.toBeUndefined();
    expect(registry.handleMessage(replacement.bridgeConnectionId, hello(expected))).toEqual(ready);
    expectHostCode(
      () => registry.handleMessage(replacement.bridgeConnectionId, hello(expected, {
        nonce: 'different-native-bridge-hello-nonce'
      })),
      'native_bridge_hello_conflict'
    );
    expect(registry.isReady(expected.profileId, expected.browserSessionId)).toBe(true);
  });

  test('binds a command result to the exact ready bridge and rejects a cross-Profile response', async () => {
    const registry = new NativeBridgeRegistry();
    const alpha = bridge('profile-alpha', 'session-alpha', 'a');
    const beta = bridge('profile-beta', 'session-beta', 'b');
    const alphaAdmission = admitReady(registry, alpha);
    const betaAdmission = admitReady(registry, beta);

    const deliveries: Array<{ bridgeConnectionId: string; envelope: CollectorHostBridgeCommand }> = [];
    const pending = registry.requestCommand(
      alpha.profileId,
      alpha.browserSessionId,
      { type: 'collector_list_extension_tabs' },
      (bridgeConnectionId, envelope) => { deliveries.push({ bridgeConnectionId, envelope }); },
      1_000
    );
    expect(deliveries).toHaveLength(1);
    const delivered = deliveries[0];
    if (!delivered) throw new Error('native_bridge_command_not_delivered');
    expect(delivered.bridgeConnectionId).toBe(alphaAdmission.bridgeConnectionId);
    const commandId = delivered.envelope.commandId;
    expect(commandId).toMatch(/^[0-9a-f-]{36}$/i);

    expectHostCode(
      () => registry.handleMessage(betaAdmission.bridgeConnectionId, commandResult(alpha, commandId)),
      'native_bridge_command_result_rejected'
    );
    const receipt = registry.handleMessage(alphaAdmission.bridgeConnectionId, commandResult(alpha, commandId));
    expect(receipt).toMatchObject({
      type: 'collector_host_bridge_command_receipt',
      commandId,
      profileId: alpha.profileId,
      browserSessionId: alpha.browserSessionId
    });
    await expect(pending).resolves.toEqual({
      type: 'collector_extension_tab_inventory',
      schemaVersion: 1,
      tabIds: [7, 11]
    });

    const pendingAtDisconnect = registry.requestCommand(
      alpha.profileId,
      alpha.browserSessionId,
      { type: 'collector_list_extension_tabs' },
      () => undefined,
      1_000
    );
    registry.disconnect(alphaAdmission.bridgeConnectionId);
    await expect(pendingAtDisconnect).rejects.toMatchObject({
      record: { code: 'native_bridge_disconnected', retryClass: 'local_query_only' }
    });
    expect(registry.isReady(alpha.profileId, alpha.browserSessionId)).toBe(false);
  });

  test('never lets stale cleanup disconnect a newer session for the same Profile', () => {
    const registry = new NativeBridgeRegistry();
    const stale = bridge('profile-alpha', 'session-old', 'a');
    const current = bridge('profile-alpha', 'session-current', 'a');
    admitReady(registry, stale);
    admitReady(registry, current);

    expect(registry.isReady(current.profileId, current.browserSessionId)).toBe(true);
    registry.clearProfile(current.profileId, stale.browserSessionId);
    expect(registry.isReady(current.profileId, current.browserSessionId)).toBe(true);

    registry.clearProfile(current.profileId, current.browserSessionId);
    expect(registry.isReady(current.profileId, current.browserSessionId)).toBe(false);
    expectHostCode(
      () => registry.requestCommand(
        current.profileId,
        current.browserSessionId,
        { type: 'collector_list_extension_tabs' },
        () => undefined
      ),
      'native_bridge_not_ready'
    );
  });
});
