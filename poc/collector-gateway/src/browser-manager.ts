import { createHash, randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { BrowserProfileRuntimeSummary } from '../../collector-extension/src/shared/control-plane';
import {
  COLLECTOR_CORE_VERSION,
  type CapabilityValidationRunSnapshot
} from '../../collector-extension/src/shared/protocol';
import { resolveNativeSearchStrategy } from '../../collector-extension/src/shared/strategy-registry';
import type { GatewayConfig } from './config';
import type { BrowserProfileRegistry } from './profiles';

interface RunningProfile {
  context: BrowserContext;
  extensionId: string;
  extensionVersion: string;
}

async function waitForExtensionWorker(context: BrowserContext) {
  const existing = context.serviceWorkers();
  if (existing.length > 0) return existing[0];
  return context.waitForEvent('serviceworker', { timeout: 15_000 });
}

async function extensionHasOrigins(page: Page, origins: readonly string[]): Promise<boolean> {
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

async function extensionMessage(page: Page, message: object): Promise<unknown> {
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

async function reloadExtension(page: Page): Promise<void> {
  await page.evaluate(() => {
    const extensionGlobal = globalThis as typeof globalThis & {
      chrome: { runtime: { reload(): void } };
    };
    extensionGlobal.chrome.runtime.reload();
  }).catch(() => undefined);
}

async function extensionStoredValidationRuns(page: Page): Promise<unknown[]> {
  return page.evaluate(async () => {
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
      .filter(([key]) => key.startsWith('collector.capability-validation.'))
      .map(([, value]) => value);
  });
}

function validationSnapshot(
  value: unknown,
  runId: string,
  profileId: string,
  extensionVersion: string
): CapabilityValidationRunSnapshot {
  if (!value || typeof value !== 'object') throw new Error('validation_extension_response_missing');
  const response = value as { ok?: unknown; validation?: unknown; error?: unknown };
  if (response.ok !== true) {
    const error = typeof response.error === 'string' && /^[a-z0-9_]{1,100}$/.test(response.error)
      ? response.error
      : 'validation_extension_rejected';
    throw new Error(error);
  }
  if (!response.validation || typeof response.validation !== 'object') {
    throw new Error('validation_extension_snapshot_missing');
  }
  const validation = response.validation as Partial<CapabilityValidationRunSnapshot>;
  if (validation.schemaVersion !== 1) throw new Error('validation_extension_schema_mismatch');
  if (validation.collectorVersion !== extensionVersion) throw new Error('validation_extension_version_mismatch');
  if (validation.runId !== runId) throw new Error('validation_extension_run_mismatch');
  if (validation.profileId !== profileId) throw new Error('validation_extension_profile_mismatch');
  if (validation.platform !== 'bilibili') throw new Error('validation_extension_platform_mismatch');
  if (validation.accountCategory !== 'anonymous') throw new Error('validation_extension_account_mismatch');
  if (typeof validation.state !== 'string') throw new Error('validation_extension_state_invalid');
  return validation as CapabilityValidationRunSnapshot;
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

  async runBilibiliAnonymousValidation(
    profileId: string,
    rawQuery: string,
    knownRunIds: ReadonlySet<string> = new Set()
  ): Promise<CapabilityValidationRunSnapshot> {
    const profile = this.#registry.get(profileId);
    if (profile.kind !== 'validation') throw new Error('validation_profile_kind_required');
    if (profile.platform !== 'bilibili') throw new Error('validation_profile_platform_mismatch');
    if (profile.account.category !== 'anonymous') throw new Error('validation_profile_anonymous_required');
    const query = rawQuery.replace(/\s+/g, ' ').trim();
    if (!query || query.length > 200) throw new Error('validation_query_invalid');

    await this.launch(profileId);
    const running = this.#running.get(profileId);
    if (!running) throw new Error('validation_browser_not_running');
    const controlPage = await this.#ensureExtensionVersion(
      running,
      await this.#extensionControlPage(running)
    );
    const queryDigest = createHash('sha256').update(query).digest('hex');
    const recoverable: CapabilityValidationRunSnapshot[] = [];
    for (const candidate of await extensionStoredValidationRuns(controlPage)) {
      if (!candidate || typeof candidate !== 'object') continue;
      const partial = candidate as Partial<CapabilityValidationRunSnapshot>;
      if (
        typeof partial.runId !== 'string' ||
        knownRunIds.has(partial.runId) ||
        partial.queryDigest !== queryDigest ||
        (partial.state !== 'completed' && partial.state !== 'inconclusive' && partial.state !== 'failed')
      ) {
        continue;
      }
      try {
        recoverable.push(validationSnapshot(
          { ok: true, validation: candidate },
          partial.runId,
          profileId,
          running.extensionVersion
        ));
      } catch {
        // Invalid session values are never returned to the Gateway registry.
      }
    }
    recoverable.sort((left, right) => Date.parse(right.completedAt ?? '') - Date.parse(left.completedAt ?? ''));
    if (recoverable[0]) return recoverable[0];

    const strategy = resolveNativeSearchStrategy('bilibili');
    if (!(await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions))) {
      await controlPage.bringToFront();
      const card = controlPage.locator('[data-platform="bilibili"]');
      await card.getByRole('button', { name: '授予站点权限' }).click({ timeout: 15_000 });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions)) break;
        await delay(500);
      }
      if (!(await extensionHasOrigins(controlPage, strategy.browser.optionalHostPermissions))) {
        throw new Error('validation_host_permission_user_action_required');
      }
    }

    const runId = randomUUID();
    let snapshot = validationSnapshot(await extensionMessage(controlPage, {
      type: 'collector.startCapabilityValidation',
      runId,
      profileId,
      platform: 'bilibili',
      accountCategory: 'anonymous',
      query
    }), runId, profileId, running.extensionVersion);

    for (let attempt = 0; attempt < 70; attempt += 1) {
      if (snapshot.state === 'completed' || snapshot.state === 'inconclusive' || snapshot.state === 'failed') {
        return snapshot;
      }
      await delay(500);
      snapshot = validationSnapshot(await extensionMessage(controlPage, {
        type: 'collector.getCapabilityValidation',
        runId
      }), runId, profileId, running.extensionVersion);
    }
    throw new Error('validation_gateway_wait_timed_out');
  }

  async #launchProfile(profileId: string): Promise<BrowserProfileRuntimeSummary> {
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
      this.#running.set(profile.profileId, { context, extensionId, extensionVersion: manifest.version });
      context.on('close', () => this.#running.delete(profile.profileId));
      await this.#registry.markLaunched(profile.profileId);

      let page = context.pages()[0] ?? await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/control.html`);
      page = await this.#ensureExtensionVersion(this.#running.get(profile.profileId)!, page);
      await page.bringToFront();
      return (await this.list()).find((summary) => summary.profile.profileId === profileId)!;
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  async #extensionControlPage(running: RunningProfile): Promise<Page> {
    const existing = running.context.pages().find((page) => {
      try {
        return new URL(page.url()).host === running.extensionId && new URL(page.url()).pathname === '/control.html';
      } catch {
        return false;
      }
    });
    if (existing) return existing;
    const page = await running.context.newPage();
    await page.goto(`chrome-extension://${running.extensionId}/control.html`);
    return page;
  }

  async #ensureExtensionVersion(running: RunningProfile, initialPage: Page): Promise<Page> {
    let page = initialPage;
    for (let attempt = 0; attempt < 31; attempt += 1) {
      try {
        const response = await extensionMessage(page, { type: 'collector.getControlSnapshot' });
        if (response && typeof response === 'object') {
          const probe = response as { ok?: unknown; snapshot?: { collectorVersion?: unknown } };
          if (probe.ok === true && probe.snapshot?.collectorVersion === running.extensionVersion) return page;
        }
      } catch {
        // A control page is expected to disappear while chrome.runtime.reload
        // replaces the extension service worker.
      }
      if (attempt === 0) await reloadExtension(page);
      if (attempt === 10) await this.#reloadUnpackedExtensionFromChromeUi(running);
      await delay(500);
      try {
        page = await this.#extensionControlPage(running);
      } catch {
        // The extension origin can be briefly unavailable while Chrome
        // replaces the unpacked extension service worker and pages.
      }
    }
    throw new Error('validation_control_version_mismatch');
  }

  async #reloadUnpackedExtensionFromChromeUi(running: RunningProfile): Promise<void> {
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
    await Promise.all(running.map(({ context }) => context.close().catch(() => undefined)));
  }
}
