import {
  BILIBILI_DYNAMIC_STRATEGY_ID,
  type StrategyObservationResult
} from '@intelligence/collector-contracts';
import {
  BILIBILI_DYNAMIC_FEED_PATH,
  BILIBILI_DYNAMIC_RESPONSE_LIMIT,
  type BilibiliDynamicDomCardObservation,
  type BilibiliDynamicDomSnapshot,
  type BilibiliDynamicResponseEvidence
} from './bilibili-dynamic-contract';
import type { BoundedBilibiliDynamicResponse } from './bilibili-dynamic-response';
import { responseSchema } from './interaction-response-projector';

const FEED_RESPONSE_URL = `https://api.bilibili.com${BILIBILI_DYNAMIC_FEED_PATH}`;

export interface BilibiliDynamicStrategyObservation {
  dom: BilibiliDynamicDomSnapshot;
  responses: BoundedBilibiliDynamicResponse[];
  failedResponseEvidence: BilibiliDynamicResponseEvidence | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
    ? value.replace(/\s+/g, ' ').trim()
    : null;
}

function publicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function stringArray(value: unknown, maximumItems: number, maximumText: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const values = value.map((item) => boundedText(item, maximumText));
  return values.every((item): item is string => item !== null)
    ? [...new Set(values)].sort((left, right) => left.localeCompare(right, 'zh-CN'))
    : null;
}

function domCard(value: unknown, expectedPosition: number): BilibiliDynamicDomCardObservation | null {
  const candidate = record(value);
  if (!candidate || candidate.position !== expectedPosition) return null;
  const outerAuthor = boundedText(candidate.outerAuthor, 200);
  const visibleText = boundedText(candidate.visibleText, 3_000);
  const publishedVisibleText = candidate.publishedVisibleText === null
    ? null
    : boundedText(candidate.publishedVisibleText, 200);
  if (!outerAuthor || !visibleText || publishedVisibleText === null && candidate.publishedVisibleText !== null) return null;
  if (candidate.kind !== 'video' && candidate.kind !== 'opus' && candidate.kind !== 'blocked' && candidate.kind !== 'other') {
    return null;
  }
  if (
    typeof candidate.blockedPlaceholder !== 'boolean' ||
    typeof candidate.reservation !== 'boolean' ||
    typeof candidate.forwarded !== 'boolean' ||
    !Array.isArray(candidate.links) || candidate.links.length > 12 ||
    !Array.isArray(candidate.images) || candidate.images.length > 8 ||
    !Array.isArray(candidate.identityAttributeCandidates) || candidate.identityAttributeCandidates.length > 12
  ) return null;
  const links: Array<{ text: string; url: string }> = [];
  for (const rawLink of candidate.links) {
    const link = record(rawLink);
    const text = boundedText(link?.text, 240);
    const url = publicUrl(link?.url);
    if (!link || text === null || !url) return null;
    links.push({ text, url });
  }
  const images: Array<{ alt: string; url: string }> = [];
  for (const rawImage of candidate.images) {
    const image = record(rawImage);
    const alt = boundedText(image?.alt, 240);
    const url = publicUrl(image?.url);
    if (!image || alt === null || !url) return null;
    images.push({ alt, url });
  }
  const identityAttributeCandidates: Array<{ name: string; value: string }> = [];
  for (const rawCandidate of candidate.identityAttributeCandidates) {
    const attribute = record(rawCandidate);
    const name = boundedText(attribute?.name, 100);
    const value = boundedText(attribute?.value, 20);
    if (!attribute || !name || !value ||
      !/^data-[a-z0-9_.:-]{1,80}$/i.test(name) || !/^\d{1,20}$/.test(value)) return null;
    identityAttributeCandidates.push({ name: name.toLowerCase(), value });
  }
  return {
    position: expectedPosition,
    outerAuthor,
    publishedVisibleText,
    visibleText,
    links,
    images,
    identityAttributeCandidates,
    kind: candidate.kind,
    blockedPlaceholder: candidate.blockedPlaceholder,
    reservation: candidate.reservation,
    forwarded: candidate.forwarded
  };
}

function dynamicDom(value: unknown, expectedAccountId: string): BilibiliDynamicDomSnapshot {
  const candidate = record(value);
  const risk = record(candidate?.risk);
  const stableAccountId = candidate?.stableAccountId;
  const visibleFilterLabels = stringArray(candidate?.visibleFilterLabels, 20, 40);
  const activeFilterLabel = candidate?.activeFilterLabel === null
    ? null
    : boundedText(candidate?.activeFilterLabel, 40);
  if (
    !candidate ||
    stableAccountId !== expectedAccountId ||
    !visibleFilterLabels ||
    (candidate.activeFilterLabel !== null && activeFilterLabel === null) ||
    !Array.isArray(candidate.cards) || candidate.cards.length > 24 ||
    !risk ||
    typeof risk.verificationRequired !== 'boolean' ||
    typeof risk.rateLimited !== 'boolean' ||
    typeof risk.sourceUnavailable !== 'boolean'
  ) throw new Error('dynamic_observation_dom_invalid');
  const cards = candidate.cards.map((card, index) => domCard(card, index + 1));
  if (cards.some((card) => card === null)) throw new Error('dynamic_observation_dom_invalid');
  return {
    stableAccountId,
    visibleFilterLabels,
    activeFilterLabel,
    cards: cards as BilibiliDynamicDomCardObservation[],
    risk: {
      verificationRequired: risk.verificationRequired,
      rateLimited: risk.rateLimited,
      sourceUnavailable: risk.sourceUnavailable
    }
  };
}

