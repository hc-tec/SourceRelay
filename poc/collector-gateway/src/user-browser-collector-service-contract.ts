import {
  canonicalXiaohongshuPublicProfileUrl,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_MAX_DETAILS,
  type XiaohongshuProfileScrollCount,
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
  executionTarget: 'collector_work_tab' | 'user_selected_tab' | 'ephemeral_public_profile_url' | 'discover_public_profile_from_note';
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

/**
 * A zero-navigation comments projection. The user has already opened the
 * video and manually made comments visible before the extension popup creates
 * its short-lived, one-time tab/document lease. The upper application can name
 * only the canonical public BV URL.
 */
export interface UserBrowserVideoDiscussionCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.discussion';
  executionTarget: 'user_selected_tab';
  input: { canonicalVideoUrl: string };
}

export interface UserBrowserXiaohongshuPublicNotesSearchCollectorServiceRequest {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: 'xiaohongshu.search.public_notes.v1';
  executionTarget: 'existing_public_explore_tab';
  input: { query: string; maximumDetails?: number; comments?: { maximumScrolls: 1 | 2 | 3; replies?: { maximumThreads: 1 | 2 | 3 } } };
}

export interface UserBrowserXiaohongshuAccountPublicNotesCollectorServiceRequest {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: 'xiaohongshu.account.public_notes.v1';
  executionTarget: 'existing_public_profile_tab' | 'ephemeral_public_profile_url' | 'discover_public_profile_from_note';
  input: { maximumScrolls: XiaohongshuProfileScrollCount; profileUrl?: string };
}

export interface UserBrowserXiaohongshuNotePublicDetailCollectorServiceRequest {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: 'xiaohongshu.note.public_detail.v1';
  executionTarget: 'existing_public_search_tab' | 'existing_public_profile_tab';
  input: { resultRank: number };
}
export interface UserBrowserXiaohongshuNotePublicCommentsCollectorServiceRequest {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  browserBindingId: string; platform: 'xiaohongshu'; capability: 'xiaohongshu.note.public_comments.v1';
  executionTarget: 'existing_public_note_overlay'; input: { maximumScrolls: 1 | 2 | 3 };
}
export interface UserBrowserXiaohongshuReplyCollectorServiceRequest {schemaVersion:typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  browserBindingId:string;platform:'xiaohongshu';capability:'xiaohongshu.note.public_comment_replies.v1';
  executionTarget:'existing_public_note_overlay';input:{maximumThreads:1|2|3};}

