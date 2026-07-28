import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type {
  XiaohongshuAccountPublicNotesWorkItem,
  XiaohongshuAccountPublicNotesWorkResult
} from '@intelligence/collector-contracts';
import { XiaohongshuAccountPublicNotesArtifactStore } from '../src/xiaohongshu-account-public-notes-artifacts.js';

const item: XiaohongshuAccountPublicNotesWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'xiaohongshu',
  capability: 'xiaohongshu.account.public_notes.v1',
  executionTarget: 'existing_public_profile_tab',
  issuedAt: '2026-07-28T09:00:00.000Z',
  expiresAt: '2026-07-28T09:01:00.000Z',
  input: { maximumScrolls: 1 },
  budget: {
    maximumPlatformNavigations: 0,
    maximumPageReloads: 0,
    maximumPageInitiatedNewDocuments: 0,
    maximumSemanticActions: 3,
    maximumNetworkResponseBodies: 8,
    maximumProjectedItems: 40,
    maximumRawPayloadBytesStored: 0
  },
  gatewaySignature: 'a'.repeat(64)
};

const result: XiaohongshuAccountPublicNotesWorkResult = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: item.workId,
  operationId: item.operationId,
  browserBindingId: item.browserBindingId,
  platform: 'xiaohongshu',
  capability: 'xiaohongshu.account.public_notes.v1',
  executionTarget: 'existing_public_profile_tab',
  state: 'completed',
  errorCode: null,
  terminalReason: 'profile_notes_ready',
  completedAt: '2026-07-28T09:00:20.000Z',
  navigation: { attempted: false, attemptCount: 0 },
  semanticAction: { attempted: true, attemptCount: 1 },
  scroll: { requestedCount: 1, completedCount: 1 },
  page: { publicSurface: 'public_profile', renderedCardCount: 1 },
  projection: {
    schemaVersion: 2,
    type: 'xiaohongshu_managed_profile_notes_projection',
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
    }]
  },
  rawPayloadStored: false,
  responseUrlsStored: false,
  debuggerDetached: true
};

describe('Xiaohongshu account public-notes artifact store', () => {
  test('persists only bounded public projection, scroll ledger and fixed URL-free provenance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xiaohongshu-account-artifact-'));
    try {
      const store = await XiaohongshuAccountPublicNotesArtifactStore.create(directory);
      const summary = await store.record({ item, result });
      expect(summary).toMatchObject({
        operationId: item.operationId,
        capability: 'xiaohongshu.account.public_notes.v1',
        state: 'completed',
        itemCount: 1,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      });
      const view = await store.get(summary.artifactId);
      expect(view).toMatchObject({
        provenance: {
          executionTarget: 'existing_public_profile_tab',
          platformNavigations: 0,
          pageReloads: 0,
          pageInitiatedNewTabs: 0,
          semanticActions: 1,
          rawPayloadStored: false,
          responseUrlsStored: false,
          debuggerDetached: true
        },
        result: {
          scroll: { requestedCount: 1, completedCount: 1 },
          projection: { items: [{ title: '公开标题' }] }
        }
      });
      const fileName = (await readdir(join(directory, 'xiaohongshu-account-public-notes-artifacts')))[0]!;
      const persisted = await readFile(join(directory, 'xiaohongshu-account-public-notes-artifacts', fileName), 'utf8');
      for (const forbidden of [
        /"url"\s*:/i, /"responseUrl"\s*:/i, /"query"\s*:/i, /"tabId"\s*:/i,
        /"documentId"\s*:/i, /"profileId"\s*:/i, /"cookie"\s*:/i, /"token"\s*:/i,
        /"rawPayload"\s*:/i
      ]) expect(persisted).not.toMatch(forbidden);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
