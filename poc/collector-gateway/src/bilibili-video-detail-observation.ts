import {
  BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
  type StrategyObservationResult
} from '@intelligence/collector-contracts';
import type { BilibiliVideoDetailDomSnapshot } from './bilibili-video-detail-contract';

export interface BilibiliVideoDetailStrategyObservation {
  dom: BilibiliVideoDetailDomSnapshot;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const result = value.replace(/\s+/g, ' ').trim();
  return result || null;
}

function optionalText(value: unknown, maximum: number): string | null | undefined {
  if (value === null) return null;
  return boundedText(value, maximum) ?? undefined;
}

function stringArray(value: unknown, maximumItems: number, maximumText: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const entries = value.map((entry) => boundedText(entry, maximumText));
  return entries.every((entry): entry is string => entry !== null)
    ? [...new Set(entries)]
    : null;
}

function domSnapshot(value: unknown, expectedBvid: string): BilibiliVideoDetailDomSnapshot {
  const candidate = record(value);
  const risk = record(candidate?.risk);
  const title = optionalText(candidate?.title, 500);
  const metadataVisibleText = optionalText(candidate?.metadataVisibleText, 1_000);
  const description = optionalText(candidate?.description, 20_000);
  const episodeSummaryText = optionalText(candidate?.episodeSummaryText, 500);
  const tagTexts = stringArray(candidate?.tagTexts, 20, 100);
  if (
    !candidate ||
    candidate.bvid !== expectedBvid ||
    title === undefined ||
    metadataVisibleText === undefined ||
    description === undefined ||
    episodeSummaryText === undefined ||
    !tagTexts ||
    typeof candidate.titleVisible !== 'boolean' ||
    typeof candidate.playerVisible !== 'boolean' ||
    typeof candidate.loginOverlayVisible !== 'boolean' ||
    !risk ||
    typeof risk.verificationRequired !== 'boolean' ||
    typeof risk.rateLimited !== 'boolean' ||
    typeof risk.sourceUnavailable !== 'boolean'
  ) throw new Error('video_detail_observation_dom_invalid');
  let creator: BilibiliVideoDetailDomSnapshot['creator'] = null;
  if (candidate.creator !== null) {
    const rawCreator = record(candidate.creator);
    const displayName = rawCreator?.displayName === null ? null : optionalText(rawCreator?.displayName, 200);
    const publicAccountId = rawCreator?.publicAccountId;
    if (
      !rawCreator ||
      displayName === undefined ||
      (publicAccountId !== null && (typeof publicAccountId !== 'string' || !/^\d{1,20}$/.test(publicAccountId)))
    ) throw new Error('video_detail_observation_dom_invalid');
    creator = { displayName, publicAccountId: publicAccountId as string | null };
  }
  return {
    bvid: expectedBvid,
    title,
    metadataVisibleText,
    description,
    creator,
    tagTexts,
    episodeSummaryText,
    titleVisible: candidate.titleVisible,
    playerVisible: candidate.playerVisible,
    loginOverlayVisible: candidate.loginOverlayVisible,
    risk: {
      verificationRequired: risk.verificationRequired,
      rateLimited: risk.rateLimited,
      sourceUnavailable: risk.sourceUnavailable
    }
  };
}

/**
 * The video-detail bridge carries only a bounded DOM projection. It cannot
 * carry a response body, route, query value, request header, or cookie.
 */
export function bilibiliVideoDetailStrategyObservation(
  result: StrategyObservationResult,
  expectedBvid: string
): BilibiliVideoDetailStrategyObservation {
  if (
    result.type !== 'collector_strategy_observation' ||
    result.strategyId !== BILIBILI_VIDEO_DETAIL_STRATEGY_ID ||
    result.payloadBytes > 96 * 1024
  ) throw new Error('video_detail_observation_strategy_result_invalid');
  const payload = record(result.payload);
  if (
    !payload ||
    payload.schemaVersion !== 1 ||
    payload.strategyId !== BILIBILI_VIDEO_DETAIL_STRATEGY_ID ||
    payload.bvid !== expectedBvid ||
    typeof payload.documentId !== 'string' ||
    payload.documentId.length === 0 ||
    payload.documentId.length > 256
  ) throw new Error('video_detail_observation_payload_context_invalid');
  return { dom: domSnapshot(payload.dom, expectedBvid) };
}
