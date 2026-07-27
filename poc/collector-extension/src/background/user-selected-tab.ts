import {
  bilibiliAccountVideoInventoryIdFromUrl,
  canonicalBilibiliAccountVideoInventoryUrl
} from '@intelligence/collector-contracts';

const USER_SELECTED_ACCOUNT_INVENTORY_TAB_KEY = 'collector.user-selected-tab.account-inventory.v1';
export const USER_SELECTED_TAB_LEASE_TTL_MS = 120_000;

interface UserSelectedAccountInventoryTabLease {
  schemaVersion: 1;
  tabId: number;
  windowId: number;
  documentId: string;
  canonicalInventoryUrl: string;
  stableAccountId: string;
  selectedAt: string;
  expiresAt: string;
}

export interface UserSelectedAccountInventoryTabSummary {
  state: 'available' | 'none';
  selectedAt: string | null;
  expiresAt: string | null;
}

export type TakenUserSelectedAccountInventoryTab =
  | { kind: 'ready'; lease: UserSelectedAccountInventoryTabLease }
  | {
    kind: 'stopped';
    errorCode:
      | 'user_selected_tab_required'
      | 'user_selected_tab_closed'
      | 'user_selected_tab_document_changed'
      | 'user_selected_tab_target_mismatch';
    disposition: 'selection_unavailable' | 'closed_or_missing' | 'document_changed' | 'target_mismatch';
  };

/**
 * This runs only from a user click in the extension popup. It records the
 * currently active Bilibili inventory document for a short, single-use,
 * passive observation lease. It never navigates, injects into, scrolls, or
 * clicks the selected page.
 */
export async function selectCurrentBilibiliAccountInventoryTab(): Promise<UserSelectedAccountInventoryTabSummary> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs.length === 1 ? tabs[0] : null;
  const tabId = tab?.id;
  const windowId = tab?.windowId;
  if (!tab || typeof tabId !== 'number' || typeof windowId !== 'number' ||
    !Number.isSafeInteger(tabId) || !Number.isSafeInteger(windowId) || tab.incognito
  ) {
    throw new Error('user_selected_tab_current_tab_unavailable');
  }
  const canonicalInventoryUrl = canonicalBilibiliAccountVideoInventoryUrl(tab.url ?? '', 'observed_document');
  const stableAccountId = canonicalInventoryUrl ? bilibiliAccountVideoInventoryIdFromUrl(canonicalInventoryUrl) : null;
  if (!canonicalInventoryUrl || !stableAccountId) throw new Error('user_selected_tab_target_not_supported');
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
  const frameCanonicalUrl = frame?.url
    ? canonicalBilibiliAccountVideoInventoryUrl(frame.url, 'observed_document')
    : null;
  if (!frame?.documentId || frameCanonicalUrl !== canonicalInventoryUrl) {
    throw new Error('user_selected_tab_document_unavailable');
  }
  const now = Date.now();
  const lease: UserSelectedAccountInventoryTabLease = {
    schemaVersion: 1,
    tabId,
    windowId,
    documentId: frame.documentId,
    canonicalInventoryUrl,
    stableAccountId,
    selectedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + USER_SELECTED_TAB_LEASE_TTL_MS).toISOString()
  };
  await chrome.storage.session.set({ [USER_SELECTED_ACCOUNT_INVENTORY_TAB_KEY]: lease });
  return summary(lease);
}

/** A local UI read; it never enumerates tabs or reads a webpage. */
export async function getSelectedBilibiliAccountInventoryTabSummary(): Promise<UserSelectedAccountInventoryTabSummary> {
  const lease = await loadLease();
  return lease ? summary(lease) : { state: 'none', selectedAt: null, expiresAt: null };
}

/**
 * Atomically consumes the popup-created lease before checking the tab. A
 * failed tab/document check therefore never leaves an old selection available
 * for a later task after user navigation, worker recovery, or caller error.
 */
