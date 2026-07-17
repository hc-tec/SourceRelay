import {
  NETWORK_CAPTURE_OBSERVED,
  sanitiseNetworkCaptureObservation,
  type NetworkCaptureObservation
} from './network-capture';
import type { StrategyProvenance } from './strategy-registry';
import type { CollectionTerminalStatus, SupportedPlatform } from './collection-contracts';

export type { SupportedPlatform } from './collection-contracts';

export const COLLECT_VISIBLE_RESULTS = 'collector.collectVisibleResults' as const;
export const COLLECTOR_CORE_VERSION = '0.2.1' as const;
export const COLLECTION_RESULT = 'collector.collectionResult' as const;
export const CONTENT_READY = 'collector.contentReady' as const;
export const NETWORK_CAPTURE_BRIDGE_READY_MESSAGE = 'collector.networkCaptureBridgeReady' as const;
export const GET_CONTROL_SNAPSHOT = 'collector.getControlSnapshot' as const;
export const SYNC_STRATEGY_PERMISSIONS = 'collector.syncStrategyPermissions' as const;
export const PAIR_GATEWAY = 'collector.pairGateway' as const;
export const REVOKE_GATEWAY_PAIRING = 'collector.revokeGatewayPairing' as const;
export const START_CAPABILITY_VALIDATION = 'collector.startCapabilityValidation' as const;
export const GET_CAPABILITY_VALIDATION = 'collector.getCapabilityValidation' as const;
export { NETWORK_CAPTURE_OBSERVED };

export interface VisibleSearchItem {
  rank: number;
  title: string;
  url: string;
  contentType: 'video' | 'answer_or_question' | 'article' | 'post' | 'note';
}

export type VisiblePageState =
  | 'results_visible'
  | 'no_results_visible'
  | 'authentication_required'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'layout_unrecognized';

export interface VisibleCollectionResult {
  schemaVersion: 1;
  platform: SupportedPlatform | 'unsupported';
  operation: 'breadth_search';
  strategy: StrategyProvenance | null;
  sourceUrl: string;
  pageState: VisiblePageState;
  partial: true;
  itemCount: number;
  items: VisibleSearchItem[];
  warnings: string[];
}

export type CapabilityValidationRunState =
  | 'navigating'
  | 'collecting'
  | 'completed'
  | 'inconclusive'
  | 'failed';

export interface CapabilityValidationRunSnapshot {
  schemaVersion: 1;
  collectorVersion: string;
  runId: string;
  profileId: string;
  platform: SupportedPlatform;
  accountCategory: 'anonymous' | 'user_managed';
  evidenceObjective: 'breadth_search';
  strategy: StrategyProvenance;
  queryDigest: string;
  navigationUrlDigest: string;
  windowId: number;
  tabId: number;
  documentId?: string;
  state: CapabilityValidationRunState;
  terminalStatus: CollectionTerminalStatus | null;
  errorCode: string | null;
  startedAt: string;
  expiresAt: string;
  completedAt: string | null;
  result: VisibleCollectionResult | null;
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

export interface StartCapabilityValidationMessage {
  type: typeof START_CAPABILITY_VALIDATION;
  runId: string;
  profileId: string;
  platform: SupportedPlatform;
  accountCategory: 'anonymous' | 'user_managed';
  query: string;
}

export interface GetCapabilityValidationMessage {
  type: typeof GET_CAPABILITY_VALIDATION;
  runId: string;
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

export function isStartCapabilityValidationMessage(value: unknown): value is StartCapabilityValidationMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StartCapabilityValidationMessage>;
  return (
    candidate.type === START_CAPABILITY_VALIDATION &&
    typeof candidate.runId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.runId) &&
    typeof candidate.profileId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.profileId) &&
    typeof candidate.platform === 'string' &&
    (candidate.accountCategory === 'anonymous' || candidate.accountCategory === 'user_managed') &&
    typeof candidate.query === 'string' &&
    candidate.query.length <= 200
  );
}

export function isGetCapabilityValidationMessage(value: unknown): value is GetCapabilityValidationMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GetCapabilityValidationMessage>;
  return (
    candidate.type === GET_CAPABILITY_VALIDATION &&
    typeof candidate.runId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.runId)
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
