import { canonicalBilibiliVideoWorkUrl } from '@intelligence/collector-contracts';

export const USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION = 2 as const;

export interface UserBrowserCollectorServiceRequest {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  browserBindingId: string;
  platform: 'bilibili';
  capability: 'bilibili.video_detail';
  executionTarget: 'collector_work_tab';
  input: {
    canonicalVideoUrl: string;
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Production API contract for a user-owned browser binding.  This is separate
 * from the legacy Profile/Browser Host `schemaVersion: 1` request so callers
 * cannot accidentally choose a Profile or invoke a fallback runner.
 */
export function userBrowserCollectorServiceRequestInput(value: unknown): UserBrowserCollectorServiceRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('user_browser_collector_service_request_invalid');
  }
  const candidate = value as Record<string, unknown>;
  const allowed = new Set(['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input']);
  if (
    Object.keys(candidate).some((key) => !allowed.has(key)) ||
    candidate.schemaVersion !== USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION ||
    typeof candidate.browserBindingId !== 'string' || !UUID_PATTERN.test(candidate.browserBindingId) ||
    candidate.platform !== 'bilibili' || candidate.capability !== 'bilibili.video_detail' ||
    candidate.executionTarget !== 'collector_work_tab' || !candidate.input ||
    typeof candidate.input !== 'object' || Array.isArray(candidate.input)
  ) throw new Error('user_browser_collector_service_request_invalid');
  const input = candidate.input as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || typeof input.canonicalVideoUrl !== 'string') {
    throw new Error('user_browser_collector_service_request_invalid');
  }
  const canonicalVideoUrl = canonicalBilibiliVideoWorkUrl(input.canonicalVideoUrl);
  if (!canonicalVideoUrl) throw new Error('user_browser_collector_service_request_invalid');
  return {
    schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
    browserBindingId: candidate.browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.video_detail',
    executionTarget: 'collector_work_tab',
    input: { canonicalVideoUrl }
  };
}
