import type {
  BrowserBindingSummary,
  GatewayPairingSummary
} from '@intelligence/collector-contracts';

export const LOOPBACK_PERMISSION = 'http://127.0.0.1/*';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const EXTENSION_ID = /^[a-p]{32}$/;
export const SAFE_ERROR = /^[a-z0-9_.-]{1,120}$/i;

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
