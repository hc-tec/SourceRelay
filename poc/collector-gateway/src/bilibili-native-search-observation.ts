import {
  BILIBILI_NATIVE_SEARCH_STRATEGY_ID,
  BILIBILI_NATIVE_SEARCH_RESULT_TYPES,
  BILIBILI_NATIVE_SEARCH_SORTS,
  type StrategyObservationResult
} from '@intelligence/collector-contracts';
import type {
  BilibiliNativeSearchDomCard,
  BilibiliNativeSearchDomSnapshot
} from './bilibili-native-search-contract';

export interface BilibiliNativeSearchStrategyObservation {
  dom: BilibiliNativeSearchDomSnapshot;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalText(value: unknown, maximum: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  const result = value.replace(/\s+/g, ' ').trim();
  return result || undefined;
}

function card(value: unknown): BilibiliNativeSearchDomCard | null {
  const candidate = record(value);
  const bvid = optionalText(candidate?.bvid, 32);
  const title = optionalText(candidate?.title, 500);
  const visibleText = optionalText(candidate?.visibleText, 2_000);
  const thumbnailUrl = optionalText(candidate?.thumbnailUrl, 2_000);
  if (!candidate || bvid === undefined || title === undefined || visibleText === undefined || thumbnailUrl === undefined) {
    return null;
  }
  return { bvid, title, visibleText, thumbnailUrl };
}

function domSnapshot(value: unknown): BilibiliNativeSearchDomSnapshot {
  const candidate = record(value);
  const risk = record(candidate?.risk);
  if (
    !candidate ||
    typeof candidate.searchInputVisible !== 'boolean' ||
    typeof candidate.resultListVisible !== 'boolean' ||
    typeof candidate.emptyStateVisible !== 'boolean' ||
    !BILIBILI_NATIVE_SEARCH_RESULT_TYPES.includes(candidate.resultType as 'comprehensive' | 'video') ||
    !BILIBILI_NATIVE_SEARCH_SORTS.includes(candidate.sort as 'relevance' | 'newest') ||
    !Number.isSafeInteger(candidate.semanticResultCardCount) ||
    Number(candidate.semanticResultCardCount) < 0 || Number(candidate.semanticResultCardCount) > 60 ||
    !Array.isArray(candidate.cards) ||
    candidate.cards.length > 20 ||
    typeof candidate.loginOverlayVisible !== 'boolean' ||
    !risk ||
    typeof risk.verificationRequired !== 'boolean' ||
    typeof risk.rateLimited !== 'boolean' ||
    typeof risk.sourceUnavailable !== 'boolean'
  ) throw new Error('native_search_observation_dom_invalid');
  const cards = candidate.cards.map(card);
  if (cards.some((entry) => entry === null)) throw new Error('native_search_observation_dom_invalid');
  return {
    searchInputVisible: candidate.searchInputVisible,
    resultListVisible: candidate.resultListVisible,
    emptyStateVisible: candidate.emptyStateVisible,
    resultType: candidate.resultType as BilibiliNativeSearchDomSnapshot['resultType'],
    sort: candidate.sort as BilibiliNativeSearchDomSnapshot['sort'],
    semanticResultCardCount: Number(candidate.semanticResultCardCount),
    cards: cards as BilibiliNativeSearchDomCard[],
    loginOverlayVisible: candidate.loginOverlayVisible,
    risk: {
      verificationRequired: risk.verificationRequired,
      rateLimited: risk.rateLimited,
      sourceUnavailable: risk.sourceUnavailable
    }
  };
}

/**
 * The first-party search bridge carries only its bounded, visible DOM card
 * projection. Query values, response bodies, request data and credentials are
 * not accepted at this boundary.
 */
export function bilibiliNativeSearchStrategyObservation(
  result: StrategyObservationResult
): BilibiliNativeSearchStrategyObservation {
  if (
    result.type !== 'collector_strategy_observation' ||
    result.strategyId !== BILIBILI_NATIVE_SEARCH_STRATEGY_ID ||
    result.payloadBytes > 128 * 1024
  ) throw new Error('native_search_observation_strategy_result_invalid');
  const payload = record(result.payload);
  const allowedPayloadKeys = new Set(['schemaVersion', 'strategyId', 'documentId', 'dom']);
  if (
    !payload ||
    Object.keys(payload).some((key) => !allowedPayloadKeys.has(key)) ||
    payload.schemaVersion !== 1 ||
    payload.strategyId !== BILIBILI_NATIVE_SEARCH_STRATEGY_ID ||
    typeof payload.documentId !== 'string' ||
    payload.documentId.length === 0 ||
    payload.documentId.length > 256
  ) throw new Error('native_search_observation_payload_context_invalid');
  return { dom: domSnapshot(payload.dom) };
}
