import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

async function waitForServiceWorker(context) {
  const existing = context.serviceWorkers();
  if (existing.length > 0) return existing[0];
  return context.waitForEvent('serviceworker', { timeout: 15_000 });
}

async function launch(extensionPath, userDataDirectory, headless, onContext) {
  const context = await chromium.launchPersistentContext(userDataDirectory, {
    channel: 'chromium',
    headless,
    args: [
      '--disable-background-networking',
      '--no-first-run',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  await onContext?.(context);
  return context;
}

export async function launchProductionExtension(extensionPath, temporaryPrefix, options = {}) {
  await access(extensionPath);
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), temporaryPrefix));
  let context;
  try {
    if (options.forceHeaded === true) {
      context = await launch(extensionPath, userDataDirectory, false, options.onContext);
      const worker = await waitForServiceWorker(context);
      return {
        context,
        worker,
        userDataDirectory,
        mode: 'headed',
        async close() {
          await context?.close().catch(() => undefined);
          await rm(userDataDirectory, { recursive: true, force: true });
        }
      };
    }
    try {
      context = await launch(extensionPath, userDataDirectory, true, options.onContext);
      const worker = await waitForServiceWorker(context);
      return {
        context,
        worker,
        userDataDirectory,
        mode: 'headless',
        async close() {
          await context?.close().catch(() => undefined);
          await rm(userDataDirectory, { recursive: true, force: true });
        }
      };
    } catch (headlessError) {
      await context?.close().catch(() => undefined);
      // A short-lived visible fallback is not an acceptable default test
      // behavior.  It looks like an unexplained browser/tab flash and can be
      // mistaken for product automation.  Real headed validation belongs only
      // to the long-lived, explicitly started validation-browser fixture.
      throw new Error(
        'production_extension_headless_load_failed_visible_fallback_disabled',
        { cause: headlessError }
      );
    }
  } catch (error) {
    await rm(userDataDirectory, { recursive: true, force: true });
    throw error;
  }
}
