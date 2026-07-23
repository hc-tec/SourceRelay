import { describe, expect, test } from 'vitest';
import {
  assertQuarantinedPageCloseEligible,
  closeQuarantinedPageRecord
} from '../src/page-ledger/quarantine-maintenance.js';
import { createLease } from '../src/page-ledger/page-record.js';
import { now, record } from './support/page-records.js';

describe('explicit quarantined page maintenance', () => {
  test('closes only the exact quarantined record version', async () => {
    const candidate = record({ state: 'quarantined' });

    await closeQuarantinedPageRecord(candidate.record, candidate.record.recordVersion);

    expect(candidate.browserPage.closed).toBe(true);
    expect(candidate.browserPage.closeCalls).toBe(1);
    expect(candidate.record.state).toBe('closed');
    expect(candidate.record.activeLease).toBeNull();
  });

  test('rejects a stale record version without touching the browser page', async () => {
    const candidate = record({ state: 'quarantined' });

    await expect(closeQuarantinedPageRecord(candidate.record, candidate.record.recordVersion + 1))
      .rejects.toMatchObject({ message: 'quarantined_page_record_version_mismatch' });
    expect(candidate.browserPage.closeCalls).toBe(0);
    expect(candidate.record.state).toBe('quarantined');
  });

  test('rejects non-quarantined pages and active leases', async () => {
    const retained = record({ state: 'retained_for_review' });
    expect(() => assertQuarantinedPageCloseEligible(retained.record, retained.record.recordVersion))
      .toThrow('quarantined_page_state_invalid');
    expect(retained.browserPage.closeCalls).toBe(0);

    const leased = record({ state: 'quarantined' });
    leased.record.activeLease = createLease({
      controllerGeneration: 'controller-1',
      profileId: 'profile-one',
      taskId: 'task-1',
      runId: 'run-1',
      stageLeaseId: null,
      platform: 'bilibili',
      pageRole: 'detail',
      leaseDurationMs: 60_000,
      now: new Date(now)
    });
    expect(() => assertQuarantinedPageCloseEligible(leased.record, leased.record.recordVersion))
      .toThrow('quarantined_page_lease_active');
    expect(leased.browserPage.closeCalls).toBe(0);
  });

  test('treats an already closed quarantined record as local idempotent cleanup', async () => {
    const candidate = record({ state: 'quarantined' });
    await candidate.record.page.close();
    const versionBefore = candidate.record.recordVersion;

    await closeQuarantinedPageRecord(candidate.record, versionBefore);

    expect(candidate.browserPage.closeCalls).toBe(1);
    expect(candidate.record.state).toBe('closed');
  });
});
