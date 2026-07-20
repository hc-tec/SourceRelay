import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import {
  BROWSER_HOST_PROTOCOL_VERSION,
  NATIVE_BRIDGE_MAX_MESSAGE_BYTES,
  NATIVE_BRIDGE_PROTOCOL_VERSION,
  nativeBridgeHandshakeAuthenticationPayload,
  type BrowserHostEndpointRecord,
  type NativeBridgeHandshakeRequest,
  type NativeBridgeHostResponse,
  type NativeBridgeMessageEnvelope
} from '@intelligence/collector-contracts';

interface BridgeOptions {
  endpointPath: string;
  profileId: string;
  browserSessionId: string;
  expectedOrigin: string;
  callerOrigin: string;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.callerOrigin !== options.expectedOrigin) throw new Error('native_bridge_caller_origin_rejected');
  const endpoint = JSON.parse(await readFile(options.endpointPath, 'utf8')) as BrowserHostEndpointRecord;
  if (endpoint.protocolVersion !== BROWSER_HOST_PROTOCOL_VERSION ||
    typeof endpoint.nativeBridgePipeName !== 'string' ||
    typeof endpoint.bootstrapSecret !== 'string') {
    throw new Error('native_bridge_endpoint_invalid');
  }
  const socket = await connectSocket(endpoint.nativeBridgePipeName);
  const lines = lineReader(socket);
  const unsigned: Omit<NativeBridgeHandshakeRequest, 'authenticationDigest'> = {
    type: 'native_bridge_handshake',
    protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
    hostInstanceId: endpoint.hostInstanceId,
    profileId: options.profileId,
    browserSessionId: options.browserSessionId,
    extensionOrigin: options.callerOrigin,
    nonce: randomBytes(18).toString('base64url'),
    issuedAt: new Date().toISOString()
  };
  const handshake: NativeBridgeHandshakeRequest = {
    ...unsigned,
    authenticationDigest: createHmac('sha256', endpoint.bootstrapSecret)
      .update(nativeBridgeHandshakeAuthenticationPayload(unsigned))
      .digest('base64url')
  };
  socket.write(`${JSON.stringify(handshake)}\n`);
  const accepted = JSON.parse(await lines.next()) as NativeBridgeHostResponse;
  if (!accepted.ok || accepted.type !== 'native_bridge_handshake_accepted') {
    throw new Error(!accepted.ok ? accepted.errorCode : 'native_bridge_handshake_response_invalid');
  }

  let tail = Promise.resolve();
  const nativeInput = nativeMessageReader((payload) => {
    tail = tail.then(async () => {
      const messageId = randomUUID();
      const envelope: NativeBridgeMessageEnvelope = {
        type: 'native_bridge_message',
        protocolVersion: NATIVE_BRIDGE_PROTOCOL_VERSION,
        bridgeConnectionId: accepted.bridgeConnectionId,
        messageId,
        payload
      };
      socket.write(`${JSON.stringify(envelope)}\n`);
      const response = JSON.parse(await lines.next()) as NativeBridgeHostResponse;
      if (!response.ok || response.type !== 'native_bridge_delivery' || response.messageId !== messageId) {
        throw new Error(!response.ok ? response.errorCode : 'native_bridge_delivery_invalid');
      }
      writeNativeMessage(response.payload);
    }).catch((error) => fail(error));
  });
  process.stdin.on('data', nativeInput.onData);
  process.stdin.on('end', () => socket.end());
  process.stdin.resume();
}

function parseOptions(args: readonly string[]): BridgeOptions {
  const separator = args.indexOf('--');
  if (separator < 0) throw new Error('native_bridge_arguments_invalid');
  const optionArgs = args.slice(0, separator);
  const chromeArgs = args.slice(separator + 1);
  const values = new Map<string, string>();
  for (let index = 0; index < optionArgs.length; index += 2) {
    const key = optionArgs[index];
    const value = optionArgs[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error('native_bridge_arguments_invalid');
    values.set(key, value);
  }
  const callerOrigin = chromeArgs.find((value) => /^chrome-extension:\/\/[a-p]{32}\/$/.test(value));
  const endpointPath = values.get('--endpoint');
  const profileId = values.get('--profile-id');
  const browserSessionId = values.get('--browser-session-id');
  const expectedOrigin = values.get('--expected-origin');
  if (!endpointPath || !profileId || !browserSessionId || !expectedOrigin || !callerOrigin) {
    throw new Error('native_bridge_arguments_invalid');
  }
  return { endpointPath, profileId, browserSessionId, expectedOrigin, callerOrigin };
}

function lineReader(socket: Socket): { next(): Promise<string> } {
  let buffer = '';
  const lines: string[] = [];
  const waiters: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer, 'utf8') > NATIVE_BRIDGE_MAX_MESSAGE_BYTES) {
      socket.destroy(new Error('native_bridge_host_message_too_large'));
      return;
    }
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(line);
      else lines.push(line);
      newline = buffer.indexOf('\n');
    }
  });
  const rejectAll = (error: Error) => {
    while (waiters.length > 0) waiters.shift()!.reject(error);
  };
  socket.on('error', rejectAll);
  socket.on('close', () => rejectAll(new Error('native_bridge_host_connection_closed')));
  return {
    next: () => {
      const line = lines.shift();
      return line !== undefined
        ? Promise.resolve(line)
        : new Promise<string>((resolve, reject) => waiters.push({ resolve, reject }));
    }
  };
}

function nativeMessageReader(onMessage: (message: NativeBridgeMessageEnvelope['payload']) => void): {
  onData(chunk: Buffer): void;
} {
  let buffer = Buffer.alloc(0);
  return {
    onData(chunk: Buffer) {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (length > NATIVE_BRIDGE_MAX_MESSAGE_BYTES) return fail(new Error('native_bridge_extension_message_too_large'));
        if (buffer.length < length + 4) return;
        const payload = JSON.parse(buffer.subarray(4, length + 4).toString('utf8')) as NativeBridgeMessageEnvelope['payload'];
        buffer = buffer.subarray(length + 4);
        onMessage(payload);
      }
    }
  };
}

function writeNativeMessage(value: unknown): void {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (payload.length > NATIVE_BRIDGE_MAX_MESSAGE_BYTES) throw new Error('native_bridge_host_delivery_too_large');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(header);
  process.stdout.write(payload);
}

function connectSocket(pipeName: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(pipeName);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function fail(error: unknown): never {
  process.stderr.write(`${error instanceof Error ? error.message : 'native_bridge_failed'}\n`);
  process.exit(1);
}

void main().catch(fail);
