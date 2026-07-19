import {
  NETWORK_CAPTURE_OBSERVED,
  type NetworkCaptureObservation
} from './network-capture';
import type { StrategyProvenance } from './strategy-registry';
import type { CollectionTerminalStatus, SupportedPlatform } from './collection-contracts';

export type { SupportedPlatform } from './collection-contracts';

export const COLLECT_VISIBLE_RESULTS = 'collector.collectVisibleResults' as const;
export const COLLECTOR_CORE_VERSION = '0.4.17' as const;
export const COLLECTION_RESULT = 'collector.collectionResult' as const;
export const CONTENT_READY = 'collector.contentReady' as const;
export const PROBE_CONTENT_INSTALLATION = 'collector.probeContentInstallation' as const;
export const NETWORK_CAPTURE_BRIDGE_READY_MESSAGE = 'collector.networkCaptureBridgeReady' as const;
export const GET_CONTROL_SNAPSHOT = 'collector.getControlSnapshot' as const;
export const POLL_GATEWAY_TASKS = 'collector.pollGatewayTasks' as const;
export const SYNC_STRATEGY_PERMISSIONS = 'collector.syncStrategyPermissions' as const;
export const PAIR_GATEWAY = 'collector.pairGateway' as const;
export const REVOKE_GATEWAY_PAIRING = 'collector.revokeGatewayPairing' as const;
export const START_CAPABILITY_VALIDATION = 'collector.startCapabilityValidation' as const;
export const GET_CAPABILITY_VALIDATION = 'collector.getCapabilityValidation' as const;
export const START_DETAIL_CAPABILITY_VALIDATION = 'collector.startDetailCapabilityValidation' as const;
export const GET_DETAIL_CAPABILITY_VALIDATION = 'collector.getDetailCapabilityValidation' as const;
export const START_TRANSCRIPT_CAPABILITY_VALIDATION = 'collector.startTranscriptCapabilityValidation' as const;
export const GET_TRANSCRIPT_CAPABILITY_VALIDATION = 'collector.getTranscriptCapabilityValidation' as const;
export const TRANSCRIPT_CONTENT_READY = 'collector.transcriptContentReady' as const;
export const TRANSCRIPT_INTERACTION_RESULT = 'collector.transcriptInteractionResult' as const;
export { NETWORK_CAPTURE_OBSERVED };

export interface VisibleSearchItem {
  rank: number;
  title: string;
  url: string;
  contentType: 'video' | 'answer_or_question' | 'article' | 'post' | 'note';
}

export interface VisibleMetric {
  label: string;
  value: string;
}

export interface VisibleVideoDetail {
  contentId: string;
  contentType: 'video';
  canonicalUrl: string;
  title: string;
  creator: {
    displayName: string;
    canonicalProfileUrl: string;
    visibleDescription: string | null;
  } | null;
  description: string | null;
  publishedText: string | null;
  visibleMetrics: VisibleMetric[];
  tags: string[];
}

export type VisiblePageState =
  | 'results_visible'
  | 'no_results_visible'
  | 'authentication_required'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'layout_unrecognized';

