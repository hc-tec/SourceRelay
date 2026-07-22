import {
  BILIBILI_TRANSCRIPT_STRATEGY_ID,
  type StrategyObservationResult
} from '@intelligence/collector-contracts';
import {
  bilibiliTranscriptResearchRouteIds,
  sanitiseNetworkCaptureObservation,
  type NetworkCaptureObservation
} from '../../collector-extension/src/shared/network-capture';
import {
  BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID,
  BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID,
  projectBilibiliTranscriptRouteBody,
  type BilibiliTranscriptDirectoryProjection,
  type BilibiliTranscriptDocumentProjection
} from '../../collector-extension/src/shared/transcript-capture';
import type { BilibiliTranscriptResponseSource } from './bilibili-transcript-contract';

export interface BilibiliTranscriptStrategyObservation {
  directory: BilibiliTranscriptDirectoryProjection | null;
  transcript: BilibiliTranscriptDocumentProjection | null;
  sources: BilibiliTranscriptResponseSource[];
}

/**
 * Revalidates the Extension's bounded payload at the Gateway boundary. The
 * returned object contains projected public subtitle data and de-queried
 * source metadata only; document IDs and browser state never leave MV3.
 */
export function bilibiliTranscriptStrategyObservation(
  result: StrategyObservationResult,
  expectedBvid: string
): BilibiliTranscriptStrategyObservation {
  if (result.strategyId !== BILIBILI_TRANSCRIPT_STRATEGY_ID) {
    throw new Error('transcript_strategy_observation_strategy_rejected');
  }
  const payload = result.payload;
  if (!isRecord(payload) || payload.schemaVersion !== 1 ||
    payload.strategyId !== BILIBILI_TRANSCRIPT_STRATEGY_ID || payload.bvid !== expectedBvid ||
    !Array.isArray(payload.responses)) {
    throw new Error('transcript_strategy_observation_payload_invalid');
  }
  const allowedRoutes = bilibiliTranscriptResearchRouteIds();
  const responses = payload.responses
    .map((candidate) => sanitiseNetworkCaptureObservation(candidate, allowedRoutes))
    .filter((candidate): candidate is NetworkCaptureObservation => candidate !== null)
    .slice(0, 2);
  if (responses.length !== payload.responses.length || responses.length > 2) {
    throw new Error('transcript_strategy_observation_payload_invalid');
  }
  const directory = projectionFor<BilibiliTranscriptDirectoryProjection>(responses, BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID);
  const transcript = projectionFor<BilibiliTranscriptDocumentProjection>(responses, BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID);
  return {
    directory,
    transcript,
    sources: responses.map(source)
  };
}

function projectionFor<T>(
  responses: readonly NetworkCaptureObservation[],
  routeId: string
): T | null {
  const body = responses.find((response) => response.routeId === routeId && response.status === 'captured')?.body;
  const projection = body === undefined ? null : projectBilibiliTranscriptRouteBody(routeId, body);
  return projection as T | null;
}

function source(response: NetworkCaptureObservation): BilibiliTranscriptResponseSource {
  let origin: string | null = null;
  let path: string | null = null;
  try {
    const url = new URL(response.responseUrl);
    origin = url.origin;
    path = url.pathname;
  } catch {
    // The Extension has already canonicalised the URL. Retain null instead of
    // persisting a malformed raw value if the trust boundary ever changes.
  }
  return {
    routeId: response.routeId,
    status: response.status,
    origin,
    path,
    contentType: response.contentType,
    httpStatus: response.httpStatus,
    capturedAt: response.capturedAt,
    bodyBytes: response.bodyBytes ?? null,
    bodySha256: response.bodySha256 ?? null
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
