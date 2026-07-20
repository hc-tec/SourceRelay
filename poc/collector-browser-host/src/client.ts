import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import {
  BROWSER_HOST_PROTOCOL_VERSION,
  BrowserHostError,
  commandAuthenticationPayload,
  handshakeAuthenticationPayload,
  type BrowserHostCommandBody,
  type BrowserHostCommandEnvelope,
  type BrowserHostCommandResult,
  type BrowserHostEndpointRecord,
  type BrowserHostHandshakeRequest,
  type BrowserHostWireResponse
} from '@intelligence/collector-contracts';

export {
  launchBrowserHost,
  type LaunchBrowserHostOptions
} from './browser-host-launcher.js';

export class BrowserHostClient {
  readonly hostInstanceId: string;
  readonly controllerGeneration: string;
  readonly #gatewayInstanceId: string;
  readonly #secret: string;
  readonly #socket: Socket;
  readonly #lines: string[] = [];
  readonly #lineWaiters: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
  #buffer = '';
  #closed = false;
  #requestTail: Promise<unknown> = Promise.resolve();

  private constructor(input: {
    hostInstanceId: string;
    controllerGeneration: string;
    gatewayInstanceId: string;
    secret: string;
    socket: Socket;
  }) {
    this.hostInstanceId = input.hostInstanceId;
    this.controllerGeneration = input.controllerGeneration;
    this.#gatewayInstanceId = input.gatewayInstanceId;
    this.#secret = input.secret;
    this.#socket = input.socket;
    this.#wireSocket();
  }

  static async connect(endpointPath: string, gatewayInstanceId = randomUUID()): Promise<BrowserHostClient> {
    const endpoint = JSON.parse(await readFile(endpointPath, 'utf8')) as BrowserHostEndpointRecord;
    if (endpoint.protocolVersion !== BROWSER_HOST_PROTOCOL_VERSION || typeof endpoint.bootstrapSecret !== 'string') {
      throw new Error('browser_host_endpoint_invalid');
    }
    const socket = await connectSocket(endpoint.pipeName);
    const provisional = new BrowserHostClient({
      hostInstanceId: endpoint.hostInstanceId,
      controllerGeneration: 'pending',
      gatewayInstanceId,
      secret: endpoint.bootstrapSecret,
      socket
    });
    const unsigned: Omit<BrowserHostHandshakeRequest, 'authenticationDigest'> = {
      type: 'handshake',
      protocolVersion: BROWSER_HOST_PROTOCOL_VERSION,
      gatewayInstanceId,
      nonce: randomBytes(18).toString('base64url'),
      issuedAt: new Date().toISOString()
    };
    const request: BrowserHostHandshakeRequest = {
      ...unsigned,
      authenticationDigest: sign(endpoint.bootstrapSecret, handshakeAuthenticationPayload(unsigned))
    };
    provisional.#socket.write(`${JSON.stringify(request)}\n`);
    const response = JSON.parse(await provisional.#nextLine()) as BrowserHostWireResponse;
    if (!response.ok) throw new BrowserHostError(response.error);
    if (response.type !== 'handshake_accepted') throw new Error('browser_host_handshake_response_invalid');
    return new BrowserHostClient({
      hostInstanceId: response.hostInstanceId,
      controllerGeneration: response.controllerGeneration,
      gatewayInstanceId,
      secret: endpoint.bootstrapSecret,
      socket: provisional.#detachSocket()
    });
  }

  command(body: BrowserHostCommandBody, options: { commandId?: string; timeoutMs?: number } = {}): Promise<BrowserHostCommandResult> {
    const run = async () => {
      if (this.#closed) throw new Error('browser_host_client_closed');
      const now = new Date();
      const unsigned: Omit<BrowserHostCommandEnvelope, 'authenticationDigest'> = {
        type: 'command',
        protocolVersion: BROWSER_HOST_PROTOCOL_VERSION,
        hostInstanceId: this.hostInstanceId,
        controllerGeneration: this.controllerGeneration,
        gatewayInstanceId: this.#gatewayInstanceId,
        commandId: options.commandId ?? randomUUID(),
        nonce: randomBytes(18).toString('base64url'),
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + (options.timeoutMs ?? 30_000)).toISOString(),
        body: structuredClone(body)
      };
      const envelope: BrowserHostCommandEnvelope = {
        ...unsigned,
        authenticationDigest: sign(this.#secret, commandAuthenticationPayload(unsigned))
      };
      this.#socket.write(`${JSON.stringify(envelope)}\n`);
      const response = JSON.parse(await this.#nextLine()) as BrowserHostWireResponse;
      if (!response.ok) throw new BrowserHostError(response.error);
      if (response.type !== 'command_result' || response.commandId !== envelope.commandId) {
        throw new Error('browser_host_command_response_invalid');
      }
      return response.result;
    };
    const result = this.#requestTail.then(run, run);
    this.#requestTail = result.then(() => undefined, () => undefined);
    return result;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#socket.end();
  }

  #wireSocket(): void {
    this.#socket.setEncoding('utf8');
    this.#socket.on('data', (chunk: string) => {
      this.#buffer += chunk;
      let newline = this.#buffer.indexOf('\n');
      while (newline >= 0) {
        const line = this.#buffer.slice(0, newline);
        this.#buffer = this.#buffer.slice(newline + 1);
        const waiter = this.#lineWaiters.shift();
        if (waiter) waiter.resolve(line);
        else this.#lines.push(line);
        newline = this.#buffer.indexOf('\n');
      }
    });
    const fail = (error: Error) => {
      while (this.#lineWaiters.length > 0) this.#lineWaiters.shift()!.reject(error);
    };
    this.#socket.on('error', fail);
    this.#socket.on('close', () => fail(new Error('browser_host_connection_closed')));
  }

  #nextLine(): Promise<string> {
    const line = this.#lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise<string>((resolve, reject) => this.#lineWaiters.push({ resolve, reject }));
  }

  #detachSocket(): Socket {
    this.#socket.removeAllListeners();
    this.#closed = true;
    return this.#socket;
  }
}

async function connectSocket(pipeName: string): Promise<Socket> {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = connect(pipeName);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}
