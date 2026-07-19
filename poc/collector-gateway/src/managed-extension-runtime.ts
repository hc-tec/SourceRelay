import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import {
  COLLECTOR_CONTROL_SURFACE_REVISION,
  type BrowserProfileRuntimeSummary
} from '../../collector-extension/src/shared/control-plane';
import {
  COLLECTOR_CORE_VERSION,
  GET_CONTROL_SNAPSHOT
} from '../../collector-extension/src/shared/protocol';
import type { GatewayConfig } from './config';
import type { BrowserProfileRegistry } from './profiles';

export interface RunningExtensionProfile {
  context: BrowserContext;
  extensionId: string;
  extensionVersion: string;
  extensionAdoption: NonNullable<BrowserProfileRuntimeSummary['extensionAdoption']>;
  controlPage: Page | null;
  controlPagePromise: Promise<Page> | null;
  controlVerification: Promise<Page> | null;
}

interface ExtensionWorkerProbe {
  worker: Worker;
  extensionId: string;
  version: string;
}

const EXTENSION_WORKER_WAIT_MS = 15_000;
const EXTENSION_WORKER_RELOAD_WAIT_MS = 5_000;
const CONTROL_VERSION_WAIT_MS = 3_000;
const LOCAL_POLL_MS = 100;

async function extensionWorkerProbe(worker: Worker): Promise<ExtensionWorkerProbe | null> {
  const snapshot = await worker.evaluate(() => {
    const extensionGlobal = globalThis as typeof globalThis & {
      chrome: {
        runtime: {
          id: string;
          getManifest(): { version?: unknown };
        };
      };
    };
    return {
      extensionId: extensionGlobal.chrome.runtime.id,
      version: extensionGlobal.chrome.runtime.getManifest().version
    };
  }).catch(() => null);
  if (
    !snapshot ||
    typeof snapshot.extensionId !== 'string' ||
    !/^[a-p]{32}$/.test(snapshot.extensionId) ||
    typeof snapshot.version !== 'string'
  ) return null;
  return { worker, extensionId: snapshot.extensionId, version: snapshot.version };
}

async function waitForExtensionWorker(
  context: BrowserContext,
  timeoutMs: number,
  predicate: (probe: ExtensionWorkerProbe) => boolean = () => true
): Promise<ExtensionWorkerProbe | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    for (const worker of context.serviceWorkers()) {
      const probe = await extensionWorkerProbe(worker);
      if (probe && predicate(probe)) return probe;
    }
    await delay(LOCAL_POLL_MS);
  } while (Date.now() < deadline);
  return null;
}

async function adoptExtensionWorker(
  context: BrowserContext,
  expectedVersion: string
): Promise<{
  probe: ExtensionWorkerProbe;
  adoption: NonNullable<BrowserProfileRuntimeSummary['extensionAdoption']>;
}> {
  const initial = await waitForExtensionWorker(context, EXTENSION_WORKER_WAIT_MS);
  if (!initial) throw new Error('collector_extension_worker_missing');
  if (initial.version === expectedVersion) {
    return {
      probe: initial,
      adoption: {
        expectedVersion,
        initialVersion: initial.version,
        finalVersion: initial.version,
        runtimeReloadAttempted: false,
        chromeUiReloadAttempted: false,
        contextRestarted: false
      }
    };
  }

  await initial.worker.evaluate(() => {
    const extensionGlobal = globalThis as typeof globalThis & {
      chrome: { runtime: { reload(): void } };
    };
    extensionGlobal.chrome.runtime.reload();
  }).catch(() => undefined);
  const adopted = await waitForExtensionWorker(
    context,
    EXTENSION_WORKER_RELOAD_WAIT_MS,
    (probe) => probe.extensionId === initial.extensionId && probe.version === expectedVersion
  );
  if (!adopted) throw new Error('collector_extension_worker_version_mismatch');
  return {
    probe: adopted,
    adoption: {
      expectedVersion,
      initialVersion: initial.version,
      finalVersion: adopted.version,
      runtimeReloadAttempted: true,
      chromeUiReloadAttempted: false,
      contextRestarted: false
    }
  };
}

export async function extensionHasOrigins(page: Page, origins: readonly string[]): Promise<boolean> {
  return page.evaluate(async (requestedOrigins) => {
    const extensionGlobal = globalThis as typeof globalThis & {
      chrome: {
        permissions: {
          contains(permission: { origins: string[] }): Promise<boolean>;
        };
      };
    };
    return extensionGlobal.chrome.permissions.contains({ origins: requestedOrigins });
  }, [...origins]);
}

