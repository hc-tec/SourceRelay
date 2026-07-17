import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import type { BrowserProfileRuntimeSummary } from '../../collector-extension/src/shared/control-plane';
import type { GatewayConfig } from './config';
import type { BrowserProfileRegistry } from './profiles';

interface RunningProfile {
  context: BrowserContext;
  extensionId: string;
}

async function waitForExtensionWorker(context: BrowserContext) {
  const existing = context.serviceWorkers();
  if (existing.length > 0) return existing[0];
  return context.waitForEvent('serviceworker', { timeout: 15_000 });
}

export class CollectionBrowserManager {
  readonly #config: GatewayConfig;
  readonly #registry: BrowserProfileRegistry;
  readonly #running = new Map<string, RunningProfile>();
  readonly #launching = new Map<string, Promise<BrowserProfileRuntimeSummary>>();

  constructor(config: GatewayConfig, registry: BrowserProfileRegistry) {
    this.#config = config;
    this.#registry = registry;
  }

  async list(): Promise<BrowserProfileRuntimeSummary[]> {
    const summaries: BrowserProfileRuntimeSummary[] = [];
    for (const profile of this.#registry.list()) {
      const running = this.#running.get(profile.profileId);
      let extensionPaired = false;
      if (running) {
        const extensionPage = running.context.pages().find((page) => {
          try {
            return new URL(page.url()).host === running.extensionId;
          } catch {
            return false;
          }
        });
        const extensionRuntime = extensionPage ?? running.context.serviceWorkers()[0];
        if (extensionRuntime) {
          extensionPaired = await extensionRuntime.evaluate(async () => {
            const extensionGlobal = globalThis as typeof globalThis & {
              chrome: {
                storage: {
                  local: {
                    get(key: string): Promise<Record<string, unknown>>;
                  };
                };
              };
            };
            const key = 'collector.gateway-pairing.v1';
            return Boolean((await extensionGlobal.chrome.storage.local.get(key))[key]);
          }).catch(() => false);
        }
      }
      summaries.push({
        profile,
        running: Boolean(running),
        extensionLoaded: Boolean(running),
        extensionPaired
      });
    }
    return summaries;
  }

  async launch(profileId: string): Promise<BrowserProfileRuntimeSummary> {
    const pending = this.#launching.get(profileId);
    if (pending) return pending;
    const profile = this.#registry.get(profileId);
    const alreadyRunning = this.#running.get(profileId);
    if (alreadyRunning) return (await this.list()).find((summary) => summary.profile.profileId === profileId)!;
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

  async #launchProfile(profileId: string): Promise<BrowserProfileRuntimeSummary> {
    const profile = this.#registry.get(profileId);

    const extensionDirectory = resolve(this.#config.extensionDirectory);
    await access(resolve(extensionDirectory, 'manifest.json'));
    const manifest = JSON.parse(await readFile(resolve(extensionDirectory, 'manifest.json'), 'utf8')) as { manifest_version?: unknown };
    if (manifest.manifest_version !== 3) throw new Error('collector_extension_artifact_invalid');

    const context = await chromium.launchPersistentContext(
      this.#registry.userDataDirectory(profile.profileId),
      {
        channel: 'chromium',
        headless: false,
        args: [
          '--no-first-run',
          `--disable-extensions-except=${extensionDirectory}`,
          `--load-extension=${extensionDirectory}`
        ],
        ...(this.#config.proxyServer ? { proxy: { server: this.#config.proxyServer } } : {})
      }
    );
    try {
      const worker = await waitForExtensionWorker(context);
      const extensionId = new URL(worker.url()).host;
      if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('collector_extension_id_invalid');
      this.#running.set(profile.profileId, { context, extensionId });
      context.on('close', () => this.#running.delete(profile.profileId));
      await this.#registry.markLaunched(profile.profileId);

      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/control.html`);
      await page.bringToFront();
      return (await this.list()).find((summary) => summary.profile.profileId === profileId)!;
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
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
    await Promise.all(running.map(({ context }) => context.close().catch(() => undefined)));
  }
}
