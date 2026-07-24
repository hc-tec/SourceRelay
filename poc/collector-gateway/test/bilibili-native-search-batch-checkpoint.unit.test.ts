import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { BilibiliNativeSearchBatchCheckpointStore } from '../src/bilibili-native-search-batch-checkpoints.js';

const profileId = '11111111-1111-4111-8111-111111111111';
const batchId = '22222222-2222-4222-8222-222222222222';
const pageRun = {
  page: 1,
  runId: '33333333-3333-4333-8333-333333333333',
  artifactId: '44444444-4444-4444-8444-444444444444',
  state: 'completed' as const,
  terminalReason: 'search_ready' as const,
  capturedItems: 2,
  unresolvedCardCount: 0
};

describe('Bilibili native-search batch checkpoints', () => {
  test('persists an in-flight page and rehydrates completed page progress', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bilibili-native-search-checkpoint-'));
    try {
      const store = await BilibiliNativeSearchBatchCheckpointStore.create(directory);
      await store.start({
        batchId,
        profileId,
        search: { resultType: 'video', sort: 'newest', pages: [1, 2] },
        queryDigest: 'a'.repeat(64),
        startedAt: '2026-07-24T00:00:00.000Z'
      });
      await store.markPageStarted(batchId, 1);
      expect(store.get(batchId)?.inFlightPage).toBe(1);

      const rehydratedInFlight = await BilibiliNativeSearchBatchCheckpointStore.create(directory);
      expect(rehydratedInFlight.get(batchId)?.inFlightPage).toBe(1);

      await store.recordPage(batchId, pageRun);
      expect(store.get(batchId)?.pageRuns).toEqual([pageRun]);
      expect(store.get(batchId)?.inFlightPage).toBeNull();

      const rehydrated = await BilibiliNativeSearchBatchCheckpointStore.create(directory);
      expect(rehydrated.get(batchId)).toMatchObject({
        state: 'running',
        inFlightPage: null,
        pageRuns: [pageRun]
      });
      await rehydrated.finish({
        batchId,
        state: 'completed',
        terminalReason: 'search_batch_ready',
        artifactId: '55555555-5555-4555-8555-555555555555'
      });
      expect((await BilibiliNativeSearchBatchCheckpointStore.create(directory)).get(batchId))
        .toMatchObject({ state: 'completed', artifactId: '55555555-5555-4555-8555-555555555555' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('resolves an unknown platform action locally without clearing its in-flight page', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bilibili-native-search-checkpoint-resolution-'));
    try {
      const store = await BilibiliNativeSearchBatchCheckpointStore.create(directory);
      await store.start({
        batchId,
        profileId,
        search: { resultType: 'video', sort: 'newest', pages: [1, 2] },
        queryDigest: 'b'.repeat(64),
        startedAt: '2026-07-24T00:00:00.000Z'
      });
      await store.markPageStarted(batchId, 2);

      const resolveInput = {
        profileId,
        batchId,
        disposition: 'abandon' as const,
        acknowledgement: 'acknowledge_unknown_platform_action' as const
      };
      await expect(store.resolveUnknown(resolveInput))
        .rejects.toThrow('bilibili_native_search_batch_checkpoint_active');
      const rehydratedBeforeResolve = await BilibiliNativeSearchBatchCheckpointStore.create(directory);

      const resolved = await rehydratedBeforeResolve.resolveUnknown(resolveInput);
      expect(resolved).toMatchObject({
        state: 'outcome_unknown',
        inFlightPage: 2,
        artifactId: null,
        resolution: {
          disposition: 'abandon',
          acknowledgement: 'acknowledge_unknown_platform_action'
        }
      });
      expect(Date.parse(resolved.resolution!.resolvedAt)).not.toBeNaN();

      const rehydrated = await BilibiliNativeSearchBatchCheckpointStore.create(directory);
      expect(rehydrated.get(batchId)).toMatchObject({
        state: 'outcome_unknown',
        inFlightPage: 2,
        resolution: { disposition: 'abandon' }
      });
      await expect(rehydrated.resolveUnknown(resolveInput))
        .rejects.toThrow('bilibili_native_search_batch_checkpoint_not_resolvable');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('rejects resolution for a different profile or a known checkpoint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bilibili-native-search-checkpoint-resolution-invalid-'));
    try {
      const store = await BilibiliNativeSearchBatchCheckpointStore.create(directory);
      await store.start({
        batchId,
        profileId,
        search: { resultType: 'video', sort: 'newest', pages: [1] },
        queryDigest: 'c'.repeat(64),
        startedAt: '2026-07-24T00:00:00.000Z'
      });
      const input = {
        profileId,
        batchId,
        disposition: 'abandon' as const,
        acknowledgement: 'acknowledge_unknown_platform_action' as const
      };
      const rehydrated = await BilibiliNativeSearchBatchCheckpointStore.create(directory);
      await expect(rehydrated.resolveUnknown({ ...input, profileId: '99999999-9999-4999-8999-999999999999' }))
        .rejects.toThrow('bilibili_native_search_batch_checkpoint_profile_mismatch');
      await expect(rehydrated.resolveUnknown(input))
        .rejects.toThrow('bilibili_native_search_batch_checkpoint_not_resolvable');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
