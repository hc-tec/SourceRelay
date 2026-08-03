import {
  canonicalBilibiliAccountProfileUrl,
  canonicalBilibiliAccountVideoInventoryUrl,
  canonicalBilibiliCollectionSeriesDetailWorkUrl,
  canonicalBilibiliCollectionSeriesOverviewWorkUrl,
  canonicalBilibiliDynamicWorkUrl,
  canonicalBilibiliNativeSearchUrl,
  canonicalBilibiliPassiveVideoWorkUrl,
  canonicalBilibiliVideoWorkUrl,
  bilibiliNativeSearchBatchTargetUrl,
  extensionWorkTargetUrl,
  isBilibiliNativeSearchBatchWorkItem,
  isExtensionWorkItem,
  type BilibiliNativeSearchBatchPageNumber,
  type BilibiliNativeSearchBatchWorkItem,
  type ExtensionWorkItem
} from '@intelligence/collector-contracts';

export type WorkTabAcquisition = 'created' | 'reused';
export type WorkTabDisposition = 'idle_reusable' | 'retained_not_reusable' | 'user_taken_over' | 'closed_or_missing';

export interface ExtensionWorkTabLease {
  leaseId: string;
  tabId: number;
  acquisition: WorkTabAcquisition;
}

interface ManagedWorkTab {
  tabId: number;
  windowId: number;
  state: 'idle_reusable' | 'leased';
  leaseId: string | null;
  expectedCanonicalUrl: string | null;
  expectedNavigationUntil: number | null;
  /**
   * The extension must distinguish its own one-time foreground transition
   * from a person selecting a managed tab. Chrome's activation event has no
   * initiator, so retain this very short acknowledgement window only around
   * the internal `tabs.update({ active: true })` call.
   */
  expectedForegroundActivationUntil: number | null;
  initialBlankNavigationUntil: number;
}

const managedTabs = new Map<number, ManagedWorkTab>();
const leaseLosses = new Map<string, Exclude<WorkTabDisposition, 'idle_reusable'>>();
let listenersInitialised = false;
const FOREGROUND_ACTIVATION_GRACE_MS = 2_000;
const FOREGROUND_SETTLE_MS = 350;

/**
 * Only tabs created by this module enter `managedTabs`.  There is no tab
 * inventory, no persistent tab identity, and no path that can adopt a normal
 * user tab after the worker starts or restarts.
 */
export function initialiseExtensionWorkTabs(): void {
  if (listenersInitialised) return;
  listenersInitialised = true;
  chrome.tabs.onRemoved.addListener((tabId) => forgetTab(tabId, 'closed_or_missing'));
  chrome.tabs.onMoved.addListener((tabId) => forgetTab(tabId, 'user_taken_over'));
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    const activated = managedTabs.get(tabId);
    const foregroundActivationExpected = activated?.expectedForegroundActivationUntil !== null &&
      activated?.expectedForegroundActivationUntil !== undefined &&
      Date.now() <= activated.expectedForegroundActivationUntil;
    const navigationActivationExpected = activated?.expectedNavigationUntil !== null &&
      activated?.expectedNavigationUntil !== undefined &&
      Date.now() <= activated.expectedNavigationUntil;
    if (activated && activated.state === 'leased' && activated.windowId === windowId &&
      (foregroundActivationExpected || navigationActivationExpected)) {
      // Chromium may emit the same-tab activation more than once while the
      // extension foregrounds and navigates its lease. Keep the acknowledgement
      // window alive for that bounded internal phase. Activating any other tab
      // still loses the lease immediately below.
      return;
    }

    // A leased work tab must stay foreground while its page settles. If a
    // person activates any other tab in that browser window, do not try to
    // steal focus back: lose the lease so observers stop rather than polling
    // a throttled/background platform page indefinitely.
    for (const record of [...managedTabs.values()]) {
      if (record.state === 'leased' && record.windowId === windowId) {
        forgetTab(record.tabId, 'user_taken_over');
      }
    }
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return;
    const record = managedTabs.get(tabId);
    if (!record) return;
    // A source navigation can redirect the exact canonical URL during the
    // short extension-initiated navigation window.  Outside that window a
    // URL change is an external takeover; do not repurpose that page.
    if (record.state === 'leased' && record.expectedCanonicalUrl !== null &&
      isExpectedExtensionWorkNavigation(record.expectedCanonicalUrl, changeInfo.url)) return;
    if (record.state === 'leased' && record.expectedNavigationUntil !== null &&
      Date.now() <= record.expectedNavigationUntil) return;
    if (record.expectedNavigationUntil === null && changeInfo.url === 'about:blank' &&
      Date.now() <= record.initialBlankNavigationUntil) return;
    forgetTab(tabId, 'user_taken_over');
  });
}