export async function takeSelectedBilibiliAccountInventoryTab(
  expectedCanonicalInventoryUrl: string
): Promise<TakenUserSelectedAccountInventoryTab> {
  const lease = await loadLease();
  await chrome.storage.session.remove(USER_SELECTED_ACCOUNT_INVENTORY_TAB_KEY);
  if (!lease) {
    return stopped('user_selected_tab_required', 'selection_unavailable');
  }
  if (lease.canonicalInventoryUrl !== expectedCanonicalInventoryUrl) {
    return stopped('user_selected_tab_target_mismatch', 'target_mismatch');
  }
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(lease.tabId);
  } catch {
    return stopped('user_selected_tab_closed', 'closed_or_missing');
  }
  if (tab.windowId !== lease.windowId || tab.incognito) {
    return stopped('user_selected_tab_closed', 'closed_or_missing');
  }
  const canonicalInventoryUrl = canonicalBilibiliAccountVideoInventoryUrl(tab.url ?? '', 'observed_document');
  if (canonicalInventoryUrl !== lease.canonicalInventoryUrl) {
    return stopped('user_selected_tab_document_changed', 'document_changed');
  }
  const frame = await chrome.webNavigation.getFrame({ tabId: lease.tabId, frameId: 0 }).catch(() => null);
  const frameCanonicalUrl = frame?.url
    ? canonicalBilibiliAccountVideoInventoryUrl(frame.url, 'observed_document')
    : null;
  if (!frame?.documentId || frame.documentId !== lease.documentId || frameCanonicalUrl !== lease.canonicalInventoryUrl) {
    return stopped('user_selected_tab_document_changed', 'document_changed');
  }
  return { kind: 'ready', lease };
}

function stopped(
  errorCode: Extract<TakenUserSelectedAccountInventoryTab, { kind: 'stopped' }>['errorCode'],
  disposition: Extract<TakenUserSelectedAccountInventoryTab, { kind: 'stopped' }>['disposition']
): Extract<TakenUserSelectedAccountInventoryTab, { kind: 'stopped' }> {
  return { kind: 'stopped', errorCode, disposition };
}

function summary(lease: UserSelectedAccountInventoryTabLease): UserSelectedAccountInventoryTabSummary {
  return {
    state: 'available',
    selectedAt: lease.selectedAt,
    expiresAt: lease.expiresAt
  };
}

async function loadLease(): Promise<UserSelectedAccountInventoryTabLease | null> {
  const stored = await chrome.storage.session.get(USER_SELECTED_ACCOUNT_INVENTORY_TAB_KEY);
  const lease = userSelectedAccountInventoryTabLease(stored[USER_SELECTED_ACCOUNT_INVENTORY_TAB_KEY]);
  if (!lease) return null;
  if (Date.parse(lease.expiresAt) <= Date.now()) {
    await chrome.storage.session.remove(USER_SELECTED_ACCOUNT_INVENTORY_TAB_KEY);
    return null;
  }
  return lease;
}

function userSelectedAccountInventoryTabLease(value: unknown): UserSelectedAccountInventoryTabLease | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<UserSelectedAccountInventoryTabLease>;
  const tabId = candidate.tabId;
  const windowId = candidate.windowId;
  if (
    candidate.schemaVersion !== 1 || typeof tabId !== 'number' || typeof windowId !== 'number' ||
    !Number.isSafeInteger(tabId) || !Number.isSafeInteger(windowId) ||
    tabId < 0 || windowId < 0 || typeof candidate.documentId !== 'string' ||
    candidate.documentId.length === 0 || candidate.documentId.length > 256 ||
    typeof candidate.canonicalInventoryUrl !== 'string' || typeof candidate.stableAccountId !== 'string' ||
    typeof candidate.selectedAt !== 'string' || typeof candidate.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.selectedAt)) || !Number.isFinite(Date.parse(candidate.expiresAt)) ||
    Date.parse(candidate.expiresAt) <= Date.parse(candidate.selectedAt) ||
    canonicalBilibiliAccountVideoInventoryUrl(candidate.canonicalInventoryUrl, 'strict_input') !== candidate.canonicalInventoryUrl ||
    bilibiliAccountVideoInventoryIdFromUrl(candidate.canonicalInventoryUrl) !== candidate.stableAccountId
  ) return null;
  return {
    schemaVersion: 1,
    tabId,
    windowId,
    documentId: candidate.documentId,
    canonicalInventoryUrl: candidate.canonicalInventoryUrl,
    stableAccountId: candidate.stableAccountId,
    selectedAt: candidate.selectedAt,
    expiresAt: candidate.expiresAt
  };
}
