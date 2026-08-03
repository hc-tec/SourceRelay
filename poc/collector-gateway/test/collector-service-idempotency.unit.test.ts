import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { CollectorServiceIdempotencyLedger } from '../src/collector-service-idempotency.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const DIGEST = 'a'.repeat(64);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'collector-idempotency-'));
  directories.push(value);
  return value;
}

describe('Collector Service idempotency ledger', () => {
  test('persists one preallocated operation identity across restart', async () => {
    const stateDirectory = await directory();
    const first = await CollectorServiceIdempotencyLedger.create(stateDirectory);
    const reserved = await first.reserve(REQUEST_ID, DIGEST, new Date('2026-08-03T00:00:00.000Z'));
    expect(reserved.created).toBe(true);
    expect(reserved.record.state).toBe('reserved');

    const restarted = await CollectorServiceIdempotencyLedger.create(stateDirectory);
    const replay = await restarted.reserve(REQUEST_ID, DIGEST);
    expect(replay).toEqual({ created: false, record: reserved.record });
  });

  test('serialises concurrent duplicate reservations to one operation', async () => {
    const ledger = await CollectorServiceIdempotencyLedger.create(await directory());
    const [left, right] = await Promise.all([
      ledger.reserve(REQUEST_ID, DIGEST),
      ledger.reserve(REQUEST_ID, DIGEST)
    ]);
    expect([left.created, right.created].sort()).toEqual([false, true]);
    expect(left.record.operationId).toBe(right.record.operationId);
    expect(ledger.list()).toHaveLength(1);
  });

  test('rejects request identity reuse with a different canonical digest', async () => {
    const ledger = await CollectorServiceIdempotencyLedger.create(await directory());
    await ledger.reserve(REQUEST_ID, DIGEST);
    await expect(ledger.reserve(REQUEST_ID, 'b'.repeat(64)))
      .rejects.toThrow('collector_service_idempotency_conflict');
  });

  test('persists accepted and rejected safe terminal records', async () => {
    const stateDirectory = await directory();
    const ledger = await CollectorServiceIdempotencyLedger.create(stateDirectory);
    const accepted = await ledger.reserve(REQUEST_ID, DIGEST, new Date('2026-08-03T00:00:00.000Z'));
    await ledger.accept(REQUEST_ID, accepted.record.operationId, new Date('2026-08-03T00:00:01.000Z'));

    const rejectedId = '22222222-2222-4222-8222-222222222222';
    const rejected = await ledger.reserve(
      rejectedId,
      'c'.repeat(64),
      new Date('2026-08-03T00:00:00.500Z')
    );
    await ledger.reject(
      rejectedId,
      rejected.record.operationId,
      'browser_binding_offline',
      409,
      new Date('2026-08-03T00:00:02.000Z')
    );

    const restarted = await CollectorServiceIdempotencyLedger.create(stateDirectory);
    expect(restarted.list().map((record) => ({
      clientRequestId: record.clientRequestId,
      state: record.state,
      errorCode: record.errorCode,
      errorStatus: record.errorStatus
    }))).toEqual([
      { clientRequestId: REQUEST_ID, state: 'accepted', errorCode: null, errorStatus: null },
      { clientRequestId: rejectedId, state: 'rejected', errorCode: 'browser_binding_offline', errorStatus: 409 }
    ]);

    const persisted = await readFile(join(stateDirectory, 'collector-service-idempotency.json'), 'utf8');
    expect(persisted).not.toContain('query');
    expect(persisted).not.toContain('url');
  });
});
