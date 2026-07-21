import { cleanupExpiredBilibiliDynamicObserverBindings } from './strategies/bilibili-dynamic-strategy';
import { cleanupExpiredBilibiliVideoDetailObserverBindings } from './strategies/bilibili-video-detail-strategy';

const RETIRED_SCRIPT_PREFIXES = [
  'collector-strategy-',
  'collector-transcript-'
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
  await cleanupExpiredBilibiliDynamicObserverBindings();
  await cleanupExpiredBilibiliVideoDetailObserverBindings();
}
