import {
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET,
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY,
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_POLICY,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_CAPABILITY
} from '@intelligence/collector-contracts';

/**
 * This descriptor is intentionally catalog-only.  It lets an upper
 * application learn the exact safety boundary before it asks for work, while
 * making it impossible to mistake an unadmitted network route for a working
 * data source.
 */
export interface UserBrowserXiaohongshuNetworkMetadataCapabilityDescriptor {
  schemaVersion: 1;
  capability: typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY;
  platform: 'xiaohongshu';
  title: string;
  inputMode: 'explicit_current_page_selection_no_caller_url';
  executionTarget: 'user_selected_tab';
  accountScopedSurfaces: 'forbidden';
  dispatchState: 'policy_ready_route_admission_required';
  captureMode: 'prearmed_same_document_network_metadata';
  responseBodies: 'not_read';
  routeAdmission: 'no_public_content_route_admitted';
  budget: typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET;
  browserHostFallback: 'forbidden';
}

export interface UserBrowserXiaohongshuPublicNotesSearchCapabilityDescriptor {
  schemaVersion: 1;
  capability: typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_CAPABILITY;
  platform: 'xiaohongshu';
  title: string;
  inputMode: 'query_only_no_caller_url';
  executionTarget: 'existing_public_explore_tab';
  accountScopedSurfaces: 'forbidden';
  dispatchState: 'trusted_browser_input_channel_required';
  managedValidationState: 'real_canary_passed';
  captureMode: 'current_document_main_world_public_projection';
  responseBodies: 'temporarily_read_projected_not_stored';
  routeAdmission: 'public_payload_shape_verified_no_url_dependency';
  budget: typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET;
  browserHostFallback: 'forbidden';
}

export type UserBrowserXiaohongshuCapabilityDescriptor =
  | UserBrowserXiaohongshuNetworkMetadataCapabilityDescriptor
  | UserBrowserXiaohongshuPublicNotesSearchCapabilityDescriptor;

export const USER_BROWSER_XIAOHONGSHU_CAPABILITIES = [
  {
    schemaVersion: 1,
    capability: XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY,
    platform: 'xiaohongshu',
    title: '小红书当前已选页网络元数据',
    inputMode: 'explicit_current_page_selection_no_caller_url',
    executionTarget: XIAOHONGSHU_CURRENT_PAGE_NETWORK_POLICY.executionTarget,
    accountScopedSurfaces: XIAOHONGSHU_CURRENT_PAGE_NETWORK_POLICY.accountScopedSurfaces,
    dispatchState: 'policy_ready_route_admission_required',
    captureMode: 'prearmed_same_document_network_metadata',
    responseBodies: XIAOHONGSHU_CURRENT_PAGE_NETWORK_POLICY.responseBodies,
    routeAdmission: 'no_public_content_route_admitted',
    budget: XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET,
    browserHostFallback: 'forbidden'
  },
  {
    schemaVersion: 1,
    capability: XIAOHONGSHU_PUBLIC_NOTES_SEARCH_CAPABILITY,
    platform: 'xiaohongshu',
    title: '小红书公开笔记站内搜索',
    inputMode: 'query_only_no_caller_url',
    executionTarget: 'existing_public_explore_tab',
    accountScopedSurfaces: 'forbidden',
    dispatchState: 'trusted_browser_input_channel_required',
    managedValidationState: 'real_canary_passed',
    captureMode: 'current_document_main_world_public_projection',
    responseBodies: 'temporarily_read_projected_not_stored',
    routeAdmission: 'public_payload_shape_verified_no_url_dependency',
    budget: XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET,
    browserHostFallback: 'forbidden'
  }
] as const satisfies readonly UserBrowserXiaohongshuCapabilityDescriptor[];

export function listUserBrowserXiaohongshuCapabilities(): UserBrowserXiaohongshuCapabilityDescriptor[] {
  return USER_BROWSER_XIAOHONGSHU_CAPABILITIES.map((value) => value.capability === XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY
    ? { ...value, budget: { ...value.budget } }
    : { ...value, budget: { ...value.budget } });
}