export interface VisibleSearchCollectionResult {
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

export interface VisibleDetailCollectionResult {
  schemaVersion: 1;
  platform: SupportedPlatform | 'unsupported';
  operation: 'detail_read';
  strategy: StrategyProvenance | null;
  sourceUrl: string;
  pageState: VisiblePageState;
  partial: true;
  itemCount: 0 | 1;
  detail: VisibleVideoDetail | null;
  warnings: string[];
}

export type VisibleCollectionResult = VisibleSearchCollectionResult | VisibleDetailCollectionResult;

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

export interface DetailCapabilityValidationRunSnapshot {
  schemaVersion: 1;
  collectorVersion: string;
  runId: string;
  profileId: string;
  platform: 'bilibili';
  accountCategory: 'anonymous';
  evidenceObjective: 'detail_read';
  strategy: StrategyProvenance;
  targetUrlDigest: string;
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
  result: VisibleDetailCollectionResult | null;
}

export type TranscriptInteractionAction = 'open_caption_menu' | 'select_caption_language';
export type TranscriptInteractionOutcome =
  | 'completed'
  | 'control_missing'
  | 'option_unavailable'
  | 'prerequisite_unmet'
  | 'postcondition_unmet'
  | 'risk_detected';

export interface TranscriptInteractionActionResult {
  action: TranscriptInteractionAction;
  attempted: boolean;
  outcome: TranscriptInteractionOutcome;
  visibleLabels: string[];
  selectedLabel: string | null;
  postconditionAcknowledged: boolean | null;
}

export interface TranscriptInteractionResult {
  schemaVersion: 1;
  canonicalUrl: string;
  state: 'completed' | 'inconclusive' | 'failed';
  objective: {
    status: 'satisfied' | 'partial' | 'not_satisfied';
    requiredActions: readonly TranscriptInteractionAction[];
    completedActions: readonly TranscriptInteractionAction[];
  };
  actions: TranscriptInteractionActionResult[];
  errorCode: string | null;
  completedAt: string;
}

export interface TranscriptCapabilityValidationRunSnapshot {
  schemaVersion: 1;
  collectorVersion: string;
  runId: string;
  profileId: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  evidenceObjective: 'transcript_read';
  strategy: StrategyProvenance;
  targetUrlDigest: string;
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
  interaction: TranscriptInteractionResult | null;
  captures: NetworkCaptureObservation[];
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    admissionEligible: false;
    semanticActionDelivery: 'at_most_once';
    productionResponseRoutes: 'unchanged_empty';
    cookiesAndTokens: 'not_read';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    queryAndFragmentValues: 'discarded';
    targetPage: 'closed_after_validation';
  };
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

export interface ProbeContentInstallationMessage {
  type: typeof PROBE_CONTENT_INSTALLATION;
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

export interface PollGatewayTasksMessage {
  type: typeof POLL_GATEWAY_TASKS;
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

export interface StartDetailCapabilityValidationMessage {
  type: typeof START_DETAIL_CAPABILITY_VALIDATION;
  runId: string;
  profileId: string;
  platform: 'bilibili';
  accountCategory: 'anonymous';
  canonicalUrl: string;
}

export interface GetDetailCapabilityValidationMessage {
  type: typeof GET_DETAIL_CAPABILITY_VALIDATION;
  runId: string;
}

export interface StartTranscriptCapabilityValidationMessage {
  type: typeof START_TRANSCRIPT_CAPABILITY_VALIDATION;
  runId: string;
  profileId: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  canonicalUrl: string;
}

export interface GetTranscriptCapabilityValidationMessage {
  type: typeof GET_TRANSCRIPT_CAPABILITY_VALIDATION;
  runId: string;
}

export interface TranscriptContentReadyMessage {
  type: typeof TRANSCRIPT_CONTENT_READY;
}

export interface TranscriptInteractionResultMessage {
  type: typeof TRANSCRIPT_INTERACTION_RESULT;
  result: TranscriptInteractionResult;
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

export function isPollGatewayTasksMessage(value: unknown): value is PollGatewayTasksMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === POLL_GATEWAY_TASKS
  );
}

export function isProbeContentInstallationMessage(
  value: unknown
): value is ProbeContentInstallationMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === PROBE_CONTENT_INSTALLATION
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

export function isStartDetailCapabilityValidationMessage(
  value: unknown
): value is StartDetailCapabilityValidationMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StartDetailCapabilityValidationMessage>;
  return (
    candidate.type === START_DETAIL_CAPABILITY_VALIDATION &&
    typeof candidate.runId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(candidate.runId) &&
    typeof candidate.profileId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(candidate.profileId) &&
    candidate.platform === 'bilibili' &&
    candidate.accountCategory === 'anonymous' &&
    typeof candidate.canonicalUrl === 'string' &&
    /^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}$/.test(candidate.canonicalUrl)
  );
}

export function isGetDetailCapabilityValidationMessage(
  value: unknown
): value is GetDetailCapabilityValidationMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GetDetailCapabilityValidationMessage>;
  return (
    candidate.type === GET_DETAIL_CAPABILITY_VALIDATION &&
    typeof candidate.runId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(candidate.runId)
  );
}

export function isStartTranscriptCapabilityValidationMessage(
  value: unknown
): value is StartTranscriptCapabilityValidationMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StartTranscriptCapabilityValidationMessage>;
  return (
    candidate.type === START_TRANSCRIPT_CAPABILITY_VALIDATION &&
    typeof candidate.runId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(candidate.runId) &&
    typeof candidate.profileId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(candidate.profileId) &&
    candidate.platform === 'bilibili' &&
    candidate.accountCategory === 'user_managed' &&
    typeof candidate.canonicalUrl === 'string' &&
    /^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}$/.test(candidate.canonicalUrl)
  );
}

export function isGetTranscriptCapabilityValidationMessage(
  value: unknown
): value is GetTranscriptCapabilityValidationMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GetTranscriptCapabilityValidationMessage>;
  return (
    candidate.type === GET_TRANSCRIPT_CAPABILITY_VALIDATION &&
    typeof candidate.runId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(candidate.runId)
  );
}

export function isTranscriptContentReadyMessage(value: unknown): value is TranscriptContentReadyMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === TRANSCRIPT_CONTENT_READY
  );
}

export function isTranscriptInteractionResultMessage(
  value: unknown
): value is TranscriptInteractionResultMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === TRANSCRIPT_INTERACTION_RESULT &&
      (value as { result?: unknown }).result
  );
}

export function isNetworkCaptureObservedMessage(value: unknown): value is NetworkCaptureObservedMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === NETWORK_CAPTURE_OBSERVED &&
      (value as { observation?: unknown }).observation &&
      typeof (value as { observation?: unknown }).observation === 'object'
  );
}

export function isNetworkCaptureBridgeReadyMessage(value: unknown): value is NetworkCaptureBridgeReadyMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === NETWORK_CAPTURE_BRIDGE_READY_MESSAGE
  );
}
