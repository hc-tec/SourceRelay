import type { Page } from 'playwright';
import { hostError } from '../host-errors.js';

/**
 * A platform page that is merely open is not necessarily allowed to finish
 * loading. Several first-party sites intentionally defer expensive content
 * while a tab is backgrounded. Make browser-tab visibility an internal
 * precondition before the Browser Host records any navigation action.
 *
 * This only operates on the Page already owned by a valid lease. It does not
 * focus the operating-system window and does not create an externally exposed
 * arbitrary-tab control surface.
 */
export async function ensureManagedPageForeground(page: Page): Promise<void> {
  try {
    await page.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'visible', undefined, {
      timeout: 5_000
    });
  } catch (error) {
    throw hostError({
      code: 'managed_page_foreground_unavailable',
      category: 'browser_lifecycle',
      scope: 'page',
      retryClass: 'local_query_only',
      safeDetails: { errorType: error instanceof Error ? error.name : 'unknown' }
    });
  }
}
