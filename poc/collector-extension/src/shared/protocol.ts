import {
  NETWORK_CAPTURE_OBSERVED,
  sanitiseNetworkCaptureObservation,
  type NetworkCaptureObservation
} from './network-capture';
import type { StrategyProvenance } from './strategy-registry';

export const COLLECT_VISIBLE_RESULTS = 'collector.collectVisibleResults' as const;
export const COLLECT_ACTIVE_TAB = 'collector.collectActiveTab' as const;
export const COLLECTION_RESULT = 'collector.collectionResult' as const;
export const CONTENT_READY = 'collector.contentReady' as const;
export const START_NATIVE_SEARCH = 'collector.startNativeSearch' as const;
export const NETWORK_CAPTURE_BRIDGE_READY_MESSAGE = 'collector.networkCaptureBridgeReady' as const;
export { NETWORK_CAPTURE_OBSERVED };

export type SupportedPlatform = 'bilibili' | 'zhihu' | 'weibo' | 'xiaohongshu';

export interface VisibleSearchItem {
  rank: number;
  title: string;
  url: string;
  contentType: 'video' | 'answer_or_question' | 'article' | 'post' | 'note';
}

export interface VisibleCollectionResult {
  schemaVersion: 1;
  platform: SupportedPlatform | 'unsupported';
  operation: 'keyword_search';
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

export interface CollectActiveTabMessage {
  type: typeof COLLECT_ACTIVE_TAB;
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

export interface StartNativeSearchMessage {
  type: typeof START_NATIVE_SEARCH;
  platform: SupportedPlatform;
  query: string;
  // Only honored by the compile-time test build. Production ignores this field.
  testFixtureBaseUrl?: string;
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

export function isCollectActiveTabMessage(
  value: unknown
): value is CollectActiveTabMessage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { type?: unknown }).type === COLLECT_ACTIVE_TAB
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

export function isStartNativeSearchMessage(value: unknown): value is StartNativeSearchMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; platform?: unknown; query?: unknown; testFixtureBaseUrl?: unknown };
  return (
    candidate.type === START_NATIVE_SEARCH &&
    (candidate.platform === 'bilibili' ||
      candidate.platform === 'zhihu' ||
      candidate.platform === 'weibo' ||
      candidate.platform === 'xiaohongshu') &&
    typeof candidate.query === 'string' &&
    (candidate.testFixtureBaseUrl === undefined || typeof candidate.testFixtureBaseUrl === 'string')
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
