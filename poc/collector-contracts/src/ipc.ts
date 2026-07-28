import type {
  AcquirePageRequest,
  AcquirePageResult,
  CloseQuarantinedPageRequest,
  CreateReclaimPlanRequest,
  ExecuteReclaimPlanRequest,
  LaunchProfileRequest,
  ManagedPageSummary,
  NavigatePageRequest,
  PagePoolSnapshot,
  ReclaimExecutionResult,
  ReclaimPlan,
  ReconcilePageRequest,
  ReleasePageRequest
} from './page-pool.js';
import type { PageScrollResult, ScrollPageRequest } from './page-scroll.js';
import type {
  CapturePageVisualEvidenceRequest,
  CaptureRetainedPageVisualEvidenceRequest,
  PageVisualEvidence
} from './page-visual-evidence.js';
import type { BrowserHostErrorRecord } from './errors.js';
import type {
  StrategyObservationReadRequest,
  StrategyObservationResult,
  StrategyBindingDiagnostics,
  StrategyBindingDiagnosticsRequest,
  StrategyObserverBindingRequest,
  StrategyObserverBindingResult
} from './strategy-observation.js';
import type {
  BilibiliAccountVideoPageClickRequest,
  BilibiliAccountVideoPageClickResult
} from './bilibili-account-video-pagination.js';
import type {
  BilibiliCollectionSeriesPageClickRequest,
  BilibiliCollectionSeriesPageClickResult
} from './bilibili-collection-series-detail.js';
import type {
  BilibiliTranscriptChineseSelectionRequest,
  BilibiliTranscriptChineseSelectionResult
} from './bilibili-transcript-interaction.js';
import type {
  BilibiliDanmakuInteractionRequest,
  BilibiliDanmakuInteractionResult
} from './bilibili-danmaku-interaction.js';
import type {
  BilibiliVideoDiscussionInteractionRequest,
  BilibiliVideoDiscussionInteractionResult
} from './bilibili-video-discussion-interaction.js';
import type {
  ValidationExtensionControlRequest,
  ValidationExtensionControlResult
} from './validation-extension-control.js';
import type {
  XiaohongshuCurrentPageNetworkObservationResult,
  XiaohongshuManagedPageNetworkObservationResult,
  XiaohongshuManagedPageNetworkObserverArmResult,
  XiaohongshuManagedPageNetworkObserverRequest
} from './xiaohongshu-current-page-network.js';

export const BROWSER_HOST_PROTOCOL_VERSION = 7 as const;
export const BROWSER_HOST_MAX_MESSAGE_BYTES = 256 * 1024;
export const BROWSER_HOST_CONNECTION_MODES = ['controller', 'observer'] as const;
export type BrowserHostConnectionMode = (typeof BROWSER_HOST_CONNECTION_MODES)[number];

export interface BrowserHostEndpointRecord {
  schemaVersion: 1;
  protocolVersion: typeof BROWSER_HOST_PROTOCOL_VERSION;
  hostInstanceId: string;
  pipeName: string;
  nativeBridgePipeName: string;
  bootstrapSecret: string;
  processId: number;
  createdAt: string;
}

export interface BrowserHostHandshakeRequest {
  type: 'handshake';
  protocolVersion: typeof BROWSER_HOST_PROTOCOL_VERSION;
  /**
   * `observer` is authenticated but can read only a de-sensitised Host
   * snapshot. It must never replace the one active controller or affect a
   * leased page.
   */
  connectionMode?: BrowserHostConnectionMode;
  gatewayInstanceId: string;
  nonce: string;
  issuedAt: string;
  authenticationDigest: string;
}

export interface BrowserHostHandshakeResponse {
  ok: true;
  type: 'handshake_accepted';
  hostInstanceId: string;
  controllerGeneration: string;
  connectionMode: BrowserHostConnectionMode;
  protocolVersion: typeof BROWSER_HOST_PROTOCOL_VERSION;
}

