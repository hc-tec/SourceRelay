export const STRATEGY_OBSERVATION_SCHEMA_VERSION = 1 as const;
export const BILIBILI_DYNAMIC_STRATEGY_ID = 'bilibili.dynamic.account-feed.response-dom.v1' as const;
export const BILIBILI_VIDEO_DETAIL_STRATEGY_ID = 'bilibili.video.detail.dom.v2' as const;
export const BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID =
  'bilibili.account.video-inventory.dom.v1' as const;

export type CollectorStrategyId =
  | typeof BILIBILI_DYNAMIC_STRATEGY_ID
  | typeof BILIBILI_VIDEO_DETAIL_STRATEGY_ID
  | typeof BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID;

export type BridgeJsonValue =
  | null
  | boolean
  | number
  | string
  | BridgeJsonValue[]
  | { [key: string]: BridgeJsonValue };

export interface BilibiliDynamicStrategyTarget {
  canonicalUrl: string;
  stableAccountId: string;
}

export interface BilibiliVideoDetailStrategyTarget {
  canonicalUrl: string;
  bvid: string;
}

export interface BilibiliAccountVideoInventoryStrategyTarget {
  canonicalUrl: string;
  stableAccountId: string;
}

/**
 * Determines whether an observer may bind the document that is already open
 * in a managed tab. A caller that will immediately navigate an exact retained
 * target must require the next document, otherwise a late document-start
 * handshake from the old page can win the binding race.
 */
export type StrategyDocumentBindingMode =
  | 'current_document_or_next_navigation'
  | 'next_navigation_only';

interface StrategyObserverBindingRequestBase {
  schemaVersion: typeof STRATEGY_OBSERVATION_SCHEMA_VERSION;
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  expectedRecordVersion: number;
  runId: string;
  observerBindingId: string;
  expiresAt: string;
  maximumPayloadBytes: number;
  documentBindingMode?: StrategyDocumentBindingMode;
}

/**
 * Each strategy owns a distinct target and observation budget.  This prevents
 * a DOM-only video-detail run from silently acquiring the dynamic response
 * observer or a dynamic target from being accepted as a video target.
 */
export type StrategyObserverBindingRequest =
  | (StrategyObserverBindingRequestBase & {
    strategyId: typeof BILIBILI_DYNAMIC_STRATEGY_ID;
    target: BilibiliDynamicStrategyTarget;
    maximumResponseObservations: 1 | 2;
  })
  | (StrategyObserverBindingRequestBase & {
    strategyId: typeof BILIBILI_VIDEO_DETAIL_STRATEGY_ID;
    target: BilibiliVideoDetailStrategyTarget;
    maximumResponseObservations: 0;
  })
  | (StrategyObserverBindingRequestBase & {
    strategyId: typeof BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID;
    target: BilibiliAccountVideoInventoryStrategyTarget;
    maximumResponseObservations: 0;
  });

export interface StrategyObservationReadRequest {
  schemaVersion: typeof STRATEGY_OBSERVATION_SCHEMA_VERSION;
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  expectedRecordVersion: number;
  runId: string;
  observerBindingId: string;
  strategyId: CollectorStrategyId;
  deadlineMs: number;
}

/**
 * Local-only request used after an observation failure while the managed page
 * is still leased.  It deliberately carries no target URL, selector, page
 * JavaScript, or content request.
 */
export interface StrategyBindingDiagnosticsRequest {
  schemaVersion: typeof STRATEGY_OBSERVATION_SCHEMA_VERSION;
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  expectedRecordVersion: number;
  runId: string;
  observerBindingId: string;
  strategyId: CollectorStrategyId;
}

/**
 * A de-sensitised explanation of the extension's binding lifecycle.  It
 * contains no tab ID, document ID, URL, page text, request metadata, storage
 * content, or authentication material.  `documentBindCount` is capped at 3,
 * where 3 means "three or more".
 */
export interface StrategyBindingDiagnostics {
  schemaVersion: typeof STRATEGY_OBSERVATION_SCHEMA_VERSION;
  type: 'collector_strategy_binding_diagnostics';
  strategyId: CollectorStrategyId;
  observerBindingId: string;
  bindingState: 'missing' | 'invalid' | 'expired' | 'active';
  documentBindingState: 'not_bound' | 'bound';
  documentBindCount: 0 | 1 | 2 | 3;
  bridgeRegistration: 'registered' | 'missing' | 'unavailable';
  currentMainFrameState:
    | 'not_checked'
    | 'unavailable'
    | 'target_mismatch'
    | 'current_document_unbound'
    | 'matches_bound_document'
    | 'different_document'
    | 'excluded_document';
}

export interface StrategyObserverBindingResult {
  schemaVersion: typeof STRATEGY_OBSERVATION_SCHEMA_VERSION;
  type: 'collector_strategy_observer_binding';
  strategyId: CollectorStrategyId;
  observerBindingId: string;
  pageAlias: string;
  state: 'ready';
  nextDocumentGeneration: number;
  expiresAt: string;
}

export interface StrategyObservationResult {
  schemaVersion: typeof STRATEGY_OBSERVATION_SCHEMA_VERSION;
  type: 'collector_strategy_observation';
  strategyId: CollectorStrategyId;
  observerBindingId: string;
  pageAlias: string;
  documentGeneration: number;
  routeGeneration: number;
  capturedAt: string;
  payloadBytes: number;
  payload: BridgeJsonValue;
}

export function isBridgeJsonValue(value: unknown, depth = 0): value is BridgeJsonValue {
  if (depth > 12) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 200_000;
  if (Array.isArray(value)) {
    return value.length <= 1_000 && value.every((entry) => isBridgeJsonValue(entry, depth + 1));
  }
  if (typeof value !== 'object') return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= 1_000 && entries.every(([key, entry]) =>
    key.length > 0 && key.length <= 200 &&
    key !== '__proto__' && key !== 'constructor' && key !== 'prototype' &&
    isBridgeJsonValue(entry, depth + 1)
  );
}
