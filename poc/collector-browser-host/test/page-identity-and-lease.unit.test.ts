import { describe, expect, test } from 'vitest';
import {
  canonicalUrlIdentity,
  createLease,
  digestUrl,
  recordSummary,
  touchRecord,
  transitionRecord
} from '../src/page-ledger/page-record.js';
import {
  leaseSelectedPage,
  selectLeaseablePage,
  validateAcquireRequest
} from '../src/page-ledger/page-selection.js';
import { acquireRequest, now, profileId, record } from './support/page-records.js';

describe('Managed page identity and lease invariants', () => {
  test('normalises HTTP identities without accepting a hash as a distinct target', () => {
    expect(canonicalUrlIdentity('https://example.test/path?z=3&a=1#ignored')).toBe(
      'https://example.test/path?a=1&z=3'
    );
    expect(canonicalUrlIdentity('chrome-extension://abcdefghijklmnop/page.html?debug=1#ignored')).toBe(
      'chrome-extension://abcdefghijklmnop/page.html'
    );
    expect(digestUrl('https://example.test/path?a=1&z=3')).toBe(
      digestUrl('https://example.test/path?z=3&a=1#ignored')
    );
  });

  test('does not generically reuse a retained review page, but permits an unchanged exact target', () => {
    const retained = record({
      alias: 'retained',
      url: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
      targetUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
      state: 'retained_for_review'
    });
    const generic = record({ alias: 'generic', url: 'https://example.test/other', pageRole: 'inventory' });
    const exactDigest = digestUrl('https://www.bilibili.com/video/BV1qZSLBYEpa');

    expect(selectLeaseablePage([retained.record, generic.record], 'bilibili', 'detail', exactDigest)).toMatchObject({
      record: retained.record,
      selection: 'reused_exact_target'
    });
    expect(selectLeaseablePage([retained.record, generic.record], 'bilibili', 'detail', null)).toMatchObject({
      record: generic.record,
      selection: 'reused_same_profile'
    });

    retained.browserPage.setUrl('https://www.bilibili.com/video/BV1xx411c7mD');
    expect(selectLeaseablePage([retained.record], 'bilibili', 'detail', exactDigest)).toEqual({
      record: null,
      selection: null
    });
  });

  test('reuses a retained Bilibili discussion tab across the public vd_source URL variant', () => {
    const canonical = 'https://www.bilibili.com/video/BV1qZSLBYEpa';
    const retained = record({
      alias: 'discussion-retained',
      url: `${canonical}/?vd_source=0123456789abcdef0123456789abcdef`,
      targetUrl: canonical,
      state: 'retained_for_review',
      pageRole: 'video_discussion'
    });
    expect(selectLeaseablePage(
      [retained.record],
      'bilibili',
      'video_discussion',
      digestUrl(`${canonical}/`),
      `${canonical}/`
    )).toMatchObject({ record: retained.record, selection: 'reused_exact_target' });

    retained.browserPage.setUrl('https://www.bilibili.com/video/BV1xx411c7mD/');
    expect(selectLeaseablePage(
      [retained.record],
      'bilibili',
      'video_discussion',
      digestUrl(`${canonical}/`),
      `${canonical}/`
    )).toEqual({ record: null, selection: null });
  });

  test('reuses a retained Bilibili discussion tab across observed multipart player markers', () => {
    const canonical = 'https://www.bilibili.com/video/BV1qZSLBYEpa';
    const retained = record({
      alias: 'discussion-part-retained',
      url: `${canonical}?vd_source=0123456789abcdef0123456789abcdef&spm_id_from=333.788.player.switch&p=4`,
      targetUrl: canonical,
      state: 'retained_for_review',
      pageRole: 'video_discussion'
    });
    expect(selectLeaseablePage(
      [retained.record],
      'bilibili',
      'video_discussion',
      digestUrl(`${canonical}/`),
      `${canonical}/`
    )).toMatchObject({ record: retained.record, selection: 'reused_exact_target' });
  });

  test('creates a lease whose state requires navigation when the current page differs from its exact target', () => {
    const candidate = record({ url: 'about:blank' });
    const request = acquireRequest();
    const result = leaseSelectedPage(
      candidate.record,
      request,
      'controller-1',
      digestUrl(request.targetUrl!),
      'reused_same_role'
    );

    expect(result.selection).toBe('reused_same_role');
    expect(result.page.state).toBe('leased_pre_navigation');
    expect(result.lease).toMatchObject({
      profileId,
      taskId: 'task-1',
      runId: 'run-1',
      platform: 'bilibili',
      pageRole: 'detail'
    });
    expect(candidate.record.activeLease?.pageLeaseId).toBe(result.lease.pageLeaseId);
    expect(candidate.record.expectedIdentity.targetUrlDigest).toBe(digestUrl(request.targetUrl!));
  });

  test('rejects mismatched profiles and out-of-budget page lease requests before selection', () => {
    expect(() => validateAcquireRequest(acquireRequest({ profileId: 'other-profile' }), profileId)).toThrow(
      'profile_mismatch'
    );
    expect(() => validateAcquireRequest(acquireRequest({ leaseDurationMs: 999 }), profileId)).toThrow(
      'page_lease_duration_invalid'
    );
    expect(() => validateAcquireRequest(acquireRequest({ maximumManagedPages: 33 }), profileId)).toThrow(
      'managed_page_limit_invalid'
    );
    expect(() => validateAcquireRequest(acquireRequest({ maxIdleTrustMs: 99 }), profileId)).toThrow(
      'idle_trust_window_invalid'
    );
  });

  test('uses fixed time only at the record boundary and returns detached lease snapshots', () => {
    const lease = createLease({
      controllerGeneration: 'controller-1',
      profileId,
      taskId: 'task-1',
      runId: 'run-1',
      stageLeaseId: null,
      platform: 'bilibili',
      pageRole: 'detail',
      leaseDurationMs: 1_000,
      now: new Date(now)
    });
    expect(lease.issuedAt).toBe(now);
    expect(lease.expiresAt).toBe('2026-07-22T00:00:01.000Z');

    const candidate = record();
    candidate.record.activeLease = lease;
    const summary = recordSummary(candidate.record);
    summary.activeLease!.taskId = 'mutated-by-caller';
    expect(candidate.record.activeLease?.taskId).toBe('task-1');

    transitionRecord(candidate.record, 'quarantined', 'unit_test', new Date('2026-07-22T00:01:00.000Z'));
    expect(candidate.record.quarantineReason).toBe('unit_test');
    touchRecord(candidate.record, new Date('2026-07-22T00:02:00.000Z'));
    transitionRecord(candidate.record, 'idle_reusable', null, new Date('2026-07-22T00:03:00.000Z'));
    expect(candidate.record.quarantineReason).toBeNull();
  });
});
