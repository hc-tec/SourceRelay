import { describe, expect, test } from 'vitest';
import { createLease } from '../src/page-ledger/page-record.js';
import { assertRetainedPageVisualEvidenceEligible } from '../src/page-ledger/retained-page-visual-evidence.js';
import { now, record } from './support/page-records.js';

describe('retained page visual evidence gate', () => {
  test('permits only the exact inactive retained record without mutating it', () => {
    const candidate = record({ state: 'retained_for_review' });
    const versionBefore = candidate.record.recordVersion;

    expect(() => assertRetainedPageVisualEvidenceEligible(candidate.record, versionBefore)).not.toThrow();
    expect(candidate.record.recordVersion).toBe(versionBefore);
    expect(candidate.record.state).toBe('retained_for_review');
    expect(candidate.browserPage.closeCalls).toBe(0);
  });

  test('rejects stale versions and non-retained states before touching a page', () => {
    const retained = record({ state: 'retained_for_review' });
    expect(() => assertRetainedPageVisualEvidenceEligible(retained.record, retained.record.recordVersion + 1))
      .toThrow('retained_page_visual_evidence_record_version_mismatch');
    expect(retained.browserPage.closeCalls).toBe(0);

    const idle = record({ state: 'idle_reusable' });
    expect(() => assertRetainedPageVisualEvidenceEligible(idle.record, idle.record.recordVersion))
      .toThrow('retained_page_visual_evidence_state_invalid');
    expect(idle.browserPage.closeCalls).toBe(0);
  });

  test('rejects an active lease even if a corrupted record claims retained state', () => {
    const candidate = record({ state: 'retained_for_review' });
    candidate.record.activeLease = createLease({
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

    expect(() => assertRetainedPageVisualEvidenceEligible(candidate.record, candidate.record.recordVersion))
      .toThrow('retained_page_visual_evidence_lease_active');
    expect(candidate.browserPage.closeCalls).toBe(0);
  });
});
