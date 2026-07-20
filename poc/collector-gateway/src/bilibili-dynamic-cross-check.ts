import type {
  BilibiliDynamicCrossCheckDiagnostic,
  BilibiliDynamicCrossCheckFailure,
  BilibiliDynamicPageProjection
} from './bilibili-dynamic-contract';

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
    failedChecks
  };
}

export function hasFullBilibiliDynamicDomResponseCrossCheck(
  page: BilibiliDynamicPageProjection
): boolean {
  return bilibiliDynamicCrossCheckDiagnostic(page).failedChecks.length === 0;
}
