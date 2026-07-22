import type {
  AcquirePageRequest,
  AcquirePageResult,
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
import type { CapturePageVisualEvidenceRequest, PageVisualEvidence } from './page-visual-evidence.js';
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

export const BROWSER_HOST_PROTOCOL_VERSION = 6 as const;
export const BROWSER_HOST_MAX_MESSAGE_BYTES = 256 * 1024;

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
  | { type: 'capture_page_visual_evidence'; request: CapturePageVisualEvidenceRequest }
  | { type: 'bind_strategy_observer'; request: StrategyObserverBindingRequest }
  | { type: 'read_strategy_observation'; request: StrategyObservationReadRequest }
  | { type: 'read_strategy_binding_diagnostics'; request: StrategyBindingDiagnosticsRequest }
  | { type: 'reconcile_page'; request: ReconcilePageRequest }
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
  | PageVisualEvidence
  | ReclaimPlan
  | ReclaimExecutionResult
  | StrategyObserverBindingResult
  | StrategyObservationResult
  | StrategyBindingDiagnostics
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