export async function acquireExtensionWorkTab(): Promise<ExtensionWorkTabLease> {
  initialiseExtensionWorkTabs();
  for (const record of managedTabs.values()) {
    if (record.state !== 'idle_reusable') continue;
    try {
      const tab = await chrome.tabs.get(record.tabId);
      if (tab.windowId !== record.windowId || tab.active) {
        forgetTab(record.tabId, 'user_taken_over');
        continue;
      }
      return lease(record, 'reused');
    } catch {
      forgetTab(record.tabId, 'closed_or_missing');
    }
  }

  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  if (!Number.isSafeInteger(tab.id) || !Number.isSafeInteger(tab.windowId)) {
    throw new Error('extension_work_tab_create_failed');
  }
  const record: ManagedWorkTab = {
    tabId: tab.id!,
    windowId: tab.windowId,
    state: 'idle_reusable',
    leaseId: null,
    expectedCanonicalUrl: null,
    expectedNavigationUntil: null,
    expectedForegroundActivationUntil: null,
    initialBlankNavigationUntil: Date.now() + 2_000
  };
  managedTabs.set(record.tabId, record);
  return lease(record, 'created');
}

/** One capability-approved platform navigation, issued exactly once per lease. */
export async function navigateExtensionWorkTabOnce(
  workTab: ExtensionWorkTabLease,
  item: ExtensionWorkItem,
  onNavigationIntent?: () => Promise<void> | void
): Promise<void> {
  // The target comes from a previously validated, signed registered work item.
  // This module deliberately accepts no free-form URL argument.
  if (!isExtensionWorkItem(item)) throw new Error('extension_work_target_invalid');
  await navigateExtensionWorkTabToCanonicalTarget(workTab, extensionWorkTargetUrl(item), onNavigationIntent);
}

/**
 * The batch runner can navigate only to one of the two URL targets already
 * signed into its work item.  It never accepts a caller-provided URL, page
 * number outside the reviewed pair, selector, or click instruction.
 */
export async function navigateBilibiliNativeSearchBatchPageOnce(
  workTab: ExtensionWorkTabLease,
  item: BilibiliNativeSearchBatchWorkItem,
  page: BilibiliNativeSearchBatchPageNumber,
  onNavigationIntent?: () => Promise<void> | void
): Promise<void> {
  if (!isBilibiliNativeSearchBatchWorkItem(item)) throw new Error('extension_work_target_invalid');
  await navigateExtensionWorkTabToCanonicalTarget(
    workTab,
    bilibiliNativeSearchBatchTargetUrl(item, page),
    onNavigationIntent
  );
}

async function navigateExtensionWorkTabToCanonicalTarget(
  workTab: ExtensionWorkTabLease,
  canonical: string,
  onNavigationIntent?: () => Promise<void> | void
): Promise<void> {
  await ensureExtensionWorkTabForeground(workTab);
  const record = requireLease(workTab);
  record.expectedCanonicalUrl = canonical;
  record.expectedNavigationUntil = Date.now() + 15_000;
  await onNavigationIntent?.();
  try {
    await chrome.tabs.update(workTab.tabId, { url: canonical });
  } catch {
    const disposition = currentDisposition(workTab);
    throw new Error(disposition === 'closed_or_missing' ? 'work_tab_closed' : 'navigation_outcome_unknown');
  }
}

