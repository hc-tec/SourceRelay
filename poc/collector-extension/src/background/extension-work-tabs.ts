import {
  canonicalBilibiliAccountProfileUrl,
  canonicalBilibiliAccountVideoInventoryUrl,
  canonicalBilibiliCollectionSeriesDetailWorkUrl,
  canonicalBilibiliCollectionSeriesOverviewWorkUrl,
  canonicalBilibiliDynamicWorkUrl,
  canonicalBilibiliNativeSearchUrl,
  canonicalBilibiliPassiveVideoWorkUrl,
  canonicalBilibiliVideoWorkUrl,
  extensionWorkTargetUrl,
  isExtensionWorkItem,
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
  state: 'idle_reusable' | 'leased';
  leaseId: string | null;
  expectedCanonicalUrl: string | null;
  expectedNavigationUntil: number | null;
  initialBlankNavigationUntil: number;
}

const managedTabs = new Map<number, ManagedWorkTab>();
const leaseLosses = new Map<string, Exclude<WorkTabDisposition, 'idle_reusable'>>();
let listenersInitialised = false;

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
  chrome.tabs.onActivated.addListener(({ tabId }) => forgetTab(tabId, 'user_taken_over'));
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
      if (tab.active) {
        forgetTab(record.tabId, 'user_taken_over');
        continue;
      }
      return lease(record, 'reused');
    } catch {
      forgetTab(record.tabId, 'closed_or_missing');
    }
  }

  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  if (!Number.isSafeInteger(tab.id)) throw new Error('extension_work_tab_create_failed');
  const record: ManagedWorkTab = {
    tabId: tab.id!,
    state: 'idle_reusable',
    leaseId: null,
    expectedCanonicalUrl: null,
    expectedNavigationUntil: null,
    initialBlankNavigationUntil: Date.now() + 2_000
  };
  managedTabs.set(record.tabId, record);
  return lease(record, 'created');
}

/** One capability-approved platform navigation, issued exactly once per lease. */
export async function navigateExtensionWorkTabOnce(
  workTab: ExtensionWorkTabLease,
  item: ExtensionWorkItem
): Promise<void> {
  // The target comes from a previously validated, signed registered work item.
  // This module deliberately accepts no free-form URL argument.
  if (!isExtensionWorkItem(item)) throw new Error('extension_work_target_invalid');
  const canonical = extensionWorkTargetUrl(item);
  const record = requireLease(workTab);
  record.expectedCanonicalUrl = canonical;
  record.expectedNavigationUntil = Date.now() + 15_000;
  try {
    await chrome.tabs.update(workTab.tabId, { url: canonical });
  } catch {
    const disposition = currentDisposition(workTab);
    throw new Error(disposition === 'closed_or_missing' ? 'work_tab_closed' : 'navigation_outcome_unknown');
  }
}

/** Read only the tab that this lease owns; never enumerate normal user tabs. */
export async function readExtensionWorkTab(workTab: ExtensionWorkTabLease): Promise<chrome.tabs.Tab> {
  requireLease(workTab);
  try {
    return await chrome.tabs.get(workTab.tabId);
  } catch {
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
  return { leaseId, tabId: record.tabId, acquisition };
}

function requireLease(workTab: ExtensionWorkTabLease): ManagedWorkTab {
  const record = managedTabs.get(workTab.tabId);
  if (record?.state === 'leased' && record.leaseId === workTab.leaseId) return record;
  const disposition = currentDisposition(workTab);
  throw new Error(disposition === 'closed_or_missing' ? 'work_tab_closed' : 'work_tab_user_taken_over');
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
