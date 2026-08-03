import type { XiaohongshuProfileScrollCount } from '@intelligence/collector-contracts';
import { USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION } from '@intelligence/collector-contracts';
import { parseUserBrowserCollectorServiceRequest } from './user-browser-capability-registry.js';

export { USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION };

interface UserBrowserCollectorServiceRequestBase {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  clientRequestId: string;
  browserBindingId: string;
  platform: 'bilibili';
  executionTarget: 'collector_work_tab' | 'user_selected_tab' | 'ephemeral_public_profile_url' | 'discover_public_profile_from_note';
}

export interface UserBrowserVideoDetailCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.video_detail';
  executionTarget: 'collector_work_tab';
  input: { canonicalVideoUrl: string };
}

/** Native search exposes only a phrase; route, order, page and URL are fixed. */
export interface UserBrowserNativeSearchCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.native_search';
  executionTarget: 'collector_work_tab';
  input: { query: string };
}

/** Fixed page 1 then page 2; applications cannot supply a page list or URL. */
export interface UserBrowserNativeSearchBatchCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.native_search_batch';
  executionTarget: 'collector_work_tab';
  input: { query: string };
}

/** A caller may name one public account identity, never an arbitrary space URL. */
export interface UserBrowserAccountProfileCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.account_profile';
  executionTarget: 'collector_work_tab';
  input: { canonicalProfileUrl: string };
}

/** Fixed first page of an account's public video inventory; pagination is separate. */
export interface UserBrowserAccountInventoryCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.account_inventory';
  /** `user_selected_tab` is a single-use passive observation lease created by the extension popup. */
  executionTarget: 'collector_work_tab' | 'user_selected_tab';
  input: { canonicalProfileUrl: string };
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
  input: { canonicalProfileUrl: string; stableSeriesId: string; listType: 'series' | 'season' };
}

export interface UserBrowserDanmakuCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.danmaku';
  executionTarget: 'collector_work_tab';
  input: { canonicalVideoUrl: string };
}

/** The extension opens or reuses its managed work tab and scrolls once to the public comments host. */
export interface UserBrowserVideoDiscussionCollectorServiceRequest extends UserBrowserCollectorServiceRequestBase {
  capability: 'bilibili.discussion';
  executionTarget: 'collector_work_tab';
  input: { canonicalVideoUrl: string };
}

export interface UserBrowserXiaohongshuPublicNotesSearchCollectorServiceRequest {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  clientRequestId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: 'xiaohongshu.search.public_notes.v1';
  executionTarget: 'existing_public_explore_tab';
  input: { query: string; maximumDetails?: number; comments?: { maximumScrolls: 1 | 2 | 3; replies?: { maximumThreads: 1 | 2 | 3 } } };
}

export interface UserBrowserXiaohongshuAccountPublicNotesCollectorServiceRequest {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  clientRequestId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: 'xiaohongshu.account.public_notes.v1';
  executionTarget: 'existing_public_profile_tab' | 'ephemeral_public_profile_url' | 'discover_public_profile_from_note';
  input: { maximumScrolls: XiaohongshuProfileScrollCount; profileUrl?: string };
}

export interface UserBrowserXiaohongshuNotePublicDetailCollectorServiceRequest {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  clientRequestId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: 'xiaohongshu.note.public_detail.v1';
  executionTarget: 'existing_public_search_tab' | 'existing_public_profile_tab';
  input: { resultRank: number };
}

export interface UserBrowserXiaohongshuNotePublicCommentsCollectorServiceRequest {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  clientRequestId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: 'xiaohongshu.note.public_comments.v1';
  executionTarget: 'existing_public_note_overlay';
  input: { maximumScrolls: 1 | 2 | 3 };
}

export interface UserBrowserXiaohongshuReplyCollectorServiceRequest {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  clientRequestId: string;
  browserBindingId: string;
  platform: 'xiaohongshu';
  capability: 'xiaohongshu.note.public_comment_replies.v1';
  executionTarget: 'existing_public_note_overlay';
  input: { maximumThreads: 1 | 2 | 3 };
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
  | UserBrowserDanmakuCollectorServiceRequest
  | UserBrowserVideoDiscussionCollectorServiceRequest
  | UserBrowserXiaohongshuPublicNotesSearchCollectorServiceRequest
  | UserBrowserXiaohongshuAccountPublicNotesCollectorServiceRequest
  | UserBrowserXiaohongshuNotePublicDetailCollectorServiceRequest
  | UserBrowserXiaohongshuNotePublicCommentsCollectorServiceRequest
  | UserBrowserXiaohongshuReplyCollectorServiceRequest;

/**
 * Parse and normalise a production `/v2/collect` request through the typed
 * capability registry. Keeping this entry point preserves the SDK contract
 * while making the registry the sole owner of capability admission.
 */
export function userBrowserCollectorServiceRequestInput(value: unknown): UserBrowserCollectorServiceRequest {
  return parseUserBrowserCollectorServiceRequest(value);
}
