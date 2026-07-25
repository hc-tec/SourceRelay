import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pocRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gatewayDirectory = resolve(pocRoot, 'collector-gateway');

test('direct Gateway reports an occupied loopback port without touching an isolated browser runtime', async () => {
  test.setTimeout(30_000);
  const port = await availableLoopbackPort();
  const blocker = createServer();
  const stateDirectory = await mkdtemp(resolve(tmpdir(), 'collector-user-browser-port-conflict-'));
  let gateway: ChildProcess | undefined;
  try {
    await listen(blocker, port);
    gateway = startGateway(port, stateDirectory);
    const outcome = await childOutcome(gateway, 15_000);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('collector_gateway_port_in_use');
    expect(outcome.stderr).not.toContain('Unhandled \'error\' event');
    const entries = await readdir(stateDirectory);
    expect(entries).not.toContain('profiles');
    expect(entries).not.toContain('browser-host');
    expect(entries).not.toContain('browser-profiles.json');
  } finally {
    if (gateway && gateway.exitCode === null) gateway.kill('SIGTERM');
    await close(blocker);
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await listen(server, 0);
  const address = server.address();
  await close(server);
  if (!address || typeof address === 'string' || address.port < 1024) {
    throw new Error('test_loopback_port_unavailable');
  }
  return address.port;
}

function startGateway(port: number, stateDirectory: string): ChildProcess {
  return spawn(process.execPath, ['dist/user-browser-server.js'], {
    cwd: gatewayDirectory,
    env: {
      ...process.env,
      COLLECTOR_GATEWAY_PORT: String(port),
      COLLECTOR_GATEWAY_STATE_DIR: stateDirectory
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

async function childOutcome(child: ChildProcess, timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => { stderr += chunk; });
  return await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('direct_gateway_port_conflict_timeout')), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolvePromise({ code, stderr });
    });
  });
}

async function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolvePromise());
  });
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => error ? reject(error) : resolvePromise());
  });
}
