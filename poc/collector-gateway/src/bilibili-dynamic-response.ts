import { createHash } from 'node:crypto';
import {
  BILIBILI_DYNAMIC_FEED_PATH,
  BILIBILI_DYNAMIC_RESPONSE_LIMIT,
  projectBilibiliDynamicDomCard,
  projectBilibiliDynamicFeedResponse,
  type BilibiliDynamicDomSnapshot,
  type BilibiliDynamicCardEvidenceCheck,
  type BilibiliDynamicItemProjection,
  type BilibiliDynamicPageCandidate,
  type BilibiliDynamicPageProjection,
  type BilibiliDynamicResponseEvidence,
  type BilibiliDynamicResponseItem
} from './bilibili-dynamic-contract';
import { responseSchema } from './interaction-response-projector';

interface ProjectableResponse {
  url(): string;
  status(): number;
  body(): Promise<Buffer>;
  request(): { method(): string };
}

export interface BoundedBilibiliDynamicResponse {
  value: unknown;
  status: number;
  capturedAt: number;
  bodyBytes: number;
  bodySha256: string;
  queryKeyNames: string[];
  schemaPaths: ReturnType<typeof responseSchema>['schemaPaths'];
  sensitiveFieldPathsOmitted: number;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeQueryKeyNames(url: URL): string[] {
  return [...new Set([...url.searchParams.keys()]
    .filter((key) => key.length > 0 && key.length <= 100)
    .map((key) => key.replace(/[^a-zA-Z0-9_.\-\[\]]/g, '_')))].sort();
}

function normaliseText(value: string): string {
  return value.replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
}

export function bilibiliDynamicCardTextEvidenceMatches(
  cardText: string,
  candidates: Array<string | null>,
  renderedMediaAlts: readonly string[]
): boolean {
  const card = normaliseText(cardText);
  return candidates.some((candidate) => {
    if (!candidate) return false;
    const expected = normaliseText(candidate);
    if (expected.length < 2) return false;
    if (card.includes(expected)) return true;
    const prefixLength = Math.min(expected.length, 80);
    if (prefixLength >= 8 && card.includes(expected.slice(0, prefixLength))) return true;
    const withoutRenderedMedia = renderedMediaAlts.reduce((value, alt) =>
      alt.length >= 2 ? value.split(alt).join('') : value,
    expected);
    if (withoutRenderedMedia === expected || withoutRenderedMedia.length < 2) return false;
    if (card.includes(withoutRenderedMedia)) return true;
    const mediaNormalisedPrefixLength = Math.min(withoutRenderedMedia.length, 80);
    return mediaNormalisedPrefixLength >= 8 && card.includes(
      withoutRenderedMedia.slice(0, mediaNormalisedPrefixLength)
    );
  });
}

function textContains(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const normalLeft = normaliseText(left);
  const normalRight = normaliseText(right);
  return normalLeft.includes(normalRight) || normalRight.includes(normalLeft);
}

function responseTextCandidates(
  item: Omit<BilibiliDynamicItemProjection, 'domEvidence'>
): Array<string | null> {
  const ordinaryOpusAdditionalCandidates = item.primaryIdentity.kind === 'opus' &&
    item.reservationTitle === null && !item.card.reservation
    ? [item.additionalGoodsHeadText, item.additionalUpowerLotteryTitle]
    : [];
  return [
    item.visibleText,
    item.majorTitle,
    item.card.reservation ? item.reservationTitle : null,
    ...ordinaryOpusAdditionalCandidates
  ];
}

function hasComparableResponseText(
  item: Omit<BilibiliDynamicItemProjection, 'domEvidence'>
): boolean {
  return responseTextCandidates(item).some((candidate) => {
    const text = candidate ? normaliseText(candidate) : '';
    return text.length >= 2 && text !== '[truncated: depth limit]';
  });
}

function isPrimaryIdentityCrossCheckable(kind: BilibiliDynamicResponseItem['primaryIdentity']['kind']): boolean {
  return kind === 'video' || kind === 'article' || kind === 'live';
}

/**
 * Evaluates one response item and its same-position DOM card.  Both page
 * projection and rejected-page diagnostics call this function so their
 * aggregate and per-card conclusions cannot drift apart.
 */
export function bilibiliDynamicCardEvidenceCheck(
  item: Omit<BilibiliDynamicItemProjection, 'domEvidence'>
): BilibiliDynamicCardEvidenceCheck {
  const authorMatch = normaliseText(item.card.outerAuthor) === normaliseText(item.displayName);
  const publicationMatch = item.publishedVisibleText === null ||
    textContains(item.card.publishedVisibleText, item.publishedVisibleText);
  const primaryIdentityCrossCheckable = isPrimaryIdentityCrossCheckable(item.primaryIdentity.kind);
  const primaryIdentityMatch = primaryIdentityCrossCheckable && item.card.links.some((link) =>
    link.url === item.primaryIdentity.canonicalUrl
  );
  const textMatch = bilibiliDynamicCardTextEvidenceMatches(
    item.card.visibleText,
    responseTextCandidates(item),
    item.card.mediaRefs.map((media) => media.alt).filter(Boolean)
  );
  const accessStateMatch = (item.accessState === 'restricted_placeholder') === item.card.blockedPlaceholder;
  const responseForwarded = item.forwardedSourceState !== 'not_forward';
  const forwardedStateMatch = responseForwarded === item.card.forwarded;
  // Ordinary Opus responses can omit the public body text at the permitted
  // network depth. In that case, accept the visible DOM card only when its
  // structural identity is still coherent; do not call the unavailable text
  // comparison a match.
  const domOnlyOpusFallback = !hasComparableResponseText(item) &&
    item.primaryIdentity.kind === 'opus' &&
    item.card.kind === 'opus' &&
    authorMatch &&
    publicationMatch;
  const cardEvidenceMatch = accessStateMatch && (
    item.accessState === 'restricted_placeholder' ||
    primaryIdentityMatch ||
    textMatch ||
    (responseForwarded && forwardedStateMatch) ||
    domOnlyOpusFallback
  );
  return {
    authorMatch,
    publicationMatch,
    primaryIdentityCrossCheckable,
    primaryIdentityMatch,
    textMatch,
    accessStateMatch,
    forwardedStateMatch,
    cardEvidenceMatch
  };
}

export function isBilibiliDynamicFeedResponse(
  response: ProjectableResponse,
  expectedAccountId: string,
  expectedOffset: string
): boolean {
  try {
    const url = new URL(response.url());
    return response.request().method() === 'GET' &&
      url.origin === 'https://api.bilibili.com' &&
      url.pathname === BILIBILI_DYNAMIC_FEED_PATH &&
      url.searchParams.get('host_mid') === expectedAccountId &&
      (url.searchParams.get('offset') ?? '') === expectedOffset;
  } catch {
    return false;
  }
}

export async function boundedBilibiliDynamicResponse(
  response: ProjectableResponse
): Promise<BoundedBilibiliDynamicResponse> {
  const body = await response.body();
  if (body.byteLength > BILIBILI_DYNAMIC_RESPONSE_LIMIT) {
    throw new Error('bilibili_dynamic_response_too_large');
  }
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new Error('bilibili_dynamic_response_invalid_json');
  }
  const schema = responseSchema(value);
  return {
    value,
    status: response.status(),
    capturedAt: Date.now(),
    bodyBytes: body.byteLength,
    bodySha256: sha256(body),
    queryKeyNames: safeQueryKeyNames(new URL(response.url())),
    schemaPaths: schema.schemaPaths,
    sensitiveFieldPathsOmitted: schema.sensitiveFieldPathsOmitted
  };
}

