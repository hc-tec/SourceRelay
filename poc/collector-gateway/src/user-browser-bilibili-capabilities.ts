/**
 * Public capability truth for the user-owned-browser lane.
 *
 * This catalog deliberately lists every Bilibili collection capability that
 * already exists in the repository, while separating its legacy implementation
 * from whether it has been migrated into the signed direct extension-work
 * protocol. A name in this list is never an implicit Browser Host fallback.
 */
export type UserBrowserBilibiliCapability =
  | 'bilibili.native_search'
  | 'bilibili.native_search_batch'
  | 'bilibili.account_profile'
  | 'bilibili.account_inventory'
  | 'bilibili.account_inventory.pagination'
  | 'bilibili.video_detail'
  | 'bilibili.transcript'
  | 'bilibili.discussion'
  | 'bilibili.danmaku'
  | 'bilibili.dynamic'
  | 'bilibili.collection_series.overview'
  | 'bilibili.collection_series.detail';

export type UserBrowserBilibiliCapabilityDispatchState =
  | 'direct_ready'
  | 'direct_canary_pending'
  | 'direct_migration_required'
  | 'trusted_interaction_migration_required';
export type UserBrowserBilibiliCapabilityInputMode =
  | 'query'
  | 'query_and_fixed_pages'
  | 'canonical_profile_url'
  | 'canonical_profile_url_and_fixed_page_budget'
  | 'canonical_video_url'
  | 'canonical_video_url_and_fixed_action_plan'
  | 'profile_url_series_id_and_fixed_page_budget';
export type UserBrowserBilibiliCapabilityCaptureMode =
  | 'dom_only'
  | 'passive_dom_projection'
  | 'passive_player_dom_projection'
  | 'multi_page_navigation'
  | 'bounded_page_navigation'
  | 'subtitle_menu_and_text_track'
  | 'scroll_sort_and_thread_expansion'
  | 'dom_and_fixed_network_metadata';

export interface UserBrowserBilibiliCapabilityDescriptor {
  schemaVersion: 1;
  capability: UserBrowserBilibiliCapability;
  platform: 'bilibili';
  title: string;
  inputMode: UserBrowserBilibiliCapabilityInputMode;
  dispatchState: UserBrowserBilibiliCapabilityDispatchState;
  captureMode: UserBrowserBilibiliCapabilityCaptureMode;
  legacyImplementationPresent: true;
  browserHostFallback: 'forbidden';
}

export const USER_BROWSER_BILIBILI_CAPABILITIES = [
  descriptor('bilibili.native_search', 'B站站内搜索', 'query', 'direct_ready', 'dom_only'),
  descriptor('bilibili.native_search_batch', 'B站站内搜索多页批量', 'query_and_fixed_pages', 'direct_migration_required', 'multi_page_navigation'),
  descriptor('bilibili.account_profile', 'UP 主公开资料', 'canonical_profile_url', 'direct_ready', 'passive_dom_projection'),
  descriptor('bilibili.account_inventory', 'UP 主视频首屏', 'canonical_profile_url', 'direct_ready', 'passive_dom_projection'),
  descriptor('bilibili.account_inventory.pagination', 'UP 主视频有界翻页', 'canonical_profile_url_and_fixed_page_budget', 'direct_migration_required', 'bounded_page_navigation'),
  descriptor('bilibili.video_detail', '视频公开详情', 'canonical_video_url', 'direct_ready', 'dom_only'),
  descriptor('bilibili.transcript', '视频字幕', 'canonical_video_url', 'trusted_interaction_migration_required', 'subtitle_menu_and_text_track'),
  descriptor('bilibili.discussion', '视频评论区', 'canonical_video_url_and_fixed_action_plan', 'trusted_interaction_migration_required', 'scroll_sort_and_thread_expansion'),
  descriptor('bilibili.danmaku', '视频弹幕可见 DOM', 'canonical_video_url', 'direct_canary_pending', 'passive_player_dom_projection'),
  descriptor('bilibili.dynamic', 'UP 主动态', 'canonical_profile_url', 'direct_canary_pending', 'passive_dom_projection'),
  descriptor('bilibili.collection_series.overview', 'UP 主合集与系列概览', 'canonical_profile_url', 'direct_canary_pending', 'passive_dom_projection'),
  descriptor('bilibili.collection_series.detail', '单个合集或系列详情', 'profile_url_series_id_and_fixed_page_budget', 'direct_canary_pending', 'passive_dom_projection')
] as const satisfies readonly UserBrowserBilibiliCapabilityDescriptor[];

export function listUserBrowserBilibiliCapabilities(): UserBrowserBilibiliCapabilityDescriptor[] {
  return USER_BROWSER_BILIBILI_CAPABILITIES.map((value) => ({ ...value }));
}

export function isDirectReadyUserBrowserBilibiliCapability(
  value: string
): value is Extract<
  UserBrowserBilibiliCapability,
  'bilibili.native_search' | 'bilibili.video_detail' | 'bilibili.account_profile' | 'bilibili.account_inventory'
> {
  return value === 'bilibili.native_search' || value === 'bilibili.video_detail' ||
    value === 'bilibili.account_profile' || value === 'bilibili.account_inventory';
}

function descriptor(
  capability: UserBrowserBilibiliCapability,
  title: string,
  inputMode: UserBrowserBilibiliCapabilityInputMode,
  dispatchState: UserBrowserBilibiliCapabilityDispatchState,
  captureMode: UserBrowserBilibiliCapabilityCaptureMode
): UserBrowserBilibiliCapabilityDescriptor {
  return {
    schemaVersion: 1,
    capability,
    platform: 'bilibili',
    title,
    inputMode,
    dispatchState,
    captureMode,
    legacyImplementationPresent: true,
    browserHostFallback: 'forbidden'
  };
}
