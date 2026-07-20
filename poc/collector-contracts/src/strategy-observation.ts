export const STRATEGY_OBSERVATION_SCHEMA_VERSION = 1 as const;
export const BILIBILI_DYNAMIC_STRATEGY_ID = 'bilibili.dynamic.account-feed.response-dom.v1' as const;

export type CollectorStrategyId = typeof BILIBILI_DYNAMIC_STRATEGY_ID;

export type BridgeJsonValue =
  | null
  | boolean
  | number
  | string
  | BridgeJsonValue[]
  | { [key: string]: BridgeJsonValue };

export interface StrategyObserverBindingRequest {
  schemaVersion: typeof STRATEGY_OBSERVATION_SCHEMA_VERSION;
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  expectedRecordVersion: number;
  runId: string;
  observerBindingId: string;
  strategyId: CollectorStrategyId;
  target: {
    canonicalUrl: string;
    stableAccountId: string;
  };
  expiresAt: string;
  maximumResponseObservations: number;
  maximumPayloadBytes: number;
}

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