function queryKeyNames(value: unknown): string[] | null {
  return Array.isArray(value) && value.length <= 100 &&
    value.every((key) => typeof key === 'string' && /^[A-Za-z0-9_.\-\[\]]{1,100}$/.test(key))
    ? [...new Set(value)].sort()
    : null;
}

function responseEvidence(
  candidate: Record<string, unknown>,
  body: unknown,
  queryKeys: string[],
  pageNumber: number
): BilibiliDynamicResponseEvidence | null {
  const status = candidate.httpStatus;
  const bodyBytes = candidate.bodyBytes;
  const bodySha256 = candidate.bodySha256;
  if (
    typeof status !== 'number' || !Number.isInteger(status) || status < 0 || status > 599 ||
    typeof bodyBytes !== 'number' || !Number.isInteger(bodyBytes) || bodyBytes < 0 || bodyBytes > BILIBILI_DYNAMIC_RESPONSE_LIMIT ||
    typeof bodySha256 !== 'string' || !/^[0-9a-f]{64}$/.test(bodySha256)
  ) return null;
  const schema = body === undefined ? { schemaPaths: [], sensitiveFieldPathsOmitted: 0 } : responseSchema(body);
  return {
    pathname: BILIBILI_DYNAMIC_FEED_PATH,
    pageNumber,
    responseStatus: status,
    responseBodyBytes: bodyBytes,
    responseBodySha256: bodySha256,
    queryKeyNames: queryKeys,
    schemaPaths: schema.schemaPaths,
    sensitiveFieldPathsOmitted: schema.sensitiveFieldPathsOmitted
  };
}

function dynamicResponse(value: unknown, pageNumber: number): {
  response: BoundedBilibiliDynamicResponse | null;
  failedResponseEvidence: BilibiliDynamicResponseEvidence | null;
} {
  const candidate = record(value);
  if (
    !candidate ||
    candidate.platform !== 'bilibili' ||
    candidate.routeId !== 'bilibili.dynamic.account-feed.response.v1' ||
    candidate.responseUrl !== FEED_RESPONSE_URL ||
    candidate.method !== 'GET' ||
    candidate.admission !== 'research_validation' ||
    (candidate.contentType !== 'application/json' && candidate.contentType !== 'text/json')
  ) throw new Error('dynamic_observation_response_context_invalid');
  const keys = queryKeyNames(candidate.queryKeyNames);
  if (!keys || !keys.includes('host_mid')) throw new Error('dynamic_observation_response_query_shape_invalid');
  const capturedAt = candidate.capturedAt;
  if (typeof capturedAt !== 'number' || !Number.isSafeInteger(capturedAt) || capturedAt <= 0) {
    throw new Error('dynamic_observation_response_capture_time_invalid');
  }
  const evidence = responseEvidence(candidate, candidate.body, keys, pageNumber);
  if (!evidence) throw new Error('dynamic_observation_response_metadata_invalid');
  if (candidate.status !== 'captured' || evidence.responseStatus !== 200) {
    return { response: null, failedResponseEvidence: evidence };
  }
  const schema = responseSchema(candidate.body);
  return {
    response: {
      value: candidate.body,
      status: evidence.responseStatus,
      capturedAt,
      bodyBytes: evidence.responseBodyBytes,
      bodySha256: evidence.responseBodySha256,
      queryKeyNames: evidence.queryKeyNames,
      schemaPaths: schema.schemaPaths,
      sensitiveFieldPathsOmitted: schema.sensitiveFieldPathsOmitted
    },
    failedResponseEvidence: null
  };
}

/**
 * Converts the Extension's bounded JSON payload back into Gateway domain
 * objects.  It cannot reconstruct URL query values, credentials, headers, or
 * raw response bytes; only the already-redacted public projection crosses the
 * Native Messaging boundary.
 */
export function bilibiliDynamicStrategyObservation(
  result: StrategyObservationResult,
  expectedAccountId: string
): BilibiliDynamicStrategyObservation {
  if (
    result.type !== 'collector_strategy_observation' ||
    result.strategyId !== BILIBILI_DYNAMIC_STRATEGY_ID ||
    result.payloadBytes > 192 * 1024
  ) throw new Error('dynamic_observation_strategy_result_invalid');
  const payload = record(result.payload);
  if (
    !payload ||
    payload.schemaVersion !== 1 ||
    payload.strategyId !== BILIBILI_DYNAMIC_STRATEGY_ID ||
    payload.stableAccountId !== expectedAccountId
  ) throw new Error('dynamic_observation_payload_context_invalid');
  const dom = dynamicDom(payload.dom, expectedAccountId);
  if (!Array.isArray(payload.responses) || payload.responses.length > 2) {
    throw new Error('dynamic_observation_response_count_invalid');
  }
  const responses: BoundedBilibiliDynamicResponse[] = [];
  let failedResponseEvidence: BilibiliDynamicResponseEvidence | null = null;
  let previousCapturedAt = 0;
  for (const [index, value] of payload.responses.entries()) {
    const observed = dynamicResponse(value, index + 1);
    if (observed.response) {
      if (failedResponseEvidence || observed.response.capturedAt < previousCapturedAt) {
        throw new Error('dynamic_observation_response_order_invalid');
      }
      previousCapturedAt = observed.response.capturedAt;
      responses.push(observed.response);
    } else if (!failedResponseEvidence) {
      failedResponseEvidence = observed.failedResponseEvidence;
    }
  }
  return { dom, responses, failedResponseEvidence };
}
