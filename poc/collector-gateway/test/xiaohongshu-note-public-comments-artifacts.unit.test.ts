import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { XiaohongshuNotePublicCommentsWorkItem, XiaohongshuNotePublicCommentsWorkResult } from '@intelligence/collector-contracts';
import { XiaohongshuNotePublicCommentsArtifactStore } from '../src/xiaohongshu-note-public-comments-artifacts.js';

const item: XiaohongshuNotePublicCommentsWorkItem = { schemaVersion: 1, protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111', operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333', platform: 'xiaohongshu',
  capability: 'xiaohongshu.note.public_comments.v1', executionTarget: 'existing_public_note_overlay',
  issuedAt: '2026-07-28T12:00:00.000Z', expiresAt: '2026-07-28T12:01:00.000Z', input: { maximumScrolls: 1 },
  budget: { maximumPlatformNavigations: 0, maximumPageReloads: 0, maximumPageInitiatedNewDocuments: 0,
    maximumSemanticActions: 3, maximumNetworkResponseBodies: 8, maximumProjectedItems: 80,
    maximumRawPayloadBytesStored: 0 }, gatewaySignature: 'a'.repeat(64) };
const result: XiaohongshuNotePublicCommentsWorkResult = { schemaVersion: 1, protocolVersion: 1,
  workId: item.workId, operationId: item.operationId, browserBindingId: item.browserBindingId, platform: 'xiaohongshu',
  capability: item.capability, executionTarget: item.executionTarget, state: 'completed', errorCode: null,
  terminalReason: 'note_comments_ready', completedAt: '2026-07-28T12:00:20.000Z',
  navigation: { attempted: false, attemptCount: 0 }, semanticAction: { attempted: true, attemptCount: 1 },
  scroll: { requestedCount: 1, completedCount: 1 }, page: { publicSurface: 'note_detail_overlay', sameDocument: true },
  projection: { schemaVersion: 1, captureMode: 'dom_fallback', network: { matchedPayloadCount: 0, bodyBytesRead: 0,
    hasMore: null, cursorObserved: false }, renderedCommentCount: 1,
    comments: [{ rank: 1, commentId: 'dom-abcdef12', publicText: '公开评论', authorNickname: '作者', likedCountText: '',
      subCommentCountText: '', createdAtText: '', locationText: '', source: 'dom' }], rawPayloadStored: false,
    responseUrlsStored: false }, rawPayloadStored: false, responseUrlsStored: false, debuggerDetached: true };

describe('Xiaohongshu public-comment artifact store', () => {
  test('persists a digest-verified URL-free public projection idempotently', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xhs-comments-'));
    const store = await XiaohongshuNotePublicCommentsArtifactStore.create(directory);
    const first = await store.record({ item, result });
    const second = await store.record({ item, result });
    expect(second.artifactId).toBe(first.artifactId);
    expect(await store.get(first.artifactId)).toMatchObject({ summary: { commentCount: 1, captureMode: 'dom_fallback' } });
    const raw = await readFile(join(directory, 'xiaohongshu-note-public-comments-artifacts', `${first.artifactId}.json`), 'utf8');
    for (const forbidden of ['"url":', '"responseUrl":', '"rawPayload":', '"tabId":', '"noteId":']) {
      expect(raw).not.toContain(forbidden);
    }
  });
});
