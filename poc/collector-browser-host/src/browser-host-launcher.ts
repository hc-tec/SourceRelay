import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import {
  BROWSER_HOST_PROTOCOL_VERSION,
  type BrowserHostEndpointRecord
} from '@intelligence/collector-contracts';

export interface LaunchBrowserHostOptions {
  mainModulePath: string;
  stateDirectory: string;
  profileRoot: string;
  extensionDirectory?: string | null;
  endpointPath: string;
  timeoutMs?: number;
}

export async function launchBrowserHost(options: LaunchBrowserHostOptions): Promise<BrowserHostEndpointRecord> {
  const existing = await readReusableEndpoint(options.endpointPath);
  if (existing) return existing;

  const args = [
    options.mainModulePath,
    '--state-dir', options.stateDirectory,
    '--profile-root', options.profileRoot,
    '--endpoint-path', options.endpointPath
  ];
  if (options.extensionDirectory) args.push('--extension-dir', options.extensionDirectory);
  const child = spawn(process.execPath, args, {
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  });
  child.unref();

  const deadline = Date.now() + (options.timeoutMs ?? 20_000);
  while (Date.now() < deadline) {
    const endpoint = await readReusableEndpoint(options.endpointPath);
    if (endpoint) return endpoint;
    await delay(100);
  }
  throw new Error('browser_host_start_timeout');
}

async function readReusableEndpoint(endpointPath: string): Promise<BrowserHostEndpointRecord | null> {
  let raw: string;
  try {
    raw = await readFile(endpointPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    await removeEndpointIfUnchanged(endpointPath, raw);
    return null;
  }
  const processId = processIdFrom(candidate);
  if (processId !== null && processIsAlive(processId)) {
    if (!isCompatibleEndpoint(candidate)) throw new Error('browser_host_existing_endpoint_invalid');
    return candidate;
  }
  await removeEndpointIfUnchanged(endpointPath, raw);
  return null;
}

function isCompatibleEndpoint(value: unknown): value is BrowserHostEndpointRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BrowserHostEndpointRecord>;
  return candidate.schemaVersion === 1 &&
    candidate.protocolVersion === BROWSER_HOST_PROTOCOL_VERSION &&
    typeof candidate.hostInstanceId === 'string' && candidate.hostInstanceId.length > 0 &&
    typeof candidate.pipeName === 'string' && candidate.pipeName.length > 0 &&
    typeof candidate.nativeBridgePipeName === 'string' && candidate.nativeBridgePipeName.length > 0 &&
    typeof candidate.bootstrapSecret === 'string' && candidate.bootstrapSecret.length > 0 &&
    Number.isSafeInteger(candidate.processId) && Number(candidate.processId) > 0 &&
    typeof candidate.createdAt === 'string' && Number.isFinite(Date.parse(candidate.createdAt));
}

function processIdFrom(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const processId = (value as { processId?: unknown }).processId;
  return Number.isSafeInteger(processId) && Number(processId) > 0 ? Number(processId) : null;
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function removeEndpointIfUnchanged(endpointPath: string, staleRaw: string): Promise<void> {
  const current = await readFile(endpointPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (current === staleRaw) await rm(endpointPath, { force: true });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
