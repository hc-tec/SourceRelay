import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type {
  BilibiliVideoDiscussionUserSelectedTabWorkItem,
  BilibiliVideoDiscussionUserSelectedTabWorkResult
} from '@intelligence/collector-contracts';
import { ExtensionWorkPassiveArtifactStore } from '../src/extension-work-passive-artifacts.js';

const item: BilibiliVideoDiscussionUserSelectedTabWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'bilibili',
  capability: 'bilibili.discussion',
  executionTarget: 'user_selected_tab',
  issuedAt: '2026-07-25T00:00:00.000Z',
  expiresAt: '2026-07-25T00:01:00.000Z',
  input: {
    canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
    bvid: 'BV1qZSLBYEpa'
  },
  budget: {
    maximumPlatformNavigations: 0,
    maximumSemanticActions: 0,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 98_304
  },
  gatewaySignature: 'a'.repeat(86)
};

const result: BilibiliVideoDiscussionUserSelectedTabWorkResult = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: item.workId,
  operationId: item.operationId,
  browserBindingId: item.browserBindingId,
  platform: 'bilibili',
  capability: 'bilibili.discussion',
  executionTarget: 'user_selected_tab',
  state: 'completed',
  errorCode: null,
  terminalReason: 'discussion_ready',
  completedAt: '2026-07-25T00:00:20.000Z',
  navigation: { attempted: false, attemptCount: 0 },
  userSelectedTabDisposition: 'observed',
  observation: {
    bvid: item.input.bvid,
    commentHostPresent: true,
    commentHostVisible: true,
    commentHostInViewport: true,
    commentContentState: 'ready',
    rootCommentTexts: ['公开可见的评论文本'],
    sortControls: { hotVisible: true, latestVisible: true, latestState: 'inactive' },
    loginGateVisible: false,
    risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
  }
};

describe('direct passive extension-work artifacts', () => {
  test('keeps a user-selected discussion projection separate from work-tab provenance and browser identifiers', async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-discussion-direct-artifact-'));
    try {
      const store = await ExtensionWorkPassiveArtifactStore.create(stateDirectory);
      const summary = await store.record({ item, result });
      const view = await store.get('bilibili.discussion', summary.artifactId);
      expect(summary).toMatchObject({ capability: 'bilibili.discussion', itemCount: 1 });
      expect(view).toMatchObject({
        capability: 'bilibili.discussion',
        provenance: {
          environment: 'user_owned_browser_extension',
          executionTarget: 'user_selected_tab',
          captureMode: 'passive_dom_projection',
          responseBodies: 'not_read',
          semanticActions: 0,
          platformNavigations: 0,
          userSelectedTabDisposition: 'observed'
        },
        result: {
          navigation: { attempted: false, attemptCount: 0 },
          observation: { rootCommentTexts: ['公开可见的评论文本'] }
        }
      });
      const serialized = await readFile(
        join(stateDirectory, 'extension-work-passive-artifacts', `${summary.artifactId}.json`),
        'utf8'
      );
      expect(serialized).not.toContain('"tabId"');
      expect(serialized).not.toContain('"windowId"');
      expect(serialized).not.toContain('"documentId"');
      expect(serialized).not.toContain('"profileId"');
      expect(serialized).not.toContain('Browser Host');
      expect(serialized).not.toContain('Playwright');
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });
});
