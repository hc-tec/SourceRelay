import { expect, test, vi } from 'vitest';
import { PageReclamationManager } from '../src/reclamation/page-reclamation.js';
import { touchRecord } from '../src/page-ledger/page-record.js';
import { now, profileId, record } from './support/page-records.js';

test('selects least-recently-used identity-verified pages and closes only the approved unchanged record', async () => {
  const oldest = record({ alias: 'oldest', lastUsedAt: '2026-07-22T00:00:00.000Z' });
  const newest = record({ alias: 'newest', lastUsedAt: '2026-07-22T00:10:00.000Z' });
  const events: string[] = [];
  const manager = new PageReclamationManager({
    profileId,
    browserSessionId: 'browser-session-1',
    records: () => [oldest.record, newest.record],
    onTransition: (event) => events.push(event)
  });

  const plan = manager.create({ profileId, maximumPagesToClose: 1, expiresInMs: 10_000 });
  expect(plan.candidates).toHaveLength(1);
  expect(plan.candidates[0]?.pageAlias).toBe('oldest');
  expect(oldest.record.state).toBe('reclaim_pending');

  const executed = await manager.execute(plan.reclaimPlanId);
  expect(executed.items).toEqual([{ pageAlias: 'oldest', status: 'closed', reason: 'reclaim_executed' }]);
  expect(oldest.browserPage.closed).toBe(true);
  expect(oldest.browserPage.closeCalls).toBe(1);
  expect(newest.browserPage.closed).toBe(false);
  expect(events).toContain('reclaim_pending');
});

test('cancels a changed plan rather than closing a page after its record version changes', async () => {
  const candidate = record();
  const manager = new PageReclamationManager({
    profileId,
    browserSessionId: 'browser-session-1',
    records: () => [candidate.record],
    onTransition: () => undefined
  });
  const plan = manager.create({ profileId, maximumPagesToClose: 1, expiresInMs: 10_000 });
  touchRecord(candidate.record);

  expect(await manager.execute(plan.reclaimPlanId)).toEqual({
    reclaimPlanId: plan.reclaimPlanId,
    items: [{ pageAlias: 'page-1', status: 'changed', reason: 'record_changed' }]
  });
  expect(candidate.record.state).toBe('idle_reusable');
  expect(candidate.browserPage.closed).toBe(false);
});

test('quarantines a page whose current identity drifts before it can enter a reclaim plan', () => {
  const candidate = record();
  candidate.browserPage.setUrl('https://example.test/unexpected');
  const events: string[] = [];
  const manager = new PageReclamationManager({
    profileId,
    browserSessionId: 'browser-session-1',
    records: () => [candidate.record],
    onTransition: (event) => events.push(event)
  });

  const plan = manager.create({ profileId, maximumPagesToClose: 1, expiresInMs: 10_000 });
  expect(plan.candidates).toEqual([]);
  expect(candidate.record).toMatchObject({ state: 'quarantined', quarantineReason: 'page_identity_changed' });
  expect(events).toContain('reclaim_candidate_identity_changed');
});

test('expired reclamation plans restore an unchanged page instead of leaving a pending lock', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(now));
    const candidate = record();
    const events: string[] = [];
    const manager = new PageReclamationManager({
      profileId,
      browserSessionId: 'browser-session-1',
      records: () => [candidate.record],
      onTransition: (event) => events.push(event)
    });
    manager.create({ profileId, maximumPagesToClose: 1, expiresInMs: 1_000 });
    expect(candidate.record.state).toBe('reclaim_pending');

    vi.setSystemTime(new Date('2026-07-22T00:00:01.001Z'));
    manager.create({ profileId, maximumPagesToClose: 1, expiresInMs: 1_000 });
    expect(events).toContain('reclaim_plan_expired');
    expect(candidate.record.state).toBe('reclaim_pending');
  } finally {
    vi.useRealTimers();
  }
});
