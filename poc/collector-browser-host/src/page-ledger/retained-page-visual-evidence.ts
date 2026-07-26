import { hostError } from '../host-errors.js';
import type { ManagedPageRecord } from './page-record.js';

/**
 * A page marked retained_for_review has intentionally left the normal reuse
 * pool so a person can inspect or resolve an intervening login/challenge.
 * This precondition gate permits only a local screenshot of the exact current
 * record; it does not grant a page lease or any browser interaction power.
 */
export function assertRetainedPageVisualEvidenceEligible(
  record: ManagedPageRecord,
  expectedRecordVersion: number
): void {
  if (!Number.isSafeInteger(expectedRecordVersion) || expectedRecordVersion < 1) {
    throw hostError({
      code: 'retained_page_visual_evidence_record_version_invalid',
      category: 'visual_evidence',
      scope: 'page',
      retryClass: 'local_query_only',
      pageDisposition: 'retained_for_review',
      profileSafetyDisposition: 'manual_review_required'
    });
  }
  if (record.recordVersion !== expectedRecordVersion) {
    throw hostError({
      code: 'retained_page_visual_evidence_record_version_mismatch',
      category: 'visual_evidence',
      scope: 'page',
      retryClass: 'local_query_only',
      pageDisposition: record.state === 'retained_for_review' ? 'retained_for_review' : 'unchanged',
      profileSafetyDisposition: 'manual_review_required',
      safeDetails: {
        expectedRecordVersion,
        observedRecordVersion: record.recordVersion
      }
    });
  }
  if (record.state !== 'retained_for_review') {
    throw hostError({
      code: 'retained_page_visual_evidence_state_invalid',
      category: 'visual_evidence',
      scope: 'page',
      retryClass: 'local_query_only',
      pageDisposition: 'unchanged',
      profileSafetyDisposition: 'manual_review_required',
      safeDetails: { observedState: record.state }
    });
  }
  if (record.activeLease !== null) {
    throw hostError({
      code: 'retained_page_visual_evidence_lease_active',
      category: 'visual_evidence',
      scope: 'lease',
      retryClass: 'local_query_only',
      pageDisposition: 'retained_for_review',
      profileSafetyDisposition: 'manual_review_required'
    });
  }
  if (record.page.isClosed()) {
    throw hostError({
      code: 'retained_page_visual_evidence_page_closed',
      category: 'visual_evidence',
      scope: 'page',
      retryClass: 'local_query_only',
      pageDisposition: 'closed',
      profileSafetyDisposition: 'manual_review_required'
    });
  }
}
