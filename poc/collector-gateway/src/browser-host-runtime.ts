import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import {
  BrowserHostClient,
  launchBrowserHost
} from '@intelligence/collector-browser-host/client';
import {
  COLLECTOR_CONTROL_SURFACE_REVISION,
  COLLECTOR_EXTENSION_VERSION,
  PAGE_POOL_SCHEMA_VERSION,
  type AcquirePageRequest,
  type AcquirePageResult,
  type BrowserHostCommandBody,
  type BrowserHostCommandResult,
  type ManagedPageSummary,
  type NavigatePageRequest,
  type PagePoolSnapshot,
  type ReleasePageRequest,
  type StrategyObservationReadRequest,
  type StrategyObservationResult,
  type StrategyObserverBindingRequest,
  type StrategyObserverBindingResult
} from '@intelligence/collector-contracts';
import type { GatewayConfig } from './config';

const EXTENSION_RUNTIME_EXPECTATION = {
  version: COLLECTOR_EXTENSION_VERSION,
  controlSurfaceRevision: COLLECTOR_CONTROL_SURFACE_REVISION,
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

  async acquirePage(request: AcquirePageRequest): Promise<AcquirePageResult> {
    const result = await this.#command({ type: 'acquire_page', request }, false);
    if (!result || typeof result !== 'object' ||
      !('lease' in result) || !('page' in result) || !('selection' in result)) {
      throw new Error('browser_host_acquire_page_response_invalid');
    }
    return structuredClone(result as AcquirePageResult);
  }

  async navigatePage(request: NavigatePageRequest): Promise<ManagedPageSummary> {
    return managedPageResult(await this.#command({ type: 'navigate_page', request }, false));
  }

  async releasePage(request: ReleasePageRequest): Promise<ManagedPageSummary> {
    return managedPageResult(await this.#command({ type: 'release_page', request }, false));
  }

  async bindStrategyObserver(request: StrategyObserverBindingRequest): Promise<StrategyObserverBindingResult> {
    const result = await this.#command({ type: 'bind_strategy_observer', request }, false);
    if (!result || typeof result !== 'object' ||
      (result as { type?: unknown }).type !== 'collector_strategy_observer_binding') {
      throw new Error('browser_host_strategy_binding_response_invalid');
    }
    return structuredClone(result as StrategyObserverBindingResult);
  }

  async readStrategyObservation(request: StrategyObservationReadRequest): Promise<StrategyObservationResult> {
    const result = await this.#command({ type: 'read_strategy_observation', request }, false);
    if (!result || typeof result !== 'object' ||
      (result as { type?: unknown }).type !== 'collector_strategy_observation') {
      throw new Error('browser_host_strategy_observation_response_invalid');
    }
    return structuredClone(result as StrategyObservationResult);
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

function managedPageResult(value: BrowserHostCommandResult): ManagedPageSummary {
  if (!value || typeof value !== 'object') throw new Error('browser_host_managed_page_response_invalid');
  const candidate = value as Partial<ManagedPageSummary>;
  if (candidate.schemaVersion !== 1 || typeof candidate.pageAlias !== 'string' || typeof candidate.state !== 'string') {
    throw new Error('browser_host_managed_page_response_invalid');
  }
  return structuredClone(value as ManagedPageSummary);
}
