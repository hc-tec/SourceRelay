import {
  BrowserHostError,
  VALIDATION_EXTENSION_CONTROL_SCHEMA_VERSION,
  validationExtensionControlRequest,
  type ValidationExtensionControlRequest,
  type ValidationExtensionControlResult
} from '@intelligence/collector-contracts';
import type { BrowserContext, Page } from 'playwright';
import { hostError } from './host-errors.js';

const CONTROL_TARGET_TIMEOUT_MS = 20_000;
const BROWSER_BINDING_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

/**
 * Exercise the real extension control page inside the long-lived validation
 * browser without opening an arbitrary target or exposing arbitrary
 * Playwright/CDP execution through Host IPC.
 *
 * The target is created as a background extension page, always uses the
 * fixed production form controls below, and is closed before the result is
 * returned.  It performs no platform navigation or page interaction.
 */
export async function runValidationExtensionControl(input: {
  context: BrowserContext;
  profileId: string;
  extensionId: string;
  request: ValidationExtensionControlRequest;
}): Promise<ValidationExtensionControlResult> {
  const request = validationExtensionControlRequest(input.request);
  if (request.profileId !== input.profileId) {
    throw hostError({
      code: 'validation_extension_control_profile_mismatch',
      category: 'validation',
      scope: 'profile',
      retryClass: 'never',
      safeDetails: { profileId: input.profileId }
    });
  }
  if (!/^[a-p]{32}$/.test(input.extensionId)) {
    throw hostError({
      code: 'validation_extension_control_extension_identity_invalid',
      category: 'extension_runtime',
      scope: 'browser_session',
      retryClass: 'never'
    });
  }

  const controlUrl = `chrome-extension://${input.extensionId}/control.html`;
  if (input.context.pages().some((page) => page.url() === controlUrl)) {
    throw hostError({
      code: 'validation_extension_control_target_already_open',
      category: 'validation',
      scope: 'browser_session',
      retryClass: 'local_query_only'
    });
  }
  const browser = input.context.browser();
  if (!browser) {
    throw hostError({
      code: 'validation_extension_control_browser_unavailable',
      category: 'browser_session',
      scope: 'browser_session',
      retryClass: 'local_query_only'
    });
  }

  const browserSession = await browser.newBrowserCDPSession();
  let controlPage: Page | null = null;
  let failure: unknown = null;
  let result: Omit<ValidationExtensionControlResult, 'controlTargetDisposed'> | null = null;
  try {
    const controlPagePromise = input.context.waitForEvent('page', { timeout: CONTROL_TARGET_TIMEOUT_MS });
    await browserSession.send('Target.createTarget', { url: controlUrl, background: true });
    controlPage = await controlPagePromise;
    await controlPage.waitForURL(controlUrl, { timeout: CONTROL_TARGET_TIMEOUT_MS });
    await controlPage.locator('input[name="loopbackOrigin"]').fill(request.loopbackOrigin);
    await controlPage.locator('input[name="identityFingerprint"]').fill(request.identityFingerprint);
    await controlPage.locator('input[name="pairingSessionId"]').fill(request.pairingSessionId);
    await controlPage.locator('input[name="pairingCode"]').fill(request.pairingCode);
    await controlPage.locator('#pair-gateway button[type="submit"]').click();

    const gatewayState = controlPage.locator('#gateway-state');
    await gatewayState.filter({ hasText: '已连接' }).waitFor({
      state: 'visible',
      timeout: CONTROL_TARGET_TIMEOUT_MS
    });
    const bindingText = await gatewayState.textContent();
    const browserBindingId = bindingText?.match(BROWSER_BINDING_ID)?.[0] ?? null;
    if (!browserBindingId) {
      throw hostError({
        code: 'validation_extension_control_binding_missing',
        category: 'extension_runtime',
        scope: 'browser_session',
        retryClass: 'local_query_only'
      });
    }

    if (request.selection === 'bilibili_discussion_current_active_tab') {
      const discussionButton = controlPage.locator('#select-current-bilibili-video-discussion');
      await discussionButton.click();
      await controlPage.locator('#user-selected-discussion-tab-state').filter({
        hasText: '当前已加载评论的视频页已显式选择'
      }).waitFor({ state: 'visible', timeout: CONTROL_TARGET_TIMEOUT_MS });
    }

    result = {
      schemaVersion: VALIDATION_EXTENSION_CONTROL_SCHEMA_VERSION,
      profileId: input.profileId,
      browserBindingId,
      connectionState: 'online',
      discussionSelection: request.selection === 'bilibili_discussion_current_active_tab'
        ? 'available'
        : 'not_requested'
    };
  } catch (error) {
    failure = error instanceof BrowserHostError
      ? error
      : await controlFailure(controlPage, input.profileId);
  }

  const disposed = await disposeControlTarget(input.context, controlPage, controlUrl);
  await browserSession.detach().catch(() => undefined);
  if (!disposed) {
    throw hostError({
      code: 'validation_extension_control_target_cleanup_failed',
      category: 'validation',
      scope: 'browser_session',
      retryClass: 'local_query_only'
    });
  }
  if (failure) throw failure;
  if (!result) {
    throw hostError({
      code: 'validation_extension_control_result_missing',
      category: 'validation',
      scope: 'browser_session',
      retryClass: 'local_query_only'
    });
  }
  return { ...result, controlTargetDisposed: true };
}

async function controlFailure(page: Page | null, profileId: string): Promise<BrowserHostError> {
  const visibleError = page
    ? await page.locator('#control-error').textContent().catch(() => null)
    : null;
  const code = typeof visibleError === 'string' && /^[a-z0-9_.-]{1,120}$/i.test(visibleError)
    ? visibleError
    : 'validation_extension_control_execution_failed';
  return hostError({
    code,
    category: 'extension_runtime',
    scope: 'browser_session',
    retryClass: 'local_query_only',
    safeDetails: { profileId, controlTarget: 'background_extension_page' }
  });
}

async function disposeControlTarget(context: BrowserContext, opened: Page | null, controlUrl: string): Promise<boolean> {
  const pages = new Set<Page>(opened ? [opened] : []);
  for (const page of context.pages()) {
    if (page.url() === controlUrl) pages.add(page);
  }
  try {
    for (const page of pages) {
      if (!page.isClosed()) await page.close({ runBeforeUnload: false });
    }
    return !context.pages().some((page) => page.url() === controlUrl && !page.isClosed());
  } catch {
    return false;
  }
}
