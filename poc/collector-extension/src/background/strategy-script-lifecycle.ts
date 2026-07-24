import { cleanupExpiredBilibiliAccountProfileObserverBindings } from './strategies/bilibili-account-profile-strategy';
import { cleanupExpiredBilibiliAccountVideoInventoryObserverBindings } from './strategies/bilibili-account-video-inventory-strategy';
import { cleanupExpiredBilibiliDynamicObserverBindings } from './strategies/bilibili-dynamic-strategy';
import { cleanupExpiredBilibiliNativeSearchObserverBindings } from './strategies/bilibili-native-search-strategy';
import { cleanupExpiredBilibiliVideoDetailObserverBindings } from './strategies/bilibili-video-detail-strategy';
import { cleanupExpiredBilibiliTranscriptObserverBindings } from './strategies/bilibili-transcript-strategy';
import { cleanupExpiredBilibiliCollectionSeriesObserverBindings } from './strategies/bilibili-collection-series-strategy';

const RETIRED_SCRIPT_PREFIXES = [
  'collector-strategy-'
] as const;

/**
 * Cleans registrations made by retired Extension-owned task runners while
 * preserving a still-valid, exact Bilibili ObserverBinding.  This is local
 * Extension hygiene only: it never navigates or contacts a platform.
 */
export async function cleanupStrategyScriptRegistrations(): Promise<void> {
  const registrations = await chrome.scripting.getRegisteredContentScripts();
  const retiredIds = registrations
    .map((registration) => registration.id)
    .filter((id) => RETIRED_SCRIPT_PREFIXES.some((prefix) => id.startsWith(prefix)));
  if (retiredIds.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: retiredIds });
  }
  await cleanupExpiredBilibiliAccountProfileObserverBindings();
  await cleanupExpiredBilibiliAccountVideoInventoryObserverBindings();
  await cleanupExpiredBilibiliDynamicObserverBindings();
  await cleanupExpiredBilibiliNativeSearchObserverBindings();
  await cleanupExpiredBilibiliVideoDetailObserverBindings();
  await cleanupExpiredBilibiliTranscriptObserverBindings();
  await cleanupExpiredBilibiliCollectionSeriesObserverBindings();
}
