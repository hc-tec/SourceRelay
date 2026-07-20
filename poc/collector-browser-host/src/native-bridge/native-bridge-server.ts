import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import {
  NATIVE_BRIDGE_MAX_MESSAGE_BYTES,
  NATIVE_BRIDGE_PROTOCOL_VERSION,
  nativeBridgeHandshakeAuthenticationPayload,
  type CollectorExtensionCommandResult,
  type CollectorHostExtensionCommand,
  type NativeBridgeErrorResponse,
  type NativeBridgeHandshakeAccepted,
  type NativeBridgeHandshakeRequest,
  type NativeBridgeHostRequest,
  type NativeBridgeHostResponse,
  type NativeBridgeMessageDelivery,
  type NativeBridgeMessageEnvelope,
  type NativeBridgeHostPush
} from '@intelligence/collector-contracts';
import { BrowserHostError } from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';
import { authenticationMatches, timestampIsFresh } from '../security.js';
import { NativeBridgeRegistry } from './native-bridge-registry.js';

interface ConnectionState {
  buffer: string;
  handling: Promise<void>;
  bridgeConnectionId: string | null;
}

export class NativeBridgeServer {
  readonly #pipeName: string;
  readonly #hostInstanceId: string;
  readonly #bootstrapSecret: string;
  readonly #registry: NativeBridgeRegistry;
  readonly #server: Server;
  readonly #sockets = new Set<Socket>();
  readonly #connectionSockets = new Map<string, Socket>();

