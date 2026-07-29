import {
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET,
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY,
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_POLICY,
  XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_BUDGET,
  XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_LINK_BUDGET,
  XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_CAPABILITY,
  XIAOHONGSHU_NOTE_PUBLIC_DETAIL_BUDGET,
  XIAOHONGSHU_NOTE_PUBLIC_DETAIL_CAPABILITY,
  XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_BUDGET,
  XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_CAPABILITY,
  XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_BUDGET,
  XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_MULTI_BUDGET,
  XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_CAPABILITY,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_DEPTH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_DEPTH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_DEPTH_BUDGET,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_MULTI_DEPTH_BUDGET,
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
  dispatchState: 'direct_ready';
  managedValidationState: 'gateway_extension_real_e2e_passed';
  captureMode: 'current_document_main_world_public_projection';
  responseBodies: 'temporarily_read_projected_not_stored';
  routeAdmission: 'public_payload_shape_verified_no_url_dependency';
  budget: typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET;
  depthBudget: typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_DEPTH_BUDGET;
  commentsDepthBudget: typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_DEPTH_BUDGET;
  commentsRepliesDepthBudget: typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_DEPTH_BUDGET;
  commentsRepliesMultiDepthBudget: typeof XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_MULTI_DEPTH_BUDGET;
  browserHostFallback: 'forbidden';
}

export interface UserBrowserXiaohongshuAccountPublicNotesCapabilityDescriptor {
  schemaVersion: 1;
  capability: typeof XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_CAPABILITY;
  platform: 'xiaohongshu';
  title: string;
  inputMode: 'scroll_budget_only_or_ephemeral_profile_url';
  executionTarget: 'existing_public_profile_tab' | 'ephemeral_public_profile_url';
  accountScopedSurfaces: 'public_profile_only';
  dispatchState: 'direct_canary_pending';
  managedValidationState: 'implementation_ready_live_e2e_pending';
  captureMode: 'current_document_network_projection_plus_trusted_scroll';
  responseBodies: 'temporarily_read_projected_not_stored';
  routeAdmission: 'generic_public_note_card_projection_no_url_dependency';
  budget: typeof XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_BUDGET;
  ephemeralProfileLinkBudget: typeof XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_LINK_BUDGET;
  browserHostFallback: 'forbidden';
}

export interface UserBrowserXiaohongshuNotePublicDetailCapabilityDescriptor {
  schemaVersion: 1;
  capability: typeof XIAOHONGSHU_NOTE_PUBLIC_DETAIL_CAPABILITY;
  platform: 'xiaohongshu';
  title: string;
  inputMode: 'result_rank_only_no_caller_url';
  executionTarget: 'existing_public_search_tab';
  accountScopedSurfaces: 'forbidden';
  dispatchState: 'direct_ready';
  managedValidationState: 'gateway_extension_real_e2e_passed';
  captureMode: 'network_first_dom_fallback_same_document_overlay';
  responseBodies: 'temporarily_read_projected_not_stored';
  routeAdmission: 'public_detail_shape_only_no_url_dependency';
  budget: typeof XIAOHONGSHU_NOTE_PUBLIC_DETAIL_BUDGET;
  browserHostFallback: 'forbidden';
}
export interface UserBrowserXiaohongshuNotePublicCommentsCapabilityDescriptor {
  schemaVersion: 1; capability: typeof XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_CAPABILITY; platform: 'xiaohongshu';
  title: string; inputMode: 'scroll_budget_only_no_caller_url'; executionTarget: 'existing_public_note_overlay';
  accountScopedSurfaces: 'forbidden'; dispatchState: 'direct_ready';
  managedValidationState: 'gateway_extension_real_e2e_passed';
  captureMode: 'network_first_dom_fallback_trusted_scroll'; responseBodies: 'temporarily_read_projected_not_stored';
  routeAdmission: 'generic_public_comment_shape_no_url_dependency'; budget: typeof XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_BUDGET;
  browserHostFallback: 'forbidden';
}
export interface UserBrowserXiaohongshuReplyCapabilityDescriptor{schemaVersion:1;capability:typeof XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_CAPABILITY;
  platform:'xiaohongshu';title:string;inputMode:'bounded_thread_budget_only_no_caller_identity';executionTarget:'existing_public_note_overlay';
  accountScopedSurfaces:'forbidden';dispatchState:'direct_ready';managedValidationState:'gateway_extension_real_e2e_passed';
  captureMode:'network_archive_first_dom_hierarchy_fallback_trusted_click';responseBodies:'temporarily_read_projected_not_stored';
  routeAdmission:'preloaded_public_reply_shape_no_url_dependency';budget:typeof XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_BUDGET;
  multiThreadBudget:typeof XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_MULTI_BUDGET;browserHostFallback:'forbidden'}

