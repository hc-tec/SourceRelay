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
  test('gives Bilibili direct work one poll window before its bounded runner deadline', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-bilibili-ttl-'));
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const dynamic = await queue.enqueueBilibiliDynamic({
        browserBindingId: bindingId,
        canonicalProfileUrl: 'https://space.bilibili.com/7481602'
      }, base);
      const claimed = await queue.claimNext(bindingId, new Date(base.getTime() + 60_001));
      expect(claimed?.operationId).toBe(dynamic.operationId);
      expect(claimed).not.toBeNull();
      expect(Date.parse(claimed!.expiresAt) - Date.parse(claimed!.issuedAt)).toBe(120_000);
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('gives bounded multi-thread reply work one extra poll window', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-reply-ttl-'));
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const single = await queue.enqueueXiaohongshuNotePublicCommentReplies({
        browserBindingId: bindingId,
        maximumThreads: 1
      }, base);
      await expect(queue.get(single.operationId, new Date(base.getTime() + 60_001))).resolves.toMatchObject({
        state: 'stopped',
        errorCode: 'extension_work_expired'
      });

      const multi = await queue.enqueueXiaohongshuNotePublicCommentReplies({
        browserBindingId: bindingId,
        maximumThreads: 3
      }, new Date(base.getTime() + 60_002));
      await expect(queue.get(multi.operationId, new Date(base.getTime() + 180_001))).resolves.toMatchObject({
        state: 'queued'
      });
      await expect(queue.get(multi.operationId, new Date(base.getTime() + 180_003))).resolves.toMatchObject({
        state: 'stopped',
        errorCode: 'extension_work_expired'
      });
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

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

  test('derives a fixed two-page native-search batch and redacts both transient URLs after terminal delivery', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-search-batch-'));
    const query = '不应长期保存的两页搜索短语';
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const queued = await queue.enqueueBilibiliNativeSearchBatch({ browserBindingId: bindingId, query }, base);
      const claimed = await queue.claimNext(bindingId, new Date(base.getTime() + 1));
      expect(claimed).toMatchObject({
        operationId: queued.operationId,
        capability: 'bilibili.native_search_batch',
        input: {
          query,
          resultType: 'comprehensive',
          sort: 'relevance',
          targets: [
            { page: 1, canonicalSearchUrl: expect.stringContaining('keyword=') },
            { page: 2, canonicalSearchUrl: expect.stringContaining('page=2') }
          ]
        },
        budget: { maximumPlatformNavigations: 2, maximumSemanticActions: 0 }
      });
      if (!claimed || claimed.capability !== 'bilibili.native_search_batch') throw new Error('test_batch_claim_missing');
      await queue.complete(bindingId, {
        schemaVersion: 1,
        protocolVersion: 1,
        workId: claimed.workId,
        operationId: claimed.operationId,
        browserBindingId: claimed.browserBindingId,
        platform: 'bilibili',
        capability: 'bilibili.native_search_batch',
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
      expect(persisted).toContain('native_search_batch');
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

  test('signs a user-selected inventory observation without accepting a tab ID or allocating a navigation budget', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-selected-tab-'));
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const queued = await queue.enqueueBilibiliAccountInventoryUserSelectedTab({
        browserBindingId: bindingId,
        canonicalProfileUrl: 'https://space.bilibili.com/7481602'
      }, base);
      expect(queued.executionTarget).toBe('user_selected_tab');
      const claimed = await queue.claimNext(bindingId, new Date(base.getTime() + 1));
      expect(claimed).toMatchObject({
        operationId: queued.operationId,
        capability: 'bilibili.account_inventory',
        executionTarget: 'user_selected_tab',
        input: {
          canonicalProfileUrl: 'https://space.bilibili.com/7481602',
          canonicalInventoryUrl: 'https://space.bilibili.com/7481602/upload/video',
          stableAccountId: '7481602'
        },
        budget: {
          maximumPlatformNavigations: 0,
          maximumSemanticActions: 0,
          maximumResponseObservations: 0
        }
      });
      if (!claimed || claimed.executionTarget !== 'user_selected_tab') throw new Error('test_selected_claim_missing');
      await queue.complete(bindingId, {
        schemaVersion: 1,
        protocolVersion: 1,
        workId: claimed.workId,
        operationId: claimed.operationId,
        browserBindingId: claimed.browserBindingId,
        platform: 'bilibili',
        capability: 'bilibili.account_inventory',
        executionTarget: 'user_selected_tab',
        state: 'stopped',
        errorCode: 'user_selected_tab_required',
        terminalReason: 'user_selected_tab_required',
        completedAt: new Date(base.getTime() + 2).toISOString(),
        navigation: { attempted: false, attemptCount: 0 },
        userSelectedTabDisposition: 'selection_unavailable',
        observation: null
      }, null);
      const persisted = await readFile(join(stateDirectory, 'extension-work-operations.json'), 'utf8');
      expect(persisted).not.toContain('"tabId"');
      expect(persisted).not.toContain('"documentId"');
      expect(persisted).toContain('"user_selected_tab"');
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('signs an automatic discussion work-tab observation with one navigation and one bounded scroll', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-discussion-work-tab-'));
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const queued = await queue.enqueueBilibiliDiscussionUserSelectedTab({
        browserBindingId: bindingId,
        canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa'
      }, base);
      expect(queued.executionTarget).toBe('collector_work_tab');
      const claimed = await queue.claimNext(bindingId, new Date(base.getTime() + 1));
      expect(claimed).toMatchObject({
        operationId: queued.operationId,
        capability: 'bilibili.discussion',
        executionTarget: 'collector_work_tab',
        input: {
          canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
          bvid: 'BV1qZSLBYEpa'
        },
        budget: {
          maximumPlatformNavigations: 1,
          maximumSemanticActions: 1,
          maximumResponseObservations: 0
        }
      });
      if (!claimed || claimed.capability !== 'bilibili.discussion') throw new Error('test_discussion_claim_missing');
      await queue.complete(bindingId, {
        schemaVersion: 1,
        protocolVersion: 1,
        workId: claimed.workId,
        operationId: claimed.operationId,
        browserBindingId: claimed.browserBindingId,
        platform: 'bilibili',
        capability: 'bilibili.discussion',
        executionTarget: 'collector_work_tab',
        state: 'stopped',
        errorCode: 'work_tab_user_taken_over',
        terminalReason: 'work_tab_user_taken_over',
        completedAt: new Date(base.getTime() + 2).toISOString(),
        navigation: { attempted: true, attemptCount: 1 },
        workTabAcquisition: 'created',
        workTabDisposition: 'retained_not_reusable',
        observation: null
      }, null);
      const persisted = await readFile(join(stateDirectory, 'extension-work-operations.json'), 'utf8');
      expect(persisted).not.toContain('"tabId"');
      expect(persisted).not.toContain('"windowId"');
      expect(persisted).not.toContain('"documentId"');
      expect(persisted).toContain('"bilibili.discussion"');
      expect(persisted).toContain('"collector_work_tab"');
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

  test('signs query-only Xiaohongshu work and redacts the phrase at terminal state', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-xiaohongshu-'));
    const query = '不应长期保存的小红书查询';
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const queued = await queue.enqueueXiaohongshuPublicNotesSearch({ browserBindingId: bindingId, query }, base);
      expect(await queue.claimNext(bindingId, new Date(base.getTime() + 1), ['bilibili'])).toBeNull();
      const claimed = await queue.claimNext(bindingId, new Date(base.getTime() + 1));
      expect(claimed).toMatchObject({
        operationId: queued.operationId,
        platform: 'xiaohongshu',
        capability: 'xiaohongshu.search.public_notes.v1',
        executionTarget: 'existing_public_explore_tab',
        input: { query },
        budget: {
          maximumPlatformNavigations: 0,
          maximumPageReloads: 0,
          maximumPageInitiatedNewDocuments: 0,
          maximumSemanticActions: 1
        }
      });
      if (!claimed || claimed.capability !== 'xiaohongshu.search.public_notes.v1') {
        throw new Error('test_claim_missing');
      }
      await queue.complete(bindingId, {
        schemaVersion: 1,
        protocolVersion: 1,
        workId: claimed.workId,
        operationId: claimed.operationId,
        browserBindingId: claimed.browserBindingId,
        platform: 'xiaohongshu',
        capability: 'xiaohongshu.search.public_notes.v1',
        executionTarget: 'existing_public_explore_tab',
        state: 'completed',
        errorCode: null,
        terminalReason: 'search_ready',
        completedAt: new Date(base.getTime() + 2).toISOString(),
        navigation: { attempted: false, attemptCount: 0 },
        semanticAction: { attempted: true, attemptCount: 1 },
        input: { queryEchoed: true, enterAttempted: true },
        page: { publicSurface: 'search', renderedCardCount: 1 },
        projection: {
          schemaVersion: 2,
          type: 'xiaohongshu_managed_search_projection',
          pageAlias: claimed.workId,
          runId: claimed.workId,
          matchedPayloadCount: 1,
          bodyBytesRead: 100,
          rawPayloadStored: false,
          responseUrlsStored: false,
          items: [{
            rank: 1,
            noteId: 'note-1',
            title: '公开笔记',
            contentType: 'normal',
            authorId: 'author-1',
            authorNickname: '公开作者',
            likedCountText: '1'
          }]
        },
        rawPayloadStored: false,
        responseUrlsStored: false,
        debuggerDetached: true
      }, {
        artifactId: '44444444-4444-4444-8444-444444444444',
        retrievalPath: '/v1/collect/artifacts/xiaohongshu.search.public_notes.v1/44444444-4444-4444-8444-444444444444',
        summary: {}
      });
      const persisted = await readFile(join(stateDirectory, 'extension-work-operations.json'), 'utf8');
      expect(persisted).not.toContain(query);
      expect(persisted).toMatch(/"queryDigest": "[a-f0-9]{64}"/);
      expect(persisted).not.toContain('search_result');
      const restored = await ExtensionWorkQueue.create(identity(), stateDirectory, new Date(base.getTime() + 3));
      await expect(restored.get(queued.operationId)).resolves.toMatchObject({
        platform: 'xiaohongshu',
        state: 'completed'
      });
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('signs URL-free Xiaohongshu account notes work and persists no profile identity', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-xiaohongshu-account-'));
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const queued = await queue.enqueueXiaohongshuAccountPublicNotes({
        browserBindingId: bindingId,
        maximumScrolls: 2
      }, base);
      const claimed = await queue.claimNext(bindingId, new Date(base.getTime() + 1));
      expect(claimed).toMatchObject({
        operationId: queued.operationId,
        platform: 'xiaohongshu',
        capability: 'xiaohongshu.account.public_notes.v1',
        executionTarget: 'existing_public_profile_tab',
        input: { maximumScrolls: 2 },
        budget: {
          maximumPlatformNavigations: 0,
          maximumPageReloads: 0,
          maximumPageInitiatedNewDocuments: 0,
          maximumSemanticActions: 3
        }
      });
      if (!claimed || claimed.capability !== 'xiaohongshu.account.public_notes.v1') {
        throw new Error('test_claim_missing');
      }
      await queue.complete(bindingId, {
        schemaVersion: 1,
        protocolVersion: 1,
        workId: claimed.workId,
        operationId: claimed.operationId,
        browserBindingId: claimed.browserBindingId,
        platform: 'xiaohongshu',
        capability: 'xiaohongshu.account.public_notes.v1',
        executionTarget: 'existing_public_profile_tab',
        state: 'completed',
        errorCode: null,
        terminalReason: 'profile_notes_ready',
        completedAt: new Date(base.getTime() + 2).toISOString(),
        navigation: { attempted: false, attemptCount: 0 },
        semanticAction: { attempted: true, attemptCount: 2 },
        scroll: { requestedCount: 2, completedCount: 2 },
        page: { publicSurface: 'public_profile', renderedCardCount: 1 },
        projection: {
          schemaVersion: 2,
          type: 'xiaohongshu_managed_profile_notes_projection',
          pageAlias: claimed.workId,
          runId: claimed.workId,
          matchedPayloadCount: 1,
          bodyBytesRead: 100,
          rawPayloadStored: false,
          responseUrlsStored: false,
          items: [{
            rank: 1,
            noteId: 'note-1',
            title: '公开笔记',
            contentType: 'normal',
            authorId: 'author-1',
            authorNickname: '公开作者',
            likedCountText: '1'
          }]
        },
        profileLinkDiscovery: null,
        rawPayloadStored: false,
        responseUrlsStored: false,
        debuggerDetached: true
      }, {
        artifactId: '44444444-4444-4444-8444-444444444444',
        retrievalPath: '/v1/collect/artifacts/xiaohongshu.account.public_notes.v1/44444444-4444-4444-8444-444444444444',
        summary: {}
      });
      const persisted = await readFile(join(stateDirectory, 'extension-work-operations.json'), 'utf8');
      for (const forbidden of [
        /"url"\s*:/i, /"profileId"\s*:/i, /"accountId"\s*:/i, /"tabId"\s*:/i,
        /"selector"\s*:/i, /"script"\s*:/i
      ]) expect(persisted).not.toMatch(forbidden);
      const restored = await ExtensionWorkQueue.create(identity(), stateDirectory, new Date(base.getTime() + 3));
      await expect(restored.get(queued.operationId)).resolves.toMatchObject({
        platform: 'xiaohongshu',
        capability: 'xiaohongshu.account.public_notes.v1',
        state: 'completed'
      });
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('uses a supplied profile link once and redacts it after terminal delivery', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-xiaohongshu-link-'));
    const profileUrl = 'https://www.xiaohongshu.com/user/profile/abc123?expires=short';
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const queued = await queue.enqueueXiaohongshuAccountPublicNotes({
        browserBindingId: bindingId,
        maximumScrolls: 2,
        profileUrl
      }, base);
      const claimed = await queue.claimNext(bindingId, new Date(base.getTime() + 1));
      expect(claimed).toMatchObject({
        operationId: queued.operationId,
        executionTarget: 'ephemeral_public_profile_url',
        input: { maximumScrolls: 2, profileUrl },
        budget: { maximumPlatformNavigations: 1 }
      });
      if (!claimed) throw new Error('test_claim_missing');
      expect(Date.parse(claimed.expiresAt) - Date.parse(claimed.issuedAt)).toBe(120_000);
      if (!claimed || claimed.capability !== 'xiaohongshu.account.public_notes.v1') {
        throw new Error('test_claim_missing');
      }
      await queue.complete(bindingId, {
        schemaVersion: 1,
        protocolVersion: 1,
        workId: claimed.workId,
        operationId: claimed.operationId,
        browserBindingId: claimed.browserBindingId,
        platform: 'xiaohongshu',
        capability: 'xiaohongshu.account.public_notes.v1',
        executionTarget: 'ephemeral_public_profile_url',
        state: 'completed',
        errorCode: null,
        terminalReason: 'profile_notes_ready',
        completedAt: new Date(base.getTime() + 2).toISOString(),
        navigation: { attempted: true, attemptCount: 1 },
        semanticAction: { attempted: false, attemptCount: 0 },
        scroll: { requestedCount: 2, completedCount: 0 },
        page: { publicSurface: 'public_profile', renderedCardCount: 1 },
        projection: {
          schemaVersion: 2,
          type: 'xiaohongshu_managed_profile_notes_projection',
          pageAlias: claimed.workId,
          runId: claimed.workId,
          matchedPayloadCount: 1,
          bodyBytesRead: 100,
          rawPayloadStored: false,
          responseUrlsStored: false,
          items: [{
            rank: 1,
            noteId: 'note-1',
            title: '公开笔记',
            contentType: 'image',
            authorId: 'author-1',
            authorNickname: '公开作者',
            likedCountText: '1'
          }]
        },
        profileLinkDiscovery: null,
        rawPayloadStored: false,
        responseUrlsStored: false,
        debuggerDetached: true
      }, {
        artifactId: '55555555-5555-4555-8555-555555555555',
        retrievalPath: '/v1/collect/artifacts/xiaohongshu.account.public_notes.v1/55555555-5555-4555-8555-555555555555',
        summary: {}
      });
      const persisted = await readFile(join(stateDirectory, 'extension-work-operations.json'), 'utf8');
      expect(persisted).not.toContain(profileUrl);
      expect(persisted).not.toContain('abc123');
      expect(persisted).not.toContain('expires=short');
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('binds note-avatar discovery to the existing public source tab and keeps its short-lived budget', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-xiaohongshu-discovery-'));
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const queued = await queue.enqueueXiaohongshuAccountPublicNotes({
        browserBindingId: bindingId,
        maximumScrolls: 20,
        discoverFromNote: true
      }, base);
      const claimed = await queue.claimNext(bindingId, new Date(base.getTime() + 1));
      expect(claimed).toMatchObject({
        operationId: queued.operationId,
        executionTarget: 'discover_public_profile_from_note',
        input: { maximumScrolls: 20 },
        budget: {
          maximumPlatformNavigations: 0,
          maximumPageInitiatedNewDocuments: 1,
          maximumSemanticActions: 21,
          maximumProjectedItems: 200
        }
      });
      const persisted = await readFile(join(stateDirectory, 'extension-work-operations.json'), 'utf8');
      expect(persisted).not.toMatch(/profileUrl|token|selector|tabId/i);
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  test('signs profile-tab note-detail work without accepting a note URL', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-extension-work-xiaohongshu-profile-detail-'));
    try {
      const queue = await ExtensionWorkQueue.create(identity(), stateDirectory, base);
      const queued = await queue.enqueueXiaohongshuNotePublicDetail({
        browserBindingId: bindingId,
        resultRank: 1,
        executionTarget: 'existing_public_profile_tab'
      }, base);
      const claimed = await queue.claimNext(bindingId, new Date(base.getTime() + 1));
      expect(claimed).toMatchObject({
        operationId: queued.operationId,
        capability: 'xiaohongshu.note.public_detail.v1',
        executionTarget: 'existing_public_profile_tab',
        input: { resultRank: 1 },
        budget: { maximumPlatformNavigations: 0, maximumSemanticActions: 1 }
      });
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });
});