export type UserBrowserCollectorServiceRequest =
  | UserBrowserVideoDetailCollectorServiceRequest
  | UserBrowserNativeSearchCollectorServiceRequest
  | UserBrowserNativeSearchBatchCollectorServiceRequest
  | UserBrowserAccountProfileCollectorServiceRequest
  | UserBrowserAccountInventoryCollectorServiceRequest
  | UserBrowserDynamicCollectorServiceRequest
  | UserBrowserCollectionSeriesOverviewCollectorServiceRequest
  | UserBrowserCollectionSeriesDetailCollectorServiceRequest
  | UserBrowserDanmakuCollectorServiceRequest
  | UserBrowserVideoDiscussionCollectorServiceRequest
  | UserBrowserXiaohongshuPublicNotesSearchCollectorServiceRequest
  | UserBrowserXiaohongshuAccountPublicNotesCollectorServiceRequest
  | UserBrowserXiaohongshuNotePublicDetailCollectorServiceRequest
  | UserBrowserXiaohongshuNotePublicCommentsCollectorServiceRequest
  | UserBrowserXiaohongshuReplyCollectorServiceRequest;

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
    (candidate.platform !== 'bilibili' && candidate.platform !== 'xiaohongshu') ||
    (executionTarget !== 'collector_work_tab' && executionTarget !== 'user_selected_tab' &&
      executionTarget !== 'existing_public_explore_tab' && executionTarget !== 'existing_public_profile_tab' &&
      executionTarget !== 'existing_public_search_tab' && executionTarget !== 'existing_public_note_overlay' &&
      executionTarget !== 'ephemeral_public_profile_url' && executionTarget !== 'discover_public_profile_from_note') ||
    !candidate.input ||
    typeof candidate.input !== 'object' || Array.isArray(candidate.input)
  ) throw new Error('user_browser_collector_service_request_invalid');
  const input = candidate.input as Record<string, unknown>;
  if (candidate.platform === 'xiaohongshu') {
    if(candidate.capability==='xiaohongshu.note.public_comment_replies.v1'){
      if(executionTarget!=='existing_public_note_overlay'||Object.keys(input).length!==1||
        (input.maximumThreads!==1&&input.maximumThreads!==2&&input.maximumThreads!==3))
        throw new Error('user_browser_collector_service_request_invalid');
      return{schemaVersion:USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,browserBindingId:candidate.browserBindingId,
        platform:'xiaohongshu',capability:'xiaohongshu.note.public_comment_replies.v1',
        executionTarget:'existing_public_note_overlay',input:{maximumThreads:input.maximumThreads}};}
    if (candidate.capability === 'xiaohongshu.note.public_comments.v1') {
      if (executionTarget !== 'existing_public_note_overlay' || Object.keys(input).length !== 1 ||
        (input.maximumScrolls !== 1 && input.maximumScrolls !== 2 && input.maximumScrolls !== 3)) {
        throw new Error('user_browser_collector_service_request_invalid');
      }
      return { schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
        browserBindingId: candidate.browserBindingId, platform: 'xiaohongshu',
        capability: 'xiaohongshu.note.public_comments.v1', executionTarget: 'existing_public_note_overlay',
        input: { maximumScrolls: input.maximumScrolls } };
    }
    if (candidate.capability === 'xiaohongshu.note.public_detail.v1') {
      if ((executionTarget !== 'existing_public_search_tab' && executionTarget !== 'existing_public_profile_tab') ||
        Object.keys(input).length !== 1 ||
        !Number.isSafeInteger(input.resultRank) || Number(input.resultRank) < 1 || Number(input.resultRank) > 20) {
        throw new Error('user_browser_collector_service_request_invalid');
      }
      return {
        schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
        browserBindingId: candidate.browserBindingId,
        platform: 'xiaohongshu',
        capability: 'xiaohongshu.note.public_detail.v1',
        executionTarget,
        input: { resultRank: Number(input.resultRank) }
      };
    }
    if (candidate.capability === 'xiaohongshu.account.public_notes.v1') {
      const existingProfileTab = executionTarget === 'existing_public_profile_tab' &&
        Object.keys(input).length === 1;
      const discoveredProfile = executionTarget === 'discover_public_profile_from_note' &&
        Object.keys(input).length === 1;
      const canonicalProfileUrl = typeof input.profileUrl === 'string'
        ? canonicalXiaohongshuPublicProfileUrl(input.profileUrl) : null;
      const ephemeralProfileUrl = executionTarget === 'ephemeral_public_profile_url' &&
        Object.keys(input).length === 2 && canonicalProfileUrl !== null;
      const maximumScrolls = typeof input.maximumScrolls === 'number' ? input.maximumScrolls : null;
      if ((!existingProfileTab && !ephemeralProfileUrl && !discoveredProfile) ||
        maximumScrolls === null || !Number.isSafeInteger(maximumScrolls) || maximumScrolls < 1 ||
        maximumScrolls > (ephemeralProfileUrl || discoveredProfile ? 20 : 3)) {
        throw new Error('user_browser_collector_service_request_invalid');
      }
      const boundedMaximumScrolls = maximumScrolls as XiaohongshuProfileScrollCount;
      return {
        schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
        browserBindingId: candidate.browserBindingId,
        platform: 'xiaohongshu',
        capability: 'xiaohongshu.account.public_notes.v1',
        executionTarget: ephemeralProfileUrl ? 'ephemeral_public_profile_url'
          : discoveredProfile ? 'discover_public_profile_from_note' : 'existing_public_profile_tab',
        input: ephemeralProfileUrl
          ? { maximumScrolls: boundedMaximumScrolls, profileUrl: canonicalProfileUrl! }
          : { maximumScrolls: boundedMaximumScrolls }
      };
    }
    if (candidate.capability !== 'xiaohongshu.search.public_notes.v1' ||
      executionTarget !== 'existing_public_explore_tab' ||
      !validXiaohongshuSearchInput(input) ||
      typeof input.query !== 'string' || input.query !== input.query.trim() || input.query.length < 1 ||
      input.query.length > 80 || /[\u0000-\u001f\u007f]/.test(input.query)) {
      throw new Error('user_browser_collector_service_request_invalid');
    }
    const maximumDetails = Object.hasOwn(input, 'maximumDetails') ? Number(input.maximumDetails) : undefined;
    return {
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      browserBindingId: candidate.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      input: {
        query: input.query,
        ...(maximumDetails === undefined ? {} : { maximumDetails }),
        ...(input.comments === undefined ? {} : { comments: input.comments })
      }
    };
  }
  if (executionTarget !== 'collector_work_tab' && executionTarget !== 'user_selected_tab') {
    throw new Error('user_browser_collector_service_request_invalid');
  }
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
  if (candidate.capability === 'bilibili.discussion') {
    if (executionTarget !== 'user_selected_tab') throw new Error('user_browser_collector_service_request_invalid');
    if (Object.keys(input).length !== 1 || typeof input.canonicalVideoUrl !== 'string') {
      throw new Error('user_browser_collector_service_request_invalid');
    }
    const canonicalVideoUrl = canonicalBilibiliPassiveVideoWorkUrl(input.canonicalVideoUrl);
    if (!canonicalVideoUrl) throw new Error('user_browser_collector_service_request_invalid');
    return {
      schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
      browserBindingId: candidate.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.discussion',
      executionTarget: 'user_selected_tab',
      input: { canonicalVideoUrl }
    };
  }
  throw new Error('user_browser_collector_service_request_invalid');
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validXiaohongshuSearchInput(
  input: Record<string, unknown>
): input is Record<string, unknown> & {
  query: string;
  maximumDetails?: number;
  comments?: { maximumScrolls: 1 | 2 | 3; replies?: { maximumThreads: 1 | 2 | 3 } };
} {
  const keys = Object.keys(input);
  if (!keys.every((key) => key === 'query' || key === 'maximumDetails' || key === 'comments')) return false;
  if (Object.hasOwn(input, 'maximumDetails') &&
    (!Number.isSafeInteger(input.maximumDetails) || Number(input.maximumDetails) < 0 ||
      Number(input.maximumDetails) > XIAOHONGSHU_PUBLIC_NOTES_SEARCH_MAX_DETAILS)) return false;
  if (!Object.hasOwn(input, 'comments')) return true;
  if (typeof input.maximumDetails !== 'number' || input.maximumDetails <= 0 ||
    !input.comments || typeof input.comments !== 'object' || Array.isArray(input.comments)) return false;
  const comments = input.comments as Record<string, unknown>;
  const commentKeys = Object.keys(comments);
  if ((commentKeys.length !== 1 && commentKeys.length !== 2) || !Object.hasOwn(comments, 'maximumScrolls') ||
    (comments.maximumScrolls !== 1 && comments.maximumScrolls !== 2 && comments.maximumScrolls !== 3)) return false;
  if (!Object.hasOwn(comments, 'replies')) return commentKeys.length === 1;
  if (commentKeys.length !== 2 || !comments.replies || typeof comments.replies !== 'object' || Array.isArray(comments.replies)) return false;
  const replies = comments.replies as Record<string, unknown>;
  return exactKeys(replies, ['maximumThreads']) &&
    (replies.maximumThreads === 1 || replies.maximumThreads === 2 || replies.maximumThreads === 3);
}
