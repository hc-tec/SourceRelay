import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type {
  XiaohongshuPublicNotesSearchWorkItem,
  XiaohongshuPublicNotesSearchWorkResult
} from '@intelligence/collector-contracts';
import { XiaohongshuPublicNotesArtifactStore } from '../src/xiaohongshu-public-notes-artifacts.js';

const item: XiaohongshuPublicNotesSearchWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'xiaohongshu',
  capability: 'xiaohongshu.search.public_notes.v1',
  executionTarget: 'existing_public_explore_tab',
  issuedAt: '2026-07-28T09:00:00.000Z',
  expiresAt: '2026-07-28T09:01:00.000Z',
  input: { query: '不能进入 artifact 的查询原文' },
  budget: {
    maximumPlatformNavigations: 1,
    maximumPageReloads: 0,
    maximumPageInitiatedNewDocuments: 0,
    maximumSemanticActions: 1,
    maximumNetworkResponseBodies: 8,
    maximumProjectedItems: 40,
    maximumRawPayloadBytesStored: 0
  },
  gatewaySignature: 'a'.repeat(64)
};

const result: XiaohongshuPublicNotesSearchWorkResult = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: item.workId,
  operationId: item.operationId,
  browserBindingId: item.browserBindingId,
  platform: 'xiaohongshu',
  capability: 'xiaohongshu.search.public_notes.v1',
  executionTarget: 'existing_public_explore_tab',
  state: 'completed',
  errorCode: null,
  terminalReason: 'search_ready',
  completedAt: '2026-07-28T09:00:20.000Z',
  navigation: { attempted: false, attemptCount: 0 },
  semanticAction: { attempted: true, attemptCount: 1 },
  input: { queryEchoed: true, enterAttempted: true },
  page: { publicSurface: 'search', renderedCardCount: 1 },
  projection: {
    schemaVersion: 2,
    type: 'xiaohongshu_managed_search_projection',
    pageAlias: item.workId,
    runId: item.workId,
    matchedPayloadCount: 1,
    bodyBytesRead: 1024,
    rawPayloadStored: false,
      responseUrlsStored: false,
      items: [{
      rank: 1,
      noteId: 'note-1',
      title: '公开标题',
      contentType: 'normal',
      authorId: 'author-1',
        authorNickname: '公开作者',
        likedCountText: '10'
      }],
      details: [{
        noteId: 'note-1',
        publicText: '公开正文描述',
        authorNickname: '公开作者',
        interactionText: '赞 10'
      }]
  },
  rawPayloadStored: false,
  responseUrlsStored: false,
  debuggerDetached: true
};

describe('Xiaohongshu public-notes artifact store', () => {
  test('persists only query digest, bounded public projection and fixed provenance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xiaohongshu-artifact-'));
    try {
      const store = await XiaohongshuPublicNotesArtifactStore.create(directory);
      const summary = await store.record({ item, result });
      // 逐笔记完整度矩阵：rank/noteId 对齐 items，detail/comments/replies
      // 的有无一目了然，委托运行无法悄悄浅采。
      expect(summary).toMatchObject({ itemCount: 1 });
      const stored = JSON.parse(await readFile(join(directory, 'xiaohongshu-public-notes-artifacts', summary.artifactId + '.json'), 'utf8'));
      expect(stored.result.coverage).toEqual([
        { rank: 1, noteId: 'note-1', detail: true, comments: false, replies: false }
      ]);
      expect(summary).toMatchObject({
        operationId: item.operationId,
        capability: 'xiaohongshu.search.public_notes.v1',
        state: 'completed',
        itemCount: 1,
        queryDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
      });
      const view = await store.get(summary.artifactId);
      expect(view).toMatchObject({
        provenance: {
          executionTarget: 'existing_public_explore_tab',
          platformNavigations: 0,
          pageReloads: 0,
          pageInitiatedNewTabs: 0,
          semanticActions: 1,
          rawPayloadStored: false,
          responseUrlsStored: false,
          debuggerDetached: true
        },
        result: { projection: { items: [{ title: '公开标题' }], details: [{ publicText: '公开正文描述' }] } }
      });
      const fileName = (await readdir(join(directory, 'xiaohongshu-public-notes-artifacts')))[0]!;
      const persisted = await readFile(join(directory, 'xiaohongshu-public-notes-artifacts', fileName), 'utf8');
      expect(persisted).not.toContain(item.input.query);
      expect(persisted).not.toMatch(/"responseUrl"\s*:/);
      expect(persisted).not.toContain('search_result');
      expect(persisted).not.toContain('xsec_token');
      expect(persisted).not.toContain('cookie');
      expect(persisted).not.toContain('tabId');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('round-trips per-rank depth truth and the unconfirmed comment tri-state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xiaohongshu-artifact-depth-'));
    try {
      const depthResult: XiaohongshuPublicNotesSearchWorkResult = {
        ...result,
        state: 'stopped',
        errorCode: 'xiaohongshu_comment_scroll_container_unavailable',
        terminalReason: 'search_depth_stopped',
        detailActions: {
          requestedCount: 2,
          attemptedCount: 2,
          completedCount: 1,
          skippedCount: 0,
          stoppedReason: 'xiaohongshu_comment_scroll_container_unavailable',
          abortReason: 'overlay_persisting',
          ranks: [
            { rank: 1, noteId: 'note-1', outcome: 'completed', errorCode: null },
            { rank: 2, noteId: 'note-2', outcome: 'failed', errorCode: 'xiaohongshu_comment_scroll_container_unavailable' }
          ]
        },
        projection: {
          ...result.projection!,
          details: [{
            noteId: 'note-1',
            publicText: '公开正文描述',
            authorNickname: '公开作者',
            interactionText: '赞 10',
            commentsCapture: 'unconfirmed',
            repliesCapture: 'unconfirmed'
          }]
        }
      };
      const store = await XiaohongshuPublicNotesArtifactStore.create(directory);
      const summary = await store.record({ item, result: depthResult });
      const view = await store.get(summary.artifactId);
      expect(view).toMatchObject({
        result: {
          detailActions: {
            requestedCount: 2,
            completedCount: 1,
            abortReason: 'overlay_persisting',
            ranks: [
              { rank: 1, outcome: 'completed' },
              { rank: 2, outcome: 'failed' }
            ]
          },
          coverage: [
            { rank: 1, noteId: 'note-1', detail: true, comments: 'unconfirmed', replies: 'unconfirmed' }
          ]
        }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('still reads a legacy depth artifact whose detailActions predate ranks and abort reasons', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xiaohongshu-artifact-legacy-'));
    try {
      const legacyDepthResult: XiaohongshuPublicNotesSearchWorkResult = {
        ...result,
        state: 'stopped',
        errorCode: 'xiaohongshu_comment_scroll_container_unavailable',
        terminalReason: 'search_depth_stopped',
        // Legacy shape: five keys only, no ranks/abortReason — what an older
        // extension reported before per-rank truth existed.
        detailActions: {
          requestedCount: 2,
          attemptedCount: 2,
          completedCount: 1,
          skippedCount: 0,
          stoppedReason: 'xiaohongshu_comment_scroll_container_unavailable'
        },
        projection: { ...result.projection!, details: result.projection!.details }
      };
      const store = await XiaohongshuPublicNotesArtifactStore.create(directory);
      const summary = await store.record({ item, result: legacyDepthResult });
      const view = await store.get(summary.artifactId);
      expect(view).toMatchObject({
        result: {
          state: 'stopped',
          detailActions: { requestedCount: 2, completedCount: 1, stoppedReason: 'xiaohongshu_comment_scroll_container_unavailable' }
        }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
