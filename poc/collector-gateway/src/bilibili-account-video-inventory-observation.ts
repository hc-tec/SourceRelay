import {
  BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
  type StrategyObservationResult
} from '@intelligence/collector-contracts';
import type {
  BilibiliAccountVideoInventoryDomCard,
  BilibiliAccountVideoInventoryDomSnapshot
} from './bilibili-account-video-inventory-contract';

export interface BilibiliAccountVideoInventoryStrategyObservation {
  dom: BilibiliAccountVideoInventoryDomSnapshot;
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

function card(value: unknown): BilibiliAccountVideoInventoryDomCard | null {
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

function domSnapshot(value: unknown, expectedStableAccountId: string): BilibiliAccountVideoInventoryDomSnapshot {
  const candidate = record(value);
  const risk = record(candidate?.risk);
  if (
    !candidate ||
    candidate.stableAccountId !== expectedStableAccountId ||
    typeof candidate.videoListVisible !== 'boolean' ||
    !Array.isArray(candidate.cards) ||
    candidate.cards.length > 40 ||
    typeof candidate.loginOverlayVisible !== 'boolean' ||
    !risk ||
    typeof risk.verificationRequired !== 'boolean' ||
    typeof risk.rateLimited !== 'boolean' ||
    typeof risk.sourceUnavailable !== 'boolean'
  ) throw new Error('account_video_inventory_observation_dom_invalid');
  const cards = candidate.cards.map(card);
  if (cards.some((entry) => entry === null)) throw new Error('account_video_inventory_observation_dom_invalid');
  return {
    stableAccountId: expectedStableAccountId,
    videoListVisible: candidate.videoListVisible,
    cards: cards as BilibiliAccountVideoInventoryDomCard[],
    loginOverlayVisible: candidate.loginOverlayVisible,
    risk: {
      verificationRequired: risk.verificationRequired,
      rateLimited: risk.rateLimited,
      sourceUnavailable: risk.sourceUnavailable
    }
  };
}

/**
 * The account-inventory strategy can carry only its fixed DOM projection. It
 * excludes response bodies, request data, query values, cookies and tokens.
 */
export function bilibiliAccountVideoInventoryStrategyObservation(
  result: StrategyObservationResult,
  expectedStableAccountId: string
): BilibiliAccountVideoInventoryStrategyObservation {
  if (
    result.type !== 'collector_strategy_observation' ||
    result.strategyId !== BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID ||
    result.payloadBytes > 128 * 1024
  ) throw new Error('account_video_inventory_observation_strategy_result_invalid');
  const payload = record(result.payload);
  if (
    !payload ||
    payload.schemaVersion !== 1 ||
    payload.strategyId !== BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID ||
    payload.stableAccountId !== expectedStableAccountId ||
    typeof payload.documentId !== 'string' ||
    payload.documentId.length === 0 ||
    payload.documentId.length > 256
  ) throw new Error('account_video_inventory_observation_payload_context_invalid');
  return { dom: domSnapshot(payload.dom, expectedStableAccountId) };
}
