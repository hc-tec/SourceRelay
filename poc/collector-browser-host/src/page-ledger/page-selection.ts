import type {
  AcquirePageRequest,
  AcquirePageResult,
  ManagedPageSelection
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';
import {
  createLease,
  digestUrl,
  recordSummary,
  touchRecord,
  type ManagedPageRecord
} from './page-record.js';
import { matchesBilibiliVideoDiscussionPageIdentity } from './bilibili-video-discussion-page-identity.js';

const MAXIMUM_LEASE_DURATION_MS = 60 * 60 * 1000;
export const DEFAULT_MAX_IDLE_TRUST_MS = 15 * 60 * 1000;
const MINIMUM_MAX_IDLE_TRUST_MS = 100;
const MAXIMUM_MAX_IDLE_TRUST_MS = 24 * 60 * 60 * 1000;

export interface PageSelectionResult {
  record: ManagedPageRecord | null;
  selection: ManagedPageSelection | null;
}

/**
 * Selects a page that can safely receive a new lease.  A review-retained page
 * is deliberately excluded from generic role/profile reuse and reclamation,
 * but an exact same-target request may reopen it after rechecking the live
 * browser URL.  This lets repeat work stay in its existing tab without ever
 * hijacking a page a person has since navigated elsewhere.
 */
export function selectLeaseablePage(
  records: readonly ManagedPageRecord[],
  platform: string,
  pageRole: string,
  targetUrlDigest: string | null,
  targetUrl?: string
): PageSelectionResult {
  const idle = records.filter((record) => record.state === 'idle_reusable');
  const exact = targetUrlDigest
    ? idle.find((record) =>
      record.platform === platform &&
      record.pageRole === pageRole &&
      record.expectedIdentity.targetUrlDigest === targetUrlDigest)
    : null;
  if (exact) return { record: exact, selection: 'reused_exact_target' };

  // A retained page is never a generic pool candidate.  It can only be
  // leased again for the exact identity it was retained to review, and only
  // when the real page has not moved since then.  The latter check protects a
  // user who keeps the tab but browses elsewhere before the next run.
  const retainedExact = targetUrlDigest
    ? records
      .filter((record) =>
        record.state === 'retained_for_review' &&
        record.activeLease === null &&
        !record.page.isClosed() &&
        record.platform === platform &&
        record.pageRole === pageRole &&
        retainedTargetMatches(record, targetUrlDigest, targetUrl))
      .sort((left, right) => Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt))[0] ?? null
    : null;
  if (retainedExact) return { record: retainedExact, selection: 'reused_exact_target' };

  const sameRole = idle.find((record) => record.platform === platform && record.pageRole === pageRole);
  if (sameRole) return { record: sameRole, selection: 'reused_same_role' };
  return idle[0]
    ? { record: idle[0], selection: 'reused_same_profile' }
    : { record: null, selection: null };
}

function retainedTargetMatches(
  record: ManagedPageRecord,
  targetUrlDigest: string,
  targetUrl: string | undefined
): boolean {
  if (record.expectedIdentity.targetUrlDigest === targetUrlDigest &&
    digestUrl(record.page.url()) === targetUrlDigest) return true;
  if (record.platform !== 'bilibili' || record.pageRole !== 'video_discussion' || !targetUrl) return false;
  const bvid = targetUrl.match(/\/video\/(BV[0-9A-Za-z]{10})\/?(?:[?#]|$)/)?.[1] ?? null;
  return Boolean(bvid && matchesBilibiliVideoDiscussionPageIdentity(record.page.url(), bvid));
}

export function validateAcquireRequest(request: AcquirePageRequest, profileId: string): void {
  if (request.profileId !== profileId) {
    throw hostError({ code: 'profile_mismatch', category: 'profile', scope: 'profile' });
  }
  if (!Number.isSafeInteger(request.leaseDurationMs) ||
    request.leaseDurationMs < 1_000 ||
    request.leaseDurationMs > MAXIMUM_LEASE_DURATION_MS) {
    throw hostError({ code: 'page_lease_duration_invalid', category: 'lease', scope: 'lease' });
  }
  if (request.maximumManagedPages !== undefined &&
    (!Number.isSafeInteger(request.maximumManagedPages) ||
      request.maximumManagedPages < 1 ||
      request.maximumManagedPages > 32)) {
    throw hostError({ code: 'managed_page_limit_invalid', category: 'capacity', scope: 'profile' });
  }
  if (request.maxIdleTrustMs !== undefined &&
    (!Number.isSafeInteger(request.maxIdleTrustMs) ||
      request.maxIdleTrustMs < MINIMUM_MAX_IDLE_TRUST_MS ||
      request.maxIdleTrustMs > MAXIMUM_MAX_IDLE_TRUST_MS)) {
    throw hostError({ code: 'idle_trust_window_invalid', category: 'page_identity', scope: 'page' });
  }
}

export function leaseSelectedPage(
  record: ManagedPageRecord,
  request: AcquirePageRequest,
  controllerGeneration: string,
  targetUrlDigest: string | null,
  selection: ManagedPageSelection
): AcquirePageResult {
  const lease = createLease({
    controllerGeneration,
    profileId: request.profileId,
    taskId: request.taskId,
    runId: request.runId,
    stageLeaseId: request.stageLeaseId ?? null,
    platform: request.platform,
    pageRole: request.pageRole,
    leaseDurationMs: request.leaseDurationMs
  });
  record.platform = request.platform;
  record.pageRole = request.pageRole;
  record.expectedIdentity = {
    platform: request.platform,
    pageRole: request.pageRole,
    targetUrlDigest: targetUrlDigest ?? digestUrl(record.page.url())
  };
  record.activeLease = lease;
  record.maxIdleTrustMs = request.maxIdleTrustMs ?? DEFAULT_MAX_IDLE_TRUST_MS;
  record.state = targetUrlDigest && targetUrlDigest !== digestUrl(record.page.url())
    ? 'leased_pre_navigation'
    : 'leased';
  record.quarantineReason = null;
  touchRecord(record);
  return { page: recordSummary(record), lease, selection };
}
