import { createHash, randomUUID } from 'node:crypto';
import {
  NATIVE_BRIDGE_PROTOCOL_VERSION,
  canonicalJson,
  isCollectorExtensionBridgeCommandResult,
  isCollectorExtensionBridgeHello,
  type CollectorExtensionBridgeMessage,
  type CollectorExtensionBridgeReady,
  type CollectorHostBridgeCommand,
  type CollectorHostBridgeCommandReceipt,
  type CollectorHostBridgeMessage,
  type CollectorHostExtensionCommand,
  type NativeBridgeHandshakeRequest
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';
import { NativeBridgeCommandBroker } from './native-bridge-command-broker.js';

interface ExpectedBridge {
  profileId: string;
  browserSessionId: string;
  extensionId: string;
  extensionOrigin: string;
  collectorVersion: string;
  controlSurfaceRevision: number;
}

interface BridgeConnection {
  bridgeConnectionId: string;
  profileId: string;
  browserSessionId: string;
  extensionOrigin: string;
  helloDigest: string | null;
  ready: boolean;
}

interface ReadyWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface NativeBridgeAdmission {
  bridgeConnectionId: string;
  replacedConnectionId: string | null;
}

export class NativeBridgeRegistry {
  readonly #expected = new Map<string, ExpectedBridge>();
  readonly #connections = new Map<string, BridgeConnection>();
  readonly #profileConnections = new Map<string, string>();
  readonly #waiters = new Map<string, ReadyWaiter[]>();
  readonly #commandBroker = new NativeBridgeCommandBroker();

  expect(input: ExpectedBridge): void {
    this.#expected.set(input.profileId, structuredClone(input));
  }

  acceptHandshake(request: NativeBridgeHandshakeRequest): NativeBridgeAdmission {
    const expected = this.#expected.get(request.profileId);
    if (!expected ||
      expected.browserSessionId !== request.browserSessionId ||
      expected.extensionOrigin !== request.extensionOrigin) {
      throw hostError({
        code: 'native_bridge_context_rejected',
        category: 'native_bridge',
        scope: 'browser_session'
      });
    }
    const bridgeConnectionId = randomUUID();
    const replacedConnectionId = this.#profileConnections.get(request.profileId) ?? null;
    if (replacedConnectionId) this.disconnect(replacedConnectionId);
    this.#connections.set(bridgeConnectionId, {
      bridgeConnectionId,
      profileId: request.profileId,
      browserSessionId: request.browserSessionId,
      extensionOrigin: request.extensionOrigin,
      helloDigest: null,
      ready: false
    });
    this.#profileConnections.set(request.profileId, bridgeConnectionId);
    return { bridgeConnectionId, replacedConnectionId };
  }

  handleMessage(
    bridgeConnectionId: string,
    payload: CollectorExtensionBridgeMessage
  ): CollectorHostBridgeMessage {
    const connection = this.#connections.get(bridgeConnectionId);
    if (!connection) {
      throw hostError({ code: 'native_bridge_connection_rejected', category: 'native_bridge', scope: 'host' });
    }
    if (isCollectorExtensionBridgeHello(payload)) {
      return this.#handleHello(connection, payload);
    }
    if (isCollectorExtensionBridgeCommandResult(payload)) {
      return this.#handleCommandResult(connection, payload);
    }
    throw hostError({ code: 'native_bridge_message_rejected', category: 'native_bridge', scope: 'host' });
  }

  requestCommand(
    profileId: string,
    browserSessionId: string,
    command: CollectorHostExtensionCommand,
    deliver: (bridgeConnectionId: string, command: CollectorHostBridgeCommand) => void,
    timeoutMs = 5_000
  ) {
    const connectionId = this.#profileConnections.get(profileId);
    const connection = connectionId ? this.#connections.get(connectionId) : null;
    return this.#commandBroker.request(
      connection?.browserSessionId === browserSessionId ? connection : null,
      command,
      deliver,
      timeoutMs
    );
  }

  #handleHello(
    connection: BridgeConnection,
    payload: Extract<CollectorExtensionBridgeMessage, { type: 'collector_extension_bridge_hello' }>
  ): CollectorExtensionBridgeReady {
    const expected = this.#expected.get(connection.profileId);
    if (!expected ||
      payload.protocolVersion !== NATIVE_BRIDGE_PROTOCOL_VERSION ||
      payload.profileId !== expected.profileId ||
      payload.browserSessionId !== expected.browserSessionId ||
      payload.extensionId !== expected.extensionId ||
      payload.collectorVersion !== expected.collectorVersion ||
      payload.controlSurfaceRevision !== expected.controlSurfaceRevision) {
      throw hostError({
        code: 'native_bridge_extension_identity_mismatch',
        category: 'native_bridge',
        scope: 'browser_session',
        profileSafetyDisposition: 'host_blocked'
      });
    }
    const digest = createHash('sha256').update(canonicalJson(payload)).digest('hex');
    if (connection.helloDigest && connection.helloDigest !== digest) {
      throw hostError({ code: 'native_bridge_hello_conflict', category: 'native_bridge', scope: 'host' });
    }
    connection.helloDigest = digest;
    connection.ready = true;
    this.#resolveWaiters(this.#waiterKey(expected.profileId, expected.browserSessionId));
    return {
      type: 'collector_extension_bridge_ready',
      protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
      profileId: expected.profileId,
      browserSessionId: expected.browserSessionId,
      bridgeConnectionId: connection.bridgeConnectionId
    };
  }

  #handleCommandResult(
    connection: BridgeConnection,
    payload: Extract<CollectorExtensionBridgeMessage, { type: 'collector_extension_bridge_command_result' }>
  ): CollectorHostBridgeCommandReceipt {
    return this.#commandBroker.resolve(connection, payload);
  }

  disconnect(bridgeConnectionId: string): void {
    const connection = this.#connections.get(bridgeConnectionId);
    if (!connection) return;
    this.#connections.delete(bridgeConnectionId);
    if (this.#profileConnections.get(connection.profileId) === bridgeConnectionId) {
      this.#profileConnections.delete(connection.profileId);
    }
    this.#commandBroker.disconnect(bridgeConnectionId);
  }

  isReady(profileId: string, browserSessionId: string): boolean {
    const connectionId = this.#profileConnections.get(profileId);
    const connection = connectionId ? this.#connections.get(connectionId) : null;
    return Boolean(connection?.ready && connection.browserSessionId === browserSessionId);
  }

  waitForReady(profileId: string, browserSessionId: string, timeoutMs: number): Promise<void> {
    if (this.isReady(profileId, browserSessionId)) return Promise.resolve();
    const key = this.#waiterKey(profileId, browserSessionId);
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const current = this.#waiters.get(key) ?? [];
        const remaining = current.filter((waiter) => waiter.resolve !== resolve);
        if (remaining.length > 0) this.#waiters.set(key, remaining);
        else this.#waiters.delete(key);
        reject(new Error('native_bridge_ready_timeout'));
      }, timeoutMs);
      const waiter = { resolve, reject, timeout };
      this.#waiters.set(key, [...(this.#waiters.get(key) ?? []), waiter]);
    });
  }

  clearProfile(profileId: string, browserSessionId: string): void {
    const expected = this.#expected.get(profileId);
    if (expected?.browserSessionId === browserSessionId) this.#expected.delete(profileId);
    const connectionId = this.#profileConnections.get(profileId);
    if (connectionId) this.disconnect(connectionId);
    const key = this.#waiterKey(profileId, browserSessionId);
    for (const waiter of this.#waiters.get(key) ?? []) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('native_bridge_profile_closed'));
    }
    this.#waiters.delete(key);
  }

  #resolveWaiters(key: string): void {
    for (const waiter of this.#waiters.get(key) ?? []) {
      clearTimeout(waiter.timeout);
      waiter.resolve();
    }
    this.#waiters.delete(key);
  }

  #waiterKey(profileId: string, browserSessionId: string): string {
    return `${profileId}:${browserSessionId}`;
  }
}
