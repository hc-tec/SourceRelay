import { canonicalBilibiliPassiveVideoWorkUrl } from '@intelligence/collector-contracts';
import { USER_SELECTED_TAB_LEASE_TTL_MS } from './user-selected-tab';

const USER_SELECTED_VIDEO_DISCUSSION_TAB_KEY = 'collector.user-selected-tab.bilibili-video-discussion.v1';

interface UserSelectedBilibiliVideoDiscussionTabLease {
  schemaVersion: 1;
  tabId: number;
  windowId: number;
  documentId: string;
  canonicalVideoUrl: string;
  bvid: string;
  selectedAt: string;
  expiresAt: string;
}

export interface UserSelectedBilibiliVideoDiscussionTabSummary {
  state: 'available' | 'none';
  selectedAt: string | null;
  expiresAt: string | null;
}

export type TakenUserSelectedBilibiliVideoDiscussionTab =
  | { kind: 'ready'; lease: UserSelectedBilibiliVideoDiscussionTabLease }
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
 * This runs only from an explicit popup click after the user has brought the
 * public comments into view. It creates a short, one-time, passive document
 * lease; it does not navigate, focus, scroll, click or inject into the tab.
 */
export async function selectCurrentBilibiliVideoDiscussionTab(): Promise<UserSelectedBilibiliVideoDiscussionTabSummary> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs.length === 1 ? tabs[0] : null;
  const tabId = tab?.id;
  const windowId = tab?.windowId;
  if (!tab || typeof tabId !== 'number' || typeof windowId !== 'number' ||
    !Number.isSafeInteger(tabId) || !Number.isSafeInteger(windowId) || tab.incognito
  ) throw new Error('user_selected_tab_current_tab_unavailable');

  const canonicalVideoUrl = canonicalBilibiliPassiveVideoWorkUrl(tab.url ?? '', 'observed_document');
  const bvid = bvidFromCanonicalUrl(canonicalVideoUrl);
  if (!canonicalVideoUrl || !bvid) throw new Error('user_selected_tab_target_not_supported');
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
  const frameCanonicalUrl = frame?.url
    ? canonicalBilibiliPassiveVideoWorkUrl(frame.url, 'observed_document')
    : null;
  if (!frame?.documentId || frameCanonicalUrl !== canonicalVideoUrl) {
    throw new Error('user_selected_tab_document_unavailable');
  }

  const now = Date.now();
  const lease: UserSelectedBilibiliVideoDiscussionTabLease = {
    schemaVersion: 1,
    tabId,
    windowId,
    documentId: frame.documentId,
    canonicalVideoUrl,
    bvid,
    selectedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + USER_SELECTED_TAB_LEASE_TTL_MS).toISOString()
  };
  await chrome.storage.session.set({ [USER_SELECTED_VIDEO_DISCUSSION_TAB_KEY]: lease });
  return summary(lease);
}

/** A popup-only local status read; this never queries tabs or reads page DOM. */
export async function getSelectedBilibiliVideoDiscussionTabSummary(): Promise<UserSelectedBilibiliVideoDiscussionTabSummary> {
  const lease = await loadLease();
  return lease ? summary(lease) : { state: 'none', selectedAt: null, expiresAt: null };
}

/**
 * Atomically consumes the lease before rechecking the exact tab/document.
 * Browser identifiers remain extension-private and never cross the Gateway or
 * artifact boundary, including on every terminal branch.
 */
