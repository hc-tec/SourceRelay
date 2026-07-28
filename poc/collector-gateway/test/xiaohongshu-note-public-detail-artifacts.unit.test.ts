import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type {
  XiaohongshuNotePublicDetailWorkItem,
  XiaohongshuNotePublicDetailWorkResult
} from '@intelligence/collector-contracts';
import { XiaohongshuNotePublicDetailArtifactStore } from '../src/xiaohongshu-note-public-detail-artifacts.js';

const item: XiaohongshuNotePublicDetailWorkItem = {
  schemaVersion: 1, protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'xiaohongshu', capability: 'xiaohongshu.note.public_detail.v1',
  executionTarget: 'existing_public_search_tab',
  issuedAt: '2026-07-28T12:00:00.000Z', expiresAt: '2026-07-28T12:01:00.000Z',
  input: { resultRank: 1 },
  budget: {
    maximumPlatformNavigations: 0, maximumPageReloads: 0, maximumPageInitiatedNewDocuments: 0,
    maximumSemanticActions: 1, maximumNetworkResponseBodies: 4, maximumProjectedItems: 1,
    maximumRawPayloadBytesStored: 0
  },
  gatewaySignature: 'a'.repeat(64)
};

const result: XiaohongshuNotePublicDetailWorkResult = {
  schemaVersion: 1, protocolVersion: 1,
  workId: item.workId, operationId: item.operationId, browserBindingId: item.browserBindingId,
  platform: 'xiaohongshu', capability: 'xiaohongshu.note.public_detail.v1',
  executionTarget: 'existing_public_search_tab', state: 'completed', errorCode: null,
  terminalReason: 'note_detail_ready', completedAt: '2026-07-28T12:00:20.000Z',
  navigation: { attempted: false, attemptCount: 0 },
  semanticAction: { attempted: true, attemptCount: 1 },
  page: { publicSurface: 'note_detail_overlay', sameDocument: true },
  projection: {
    schemaVersion: 1, sourceRank: 1, captureMode: 'dom_fallback',
    network: { matchedPayloadCount: 0, bodyBytesRead: 0 },
    publicText: '公开标题和公开正文', authorNickname: '公开作者', interactionText: '1267 124 7104',
    visibleMediaCount: 1, commentEntryVisible: true, rawPayloadStored: false, responseUrlsStored: false
  },
  rawPayloadStored: false, responseUrlsStored: false, debuggerDetached: true
};

describe('Xiaohongshu note public-detail artifact store', () => {
  test('persists the public projection and fixed provenance without browser or Network carriers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xiaohongshu-note-detail-artifact-'));
    try {
      const store = await XiaohongshuNotePublicDetailArtifactStore.create(directory);
      const summary = await store.record({ item, result });
      expect(summary).toMatchObject({ capability: 'xiaohongshu.note.public_detail.v1', captureMode: 'dom_fallback' });
      const view = await store.get(summary.artifactId);
      expect(view).toMatchObject({
        provenance: { platformNavigations: 0, pageReloads: 0, pageInitiatedNewTabs: 0, semanticActions: 1 },
        result: { projection: { publicText: '公开标题和公开正文', sourceRank: 1 } }
      });
      const fileName = (await readdir(join(directory, 'xiaohongshu-note-public-detail-artifacts')))[0]!;
      const persisted = await readFile(join(directory, 'xiaohongshu-note-public-detail-artifacts', fileName), 'utf8');
      for (const forbidden of [
        /"url"\s*:/i, /"responseUrl"\s*:/i, /"rawPayload"\s*:/i, /"tabId"\s*:/i,
        /"documentId"\s*:/i, /"selector"\s*:/i, /"script"\s*:/i, /"cookie"\s*:/i, /"token"\s*:/i
      ]) expect(persisted).not.toMatch(forbidden);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
