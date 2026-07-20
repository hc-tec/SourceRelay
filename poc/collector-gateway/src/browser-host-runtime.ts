import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import {
  BrowserHostClient,
  launchBrowserHost
} from '@intelligence/collector-browser-host/client';
import {
  PAGE_POOL_SCHEMA_VERSION,
  type BrowserHostCommandBody,
  type BrowserHostCommandResult,
  type PagePoolSnapshot
} from '@intelligence/collector-contracts';
import type { GatewayConfig } from './config';

const EXTENSION_RUNTIME_EXPECTATION = {
  version: '0.6.0',
  controlSurfaceRevision: 4,
  runtimeBootstrapKey: 'collector.runtime-bootstrap.v1'
} as const;

export class GatewayBrowserHostRuntime {
  readonly #config: GatewayConfig;
  readonly #gatewayInstanceId = randomUUID();
  #client: BrowserHostClient | null = null;
  #connecting: Promise<BrowserHostClient | null> | null = null;

  constructor(config: GatewayConfig) {
    this.#config = config;
  }

  async snapshotIfRunning(): Promise<PagePoolSnapshot | null> {
    const client = await this.#connect(false);
    if (!client) return null;
    try {
      return snapshotResult(await client.command({ type: 'get_snapshot' }));
    } catch {
      if (this.#client === client) this.disconnect();
      return null;
    }
  }

  async launchProfile(profileId: string): Promise<PagePoolSnapshot> {
    return snapshotResult(await this.#command({
      type: 'launch_profile',
      request: {
        profileId,
        maximumManagedPages: 3,
        headless: false,
        offlineOnly: false,
        extensionRuntime: EXTENSION_RUNTIME_EXPECTATION
      }
    }, true));
  }

  async closeProfile(profileId: string): Promise<void> {
    const result = await this.#command({ type: 'close_profile', profileId }, false);
    if (!isOkState(result, profileId, 'closed')) throw new Error('browser_host_close_profile_response_invalid');
  }

  async shutdownHost(): Promise<void> {
    const result = await this.#command({ type: 'shutdown_host' }, false);
    if (!result || typeof result !== 'object' ||
      (result as { ok?: unknown }).ok !== true ||
      (result as { shuttingDown?: unknown }).shuttingDown !== true) {
      throw new Error('browser_host_shutdown_response_invalid');
    }
    this.disconnect();
  }

  disconnect(): void {
    this.#client?.close();
    this.#client = null;
  }

  async #command(body: BrowserHostCommandBody, startIfMissing: boolean): Promise<BrowserHostCommandResult> {
    const client = await this.#connect(startIfMissing);
    if (!client) throw new Error('browser_host_not_running');
    try {
      return await client.command(body);
    } catch (error) {
      if (this.#client === client) this.disconnect();
      throw error;
    }
  }

  async #connect(startIfMissing: boolean): Promise<BrowserHostClient | null> {
    if (this.#client) return this.#client;
    if (this.#connecting) {
      const connected = await this.#connecting;
      if (connected || !startIfMissing) return connected;
    }
    if (!startIfMissing && !(await fileExists(this.#config.browserHostEndpointPath))) return null;
    const connecting = (async () => {
      try {
        if (startIfMissing) {
          await launchBrowserHost({
            mainModulePath: this.#config.browserHostMainModulePath,
            stateDirectory: this.#config.browserHostStateDirectory,
            profileRoot: this.#config.profileDirectory,
            extensionDirectory: this.#config.extensionDirectory,
            endpointPath: this.#config.browserHostEndpointPath,
            timeoutMs: 30_000
          });
        }
        return await BrowserHostClient.connect(
          this.#config.browserHostEndpointPath,
          this.#gatewayInstanceId
        );
      } catch (error) {
        if (startIfMissing) throw error;
        return null;
      }
    })();
    this.#connecting = connecting;
    try {
      const connected = await connecting;
      this.#client = connected;
      return connected;
    } finally {
      if (this.#connecting === connecting) this.#connecting = null;
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function snapshotResult(value: BrowserHostCommandResult): PagePoolSnapshot {
  if (!value || typeof value !== 'object') throw new Error('browser_host_snapshot_invalid');
  const candidate = value as Partial<PagePoolSnapshot>;
  if (candidate.schemaVersion !== PAGE_POOL_SCHEMA_VERSION ||
    typeof candidate.hostInstanceId !== 'string' ||
    !Number.isSafeInteger(candidate.hostProcessId) ||
    !Number.isSafeInteger(candidate.snapshotRevision) ||
    typeof candidate.capturedAt !== 'string' ||
    !Array.isArray(candidate.profiles)) throw new Error('browser_host_snapshot_invalid');
  return structuredClone(value as PagePoolSnapshot);
}

function isOkState(
  value: BrowserHostCommandResult,
  profileId: string,
  state: string
): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { ok?: unknown; profileId?: unknown; state?: unknown };
  return candidate.ok === true && candidate.profileId === profileId && candidate.state === state;
}
