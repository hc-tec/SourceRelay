import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { LoadedGatewayIdentity } from '../src/identity.js';
import { ExtensionWorkQueue } from '../src/extension-work-queue.js';

const bindingId = '11111111-1111-4111-8111-111111111111';
const base = new Date('2026-07-25T00:00:00.000Z');

function identity(): LoadedGatewayIdentity {
  return {
    publicIdentity: {
      schemaVersion: 1,
      protocolVersion: 1,
      gatewayInstanceId: '22222222-2222-4222-8222-222222222222',
      displayName: 'Unit Gateway',
      loopbackOrigin: 'http://127.0.0.1:43127',
      signingPublicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      identityFingerprint: 'a'.repeat(64)
    },
    signPayload: () => 'b'.repeat(86)
  } as LoadedGatewayIdentity;
}

describe('extension work queue state machine', () => {
  test('delivers one signed work item once and never requeues a claimed platform action', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-'));
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const queued = await queue.enqueueBilibiliVideoDetail({
        browserBindingId: bindingId,
        canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa'
      }, base);
      const claimed = await queue.claimNext(bindingId, new Date(base.getTime() + 1));
      expect(claimed).toMatchObject({
        operationId: queued.operationId,
        browserBindingId: bindingId,
        capability: 'bilibili.video_detail',
        executionTarget: 'collector_work_tab'
      });
      expect(await queue.claimNext(bindingId, new Date(base.getTime() + 2))).toBeNull();
      await expect(queue.enqueueBilibiliVideoDetail({
        browserBindingId: bindingId,
        canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa'
      }, new Date(base.getTime() + 3))).rejects.toThrow('extension_work_binding_busy');
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('conservatively stops pending work after a Gateway restart instead of replaying it', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-'));
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const queued = await queue.enqueueBilibiliVideoDetail({
        browserBindingId: bindingId,
        canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa'
      }, base);
      const restored = await ExtensionWorkQueue.create(identity(), stateDirectory, new Date(base.getTime() + 1));
      const operation = await restored.get(queued.operationId, new Date(base.getTime() + 2));
      expect(operation).toMatchObject({
        state: 'stopped',
        errorCode: 'gateway_restarted_before_completion',
        terminalReason: 'gateway_restarted_before_completion'
      });
      expect(await restored.claimNext(bindingId, new Date(base.getTime() + 2))).toBeNull();
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('derives one fixed native-search route and redacts its phrase after the terminal state', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-search-'));
    const query = '不应长期保存的搜索短语';
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const queued = await queue.enqueueBilibiliNativeSearch({ browserBindingId: bindingId, query }, base);
      const claimed = await queue.claimNext(bindingId, new Date(base.getTime() + 1));
      expect(claimed).toMatchObject({
        operationId: queued.operationId,
        capability: 'bilibili.native_search',
        input: {
          query,
          canonicalSearchUrl: expect.stringContaining('https://search.bilibili.com/all?keyword='),
          resultType: 'comprehensive',
          sort: 'relevance',
          page: 1
        }
      });
      if (!claimed || claimed.capability !== 'bilibili.native_search') throw new Error('test_claim_missing');
      await queue.complete(bindingId, {
        schemaVersion: 1,
        protocolVersion: 1,
        workId: claimed.workId,
        operationId: claimed.operationId,
        browserBindingId: claimed.browserBindingId,
        platform: 'bilibili',
        capability: 'bilibili.native_search',
        executionTarget: 'collector_work_tab',
        state: 'stopped',
        errorCode: 'bilibili_source_unavailable',
        terminalReason: 'source_unavailable',
        completedAt: new Date(base.getTime() + 2).toISOString(),
        navigation: { attempted: true, attemptCount: 1 },
        workTabAcquisition: 'created',
        workTabDisposition: 'retained_not_reusable',
        observation: null
      }, null);
      const persisted = await readFile(join(stateDirectory, 'extension-work-operations.json'), 'utf8');
      expect(persisted).not.toContain(query);
      expect(persisted).not.toContain('canonicalSearchUrl');
      expect(persisted).toContain('queryDigest');
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('derives public profile and inventory targets from one canonical MID without accepting a free-form page', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-account-'));
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const profile = await queue.enqueueBilibiliAccountProfile({
        browserBindingId: bindingId,
        canonicalProfileUrl: 'https://space.bilibili.com/7481602'
      }, base);
      const claimedProfile = await queue.claimNext(bindingId, new Date(base.getTime() + 1));
      expect(claimedProfile).toMatchObject({
        operationId: profile.operationId,
        capability: 'bilibili.account_profile',
        input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602', stableAccountId: '7481602' }
      });

      const restored = await ExtensionWorkQueue.create(identity(), stateDirectory, new Date(base.getTime() + 2));
      const inventory = await restored.enqueueBilibiliAccountInventory({
        browserBindingId: bindingId,
        canonicalProfileUrl: 'https://space.bilibili.com/7481602'
      }, new Date(base.getTime() + 3));
      const claimedInventory = await restored.claimNext(bindingId, new Date(base.getTime() + 4));
      expect(claimedInventory).toMatchObject({
        operationId: inventory.operationId,
        capability: 'bilibili.account_inventory',
        input: {
          canonicalProfileUrl: 'https://space.bilibili.com/7481602',
          canonicalInventoryUrl: 'https://space.bilibili.com/7481602/upload/video',
          stableAccountId: '7481602'
        }
      });
      await expect(restored.enqueueBilibiliAccountInventory({
        browserBindingId: bindingId,
        canonicalProfileUrl: 'https://space.bilibili.com/7481602/upload/video'
      }, new Date(base.getTime() + 5))).rejects.toThrow('bilibili_account_inventory_input_invalid');
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('gives collection overview exactly one fixed response-observation budget', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-collection-overview-'));
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const queued = await queue.enqueueBilibiliCollectionSeriesOverview({
        browserBindingId: bindingId,
        canonicalProfileUrl: 'https://space.bilibili.com/7481602'
      }, base);
      const claimed = await queue.claimNext(bindingId, new Date(base.getTime() + 1));
      expect(claimed).toMatchObject({
        operationId: queued.operationId,
        capability: 'bilibili.collection_series.overview',
        input: {
          canonicalOverviewUrl: 'https://space.bilibili.com/7481602/lists',
          stableAccountId: '7481602'
        },
        budget: {
          maximumPlatformNavigations: 1,
          maximumSemanticActions: 0,
          maximumResponseObservations: 1,
          maximumPayloadBytes: 98_304
        }
      });
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });
});