export type BrowserHostCommandBody =
  | { type: 'get_snapshot' }
  | { type: 'launch_profile'; request: LaunchProfileRequest }
  | { type: 'acquire_page'; request: AcquirePageRequest }
  | { type: 'release_page'; request: ReleasePageRequest }
  | { type: 'navigate_page'; request: NavigatePageRequest }
  | { type: 'scroll_page'; request: ScrollPageRequest }
  | { type: 'click_bilibili_account_video_page'; request: BilibiliAccountVideoPageClickRequest }
  | { type: 'click_bilibili_collection_series_page'; request: BilibiliCollectionSeriesPageClickRequest }
  | { type: 'select_bilibili_transcript_chinese'; request: BilibiliTranscriptChineseSelectionRequest }
  | { type: 'interact_bilibili_danmaku'; request: BilibiliDanmakuInteractionRequest }
  | { type: 'click_bilibili_video_discussion_control'; request: BilibiliVideoDiscussionInteractionRequest }
  | { type: 'run_validation_extension_control'; request: ValidationExtensionControlRequest }
  | { type: 'capture_page_visual_evidence'; request: CapturePageVisualEvidenceRequest }
  | { type: 'capture_retained_page_visual_evidence'; request: CaptureRetainedPageVisualEvidenceRequest }
  | { type: 'bind_strategy_observer'; request: StrategyObserverBindingRequest }
  | { type: 'read_strategy_observation'; request: StrategyObservationReadRequest }
  | { type: 'read_strategy_binding_diagnostics'; request: StrategyBindingDiagnosticsRequest }
  | { type: 'read_xiaohongshu_current_page_network_observation'; profileId: string }
  | { type: 'arm_xiaohongshu_managed_page_network_observer'; request: XiaohongshuManagedPageNetworkObserverRequest }
  | { type: 'read_xiaohongshu_managed_page_network_observation'; request: XiaohongshuManagedPageNetworkObserverRequest }
  | { type: 'reconcile_page'; request: ReconcilePageRequest }
  | { type: 'close_quarantined_page'; request: CloseQuarantinedPageRequest }
  | { type: 'create_reclaim_plan'; request: CreateReclaimPlanRequest }
  | { type: 'execute_reclaim_plan'; request: ExecuteReclaimPlanRequest }
  | { type: 'close_profile'; profileId: string }
  | { type: 'shutdown_host' };

export interface BrowserHostCommandEnvelope {
  type: 'command';
  protocolVersion: typeof BROWSER_HOST_PROTOCOL_VERSION;
  hostInstanceId: string;
  controllerGeneration: string;
  gatewayInstanceId: string;
  commandId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  body: BrowserHostCommandBody;
  authenticationDigest: string;
}

export type BrowserHostCommandResult =
  | PagePoolSnapshot
  | AcquirePageResult
  | ManagedPageSummary
  | PageScrollResult
  | BilibiliAccountVideoPageClickResult
  | BilibiliCollectionSeriesPageClickResult
  | BilibiliTranscriptChineseSelectionResult
  | BilibiliDanmakuInteractionResult
  | BilibiliVideoDiscussionInteractionResult
  | ValidationExtensionControlResult
  | PageVisualEvidence
  | ReclaimPlan
  | ReclaimExecutionResult
  | StrategyObserverBindingResult
  | StrategyObservationResult
  | StrategyBindingDiagnostics
  | XiaohongshuCurrentPageNetworkObservationResult
  | XiaohongshuManagedPageNetworkObserverArmResult
  | XiaohongshuManagedPageNetworkObservationResult
  | { ok: true; profileId?: string; pageAlias?: string; state?: string }
  | { ok: true; shuttingDown: true };

export interface BrowserHostCommandResponse {
  ok: true;
  type: 'command_result';
  commandId: string;
  result: BrowserHostCommandResult;
}

export interface BrowserHostErrorResponse {
  ok: false;
  type: 'command_error';
  commandId: string | null;
  error: BrowserHostErrorRecord;
}

export type BrowserHostWireRequest = BrowserHostHandshakeRequest | BrowserHostCommandEnvelope;
export type BrowserHostWireResponse = BrowserHostHandshakeResponse | BrowserHostCommandResponse | BrowserHostErrorResponse;

export function commandAuthenticationPayload(envelope: Omit<BrowserHostCommandEnvelope, 'authenticationDigest'>): string {
  return canonicalJson(envelope);
}

export function handshakeAuthenticationPayload(request: Omit<BrowserHostHandshakeRequest, 'authenticationDigest'>): string {
  return canonicalJson(request);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(',')}}`;
}
