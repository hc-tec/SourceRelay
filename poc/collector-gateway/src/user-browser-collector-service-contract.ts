import {
  canonicalBilibiliAccountProfileUrl,
  canonicalBilibiliVideoWorkUrl,
  normaliseBilibiliNativeSearchRoute
} from '@intelligence/collector-contracts';

export const USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION = 2 as const;

interface UserBrowserCollectorServiceRequestBase {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  browserBindingId: string;
  platform: 'bilibili';
  executionTarget: 'collector_work_tab';
}

export interface UserBrowserVideoDetailCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.video_detail';
  input: {
    canonicalVideoUrl: string;
  };
}

/**
 * Native-search direct mode intentionally exposes just a phrase. Result type,
 * order, page, URL and page interaction are fixed by the registered
 * capability rather than supplied by the upper application.
 */
export interface UserBrowserNativeSearchCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.native_search';
  input: {
    query: string;
  };
}

/** A caller may name one public account identity, never an arbitrary space URL. */
export interface UserBrowserAccountProfileCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.account_profile';
  input: {
    canonicalProfileUrl: string;
  };
}

/** Fixed first page of an account's public video inventory; pagination is separate. */
export interface UserBrowserAccountInventoryCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.account_inventory';
  input: {
    canonicalProfileUrl: string;
  };
}

export type UserBrowserCollectorServiceRequest =
  | UserBrowserVideoDetailCollectorServiceRequest
  | UserBrowserNativeSearchCollectorServiceRequest
  | UserBrowserAccountProfileCollectorServiceRequest
  | UserBrowserAccountInventoryCollectorServiceRequest;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Production API contract for a user-owned browser binding. This is separate
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
    candidate.platform !== 'bilibili' || candidate.executionTarget !== 'collector_work_tab' || !candidate.input ||
    typeof candidate.input !== 'object' || Array.isArray(candidate.input)
  ) throw new Error('user_browser_collector_service_request_invalid');
  const input = candidate.input as Record<string, unknown>;
  if (candidate.capability === 'bilibili.video_detail') {
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
  if (candidate.capability === 'bilibili.native_search') {
    if (Object.keys(input).length !== 1 || typeof input.query !== 'string') {
      throw new Error('user_browser_collector_service_request_invalid');
    }
    const route = normaliseBilibiliNativeSearchRoute({
      query: input.query,
      resultType: 'comprehensive',
      sort: 'relevance',
      page: 1
    });
    if (!route) throw new Error('user_browser_collector_service_request_invalid');
    return {
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      browserBindingId: candidate.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search',
      executionTarget: 'collector_work_tab',
      input: { query: route.query }
    };
  }
  if (candidate.capability === 'bilibili.account_profile' || candidate.capability === 'bilibili.account_inventory') {
    if (Object.keys(input).length !== 1 || typeof input.canonicalProfileUrl !== 'string') {
      throw new Error('user_browser_collector_service_request_invalid');
    }
    const canonicalProfileUrl = canonicalBilibiliAccountProfileUrl(input.canonicalProfileUrl, 'strict_input');
    if (!canonicalProfileUrl) throw new Error('user_browser_collector_service_request_invalid');
    return {
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      browserBindingId: candidate.browserBindingId,
      platform: 'bilibili',
      capability: candidate.capability,
      executionTarget: 'collector_work_tab',
      input: { canonicalProfileUrl }
    };
  }
  throw new Error('user_browser_collector_service_request_invalid');
}
