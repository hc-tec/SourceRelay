import { hostError } from '../host-errors.js';
import { transitionRecord, type ManagedPageRecord } from './page-record.js';

/**
 * Validate the explicit maintenance preconditions before a quarantined page
 * can be closed. A caller must have read the current snapshot and provide
 * the exact record version so a stale cleanup command cannot close a page
 * that changed state after it was observed.
 */
export function assertQuarantinedPageCloseEligible(
  record: ManagedPageRecord,
  expectedRecordVersion: number
): void {
  if (!Number.isSafeInteger(expectedRecordVersion) || expectedRecordVersion < 1) {
    throw hostError({
      code: 'quarantined_page_record_version_invalid',
      category: 'maintenance',
      scope: 'page',
      retryClass: 'local_query_only',
      pageDisposition: 'quarantined',
      profileSafetyDisposition: 'manual_review_required'
    });
  }
  if (record.recordVersion !== expectedRecordVersion) {
    throw hostError({
      code: 'quarantined_page_record_version_mismatch',
      category: 'maintenance',
      scope: 'page',
      retryClass: 'local_query_only',
      pageDisposition: 'quarantined',
      profileSafetyDisposition: 'manual_review_required',
      safeDetails: {
        expectedRecordVersion,
        observedRecordVersion: record.recordVersion
      }
    });
  }
  if (record.state !== 'quarantined') {
    throw hostError({
      code: 'quarantined_page_state_invalid',
      category: 'maintenance',
      scope: 'page',
      retryClass: 'local_query_only',
      pageDisposition: 'unchanged',
      profileSafetyDisposition: 'manual_review_required',
      safeDetails: { observedState: record.state }
    });
  }
  if (record.activeLease !== null) {
    throw hostError({
      code: 'quarantined_page_lease_active',
      category: 'maintenance',
      scope: 'page',
      retryClass: 'local_query_only',
      pageDisposition: 'quarantined',
      profileSafetyDisposition: 'manual_review_required'
    });
  }
}

/**
 * Close a page after the caller has passed the exact quarantine checks. The
 * browser page's `close` event normally transitions the ledger to `closed`;
 * the explicit transition below also covers a minimal test double and a
 * browser implementation that does not synchronously emit that event.
 */
export async function closeQuarantinedPageRecord(
  record: ManagedPageRecord,
  expectedRecordVersion: number
): Promise<void> {
  assertQuarantinedPageCloseEligible(record, expectedRecordVersion);
  if (record.page.isClosed()) {
    transitionRecord(record, 'closed', null);
    return;
  }
  try {
    await record.page.close({ runBeforeUnload: false });
  } catch (error) {
    throw hostError({
      code: 'quarantined_page_close_failed',
      category: 'maintenance',
      scope: 'page',
      pageDisposition: 'quarantined',
      profileSafetyDisposition: 'manual_review_required',
      safeDetails: { errorType: error instanceof Error ? error.name : 'unknown' }
    });
  }
  if (record.state !== 'closed') transitionRecord(record, 'closed', null);
}
