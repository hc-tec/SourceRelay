import {
  NETWORK_CAPTURE_OBSERVED,
  sanitiseNetworkCaptureObservation,
  type NetworkCaptureObservation
} from './network-capture';
import type { StrategyProvenance } from './strategy-registry';
import type { SupportedPlatform } from './collection-contracts';

export type { SupportedPlatform } from './collection-contracts';

export const COLLECT_VISIBLE_RESULTS = 'collector.collectVisibleResults' as const;
export const COLLECTION_RESULT = 'collector.collectionResult' as const;
export const CONTENT_READY = 'collector.contentReady' as const;
export const NETWORK_CAPTURE_BRIDGE_READY_MESSAGE = 'collector.networkCaptureBridgeReady' as const;
export const GET_CONTROL_SNAPSHOT = 'collector.getControlSnapshot' as const;
export const SYNC_STRATEGY_PERMISSIONS = 'collector.syncStrategyPermissions' as const;
export const PAIR_GATEWAY = 'collector.pairGateway' as const;
export const REVOKE_GATEWAY_PAIRING = 'collector.revokeGatewayPairing' as const;
export { NETWORK_CAPTURE_OBSERVED };

export interface VisibleSearchItem {
  rank: number;
  title: string;
  url: string;
  contentType: 'video' | 'answer_or_question' | 'article' | 'post' | 'note';
}

export interface VisibleCollectionResult {
  schemaVersion: 1;
  platform: SupportedPlatform | 'unsupported';
  operation: 'breadth_search';
  strategy: StrategyProvenance | null;
  sourceUrl: string;
  partial: true;
  itemCount: number;
  items: VisibleSearchItem[];
  warnings: string[];
}

export interface CollectVisibleResultsMessage {
  type: typeof COLLECT_VISIBLE_RESULTS;
}

export interface CollectionResultMessage {
  type: typeof COLLECTION_RESULT;
  result: VisibleCollectionResult;
}

export interface ContentReadyMessage {
  type: typeof CONTENT_READY;
  pageUrl: string;
}

export interface NetworkCaptureObservedMessage {
  type: typeof NETWORK_CAPTURE_OBSERVED;
  observation: NetworkCaptureObservation;
}

export interface NetworkCaptureBridgeReadyMessage {
  type: typeof NETWORK_CAPTURE_BRIDGE_READY_MESSAGE;
}

export interface GetControlSnapshotMessage {
  type: typeof GET_CONTROL_SNAPSHOT;
}

export interface SyncStrategyPermissionsMessage {
  type: typeof SYNC_STRATEGY_PERMISSIONS;
}

export interface PairGatewayMessage {
  type: typeof PAIR_GATEWAY;
  loopbackOrigin: string;
  pairingSessionId: string;
  pairingCode: string;
}

export interface RevokeGatewayPairingMessage {
  type: typeof REVOKE_GATEWAY_PAIRING;
}

export function isCollectVisibleResultsMessage(
  value: unknown
): value is CollectVisibleResultsMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === COLLECT_VISIBLE_RESULTS
  );
}

export function isGetControlSnapshotMessage(value: unknown): value is GetControlSnapshotMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === GET_CONTROL_SNAPSHOT
  );
}

export function isCollectionResultMessage(
  value: unknown
): value is CollectionResultMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === COLLECTION_RESULT &&
      (value as { result?: unknown }).result
  );
}

export function isSyncStrategyPermissionsMessage(value: unknown): value is SyncStrategyPermissionsMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === SYNC_STRATEGY_PERMISSIONS
  );
}

export function isPairGatewayMessage(value: unknown): value is PairGatewayMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PairGatewayMessage>;
  return (
    candidate.type === PAIR_GATEWAY &&
    typeof candidate.loopbackOrigin === 'string' &&
    candidate.loopbackOrigin.length <= 100 &&
    typeof candidate.pairingSessionId === 'string' &&
    candidate.pairingSessionId.length <= 100 &&
    typeof candidate.pairingCode === 'string' &&
    candidate.pairingCode.length <= 20
  );
}

export function isRevokeGatewayPairingMessage(value: unknown): value is RevokeGatewayPairingMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === REVOKE_GATEWAY_PAIRING
  );
}

export function isNetworkCaptureObservedMessage(value: unknown): value is NetworkCaptureObservedMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === NETWORK_CAPTURE_OBSERVED &&
      sanitiseNetworkCaptureObservation((value as { observation?: unknown }).observation)
  );
}

export function isNetworkCaptureBridgeReadyMessage(value: unknown): value is NetworkCaptureBridgeReadyMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === NETWORK_CAPTURE_BRIDGE_READY_MESSAGE
  );
}