export async function takeSelectedBilibiliVideoDiscussionTab(
  expectedCanonicalVideoUrl: string
): Promise<TakenUserSelectedBilibiliVideoDiscussionTab> {
  const lease = await loadLease();
  await chrome.storage.session.remove(USER_SELECTED_VIDEO_DISCUSSION_TAB_KEY);
  if (!lease) return stopped('user_selected_tab_required', 'selection_unavailable');
  if (lease.canonicalVideoUrl !== expectedCanonicalVideoUrl) {
    return stopped('user_selected_tab_target_mismatch', 'target_mismatch');
  }

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(lease.tabId);
  } catch {
    return stopped('user_selected_tab_closed', 'closed_or_missing');
  }
  if (tab.windowId !== lease.windowId || tab.incognito) return stopped('user_selected_tab_closed', 'closed_or_missing');
  const canonicalVideoUrl = canonicalBilibiliPassiveVideoWorkUrl(tab.url ?? '', 'observed_document');
  if (canonicalVideoUrl !== lease.canonicalVideoUrl) return stopped('user_selected_tab_document_changed', 'document_changed');

  const frame = await chrome.webNavigation.getFrame({ tabId: lease.tabId, frameId: 0 }).catch(() => null);
  const frameCanonicalUrl = frame?.url
    ? canonicalBilibiliPassiveVideoWorkUrl(frame.url, 'observed_document')
    : null;
  if (!frame?.documentId || frame.documentId !== lease.documentId || frameCanonicalUrl !== lease.canonicalVideoUrl) {
    return stopped('user_selected_tab_document_changed', 'document_changed');
  }
  return { kind: 'ready', lease };
}

function stopped(
  errorCode: Extract<TakenUserSelectedBilibiliVideoDiscussionTab, { kind: 'stopped' }>['errorCode'],
  disposition: Extract<TakenUserSelectedBilibiliVideoDiscussionTab, { kind: 'stopped' }>['disposition']
): Extract<TakenUserSelectedBilibiliVideoDiscussionTab, { kind: 'stopped' }> {
  return { kind: 'stopped', errorCode, disposition };
}

function summary(
  lease: UserSelectedBilibiliVideoDiscussionTabLease
): UserSelectedBilibiliVideoDiscussionTabSummary {
  return { state: 'available', selectedAt: lease.selectedAt, expiresAt: lease.expiresAt };
}

async function loadLease(): Promise<UserSelectedBilibiliVideoDiscussionTabLease | null> {
  const stored = await chrome.storage.session.get(USER_SELECTED_VIDEO_DISCUSSION_TAB_KEY);
  const lease = userSelectedBilibiliVideoDiscussionTabLease(stored[USER_SELECTED_VIDEO_DISCUSSION_TAB_KEY]);
  if (!lease) return null;
  if (Date.parse(lease.expiresAt) <= Date.now()) {
    await chrome.storage.session.remove(USER_SELECTED_VIDEO_DISCUSSION_TAB_KEY);
    return null;
  }
  return lease;
}

function userSelectedBilibiliVideoDiscussionTabLease(
  value: unknown
): UserSelectedBilibiliVideoDiscussionTabLease | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<UserSelectedBilibiliVideoDiscussionTabLease>;
  const tabId = candidate.tabId;
  const windowId = candidate.windowId;
  if (
    candidate.schemaVersion !== 1 || typeof tabId !== 'number' || typeof windowId !== 'number' ||
    !Number.isSafeInteger(tabId) || !Number.isSafeInteger(windowId) || tabId < 0 || windowId < 0 ||
    typeof candidate.documentId !== 'string' || candidate.documentId.length === 0 || candidate.documentId.length > 256 ||
    typeof candidate.canonicalVideoUrl !== 'string' || typeof candidate.bvid !== 'string' ||
    typeof candidate.selectedAt !== 'string' || typeof candidate.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.selectedAt)) || !Number.isFinite(Date.parse(candidate.expiresAt)) ||
    Date.parse(candidate.expiresAt) <= Date.parse(candidate.selectedAt) ||
    canonicalBilibiliPassiveVideoWorkUrl(candidate.canonicalVideoUrl, 'strict_input') !== candidate.canonicalVideoUrl ||
    bvidFromCanonicalUrl(candidate.canonicalVideoUrl) !== candidate.bvid
  ) return null;
  return {
    schemaVersion: 1,
    tabId,
    windowId,
    documentId: candidate.documentId,
    canonicalVideoUrl: candidate.canonicalVideoUrl,
    bvid: candidate.bvid,
    selectedAt: candidate.selectedAt,
    expiresAt: candidate.expiresAt
  };
}

function bvidFromCanonicalUrl(value: string | null): string | null {
  return value?.match(/^https:\/\/www\.bilibili\.com\/video\/(BV[0-9A-Za-z]{10})$/)?.[1] ?? null;
}
