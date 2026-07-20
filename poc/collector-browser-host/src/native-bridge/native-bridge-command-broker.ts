import { randomUUID } from 'node:crypto';
import {
  NATIVE_BRIDGE_PROTOCOL_VERSION,
  type CollectorExtensionBridgeCommandResult,
  type CollectorExtensionCommandResult,
  type CollectorHostBridgeCommand,
  type CollectorHostBridgeCommandReceipt,
  type CollectorHostExtensionCommand
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';

export interface ReadyBridgeConnection {
  bridgeConnectionId: string;
  profileId: string;
  browserSessionId: string;
  ready: boolean;
}

interface PendingCommand {
  bridgeConnectionId: string;
  profileId: string;
  browserSessionId: string;
  resolve: (result: CollectorExtensionCommandResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class NativeBridgeCommandBroker {
  readonly #pending = new Map<string, PendingCommand>();

  request(
    connection: ReadyBridgeConnection | null,
    command: CollectorHostExtensionCommand,
    deliver: (bridgeConnectionId: string, command: CollectorHostBridgeCommand) => void,
    timeoutMs = 5_000
  ): Promise<CollectorExtensionCommandResult> {
    if (!connection?.ready) {
      throw hostError({
        code: 'native_bridge_not_ready',
        category: 'native_bridge',
        scope: 'browser_session',
        retryClass: 'local_query_only'
      });
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      throw new Error('native_bridge_command_timeout_invalid');
    }
    const commandId = randomUUID();
    const now = new Date();
    const envelope: CollectorHostBridgeCommand = {
      type: 'collector_host_bridge_command',
      protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
      profileId: connection.profileId,
      browserSessionId: connection.browserSessionId,
      commandId,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + timeoutMs).toISOString(),
      command: structuredClone(command)
    };
    return new Promise<CollectorExtensionCommandResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(commandId);
        reject(hostError({
          code: 'native_bridge_command_timeout',
          category: 'native_bridge',
          scope: 'browser_session',
          retryClass: 'local_query_only'
        }));
      }, timeoutMs);
      this.#pending.set(commandId, {
        bridgeConnectionId: connection.bridgeConnectionId,
        profileId: connection.profileId,
        browserSessionId: connection.browserSessionId,
        resolve,
        reject,
        timeout
      });
      try {
        deliver(connection.bridgeConnectionId, envelope);
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(commandId);
        reject(error instanceof Error ? error : new Error('native_bridge_command_delivery_failed'));
      }
    });
  }

  resolve(
    connection: ReadyBridgeConnection,
    payload: CollectorExtensionBridgeCommandResult
  ): CollectorHostBridgeCommandReceipt {
    const pending = this.#pending.get(payload.commandId);
    if (!connection.ready ||
      !pending ||
      pending.bridgeConnectionId !== connection.bridgeConnectionId ||
      pending.profileId !== payload.profileId ||
      pending.browserSessionId !== payload.browserSessionId) {
      throw hostError({ code: 'native_bridge_command_result_rejected', category: 'native_bridge', scope: 'host' });
    }
    clearTimeout(pending.timeout);
    this.#pending.delete(payload.commandId);
    if (payload.ok) pending.resolve(structuredClone(payload.result));
    else pending.reject(hostError({
      code: payload.errorCode,
      category: 'extension_runtime',
      scope: 'browser_session',
      retryClass: 'local_query_only'
    }));
    return {
      type: 'collector_host_bridge_command_receipt',
      protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
      profileId: payload.profileId,
      browserSessionId: payload.browserSessionId,
      commandId: payload.commandId
    };
  }

  disconnect(bridgeConnectionId: string): void {
    for (const [commandId, pending] of this.#pending) {
      if (pending.bridgeConnectionId !== bridgeConnectionId) continue;
      clearTimeout(pending.timeout);
      this.#pending.delete(commandId);
      pending.reject(hostError({
        code: 'native_bridge_disconnected',
        category: 'native_bridge',
        scope: 'browser_session',
        retryClass: 'local_query_only'
      }));
    }
  }
}