/** Read only the tab that this lease owns; never enumerate normal user tabs. */
export async function readExtensionWorkTab(workTab: ExtensionWorkTabLease): Promise<chrome.tabs.Tab> {
  const record = requireLease(workTab);
  try {
    const tab = await chrome.tabs.get(workTab.tabId);
    if (tab.windowId !== record.windowId || !tab.active) {
      forgetTab(workTab.tabId, 'user_taken_over');
      throw new Error('work_tab_user_taken_over');
    }
    return tab;
  } catch {
    const disposition = currentDisposition(workTab);
    if (disposition === 'user_taken_over' || disposition === 'retained_not_reusable') {
      throw new Error('work_tab_user_taken_over');
    }
    forgetTab(workTab.tabId, 'closed_or_missing');
    throw new Error('work_tab_closed');
  }
}

/**
 * A normal terminal path retains the tab for explicit, safe reuse.  This does
 * not close, refresh, activate, move, or navigate it.
 */
export function releaseExtensionWorkTab(workTab: ExtensionWorkTabLease): WorkTabDisposition {
  const record = managedTabs.get(workTab.tabId);
  if (!record || record.state !== 'leased' || record.leaseId !== workTab.leaseId) {
    return currentDisposition(workTab);
  }
  record.state = 'idle_reusable';
  record.leaseId = null;
  record.expectedCanonicalUrl = null;
  record.expectedNavigationUntil = null;
  record.expectedForegroundActivationUntil = null;
  return 'idle_reusable';
}

/**
 * Retain a page for the user to inspect, but permanently remove it from the
 * extension pool after an uncertain or risk-stopped run.  It is never closed
 * or refreshed as part of this safety transition.
 */
export function abandonExtensionWorkTab(workTab: ExtensionWorkTabLease): WorkTabDisposition {
  const record = managedTabs.get(workTab.tabId);
  if (!record || record.state !== 'leased' || record.leaseId !== workTab.leaseId) {
    return currentDisposition(workTab);
  }
  managedTabs.delete(workTab.tabId);
  leaseLosses.set(workTab.leaseId, 'retained_not_reusable');
  return 'retained_not_reusable';
}

export function currentExtensionWorkTabDisposition(workTab: ExtensionWorkTabLease): WorkTabDisposition {
  return currentDisposition(workTab);
}

function lease(record: ManagedWorkTab, acquisition: WorkTabAcquisition): ExtensionWorkTabLease {
  const leaseId = crypto.randomUUID();
  record.state = 'leased';
  record.leaseId = leaseId;
  record.expectedCanonicalUrl = null;
  record.expectedNavigationUntil = null;
  record.expectedForegroundActivationUntil = null;
  return { leaseId, tabId: record.tabId, acquisition };
}

/**
 * Page loading on several platforms is deliberately degraded for background
 * tabs. This is an internal precondition for an extension-owned lease, not a
 * caller-controlled tab-focus capability. The requested work is allowed to
 * bring its own managed window to the foreground once; it never reclaims
 * focus after a user takeover.
 */
async function ensureExtensionWorkTabForeground(workTab: ExtensionWorkTabLease): Promise<void> {
  const record = requireLease(workTab);
  record.expectedForegroundActivationUntil = Date.now() + FOREGROUND_ACTIVATION_GRACE_MS;
  try {
    const focusedWindow = await chrome.windows.update(record.windowId, { focused: true });
    if (!focusedWindow || focusedWindow.id !== record.windowId || focusedWindow.focused !== true) {
      throw new Error('work_tab_foreground_unavailable');
    }
    const activated = await chrome.tabs.update(workTab.tabId, { active: true });
    if (!activated || activated.windowId !== record.windowId || activated.active !== true) {
      throw new Error('work_tab_foreground_unavailable');
    }
    const verified = await chrome.tabs.get(workTab.tabId);
    const verifiedWindow = await chrome.windows.get(record.windowId);
    if (verified.windowId !== record.windowId || verified.active !== true || verifiedWindow.focused !== true) {
      throw new Error('work_tab_foreground_unavailable');
    }
    await delay(FOREGROUND_SETTLE_MS);
  } catch (error) {
    record.expectedForegroundActivationUntil = null;
    const code = error instanceof Error ? error.message : '';
    if (code === 'work_tab_foreground_unavailable') throw error;
    const disposition = currentDisposition(workTab);
    if (disposition === 'closed_or_missing') throw new Error('work_tab_closed');
    if (disposition !== 'idle_reusable') throw new Error('work_tab_user_taken_over');
    throw new Error('work_tab_foreground_unavailable');
  }
}

