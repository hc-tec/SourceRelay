import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import {
  BROWSER_HOST_MAX_MESSAGE_BYTES,
  BROWSER_HOST_PROTOCOL_VERSION,
  BrowserHostError,
  commandAuthenticationPayload,
  handshakeAuthenticationPayload,
  type BrowserHostCommandEnvelope,
  type BrowserHostCommandResponse,
  type BrowserHostErrorResponse,
  type BrowserHostHandshakeRequest,
  type BrowserHostHandshakeResponse,
  type BrowserHostWireRequest,
  type BrowserHostWireResponse
} from '@intelligence/collector-contracts';
import { BrowserHostRuntime } from '../browser-host-runtime.js';
import { hostError } from '../host-errors.js';
import { authenticationMatches, timestampIsFresh, timestampIsUnexpired } from '../security.js';
import {
  commandIntentDigest,
  withoutCommandAuthentication,
  withoutHandshakeAuthentication
} from './wire-auth.js';

interface ConnectionState {
  accepted: boolean;
  gatewayInstanceId: string | null;
  controllerGeneration: string | null;
  buffer: string;
  handling: Promise<void>;
}

interface CachedCommand {
  payloadDigest: string;
  response: BrowserHostCommandResponse | BrowserHostErrorResponse;
}

export class BrowserHostServer {
  readonly #runtime: BrowserHostRuntime;
  readonly #pipeName: string;
  readonly #bootstrapSecret: string;
  readonly #onShutdownRequested: () => void;
  readonly #server: Server;
  readonly #commandCache = new Map<string, CachedCommand>();
  readonly #seenNonces = new Set<string>();
  readonly #nonceOrder: string[] = [];
  #activeSocket: Socket | null = null;
  #activeControllerGeneration: string | null = null;