export type UserBrowserXiaohongshuCapabilityDescriptor =
  | UserBrowserXiaohongshuNetworkMetadataCapabilityDescriptor
  | UserBrowserXiaohongshuPublicNotesSearchCapabilityDescriptor
  | UserBrowserXiaohongshuAccountPublicNotesCapabilityDescriptor
  | UserBrowserXiaohongshuNotePublicDetailCapabilityDescriptor
  | UserBrowserXiaohongshuNotePublicCommentsCapabilityDescriptor
  | UserBrowserXiaohongshuReplyCapabilityDescriptor;

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
    dispatchState: 'direct_ready',
    managedValidationState: 'gateway_extension_real_e2e_passed',
    captureMode: 'current_document_main_world_public_projection',
    responseBodies: 'temporarily_read_projected_not_stored',
    routeAdmission: 'public_payload_shape_verified_no_url_dependency',
    budget: XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET,
    depthBudget: XIAOHONGSHU_PUBLIC_NOTES_SEARCH_DEPTH_BUDGET,
    commentsDepthBudget: XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_DEPTH_BUDGET,
    commentsRepliesDepthBudget: XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_DEPTH_BUDGET,
    commentsRepliesMultiDepthBudget: XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_MULTI_DEPTH_BUDGET,
    browserHostFallback: 'forbidden'
  },
  {
    schemaVersion: 1,
    capability: XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_CAPABILITY,
    platform: 'xiaohongshu',
    title: '小红书公开博主笔记列表',
    inputMode: 'scroll_budget_only_or_ephemeral_profile_url',
    executionTarget: 'existing_public_profile_tab',
    accountScopedSurfaces: 'public_profile_only',
    dispatchState: 'direct_canary_pending',
    managedValidationState: 'implementation_ready_live_e2e_pending',
    captureMode: 'current_document_network_projection_plus_trusted_scroll',
    responseBodies: 'temporarily_read_projected_not_stored',
    routeAdmission: 'generic_public_note_card_projection_no_url_dependency',
    budget: XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_BUDGET,
    ephemeralProfileLinkBudget: XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_LINK_BUDGET,
    browserHostFallback: 'forbidden'
  },
  {
    schemaVersion: 1,
    capability: XIAOHONGSHU_NOTE_PUBLIC_DETAIL_CAPABILITY,
    platform: 'xiaohongshu',
    title: '小红书公开笔记详情',
    inputMode: 'result_rank_only_no_caller_url',
    executionTarget: 'existing_public_search_tab',
    accountScopedSurfaces: 'forbidden',
    dispatchState: 'direct_ready',
    managedValidationState: 'gateway_extension_real_e2e_passed',
    captureMode: 'network_first_dom_fallback_same_document_overlay',
    responseBodies: 'temporarily_read_projected_not_stored',
    routeAdmission: 'public_detail_shape_only_no_url_dependency',
    budget: XIAOHONGSHU_NOTE_PUBLIC_DETAIL_BUDGET,
    browserHostFallback: 'forbidden'
  },
  {
    schemaVersion: 1, capability: XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_CAPABILITY, platform: 'xiaohongshu',
    title: '小红书公开笔记评论', inputMode: 'scroll_budget_only_no_caller_url',
    executionTarget: 'existing_public_note_overlay', accountScopedSurfaces: 'forbidden',
    dispatchState: 'direct_ready', managedValidationState: 'gateway_extension_real_e2e_passed',
    captureMode: 'network_first_dom_fallback_trusted_scroll', responseBodies: 'temporarily_read_projected_not_stored',
    routeAdmission: 'generic_public_comment_shape_no_url_dependency', budget: XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_BUDGET,
    browserHostFallback: 'forbidden'
  },
  {schemaVersion:1,capability:XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_CAPABILITY,platform:'xiaohongshu',
    title:'小红书公开评论回复',inputMode:'bounded_thread_budget_only_no_caller_identity',executionTarget:'existing_public_note_overlay',
    accountScopedSurfaces:'forbidden',dispatchState:'direct_ready',managedValidationState:'gateway_extension_real_e2e_passed',
    captureMode:'network_archive_first_dom_hierarchy_fallback_trusted_click',responseBodies:'temporarily_read_projected_not_stored',
    routeAdmission:'preloaded_public_reply_shape_no_url_dependency',budget:XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_BUDGET,
    multiThreadBudget:XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_MULTI_BUDGET,
    browserHostFallback:'forbidden'
  }
] as const satisfies readonly UserBrowserXiaohongshuCapabilityDescriptor[];

export function listUserBrowserXiaohongshuCapabilities(): UserBrowserXiaohongshuCapabilityDescriptor[] {
  return USER_BROWSER_XIAOHONGSHU_CAPABILITIES.map((value) =>
    ({
      ...value,
      budget: { ...value.budget },
      ...('ephemeralProfileLinkBudget' in value
        ? { ephemeralProfileLinkBudget: { ...value.ephemeralProfileLinkBudget } }
        : {}),
      ...('multiThreadBudget' in value
        ? { multiThreadBudget: { ...value.multiThreadBudget } }
        : {})
    }) as UserBrowserXiaohongshuCapabilityDescriptor
  );
}
