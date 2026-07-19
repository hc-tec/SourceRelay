import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import {
  COLLECTOR_CONTROL_SURFACE_REVISION
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
  controlPage: Page | null;
  controlPagePromise: Promise<Page> | null;
  versionRecovery: Promise<Page> | null;
}

async function waitForExtensionWorker(context: BrowserContext) {
  const existing = context.serviceWorkers();
  if (existing.length > 0) return existing[0];
  return context.waitForEvent('serviceworker', { timeout: 15_000 });
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

async function reloadExtension(page: Page): Promise<void> {
  await page.evaluate(() => {
    const extensionGlobal = globalThis as typeof globalThis & {
      chrome: { runtime: { reload(): void } };
    };
    extensionGlobal.chrome.runtime.reload();
  }).catch(() => undefined);
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

    const operation = this.#launchProfileWithRecovery(profileId);
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

  async #launchProfileWithRecovery(profileId: string): Promise<RunningExtensionProfile> {
    try {
      return await this.#launchProfile(profileId);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code !== 'validation_extension_ui_reload_failed' && code !== 'validation_control_version_mismatch') {
        throw error;
      }
      // A changed unpacked extension may be adopted only after the persistent
      // context exits. This one local recovery never navigates to a platform.
      return this.#launchProfile(profileId);
    }
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
      const worker = await waitForExtensionWorker(context);
      const extensionId = new URL(worker.url()).host;
      if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('collector_extension_id_invalid');
      const running: RunningExtensionProfile = {
        context,
        extensionId,
        extensionVersion: manifest.version,
        controlPage: null,
        controlPagePromise: null,
        versionRecovery: null
      };
      this.#running.set(profile.profileId, running);
      context.on('close', () => this.#running.delete(profile.profileId));
      await this.#registry.markLaunched(profile.profileId);

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
    if (running.versionRecovery) return running.versionRecovery;
    const pending = this.#ensureExtensionVersionOnce(running, initialPage);
    running.versionRecovery = pending;
    try {
      return await pending;
    } finally {
      if (running.versionRecovery === pending) running.versionRecovery = null;
    }
  }

  async #ensureExtensionVersionOnce(
    running: RunningExtensionProfile,
    initialPage: Page
  ): Promise<Page> {
    let page = initialPage;
    let unpackedReloadFailed = false;
    for (let attempt = 0; attempt < 31; attempt += 1) {
      try {
        const response = await extensionMessage(page, { type: GET_CONTROL_SNAPSHOT });
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
          ) return page;
        }
      } catch {
        // The control page may disappear while the MV3 worker reloads.
      }
      if (attempt === 0) await reloadExtension(page);
      if (attempt === 10) {
        try {
          await this.#reloadUnpackedExtensionFromChromeUi(running);
        } catch {
          unpackedReloadFailed = true;
        }
      }
      await delay(500);
      try {
        page = await this.#extensionControlPage(running);
      } catch {
        // The extension origin is briefly unavailable during replacement.
      }
    }
    throw new Error(
      unpackedReloadFailed
        ? 'validation_extension_ui_reload_failed'
        : 'validation_control_version_mismatch'
    );
  }

  async #reloadUnpackedExtensionFromChromeUi(running: RunningExtensionProfile): Promise<void> {
    const page = await running.context.newPage();
    try {
      await page.goto('chrome://extensions/');
      const extension = page.locator(`extensions-item#${running.extensionId}`);
      await extension.locator('#dev-reload-button').click({ timeout: 10_000 });
    } catch {
      throw new Error('validation_extension_ui_reload_failed');
    } finally {
      await page.close().catch(() => undefined);
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
    await Promise.all(running.map((profile) => profile.context.close().catch(() => undefined)));
  }
}
