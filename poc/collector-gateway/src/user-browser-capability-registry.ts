import {
  enqueueBilibiliAccountInventoryUserSelectedTabWork,
  enqueueBilibiliAccountInventoryWork,
  enqueueBilibiliAccountProfileWork,
  enqueueBilibiliCollectionSeriesDetailWork,
  enqueueBilibiliCollectionSeriesOverviewWork,
  enqueueBilibiliDanmakuWork,
  enqueueBilibiliDiscussionUserSelectedTabWork,
  enqueueBilibiliDynamicWork,
  enqueueBilibiliNativeSearchBatchWork,
  enqueueBilibiliNativeSearchWork,
  enqueueBilibiliVideoDetailWork,
  enqueueXiaohongshuAccountPublicNotesWork,
  enqueueXiaohongshuNotePublicCommentsWork,
  enqueueXiaohongshuNotePublicDetailWork,
  enqueueXiaohongshuPublicNotesSearchWork,
  enqueueXiaohongshuReplyWork,
  type ExtensionWorkRouteContext
} from './extension-work-routes';
import type { ExtensionWorkOperationSummary } from './extension-work-queue';
import type { UserBrowserCollectorServiceRequest } from './user-browser-collector-service-contract';

export type UserBrowserExecutableCapability = UserBrowserCollectorServiceRequest['capability'];

type RequestFor<C extends UserBrowserExecutableCapability> = Extract<
  UserBrowserCollectorServiceRequest,
  { capability: C }
>;

export interface UserBrowserCapabilityRegistryEntry<C extends UserBrowserExecutableCapability> {
  capability: C;
  dispatch: (
    context: ExtensionWorkRouteContext,
    request: RequestFor<C>
  ) => Promise<ExtensionWorkOperationSummary>;
}

type UserBrowserCapabilityRegistry = {
  [C in UserBrowserExecutableCapability]: UserBrowserCapabilityRegistryEntry<C>;
};

/**
 * The only executable dispatch table for the user-owned-browser `/v2` lane.
 * Request validation remains in the wire-contract parser; this registry owns
 * the capability-to-enqueue mapping and does not expose a generic fallback.
 */
export const USER_BROWSER_CAPABILITY_REGISTRY: UserBrowserCapabilityRegistry = {
  'bilibili.video_detail': {
    capability: 'bilibili.video_detail',
    dispatch: (context, request) => enqueueBilibiliVideoDetailWork(
      context,
      request.browserBindingId,
      request.input.canonicalVideoUrl
    )
  },
  'bilibili.native_search': {
    capability: 'bilibili.native_search',
    dispatch: (context, request) => enqueueBilibiliNativeSearchWork(
      context,
      request.browserBindingId,
      request.input.query
    )
  },
  'bilibili.native_search_batch': {
    capability: 'bilibili.native_search_batch',
    dispatch: (context, request) => enqueueBilibiliNativeSearchBatchWork(
      context,
      request.browserBindingId,
      request.input.query
    )
  },
  'bilibili.account_profile': {
    capability: 'bilibili.account_profile',
    dispatch: (context, request) => enqueueBilibiliAccountProfileWork(
      context,
      request.browserBindingId,
      request.input.canonicalProfileUrl
    )
  },
  'bilibili.account_inventory': {
    capability: 'bilibili.account_inventory',
    dispatch: (context, request) => request.executionTarget === 'user_selected_tab'
      ? enqueueBilibiliAccountInventoryUserSelectedTabWork(
        context,
        request.browserBindingId,
        request.input.canonicalProfileUrl
      )
      : enqueueBilibiliAccountInventoryWork(
        context,
        request.browserBindingId,
        request.input.canonicalProfileUrl
      )
  },
  'bilibili.dynamic': {
    capability: 'bilibili.dynamic',
    dispatch: (context, request) => enqueueBilibiliDynamicWork(
      context,
      request.browserBindingId,
      request.input.canonicalProfileUrl
    )
  },
  'bilibili.collection_series.overview': {
    capability: 'bilibili.collection_series.overview',
    dispatch: (context, request) => enqueueBilibiliCollectionSeriesOverviewWork(
      context,
      request.browserBindingId,
      request.input.canonicalProfileUrl
    )
  },
  'bilibili.collection_series.detail': {
    capability: 'bilibili.collection_series.detail',
    dispatch: (context, request) => enqueueBilibiliCollectionSeriesDetailWork(
      context,
      request.browserBindingId,
      request.input.canonicalProfileUrl,
      request.input.stableSeriesId,
      request.input.listType
    )
  },
  'bilibili.danmaku': {
    capability: 'bilibili.danmaku',
    dispatch: (context, request) => enqueueBilibiliDanmakuWork(
      context,
      request.browserBindingId,
      request.input.canonicalVideoUrl
    )
  },
  'bilibili.discussion': {
    capability: 'bilibili.discussion',
    dispatch: (context, request) => enqueueBilibiliDiscussionUserSelectedTabWork(
      context,
      request.browserBindingId,
      request.input.canonicalVideoUrl
    )
  },
  'xiaohongshu.search.public_notes.v1': {
    capability: 'xiaohongshu.search.public_notes.v1',
    dispatch: (context, request) => enqueueXiaohongshuPublicNotesSearchWork(
      context,
      request.browserBindingId,
      request.input.query,
      request.input.maximumDetails,
      request.input.comments
    )
  },
  'xiaohongshu.account.public_notes.v1': {
    capability: 'xiaohongshu.account.public_notes.v1',
    dispatch: (context, request) => enqueueXiaohongshuAccountPublicNotesWork(
      context,
      request.browserBindingId,
      request.input.maximumScrolls,
      request.executionTarget === 'ephemeral_public_profile_url' ? request.input.profileUrl : undefined,
      request.executionTarget === 'discover_public_profile_from_note'
    )
  },
  'xiaohongshu.note.public_detail.v1': {
    capability: 'xiaohongshu.note.public_detail.v1',
    dispatch: (context, request) => enqueueXiaohongshuNotePublicDetailWork(
      context,
      request.browserBindingId,
      request.input.resultRank,
      request.executionTarget
    )
  },
  'xiaohongshu.note.public_comments.v1': {
    capability: 'xiaohongshu.note.public_comments.v1',
    dispatch: (context, request) => enqueueXiaohongshuNotePublicCommentsWork(
      context,
      request.browserBindingId,
      request.input.maximumScrolls
    )
  },
  'xiaohongshu.note.public_comment_replies.v1': {
    capability: 'xiaohongshu.note.public_comment_replies.v1',
    dispatch: (context, request) => enqueueXiaohongshuReplyWork(
      context,
      request.browserBindingId,
      request.input.maximumThreads
    )
  }
};

export function listUserBrowserExecutableCapabilities(): UserBrowserExecutableCapability[] {
  return Object.keys(USER_BROWSER_CAPABILITY_REGISTRY) as UserBrowserExecutableCapability[];
}

export function isUserBrowserExecutableCapability(
  value: string
): value is UserBrowserExecutableCapability {
  return Object.prototype.hasOwnProperty.call(USER_BROWSER_CAPABILITY_REGISTRY, value);
}

export async function dispatchUserBrowserCapability(
  context: ExtensionWorkRouteContext,
  request: UserBrowserCollectorServiceRequest
): Promise<ExtensionWorkOperationSummary> {
  const entry = USER_BROWSER_CAPABILITY_REGISTRY[request.capability] as UserBrowserCapabilityRegistryEntry<UserBrowserExecutableCapability>;
  if (!entry) throw new Error('user_browser_capability_dispatch_unavailable');
  return await entry.dispatch(context, request as never);
}
