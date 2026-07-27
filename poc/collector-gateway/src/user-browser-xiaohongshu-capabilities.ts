import {
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET,
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY,
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_POLICY
} from '@intelligence/collector-contracts';

/**
 * This descriptor is intentionally catalog-only.  It lets an upper
 * application learn the exact safety boundary before it asks for work, while
 * making it impossible to mistake an unadmitted network route for a working
 * data source.
 */
export interface UserBrowserXiaohongshuCapabilityDescriptor {
  schemaVersion: 1;
  capability: typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY;
  platform: 'xiaohongshu';
  title: string;
  inputMode: 'explicit_current_page_selection_no_caller_url';
  executionTarget: 'user_selected_tab';
  dispatchState: 'policy_ready_route_admission_required';
  captureMode: 'prearmed_same_document_network_metadata';
  responseBodies: 'not_read';
  routeAdmission: 'no_public_content_route_admitted';
  budget: typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET;
  browserHostFallback: 'forbidden';
}

export const USER_BROWSER_XIAOHONGSHU_CAPABILITIES = [
  {
    schemaVersion: 1,
    capability: XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY,
    platform: 'xiaohongshu',
    title: '小红书当前已选页网络元数据',
    inputMode: 'explicit_current_page_selection_no_caller_url',
    executionTarget: XIAOHONGSHU_CURRENT_PAGE_NETWORK_POLICY.executionTarget,
    dispatchState: 'policy_ready_route_admission_required',
    captureMode: 'prearmed_same_document_network_metadata',
    responseBodies: XIAOHONGSHU_CURRENT_PAGE_NETWORK_POLICY.responseBodies,
    routeAdmission: 'no_public_content_route_admitted',
    budget: XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET,
    browserHostFallback: 'forbidden'
  }
] as const satisfies readonly UserBrowserXiaohongshuCapabilityDescriptor[];

export function listUserBrowserXiaohongshuCapabilities(): UserBrowserXiaohongshuCapabilityDescriptor[] {
  return USER_BROWSER_XIAOHONGSHU_CAPABILITIES.map((value) => ({
    ...value,
    budget: { ...value.budget }
  }));
}