  constructor(input: {
    runtime: BrowserHostRuntime;
    pipeName: string;
    bootstrapSecret: string;
    onShutdownRequested: () => void;
  }) {
    this.#runtime = input.runtime;
    this.#pipeName = input.pipeName;
    this.#bootstrapSecret = input.bootstrapSecret;
    this.#onShutdownRequested = input.onShutdownRequested;
    this.#server = createServer((socket) => this.#handleConnection(socket));
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.#server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.#server.off('error', onError);
        resolve();
      };
      this.#server.once('error', onError);
      this.#server.once('listening', onListening);
      this.#server.listen(this.#pipeName);
    });
  }

  async close(): Promise<void> {
    this.#activeSocket?.destroy();
    await new Promise<void>((resolve) => {
      if (!this.#server.listening) return resolve();
      this.#server.close(() => resolve());
    });
  }

  #handleConnection(socket: Socket): void {
    socket.setEncoding('utf8');
    const state: ConnectionState = {
      accepted: false,
      gatewayInstanceId: null,
      controllerGeneration: null,
      buffer: '',
      handling: Promise.resolve()
    };
    socket.on('data', (chunk: string) => {
      state.buffer += chunk;
      if (Buffer.byteLength(state.buffer, 'utf8') > BROWSER_HOST_MAX_MESSAGE_BYTES) {
        socket.destroy(new Error('browser_host_message_too_large'));
        return;
      }
      let newline = state.buffer.indexOf('\n');
      while (newline >= 0) {
        const line = state.buffer.slice(0, newline);
        state.buffer = state.buffer.slice(newline + 1);
        if (line.trim().length > 0) {
          state.handling = state.handling
            .then(() => this.#handleLine(socket, state, line))
            .catch(() => {
              socket.destroy();
            });
        }
        newline = state.buffer.indexOf('\n');
      }
    });
    socket.on('close', () => {
      if (this.#activeSocket !== socket || !state.controllerGeneration) return;
      this.#runtime.disconnectController(state.controllerGeneration);
      this.#activeSocket = null;
      this.#activeControllerGeneration = null;
    });
    socket.on('error', () => undefined);
  }

  async #handleLine(socket: Socket, state: ConnectionState, line: string): Promise<void> {
    let request: BrowserHostWireRequest;
    try {
      request = JSON.parse(line) as BrowserHostWireRequest;
    } catch {
      this.#write(socket, this.#errorResponse(null, hostError({ code: 'protocol_json_invalid', category: 'protocol', scope: 'host' })));
      return;
    }
    if (!state.accepted) {
      await this.#acceptHandshake(socket, state, request);
      return;
    }
    if (request.type !== 'command') {
      this.#write(socket, this.#errorResponse(null, hostError({ code: 'protocol_command_required', category: 'protocol', scope: 'host' })));
      return;
    }
    await this.#executeCommand(socket, state, request);
  }

  async #acceptHandshake(socket: Socket, state: ConnectionState, request: BrowserHostWireRequest): Promise<void> {
    if (request.type !== 'handshake' || !this.#handshakeValid(request)) {
      this.#write(socket, this.#errorResponse(null, hostError({ code: 'browser_host_handshake_rejected', category: 'protocol', scope: 'host' })));
      socket.end();
      return;
    }
    if (this.#activeSocket && this.#activeSocket !== socket && this.#activeControllerGeneration) {
      this.#runtime.disconnectController(this.#activeControllerGeneration);
      this.#activeSocket.destroy();
    }
    const controllerGeneration = randomUUID();
    state.accepted = true;
    state.gatewayInstanceId = request.gatewayInstanceId;
    state.controllerGeneration = controllerGeneration;
    this.#activeSocket = socket;
    this.#activeControllerGeneration = controllerGeneration;
    this.#runtime.adoptController(controllerGeneration);
    const response: BrowserHostHandshakeResponse = {
      ok: true,
      type: 'handshake_accepted',
      hostInstanceId: this.#runtime.hostInstanceId,
      controllerGeneration,
      protocolVersion: BROWSER_HOST_PROTOCOL_VERSION
    };
    this.#write(socket, response);
  }

  async #executeCommand(socket: Socket, state: ConnectionState, envelope: BrowserHostCommandEnvelope): Promise<void> {
    const validationError = this.#commandValidationError(state, envelope);
    if (validationError) {
      this.#write(socket, this.#errorResponse(envelope.commandId ?? null, validationError));
      return;
    }
    const payloadDigest = commandIntentDigest(envelope);
    const cached = this.#commandCache.get(envelope.commandId);
    if (cached) {
      if (cached.payloadDigest !== payloadDigest) {
        this.#write(socket, this.#errorResponse(envelope.commandId, hostError({
          code: 'command_id_payload_conflict',
          category: 'protocol',
          scope: 'host'
        })));
        return;
      }
      this.#write(socket, cached.response);
      return;
    }
    if (this.#seenNonces.has(envelope.nonce)) {
      this.#write(socket, this.#errorResponse(envelope.commandId, hostError({
        code: 'command_nonce_replayed',
        category: 'protocol',
        scope: 'host'
      })));
      return;
    }
    this.#rememberNonce(envelope.nonce);
    let response: BrowserHostCommandResponse | BrowserHostErrorResponse;
    try {
      const result = await this.#runtime.execute(envelope.body, envelope.controllerGeneration);
      response = { ok: true, type: 'command_result', commandId: envelope.commandId, result };
    } catch (error) {
      response = this.#errorResponse(envelope.commandId, error);
    }
    this.#commandCache.set(envelope.commandId, { payloadDigest, response });
    if (this.#commandCache.size > 2_048) {
      const first = this.#commandCache.keys().next().value as string | undefined;
      if (first) this.#commandCache.delete(first);
    }
    this.#write(socket, response);
    if (envelope.body.type === 'shutdown_host' && response.ok) {
      setTimeout(this.#onShutdownRequested, 25);
    }
  }

  #handshakeValid(request: BrowserHostHandshakeRequest): boolean {
    if (request.protocolVersion !== BROWSER_HOST_PROTOCOL_VERSION) return false;
    if (typeof request.gatewayInstanceId !== 'string' || request.gatewayInstanceId.length < 1) return false;
    if (typeof request.nonce !== 'string' || request.nonce.length < 16) return false;
    if (!timestampIsFresh(request.issuedAt)) return false;
    const unsigned = withoutHandshakeAuthentication(request);
    return authenticationMatches(
      this.#bootstrapSecret,
      handshakeAuthenticationPayload(unsigned),
      request.authenticationDigest
    );
  }

  #commandValidationError(state: ConnectionState, envelope: BrowserHostCommandEnvelope): unknown | null {
    if (envelope.protocolVersion !== BROWSER_HOST_PROTOCOL_VERSION ||
      envelope.hostInstanceId !== this.#runtime.hostInstanceId ||
      envelope.controllerGeneration !== state.controllerGeneration ||
      envelope.gatewayInstanceId !== state.gatewayInstanceId) {
      return hostError({ code: 'command_context_rejected', category: 'protocol', scope: 'host' });
    }
    if (!timestampIsFresh(envelope.issuedAt) || !timestampIsUnexpired(envelope.expiresAt)) {
      return hostError({ code: 'command_expired', category: 'protocol', scope: 'host' });
    }
    if (typeof envelope.commandId !== 'string' || envelope.commandId.length < 16 ||
      typeof envelope.nonce !== 'string' || envelope.nonce.length < 16) {
      return hostError({ code: 'command_identity_invalid', category: 'protocol', scope: 'host' });
    }
    const unsigned = withoutCommandAuthentication(envelope);
    const valid = authenticationMatches(
      this.#bootstrapSecret,
      commandAuthenticationPayload(unsigned),
      envelope.authenticationDigest
    );
    return valid ? null : hostError({ code: 'command_authentication_rejected', category: 'protocol', scope: 'host' });
  }

  #rememberNonce(nonce: string): void {
    this.#seenNonces.add(nonce);
    this.#nonceOrder.push(nonce);
    while (this.#nonceOrder.length > 4_096) {
      const expired = this.#nonceOrder.shift();
      if (expired) this.#seenNonces.delete(expired);
    }
  }

  #errorResponse(commandId: string | null, error: unknown): BrowserHostErrorResponse {
    const record = error instanceof BrowserHostError
      ? error.record
      : hostError({
          code: 'browser_host_internal_error',
          category: 'internal',
          scope: 'host',
          profileSafetyDisposition: 'host_blocked',
          safeDetails: { errorType: error instanceof Error ? error.name : 'unknown' }
        }).record;
    return { ok: false, type: 'command_error', commandId, error: record };
  }

  #write(socket: Socket, response: BrowserHostWireResponse): void {
    socket.write(`${JSON.stringify(response)}\n`);
  }
}
