import { zhihuOfficialApiCredentialConfigured } from './zhihu-official-config';
import {
  ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY,
  ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY,
  ZHIHU_OFFICIAL_SEARCH_CAPABILITY,
  type ZhihuOfficialCapability
} from './zhihu-official-contract';

export interface OfficialSourceCapabilityDescriptor {
  schemaVersion: 1;
  capability: ZhihuOfficialCapability;
  platform: 'zhihu' | 'web';
  title: string;
  inputMode: 'query_and_count' | 'fixed_limit' | 'query_count_and_bounded_filters';
  executionTarget: 'official_api';
  executionProvider: 'zhihu_open_platform';
  dispatchState: 'direct_ready';
  runtimeState: 'ready' | 'credential_required';
  captureMode: 'official_json_api';
  credentialLocation: 'gateway_only';
  browserBindingRequired: false;
  maximumItems: 10 | 20 | 30;
}

export function listOfficialSourceCapabilities(
  credentialConfigured = zhihuOfficialApiCredentialConfigured()
): OfficialSourceCapabilityDescriptor[] {
  const runtimeState = credentialConfigured ? 'ready' as const : 'credential_required' as const;
  return [
    descriptor(
      ZHIHU_OFFICIAL_SEARCH_CAPABILITY,
      'zhihu',
      '知乎官方站内搜索',
      'query_and_count',
      10,
      runtimeState
    ),
    descriptor(
      ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY,
      'zhihu',
      '知乎官方热榜',
      'fixed_limit',
      30,
      runtimeState
    ),
    descriptor(
      ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY,
      'web',
      '知乎开放平台全网搜索',
      'query_count_and_bounded_filters',
      20,
      runtimeState
    )
  ];
}

function descriptor(
  capability: ZhihuOfficialCapability,
  platform: 'zhihu' | 'web',
  title: string,
  inputMode: OfficialSourceCapabilityDescriptor['inputMode'],
  maximumItems: OfficialSourceCapabilityDescriptor['maximumItems'],
  runtimeState: OfficialSourceCapabilityDescriptor['runtimeState']
): OfficialSourceCapabilityDescriptor {
  return {
    schemaVersion: 1,
    capability,
    platform,
    title,
    inputMode,
    executionTarget: 'official_api',
    executionProvider: 'zhihu_open_platform',
    dispatchState: 'direct_ready',
    runtimeState,
    captureMode: 'official_json_api',
    credentialLocation: 'gateway_only',
    browserBindingRequired: false,
    maximumItems
  };
}