  constructor(input: {
    pipeName: string;
    hostInstanceId: string;
    bootstrapSecret: string;
    registry: NativeBridgeRegistry;
  }) {
    this.#pipeName = input.pipeName;
    this.#hostInstanceId = input.hostInstanceId;
    this.#bootstrapSecret = input.bootstrapSecret;
    this.#registry = input.registry;
    this.#server = createServer((socket) => this.#handleConnection(socket));
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(this.#pipeName, () => {
        this.#server.off('error', reject);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      if (!this.#server.listening) return resolve();
      this.#server.close(() => resolve());
    });
  }

  command(
    profileId: string,
    browserSessionId: string,
    command: CollectorHostExtensionCommand,
    timeoutMs?: number
  ): Promise<CollectorExtensionCommandResult> {
    return this.#registry.requestCommand(
      profileId,
      browserSessionId,
      command,
      (bridgeConnectionId, payload) => {
        const socket = this.#connectionSockets.get(bridgeConnectionId);
        if (!socket?.writable) throw new Error('native_bridge_connection_not_writable');
        const push: NativeBridgeHostPush = {
          type: 'native_bridge_host_push',
          protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
          bridgeConnectionId,
          payload
        };
        this.#write(socket, push);
      },
      timeoutMs
    );
  }

  #handleConnection(socket: Socket): void {
    this.#sockets.add(socket);
    socket.setEncoding('utf8');
    const state: ConnectionState = { buffer: '', handling: Promise.resolve(), bridgeConnectionId: null };
    socket.on('data', (chunk: string) => {
      state.buffer += chunk;
      if (Buffer.byteLength(state.buffer, 'utf8') > NATIVE_BRIDGE_MAX_MESSAGE_BYTES) {
        socket.destroy(new Error('native_bridge_message_too_large'));
        return;
      }
      let newline = state.buffer.indexOf('\n');
      while (newline >= 0) {
        const line = state.buffer.slice(0, newline);
        state.buffer = state.buffer.slice(newline + 1);
        if (line.trim()) {
          state.handling = state.handling.then(() => this.#handleLine(socket, state, line)).catch(() => {
            socket.destroy();
          });
        }
        newline = state.buffer.indexOf('\n');
      }
    });
    socket.on('close', () => {
      this.#sockets.delete(socket);
      if (!state.bridgeConnectionId) return;
      this.#connectionSockets.delete(state.bridgeConnectionId);
      this.#registry.disconnect(state.bridgeConnectionId);
    });
    socket.on('error', () => undefined);
  }

  async #handleLine(socket: Socket, state: ConnectionState, line: string): Promise<void> {
    let request: NativeBridgeHostRequest;
    try {
      request = JSON.parse(line) as NativeBridgeHostRequest;
    } catch {
      this.#write(socket, this.#error(null, 'native_bridge_json_invalid'));
      return;
    }
    if (!state.bridgeConnectionId) {
      this.#acceptHandshake(socket, state, request);
      return;
    }
    if (request.type !== 'native_bridge_message') {
      this.#write(socket, this.#error(null, 'native_bridge_message_required'));
      return;
    }
    this.#handleMessage(socket, state, request);
  }

  #acceptHandshake(socket: Socket, state: ConnectionState, request: NativeBridgeHostRequest): void {
    if (request.type !== 'native_bridge_handshake' || !this.#handshakeValid(request)) {
      this.#write(socket, this.#error(null, 'native_bridge_handshake_rejected'));
      socket.end();
      return;
    }
    try {
      const admission = this.#registry.acceptHandshake(request);
      if (admission.replacedConnectionId) this.#connectionSockets.get(admission.replacedConnectionId)?.destroy();
      state.bridgeConnectionId = admission.bridgeConnectionId;
      this.#connectionSockets.set(admission.bridgeConnectionId, socket);
      const response: NativeBridgeHandshakeAccepted = {
        ok: true,
        type: 'native_bridge_handshake_accepted',
        protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
        bridgeConnectionId: admission.bridgeConnectionId
      };
      this.#write(socket, response);
    } catch (error) {
      this.#write(socket, this.#error(null, this.#errorCode(error)));
      socket.end();
    }
  }

  #handleMessage(socket: Socket, state: ConnectionState, envelope: NativeBridgeMessageEnvelope): void {
    if (envelope.protocolVersion !== NATIVE_BRIDGE_PROTOCOL_VERSION ||
      envelope.bridgeConnectionId !== state.bridgeConnectionId ||
      typeof envelope.messageId !== 'string' || envelope.messageId.length < 16) {
      this.#write(socket, this.#error(envelope.messageId ?? null, 'native_bridge_message_context_rejected'));
      return;
    }
    try {
      const payload = this.#registry.handleMessage(state.bridgeConnectionId, envelope.payload);
      const response: NativeBridgeMessageDelivery = {
        ok: true,
        type: 'native_bridge_delivery',
        protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
        messageId: envelope.messageId,
        payload
      };
      this.#write(socket, response);
    } catch (error) {
      this.#write(socket, this.#error(envelope.messageId, this.#errorCode(error)));
    }
  }

  #handshakeValid(request: NativeBridgeHandshakeRequest): boolean {
    if (request.protocolVersion !== NATIVE_BRIDGE_PROTOCOL_VERSION || request.hostInstanceId !== this.#hostInstanceId) {
      return false;
    }
    if (typeof request.authenticationDigest !== 'string' ||
      typeof request.nonce !== 'string' || request.nonce.length < 16 ||
      typeof request.extensionOrigin !== 'string' || !/^chrome-extension:\/\/[a-p]{32}\/$/.test(request.extensionOrigin) ||
      !timestampIsFresh(request.issuedAt)) return false;
    const { authenticationDigest: _authenticationDigest, ...unsigned } = request;
    return authenticationMatches(
      this.#bootstrapSecret,
      nativeBridgeHandshakeAuthenticationPayload(unsigned),
      request.authenticationDigest
    );
  }

  #error(messageId: string | null, errorCode: string): NativeBridgeErrorResponse {
    return {
      ok: false,
      type: 'native_bridge_error',
      protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
      messageId,
      errorCode
    };
  }

  #errorCode(error: unknown): string {
    return error instanceof BrowserHostError
      ? error.record.code
      : hostError({ code: 'native_bridge_internal_error', category: 'native_bridge', scope: 'host' }).record.code;
  }

  #write(socket: Socket, response: NativeBridgeHostResponse): void {
    socket.write(`${JSON.stringify(response)}\n`);
  }
}
