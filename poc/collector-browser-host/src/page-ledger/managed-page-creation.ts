import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserContext, Page } from 'playwright';
import { hostError } from '../host-errors.js';
import { targetIdForPage } from './page-record.js';

export interface CreatedManagedPage {
  page: Page;
  targetId: string;
  extensionTabId: number | null;
}

export async function createManagedPage(
  context: BrowserContext,
  listExtensionTabIds: (() => Promise<readonly number[]>) | null
): Promise<CreatedManagedPage> {
  const tabIdsBefore = listExtensionTabIds
    ? new Set(await listExtensionTabIds())
    : null;
  const page = await context.newPage();
  try {
    const targetId = await targetIdForPage(page);
    const extensionTabId = tabIdsBefore && listExtensionTabIds
      ? await resolveCreatedExtensionTab(tabIdsBefore, listExtensionTabIds)
      : null;
    if (tabIdsBefore && extensionTabId === null) {
      throw hostError({
        code: 'extension_tab_binding_unavailable',
        category: 'extension_runtime',
        scope: 'page',
        pageDisposition: 'closed'
      });
    }
    return { page, targetId, extensionTabId };
  } catch (error) {
    if (page.url() === 'about:blank') await page.close().catch(() => undefined);
    throw error;
  }
}

async function resolveCreatedExtensionTab(
  tabIdsBefore: ReadonlySet<number>,
  listExtensionTabIds: () => Promise<readonly number[]>
): Promise<number | null> {
  const deadline = Date.now() + 2_000;
  do {
    const candidates = (await listExtensionTabIds()).filter((tabId) => !tabIdsBefore.has(tabId));
    if (candidates.length === 1) return candidates[0] ?? null;
    if (candidates.length > 1) {
      throw hostError({
        code: 'extension_tab_binding_ambiguous',
        category: 'extension_runtime',
        scope: 'page',
        pageDisposition: 'closed'
      });
    }
    await delay(50);
  } while (Date.now() < deadline);
  return null;
}