export function dynamicResponseEvidence(
  response: BoundedBilibiliDynamicResponse,
  pageNumber: number
): BilibiliDynamicResponseEvidence {
  return {
    pathname: BILIBILI_DYNAMIC_FEED_PATH,
    pageNumber,
    responseStatus: response.status,
    responseBodyBytes: response.bodyBytes,
    responseBodySha256: response.bodySha256,
    queryKeyNames: response.queryKeyNames,
    schemaPaths: response.schemaPaths,
    sensitiveFieldPathsOmitted: response.sensitiveFieldPathsOmitted
  };
}

export function projectBilibiliDynamicPageWithDom(
  response: BoundedBilibiliDynamicResponse,
  expectedAccountId: string,
  expectedPageNumber: number,
  previousItems: readonly BilibiliDynamicResponseItem[],
  dom: BilibiliDynamicDomSnapshot,
  capturedAt: string
): { projection: BilibiliDynamicPageProjection; candidate: BilibiliDynamicPageCandidate } | null {
  const candidate = projectBilibiliDynamicFeedResponse(response.value, expectedAccountId, expectedPageNumber);
  if (!candidate) return null;
  const cumulativeItems = [...previousItems, ...candidate.items];
  const pageCards = dom.cards.slice(previousItems.length, cumulativeItems.length);
  const projectedCards = pageCards.map(projectBilibiliDynamicDomCard);
  if (projectedCards.some((card) => card === null) || projectedCards.length !== candidate.items.length) return null;
  const cards = projectedCards as Array<NonNullable<(typeof projectedCards)[number]>>;
  const items: BilibiliDynamicItemProjection[] = candidate.items.map((item, index) => {
    const itemWithCard: Omit<BilibiliDynamicItemProjection, 'domEvidence'> = {
      ...item,
      card: cards[index]!
    };
    const domEvidence = bilibiliDynamicCardEvidenceCheck(itemWithCard);
    return {
      ...itemWithCard,
      domEvidence
    };
  });

  let authorMatches = 0;
  let publicationMatches = 0;
  let primaryIdentityMatches = 0;
  let crossCheckablePrimaryIdentities = 0;
  let textMatches = 0;
  let cardEvidenceMatches = 0;
  let accessStateMatches = 0;
  let forwardedStateMatches = 0;
  for (const item of items) {
    const evidence = item.domEvidence;
    if (evidence.authorMatch) authorMatches += 1;
    if (evidence.publicationMatch) publicationMatches += 1;
    if (evidence.primaryIdentityCrossCheckable) crossCheckablePrimaryIdentities += 1;
    if (evidence.primaryIdentityMatch) primaryIdentityMatches += 1;
    if (evidence.textMatch) textMatches += 1;
    if (evidence.cardEvidenceMatch) cardEvidenceMatches += 1;
    if (evidence.accessStateMatch) accessStateMatches += 1;
    if (evidence.forwardedStateMatch) forwardedStateMatches += 1;
  }

  const pageIds = candidate.items.map((item) => item.stableDynamicId);
  const cumulativeIds = cumulativeItems.map((item) => item.stableDynamicId);
  return {
    candidate,
    projection: {
      schemaVersion: 1,
      pageNumber: candidate.pageNumber,
      items,
      hasMore: candidate.hasMore,
      nextOffsetPresent: candidate.nextOffset.length > 0,
      totalHint: candidate.totalHint,
      responseStatus: response.status,
      responseBodyBytes: response.bodyBytes,
      responseBodySha256: response.bodySha256,
      queryKeyNames: response.queryKeyNames,
      schemaPaths: response.schemaPaths,
      sensitiveFieldPathsOmitted: response.sensitiveFieldPathsOmitted,
      domCrossCheck: {
        responsePageItems: candidate.items.length,
        responseCumulativeItems: cumulativeItems.length,
        domCumulativeCards: dom.cards.length,
        matchedPageCards: items.length,
        cardEvidenceMatches,
        accessStateMatches,
        forwardedStateMatches,
        crossCheckablePrimaryIdentities,
        primaryIdentityMatches,
        textMatches,
        authorMatches,
        publicationMatches,
        exactCumulativeCardCount: dom.cards.length === cumulativeItems.length,
        responsePageDynamicIdDigest: sha256([...pageIds].sort().join('\n')),
        responseCumulativeDynamicIdDigest: sha256([...cumulativeIds].sort().join('\n'))
      },
      capturedAt
    }
  };
}
