import {
  canonicalBilibiliAccountProfileUrl,
  canonicalBilibiliPassiveVideoWorkUrl,
  canonicalBilibiliVideoWorkUrl,
  normaliseBilibiliNativeSearchRoute
} from '@intelligence/collector-contracts';

export const USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION = 2 as const;

interface UserBrowserCollectorServiceRequestBase {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  browserBindingId: string;
  platform: 'bilibili';
  executionTarget: 'collector_work_tab' | 'user_selected_tab';
}

export interface UserBrowserVideoDetailCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.video_detail';
  executionTarget: 'collector_work_tab';
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
  executionTarget: 'collector_work_tab';
  input: {
    query: string;
  };
}

/** Fixed page 1 then page 2; applications cannot supply a page list or URL. */
export interface UserBrowserNativeSearchBatchCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.native_search_batch';
  executionTarget: 'collector_work_tab';
  input: {
    query: string;
  };
}

/** A caller may name one public account identity, never an arbitrary space URL. */
export interface UserBrowserAccountProfileCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.account_profile';
  executionTarget: 'collector_work_tab';
  input: {
    canonicalProfileUrl: string;
  };
}

/** Fixed first page of an account's public video inventory; pagination is separate. */
export interface UserBrowserAccountInventoryCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.account_inventory';
  /**
   * `user_selected_tab` is a single-use passive observation lease created by
   * the extension popup. The request never carries a tab ID, selector, page
   * number, URL variant, script, or page-action plan.
   */
  executionTarget: 'collector_work_tab' | 'user_selected_tab';
  input: {
    canonicalProfileUrl: string;
  };
}

export interface UserBrowserDynamicCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.dynamic';
  executionTarget: 'collector_work_tab';
  input: { canonicalProfileUrl: string };
}

export interface UserBrowserCollectionSeriesOverviewCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.collection_series.overview';
  executionTarget: 'collector_work_tab';
  input: { canonicalProfileUrl: string };
}

export interface UserBrowserCollectionSeriesDetailCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.collection_series.detail';
  executionTarget: 'collector_work_tab';
  input: {
    canonicalProfileUrl: string;
    stableSeriesId: string;
    listType: 'series' | 'season';
  };
}

export interface UserBrowserDanmakuCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.danmaku';
  executionTarget: 'collector_work_tab';
  input: { canonicalVideoUrl: string };
}

export type UserBrowserCollectorServiceRequest =
  | UserBrowserVideoDetailCollectorServiceRequest
  | UserBrowserNativeSearchCollectorServiceRequest
  | UserBrowserNativeSearchBatchCollectorServiceRequest
  | UserBrowserAccountProfileCollectorServiceRequest
  | UserBrowserAccountInventoryCollectorServiceRequest
  | UserBrowserDynamicCollectorServiceRequest
  | UserBrowserCollectionSeriesOverviewCollectorServiceRequest
  | UserBrowserCollectionSeriesDetailCollectorServiceRequest
  | UserBrowserDanmakuCollectorServiceRequest;

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
  const executionTarget = candidate.executionTarget;
  const allowed = new Set(['schemaVersion', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input']);
  if (
    Object.keys(candidate).some((key) => !allowed.has(key)) ||
    candidate.schemaVersion !== USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION ||
    typeof candidate.browserBindingId !== 'string' || !UUID_PATTERN.test(candidate.browserBindingId) ||
    candidate.platform !== 'bilibili' ||
    (executionTarget !== 'collector_work_tab' && executionTarget !== 'user_selected_tab') || !candidate.input ||
    typeof candidate.input !== 'object' || Array.isArray(candidate.input)
  ) throw new Error('user_browser_collector_service_request_invalid');
  const input = candidate.input as Record<string, unknown>;
  if (candidate.capability === 'bilibili.video_detail') {
    if (executionTarget !== 'collector_work_tab') throw new Error('user_browser_collector_service_request_invalid');
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
    if (executionTarget !== 'collector_work_tab') throw new Error('user_browser_collector_service_request_invalid');
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
  if (candidate.capability === 'bilibili.native_search_batch') {
    if (executionTarget !== 'collector_work_tab') throw new Error('user_browser_collector_service_request_invalid');
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
      capability: 'bilibili.native_search_batch',
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
    if (candidate.capability === 'bilibili.account_profile') {
      if (executionTarget !== 'collector_work_tab') throw new Error('user_browser_collector_service_request_invalid');
      return {
        schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
        browserBindingId: candidate.browserBindingId,
        platform: 'bilibili',
        capability: 'bilibili.account_profile',
        executionTarget: 'collector_work_tab',
        input: { canonicalProfileUrl }
      };
    }
    return {
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      browserBindingId: candidate.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.account_inventory',
      executionTarget,
      input: { canonicalProfileUrl }
    };
  }
  if (candidate.capability === 'bilibili.dynamic' || candidate.capability === 'bilibili.collection_series.overview') {
    if (executionTarget !== 'collector_work_tab') throw new Error('user_browser_collector_service_request_invalid');
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
  if (candidate.capability === 'bilibili.collection_series.detail') {
    if (executionTarget !== 'collector_work_tab') throw new Error('user_browser_collector_service_request_invalid');
    if (Object.keys(input).length !== 3 || typeof input.canonicalProfileUrl !== 'string' ||
      typeof input.stableSeriesId !== 'string' || (input.listType !== 'series' && input.listType !== 'season')
    ) throw new Error('user_browser_collector_service_request_invalid');
    const canonicalProfileUrl = canonicalBilibiliAccountProfileUrl(input.canonicalProfileUrl, 'strict_input');
    if (!canonicalProfileUrl || !/^\d{1,20}$/.test(input.stableSeriesId) || input.stableSeriesId === '0') {
      throw new Error('user_browser_collector_service_request_invalid');
    }
    return {
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      browserBindingId: candidate.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.collection_series.detail',
      executionTarget: 'collector_work_tab',
      input: {
        canonicalProfileUrl,
        stableSeriesId: input.stableSeriesId,
        listType: input.listType
      }
    };
  }
  if (candidate.capability === 'bilibili.danmaku') {
    if (executionTarget !== 'collector_work_tab') throw new Error('user_browser_collector_service_request_invalid');
    if (Object.keys(input).length !== 1 || typeof input.canonicalVideoUrl !== 'string') {
      throw new Error('user_browser_collector_service_request_invalid');
    }
    const canonicalVideoUrl = canonicalBilibiliPassiveVideoWorkUrl(input.canonicalVideoUrl);
    if (!canonicalVideoUrl) throw new Error('user_browser_collector_service_request_invalid');
    return {
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      browserBindingId: candidate.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.danmaku',
      executionTarget: 'collector_work_tab',
      input: { canonicalVideoUrl }
    };
  }
  throw new Error('user_browser_collector_service_request_invalid');
}
