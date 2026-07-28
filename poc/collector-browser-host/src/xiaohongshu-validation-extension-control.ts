import {
  BrowserHostError,
  isXiaohongshuCurrentPageNetworkValidationControlResult,
  xiaohongshuCurrentPageNetworkValidationControlRequest,
  type XiaohongshuCurrentPageNetworkValidationControlRequest,
  type XiaohongshuCurrentPageNetworkValidationControlResult
} from '@intelligence/collector-contracts';
import type { BrowserContext, Page } from 'playwright';
import { hostError } from './host-errors.js';

const CONTROL_TARGET_TIMEOUT_MS = 90_000;

/**
 * Exercise one fixed button in the real extension control page. This is not
 * a generic extension-page runner: callers cannot provide a URL, selector,
 * script, tab, document, permission scope or platform action.
 *
 * If Chrome shows its optional-permission dialog, the control page remains
 * alive until that exact native prompt is resolved or this bounded local
 * deadline expires. No platform page is opened or manipulated.
 */
export async function runXiaohongshuCurrentPageNetworkValidationControl(input: {
  context: BrowserContext;
  profileId: string;
  extensionId: string;
  request: XiaohongshuCurrentPageNetworkValidationControlRequest;
}): Promise<XiaohongshuCurrentPageNetworkValidationControlResult> {
  const request = xiaohongshuCurrentPageNetworkValidationControlRequest(input.request);
  if (request.profileId !== input.profileId) {
    throw hostError({
      code: 'xiaohongshu_validation_extension_control_profile_mismatch',
      category: 'validation',
      scope: 'profile',
      retryClass: 'never',
      safeDetails: { profileId: input.profileId }
    });
  }
  if (!/^[a-p]{32}$/.test(input.extensionId)) {
    throw hostError({
      code: 'xiaohongshu_validation_extension_control_extension_identity_invalid',
      category: 'extension_runtime',
      scope: 'browser_session',
      retryClass: 'never'
    });
  }

  const controlUrl = `chrome-extension://${input.extensionId}/control.html`;
  if (input.context.pages().some((page) => page.url() === controlUrl)) {
    throw hostError({
      code: 'xiaohongshu_validation_extension_control_target_already_open',
      category: 'validation',
      scope: 'browser_session',
      retryClass: 'local_query_only'
    });
  }
  const browser = input.context.browser();
  if (!browser) {
    throw hostError({
      code: 'xiaohongshu_validation_extension_control_browser_unavailable',
      category: 'browser_session',
      scope: 'browser_session',
      retryClass: 'local_query_only'
    });
  }

  const browserSession = await browser.newBrowserCDPSession();
  let controlPage: Page | null = null;
  let failure: unknown = null;
  let result: XiaohongshuCurrentPageNetworkValidationControlResult | null = null;
  try {
    const controlPagePromise = input.context.waitForEvent('page', { timeout: CONTROL_TARGET_TIMEOUT_MS });
    await browserSession.send('Target.createTarget', { url: controlUrl, background: true });
    controlPage = await controlPagePromise;
    await controlPage.waitForURL(controlUrl, { timeout: CONTROL_TARGET_TIMEOUT_MS });
    await controlPage.locator('html[data-collector-control-ready="true"]').waitFor({
      state: 'attached',
      timeout: CONTROL_TARGET_TIMEOUT_MS
    });
    await controlPage.locator('#arm-next-xiaohongshu-current-page-network').click();
    await controlPage.locator('#xiaohongshu-current-page-network-state').filter({
      hasText: '已预置下一次同 tab 手动导航'
    }).waitFor({ state: 'visible', timeout: CONTROL_TARGET_TIMEOUT_MS });
    result = {
      schemaVersion: 1,
      profileId: request.profileId,
      selectionState: 'armed_next_document',
      controlTargetDisposed: true
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
      code: 'xiaohongshu_validation_extension_control_target_cleanup_failed',
      category: 'validation',
      scope: 'browser_session',
      retryClass: 'local_query_only'
    });
  }
  if (failure) throw failure;
  if (!result || !isXiaohongshuCurrentPageNetworkValidationControlResult(result)) {
    throw hostError({
      code: 'xiaohongshu_validation_extension_control_result_missing',
      category: 'validation',
      scope: 'browser_session',
      retryClass: 'local_query_only'
    });
  }
  return result;
}

async function controlFailure(page: Page | null, profileId: string): Promise<BrowserHostError> {
  const visibleError = page
    ? await page.locator('#control-error').textContent().catch(() => null)
    : null;
  const code = typeof visibleError === 'string' && /^[a-z0-9_.-]{1,120}$/i.test(visibleError)
    ? visibleError
    : 'xiaohongshu_validation_extension_control_execution_failed';
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
