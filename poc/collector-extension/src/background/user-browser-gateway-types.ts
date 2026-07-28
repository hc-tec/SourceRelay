import type {
  BrowserBindingSummary,
  GatewayPairingSummary
} from '@intelligence/collector-contracts';

export const LOOPBACK_PERMISSION = 'http://127.0.0.1/*';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const EXTENSION_ID = /^[a-p]{32}$/;
export const SAFE_ERROR = /^[a-z0-9_.-]{1,120}$/i;

/**
 * The only signed direct work kinds this installed MV3 runtime can execute.
 * This local allow-list is deliberately separate from the older static
 * research Strategy registry: a catalog entry cannot turn into browser work
 * unless both the Gateway and this extension agree on it.
 */
export const USER_BROWSER_DIRECT_WORK_CAPABILITIES = [
  'bilibili.video_detail',
  'bilibili.native_search',
  'bilibili.native_search_batch',
  'bilibili.account_profile',
  'bilibili.account_inventory',
  'bilibili.discussion',
  'xiaohongshu.search.public_notes.v1',
  'xiaohongshu.account.public_notes.v1'
] as const;

export type UserBrowserDirectWorkCapability =
  (typeof USER_BROWSER_DIRECT_WORK_CAPABILITIES)[number];

export type UserBrowserGatewayCapabilityDispatchState =
  | 'direct_ready'
  | 'direct_canary_pending'
  | 'direct_gateway_dispatch_pending'
  | 'direct_migration_required'
  | 'trusted_interaction_migration_required';

export interface UserBrowserGatewayBilibiliCapabilityDescriptor {
  schemaVersion: 1;
  capability: UserBrowserDirectWorkCapability;
  platform: 'bilibili';
  title: string;
  inputMode: string;
  dispatchState: UserBrowserGatewayCapabilityDispatchState;
  captureMode: string;
  legacyImplementationPresent: true;
  browserHostFallback: 'forbidden';
}

export interface UserBrowserGatewayXiaohongshuCapabilityDescriptor {
  schemaVersion: 1;
  capability: 'xiaohongshu.search.public_notes.v1' | 'xiaohongshu.account.public_notes.v1';
  platform: 'xiaohongshu';
  title: string;
  inputMode: string;
  dispatchState: 'direct_ready' | 'direct_canary_pending';
  captureMode: string;
  browserHostFallback: 'forbidden';
}

export type UserBrowserGatewayCapabilityDescriptor =
  | UserBrowserGatewayBilibiliCapabilityDescriptor
  | UserBrowserGatewayXiaohongshuCapabilityDescriptor;

export interface PairUserBrowserGatewayInput {
  loopbackOrigin: string;
  identityFingerprint: string;
  pairingSessionId: string;
  pairingCode: string;
}

export type UserBrowserGatewayConnectionState = 'unpaired' | 'online' | 'offline';

export interface UserBrowserGatewayConnection {
  state: UserBrowserGatewayConnectionState;
  pairing: GatewayPairingSummary | null;
  binding: BrowserBindingSummary | null;
  errorCode: string | null;
}
