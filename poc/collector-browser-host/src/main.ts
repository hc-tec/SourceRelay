import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BROWSER_HOST_PROTOCOL_VERSION,
  type BrowserHostEndpointRecord
} from '@intelligence/collector-contracts';
import { writeJsonAtomic } from './atomic-file.js';
import { BrowserHostRuntime } from './browser-host-runtime.js';
import { BrowserHostServer } from './ipc/browser-host-server.js';
import { createBootstrapSecret } from './security.js';
import { absolutePath } from './validation.js';

interface MainOptions {
  stateDirectory: string;
  profileRoot: string;
  extensionDirectory: string | null;
  endpointPath: string;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  await mkdir(options.stateDirectory, { recursive: true });
  const lockPath = resolve(options.stateDirectory, 'browser-host.lock.json');
  const lock = await acquireSingleInstanceLock(lockPath);
  if (!lock.acquired) return;

  const hostInstanceId = randomUUID();
  const bootstrapSecret = createBootstrapSecret();
  const pipeName = pipeNameFor(options.stateDirectory, hostInstanceId);
  const runtime = new BrowserHostRuntime({
    hostInstanceId,
    profileRoot: options.profileRoot,
    extensionDirectory: options.extensionDirectory,
    journalDirectory: resolve(options.stateDirectory, 'journal')
  });
  await runtime.initialise();

  let closing = false;
  let server!: BrowserHostServer;
  const shutdown = async (exitCode: number) => {
    if (closing) return;
    closing = true;
    await server.close().catch(() => undefined);
    await runtime.shutdown().catch(() => undefined);
    await rm(options.endpointPath, { force: true }).catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
    if (process.platform !== 'win32') await rm(pipeName, { force: true }).catch(() => undefined);
    process.exit(exitCode);
  };
  server = new BrowserHostServer({
    runtime,
    pipeName,
    bootstrapSecret,
    onShutdownRequested: () => void shutdown(0)
  });

  try {
    if (process.platform !== 'win32') await rm(pipeName, { force: true });
    await server.listen();
    const endpoint: BrowserHostEndpointRecord = {
      schemaVersion: 1,
      protocolVersion: BROWSER_HOST_PROTOCOL_VERSION,
      hostInstanceId,
      pipeName,
      bootstrapSecret,
      processId: process.pid,
      createdAt: new Date().toISOString()
    };
    await writeJsonAtomic(options.endpointPath, endpoint);
    process.on('SIGINT', () => void shutdown(0));
    process.on('SIGTERM', () => void shutdown(0));
  } catch (error) {
    await server.close().catch(() => undefined);
    await runtime.shutdown().catch(() => undefined);
    await rm(options.endpointPath, { force: true }).catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function parseOptions(args: readonly string[]): MainOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error('browser_host_arguments_invalid');
    values.set(key, value);
  }
  const stateDirectory = absolutePath(values.get('--state-dir'), 'state_directory');
  const profileRoot = absolutePath(values.get('--profile-root'), 'profile_root');
  const endpointPath = absolutePath(values.get('--endpoint-path'), 'endpoint_path');
  const extensionValue = values.get('--extension-dir');
  return {
    stateDirectory,
    profileRoot,
    endpointPath,
    extensionDirectory: extensionValue ? absolutePath(extensionValue, 'extension_directory') : null
  };
}

async function acquireSingleInstanceLock(path: string): Promise<{ acquired: boolean }> {
  await rmStaleLock(path);
  try {
    const handle = await open(path, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, processId: process.pid })}\n`, 'utf8');
    await handle.close();
    return { acquired: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { acquired: false };
    throw error;
  }
}

async function rmStaleLock(path: string): Promise<void> {
  const exists = await stat(path).then(() => true, () => false);
  if (!exists) return;
  try {
    const record = JSON.parse(await readFile(path, 'utf8')) as { processId?: unknown };
    if (typeof record.processId === 'number' && processIsAlive(record.processId)) return;
  } catch {
    // Invalid lock files are stale by definition.
  }
  await rm(path, { force: true });
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function pipeNameFor(stateDirectory: string, hostInstanceId: string): string {
  const digest = createHash('sha256').update(stateDirectory).digest('hex').slice(0, 16);
  if (process.platform === 'win32') return `\\\\.\\pipe\\intelligence-collector-${digest}`;
  return resolve(stateDirectory, `browser-host-${hostInstanceId}.sock`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'browser_host_start_failed'}\n`);
  process.exit(1);
});