export async function extensionMessage(page: Page, message: object): Promise<unknown> {
  return page.evaluate(async (payload) => {
    const extensionGlobal = globalThis as typeof globalThis & {
      chrome: {
        runtime: {
          sendMessage(value: object): Promise<unknown>;
        };
      };
    };
    return extensionGlobal.chrome.runtime.sendMessage(payload);
  }, message);
}

export async function extensionStoredValidationRuns(page: Page, keyPrefix: string): Promise<unknown[]> {
  return page.evaluate(async (prefix) => {
    const extensionGlobal = globalThis as typeof globalThis & {
      chrome: {
        storage: {
          session: {
            get(key: null): Promise<Record<string, unknown>>;
          };
        };
      };
    };
    const stored = await extensionGlobal.chrome.storage.session.get(null);
    return Object.entries(stored)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value);
  }, keyPrefix);
}

export async function extensionControlSnapshot(page: Page): Promise<{
  pairing: { gatewayInstanceId: string } | null;
}> {
  const response = await extensionMessage(page, { type: GET_CONTROL_SNAPSHOT });
  if (!response || typeof response !== 'object') throw new Error('profile_control_snapshot_missing');
  const candidate = response as {
    ok?: unknown;
    snapshot?: { pairing?: { gatewayInstanceId?: unknown } | null };
  };
  if (candidate.ok !== true || !candidate.snapshot) throw new Error('profile_control_snapshot_missing');
  const pairing = candidate.snapshot.pairing;
  if (pairing === null || pairing === undefined) return { pairing: null };
  if (typeof pairing.gatewayInstanceId !== 'string') throw new Error('profile_control_snapshot_invalid');
  return { pairing: { gatewayInstanceId: pairing.gatewayInstanceId } };
}

export class ManagedExtensionRuntime {
  readonly #config: GatewayConfig;
  readonly #registry: BrowserProfileRegistry;
  readonly #running = new Map<string, RunningExtensionProfile>();
  readonly #launching = new Map<string, Promise<RunningExtensionProfile>>();

  constructor(config: GatewayConfig, registry: BrowserProfileRegistry) {
    this.#config = config;
    this.#registry = registry;
  }

  get(profileId: string): RunningExtensionProfile | undefined {
    return this.#running.get(profileId);
  }

