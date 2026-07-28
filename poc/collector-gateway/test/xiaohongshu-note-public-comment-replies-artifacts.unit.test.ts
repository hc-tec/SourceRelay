import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type {
  XiaohongshuNotePublicCommentRepliesWorkItem,
  XiaohongshuNotePublicCommentRepliesWorkResult
} from '@intelligence/collector-contracts';
import { XiaohongshuReplyArtifactStore } from '../src/xiaohongshu-note-public-comment-replies-artifacts.js';

const item: XiaohongshuNotePublicCommentRepliesWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'xiaohongshu',
  capability: 'xiaohongshu.note.public_comment_replies.v1',
  executionTarget: 'existing_public_note_overlay',
  issuedAt: '2026-07-28T12:00:00.000Z',
  expiresAt: '2026-07-28T12:01:00.000Z',
  input: { maximumThreads: 1 },
  budget: {
    maximumPlatformNavigations: 0,
    maximumPageReloads: 0,
    maximumPageInitiatedNewDocuments: 0,
    maximumSemanticActions: 1,
    maximumNetworkResponseBodies: 8,
    maximumProjectedItems: 40,
    maximumRawPayloadBytesStored: 0
  },
  gatewaySignature: 'a'.repeat(64)
};

const result: XiaohongshuNotePublicCommentRepliesWorkResult = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: item.workId,
  operationId: item.operationId,
  browserBindingId: item.browserBindingId,
  platform: 'xiaohongshu',
  capability: item.capability,
  executionTarget: item.executionTarget,
  state: 'completed',
  errorCode: null,
  terminalReason: 'comment_replies_ready',
  completedAt: '2026-07-28T12:00:20.000Z',
  navigation: { attempted: false, attemptCount: 0 },
  semanticAction: { attempted: true, attemptCount: 1 },
  thread: { requestedCount: 1, completedCount: 1 },
  page: { publicSurface: 'note_detail_overlay', sameDocument: true },
  projection: {
    schemaVersion: 1,
    captureMode: 'hybrid',
    network: {
      matchedPayloadCount: 1,
      bodyBytesRead: 2048,
      cursorObserved: true,
      actionTriggeredResponseCount: 0
    },
    expandedLabelText: '展开 3 条回复',
    parentComment: {
      rank: 1,
      commentId: 'public-parent-comment',
      publicText: '公开父评论',
      authorNickname: '公开用户',
      likedCountText: '2',
      createdAtText: '昨天',
      locationText: '上海',
      source: 'network'
    },
    replies: [{
      rank: 1,
      commentId: 'dom-abcd1234',
      publicText: '公开回复',
      authorNickname: '回复用户',
      likedCountText: '',
      createdAtText: '',
      locationText: '',
      source: 'dom'
    }],
    rawPayloadStored: false,
    responseUrlsStored: false
  },
  rawPayloadStored: false,
  responseUrlsStored: false,
  debuggerDetached: true
};

describe('Xiaohongshu public-comment-reply artifact store', () => {
  test('persists a digest-verified, idempotent, private-field-free hybrid projection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xhs-comment-replies-'));
    const store = await XiaohongshuReplyArtifactStore.create(directory);

    const first = await store.record({ item, result });
    const second = await store.record({ item, result });
    expect(second.artifactId).toBe(first.artifactId);
    expect(await store.get(first.artifactId)).toMatchObject({
      summary: { replyCount: 1, captureMode: 'hybrid' },
      provenance: { semanticActions: 1, rawPayloadStored: false, responseUrlsStored: false }
    });

    const artifactPath = join(
      directory,
      'xiaohongshu-comment-reply-artifacts',
      `${first.artifactId}.json`
    );
    const raw = await readFile(artifactPath, 'utf8');
    for (const forbidden of [
      '"url":', '"responseUrl":', '"route":', '"query":', '"header":', '"cookie":', '"token":',
      '"rawPayload":', '"tabId":', '"documentId":', '"selector":', '"script":', '"noteId":', '"profileId":',
      '"input":', '"identity":'
    ]) {
      expect(raw).not.toContain(forbidden);
    }

    const tampered = raw.replace('公开回复', '篡改回复');
    await writeFile(artifactPath, tampered, 'utf8');
    await expect(store.get(first.artifactId)).rejects.toThrow('xiaohongshu_reply_artifact_digest_mismatch');
  });
});
