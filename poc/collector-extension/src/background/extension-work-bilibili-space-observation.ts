/**
 * Bilibili space pages are single-page applications: `tabs.Tab.status` can
 * become `complete` before the public account header and first-screen content
 * are rendered.  Keep the passive DOM observation bounded, while leaving the
 * signed work item's earlier expiry authoritative.
 */
export const BILIBILI_SPACE_PAGE_SETTLE_MS = 3_000;
export const BILIBILI_SPACE_DOM_OBSERVATION_INTERVAL_MS = 350;
export const BILIBILI_SPACE_DOM_OBSERVATION_MAX_MS = 30_000;

export function boundedBilibiliSpaceDomObservationDeadline(expiresAt: string, now = Date.now()): number {
  const workExpiry = Date.parse(expiresAt);
  if (!Number.isFinite(workExpiry)) return now;
  return Math.min(workExpiry, now + BILIBILI_SPACE_DOM_OBSERVATION_MAX_MS);
}