  async launch(profileId: string): Promise<RunningExtensionProfile> {
    const pending = this.#launching.get(profileId);
    if (pending) return pending;
    const profile = this.#registry.get(profileId);
    const alreadyRunning = this.#running.get(profileId);
    if (alreadyRunning) return alreadyRunning;
    const activeProfileIds = [...this.#running.keys(), ...this.#launching.keys()];
    if (activeProfileIds.some((activeId) => this.#registry.get(activeId).platform === profile.platform)) {
      throw new Error('profile_platform_concurrency_rejected');
    }

    const operation = this.#launchProfile(profileId);
    this.#launching.set(profileId, operation);
    try {
      return await operation;
    } finally {
      this.#launching.delete(profileId);
    }
  }

  async controlPage(profileId: string): Promise<Page> {
    const running = this.#running.get(profileId);
    if (!running) throw new Error('profile_browser_not_running');
    return this.#ensureExtensionVersion(running, await this.#extensionControlPage(running));
  }

  async #launchProfile(profileId: string): Promise<RunningExtensionProfile> {
    const profile = this.#registry.get(profileId);
    const extensionDirectory = resolve(this.#config.extensionDirectory);
    await access(resolve(extensionDirectory, 'manifest.json'));
    const manifest = JSON.parse(await readFile(resolve(extensionDirectory, 'manifest.json'), 'utf8')) as {
      manifest_version?: unknown;
      version?: unknown;
    };
    if (
      manifest.manifest_version !== 3 ||
      typeof manifest.version !== 'string' ||
      manifest.version !== COLLECTOR_CORE_VERSION
    ) {
      throw new Error('collector_extension_artifact_invalid');
    }

    const context = await chromium.launchPersistentContext(
      this.#registry.userDataDirectory(profile.profileId),
      {
        channel: 'chromium',
        headless: false,
        args: [
          '--no-first-run',
          '--autoplay-policy=user-gesture-required',
          `--disable-extensions-except=${extensionDirectory}`,
          `--load-extension=${extensionDirectory}`
        ],
        ...(this.#config.proxyServer ? { proxy: { server: this.#config.proxyServer } } : {})
      }
    );
    try {
      const { probe, adoption } = await adoptExtensionWorker(context, manifest.version);
      const running: RunningExtensionProfile = {
        context,
        extensionId: probe.extensionId,
        extensionVersion: manifest.version,
        extensionAdoption: adoption,
        controlPage: null,
        controlPagePromise: null,
        controlVerification: null
      };
      this.#running.set(profile.profileId, running);
      context.on('close', () => this.#running.delete(profile.profileId));

      // Login state stays in browser storage, but restored web tabs are never
      // allowed to replay a platform visit after launch or crash recovery.
      await Promise.all(context.pages().filter((page) => {
        try {
          const protocol = new URL(page.url()).protocol;
          return protocol === 'http:' || protocol === 'https:';
        } catch {
          return false;
        }
      }).map((page) => page.close().catch(() => undefined)));

      const controlPage = await this.#ensureExtensionVersion(
        running,
        await this.#extensionControlPage(running)
      );
      await controlPage.bringToFront();
      await this.#registry.markLaunched(profile.profileId);
      return running;
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  async #extensionControlPage(running: RunningExtensionProfile): Promise<Page> {
    const expectedUrl = `chrome-extension://${running.extensionId}/control.html`;
    if (
      running.controlPage &&
      !running.controlPage.isClosed() &&
      running.controlPage.url() === expectedUrl
    ) return running.controlPage;
    if (running.controlPagePromise) return running.controlPagePromise;

    const pending = (async () => {
      const extensionPages = running.context.pages().filter((page) => {
        try {
          const url = new URL(page.url());
          return url.protocol === 'chrome-extension:' && url.host === running.extensionId;
        } catch {
          return false;
        }
      });
      const existing = extensionPages.find((page) => page.url() === expectedUrl) ?? null;
      await Promise.all(extensionPages.filter((page) => page !== existing)
        .map((page) => page.close().catch(() => undefined)));
      if (existing && !existing.isClosed()) {
        running.controlPage = existing;
        return existing;
      }

      const stale = running.controlPage;
      running.controlPage = null;
      if (stale && !stale.isClosed()) await stale.close().catch(() => undefined);
      const reusableBlank = running.context.pages().find((page) => page.url() === 'about:blank') ?? null;
      const page = reusableBlank ?? await running.context.newPage();
      try {
        await page.goto(expectedUrl);
        running.controlPage = page;
        return page;
      } catch (error) {
        await page.close().catch(() => undefined);
        throw error;
      }
    })();
    running.controlPagePromise = pending;
    try {
      return await pending;
    } finally {
      if (running.controlPagePromise === pending) running.controlPagePromise = null;
    }
  }

  async #ensureExtensionVersion(
    running: RunningExtensionProfile,
    initialPage: Page
  ): Promise<Page> {
    if (running.controlVerification) return running.controlVerification;
    const pending = this.#ensureExtensionVersionOnce(running, initialPage);
    running.controlVerification = pending;
    try {
      return await pending;
    } finally {
      if (running.controlVerification === pending) running.controlVerification = null;
    }
  }

  async #ensureExtensionVersionOnce(
    running: RunningExtensionProfile,
    initialPage: Page
  ): Promise<Page> {
    const deadline = Date.now() + CONTROL_VERSION_WAIT_MS;
    do {
      try {
        const response = await extensionMessage(initialPage, { type: GET_CONTROL_SNAPSHOT });
        if (response && typeof response === 'object') {
          const probe = response as {
            ok?: unknown;
            snapshot?: {
              collectorVersion?: unknown;
              controlSurfaceRevision?: unknown;
            };
          };
          if (
            probe.ok === true &&
            probe.snapshot?.collectorVersion === running.extensionVersion &&
            probe.snapshot.controlSurfaceRevision === COLLECTOR_CONTROL_SURFACE_REVISION
          ) return initialPage;
        }
      } catch {
        // Readiness is local and bounded; launch never opens recovery tabs.
      }
      await delay(LOCAL_POLL_MS);
    } while (Date.now() < deadline);
    throw new Error('validation_control_version_mismatch');
  }

  async close(profileId: string): Promise<void> {
    const pending = this.#launching.get(profileId);
    if (pending) await pending.catch(() => undefined);
    const running = this.#running.get(profileId);
    if (!running) return;
    this.#running.delete(profileId);
    await running.context.close();
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.#launching.values()].map((pending) => pending.catch(() => undefined)));
    const running = [...this.#running.values()];
    this.#running.clear();
    await Promise.all(running.map((profile) => profile.context.close().catch(() => undefined)));
  }
}