function requireLease(workTab: ExtensionWorkTabLease): ManagedWorkTab {
  const record = managedTabs.get(workTab.tabId);
  if (record?.state === 'leased' && record.leaseId === workTab.leaseId) return record;
  const disposition = currentDisposition(workTab);
  throw new Error(disposition === 'closed_or_missing' ? 'work_tab_closed' : 'work_tab_user_taken_over');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function forgetTab(tabId: number, disposition: Exclude<WorkTabDisposition, 'idle_reusable'>): void {
  const record = managedTabs.get(tabId);
  if (!record) return;
  managedTabs.delete(tabId);
  if (record.leaseId) {
    leaseLosses.set(record.leaseId, disposition);
    while (leaseLosses.size > 100) {
      const oldest = leaseLosses.keys().next().value as string | undefined;
      if (!oldest) break;
      leaseLosses.delete(oldest);
    }
  }
}

function currentDisposition(workTab: ExtensionWorkTabLease): WorkTabDisposition {
  const record = managedTabs.get(workTab.tabId);
  if (record?.state === 'leased' && record.leaseId === workTab.leaseId) return 'idle_reusable';
  return leaseLosses.get(workTab.leaseId) ?? 'closed_or_missing';
}

/**
 * Chromium can emit a later URL update while a slow source page settles. A
 * work tab remains leased only if that update still canonicalises to the
 * signed target; an arbitrary URL, user activation, move, or close remains a
 * hard takeover signal.
 */
export function isExpectedExtensionWorkNavigation(expectedCanonicalUrl: string, observedUrl: string): boolean {
  const video = canonicalBilibiliVideoWorkUrl(expectedCanonicalUrl);
  if (video && video === expectedCanonicalUrl) {
    return canonicalBilibiliVideoWorkUrl(observedUrl) === expectedCanonicalUrl;
  }
  const search = canonicalBilibiliNativeSearchUrl(expectedCanonicalUrl, 'strict_input');
  if (search && search === expectedCanonicalUrl) {
    return canonicalBilibiliNativeSearchUrl(observedUrl, 'observed_document') === expectedCanonicalUrl;
  }
  const profile = canonicalBilibiliAccountProfileUrl(expectedCanonicalUrl, 'strict_input');
  if (profile && profile === expectedCanonicalUrl) {
    return canonicalBilibiliAccountProfileUrl(observedUrl, 'observed_document') === expectedCanonicalUrl;
  }
  const inventory = canonicalBilibiliAccountVideoInventoryUrl(expectedCanonicalUrl, 'strict_input');
  if (inventory && inventory === expectedCanonicalUrl) {
    return canonicalBilibiliAccountVideoInventoryUrl(observedUrl, 'observed_document') === expectedCanonicalUrl;
  }
  const dynamic = canonicalBilibiliDynamicWorkUrl(expectedCanonicalUrl, 'strict_input');
  if (dynamic && dynamic === expectedCanonicalUrl) {
    return canonicalBilibiliDynamicWorkUrl(observedUrl, 'observed_document') === expectedCanonicalUrl;
  }
  const overview = canonicalBilibiliCollectionSeriesOverviewWorkUrl(expectedCanonicalUrl, 'strict_input');
  if (overview && overview === expectedCanonicalUrl) {
    return canonicalBilibiliCollectionSeriesOverviewWorkUrl(observedUrl, 'observed_document') === expectedCanonicalUrl;
  }
  const detail = canonicalBilibiliCollectionSeriesDetailWorkUrl(expectedCanonicalUrl, 'strict_input');
  if (detail && detail === expectedCanonicalUrl) {
    return canonicalBilibiliCollectionSeriesDetailWorkUrl(observedUrl, 'observed_document') === expectedCanonicalUrl;
  }
  const passiveVideo = canonicalBilibiliPassiveVideoWorkUrl(expectedCanonicalUrl);
  if (passiveVideo && passiveVideo === expectedCanonicalUrl) {
    return canonicalBilibiliPassiveVideoWorkUrl(observedUrl, 'observed_document') === expectedCanonicalUrl;
  }
  return false;
}
