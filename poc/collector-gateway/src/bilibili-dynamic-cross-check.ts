import type {
  BilibiliDynamicCardCrossCheckDiagnostic,
  BilibiliDynamicCrossCheckDiagnostic,
  BilibiliDynamicCrossCheckFailure,
  BilibiliDynamicPageProjection
} from './bilibili-dynamic-contract';

function textCandidateCount(page: BilibiliDynamicPageProjection['items'][number]): 0 | 1 | 2 | 3 | 4 | 5 {
  const ordinaryOpusAdditionalCandidateCount = page.primaryIdentity.kind === 'opus' &&
    page.reservationTitle === null && !page.card.reservation
    ? Number(Boolean(page.additionalGoodsHeadText)) + Number(Boolean(page.additionalUpowerLotteryTitle))
    : 0;
  return (
    Number(Boolean(page.visibleText)) +
    Number(Boolean(page.majorTitle)) +
    Number(page.card.reservation && Boolean(page.reservationTitle)) +
    ordinaryOpusAdditionalCandidateCount
  ) as 0 | 1 | 2 | 3 | 4 | 5;
}

function cardDiagnostic(
  item: BilibiliDynamicPageProjection['items'][number]
): BilibiliDynamicCardCrossCheckDiagnostic {
  return {
    positionOnPage: item.positionOnPage,
    cardKind: item.card.kind,
    domLinkCount: item.card.links.length,
    domMediaRefCount: item.card.mediaRefs.length,
    domReservation: item.card.reservation,
    domBlockedPlaceholder: item.card.blockedPlaceholder,
    domForwarded: item.card.forwarded,
    responsePrimaryIdentityKind: item.primaryIdentity.kind,
    responseAccessState: item.accessState,
    responseForwardedState: item.forwardedSourceState,
    responseTextCandidateCount: textCandidateCount(item),
    checks: item.domEvidence
  };
}

/**
 * Produces a redacted, durable explanation for a strict cross-check result.
 * The page projection is used only in memory; the returned diagnostic contains
 * aggregate counts, booleans, and already-redacted ID digests.
 */
export function bilibiliDynamicCrossCheckDiagnostic(
  page: BilibiliDynamicPageProjection
): BilibiliDynamicCrossCheckDiagnostic {
  const itemCount = page.items.length;
  const check = page.domCrossCheck;
  const failedChecks: BilibiliDynamicCrossCheckFailure[] = [];
  if (!check.exactCumulativeCardCount) failedChecks.push('cumulative_card_count_mismatch');
  if (check.matchedPageCards !== itemCount) failedChecks.push('page_card_alignment_mismatch');
  if (check.cardEvidenceMatches !== itemCount) failedChecks.push('card_evidence_mismatch');
  if (check.authorMatches !== itemCount) failedChecks.push('author_mismatch');
  if (check.accessStateMatches !== itemCount) failedChecks.push('access_state_mismatch');
  if (check.forwardedStateMatches !== itemCount) failedChecks.push('forwarded_state_mismatch');
  return {
    schemaVersion: 1,
    pageNumber: page.pageNumber,
    itemCount,
    domCrossCheck: { ...check },
    failedChecks,
    cards: page.items.map(cardDiagnostic)
  };
}

export function hasFullBilibiliDynamicDomResponseCrossCheck(
  page: BilibiliDynamicPageProjection
): boolean {
  return bilibiliDynamicCrossCheckDiagnostic(page).failedChecks.length === 0;
}
