import { clearNetworkCaptureState } from './network-capture-runtime';

export const DYNAMIC_OBSERVER_BINDING_STORAGE_PREFIX = 'collector.strategy-observer.' as const;
export const VIDEO_DETAIL_OBSERVER_BINDING_STORAGE_PREFIX = 'collector.video-detail-observer.' as const;
export const ACCOUNT_VIDEO_INVENTORY_OBSERVER_BINDING_STORAGE_PREFIX =
  'collector.account-video-inventory-observer.' as const;
export const ACCOUNT_PROFILE_OBSERVER_BINDING_STORAGE_PREFIX =
  'collector.account-profile-observer.' as const;
export const NATIVE_SEARCH_OBSERVER_BINDING_STORAGE_PREFIX =
  'collector.native-search-observer.' as const;
export const TRANSCRIPT_OBSERVER_BINDING_STORAGE_PREFIX =
  'collector.transcript-observer.' as const;
export const DISCUSSION_OBSERVER_BINDING_STORAGE_PREFIX =
  'collector.discussion-observer.' as const;
export const DANMAKU_OBSERVER_BINDING_STORAGE_PREFIX =
  'collector.danmaku-observer.' as const;

const OBSERVER_BINDING_STORAGE_PREFIXES = [
  DYNAMIC_OBSERVER_BINDING_STORAGE_PREFIX,
  VIDEO_DETAIL_OBSERVER_BINDING_STORAGE_PREFIX,
  ACCOUNT_VIDEO_INVENTORY_OBSERVER_BINDING_STORAGE_PREFIX,
  ACCOUNT_PROFILE_OBSERVER_BINDING_STORAGE_PREFIX,
  NATIVE_SEARCH_OBSERVER_BINDING_STORAGE_PREFIX,
  TRANSCRIPT_OBSERVER_BINDING_STORAGE_PREFIX,
  DISCUSSION_OBSERVER_BINDING_STORAGE_PREFIX,
  DANMAKU_OBSERVER_BINDING_STORAGE_PREFIX
] as const;

interface StoredBindingReference {
  tabId?: unknown;
  contentScriptId?: unknown;
}

/**
 * A managed tab may have one active Strategy binding at a time. Clearing the
 * prior short-lived registration also clears any route-bound network arm, so a
 * DOM-only detail run cannot inherit an earlier dynamic-page observer.
 */
export async function clearStrategyBindingsForTab(tabId: number): Promise<void> {
  if (!Number.isSafeInteger(tabId) || tabId < 0) throw new Error('strategy_binding_tab_invalid');
  const values = await chrome.storage.session.get(null);
  const keys: string[] = [];
  const scriptIds: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!OBSERVER_BINDING_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    const candidate = value as StoredBindingReference;
    if (candidate.tabId !== tabId) continue;
    keys.push(key);
    if (typeof candidate.contentScriptId === 'string') scriptIds.push(candidate.contentScriptId);
  }
  if (scriptIds.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [...new Set(scriptIds)] }).catch(() => undefined);
  }
  if (keys.length > 0) await chrome.storage.session.remove(keys);
  await clearNetworkCaptureState(tabId);
}
