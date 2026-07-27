import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type {
  BilibiliNativeSearchBatchWorkItem,
  BilibiliNativeSearchBatchWorkResult
} from '@intelligence/collector-contracts';
import { ExtensionWorkNativeSearchBatchArtifactStore } from '../src/extension-work-native-search-batch-artifacts.js';

const item: BilibiliNativeSearchBatchWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'bilibili',
  capability: 'bilibili.native_search_batch',
  executionTarget: 'collector_work_tab',
  issuedAt: '2026-07-27T00:00:00.000Z',
  expiresAt: '2026-07-27T00:01:00.000Z',
  input: {
    query: '不应出现在artifact中的查询词',
    resultType: 'comprehensive',
    sort: 'relevance',
    targets: [
      { page: 1, canonicalSearchUrl: 'https://search.bilibili.com/all?keyword=not-persisted' },
      { page: 2, canonicalSearchUrl: 'https://search.bilibili.com/all?keyword=not-persisted&page=2' }
    ]
  },
  budget: {
    maximumPlatformNavigations: 2,
    maximumSemanticActions: 0,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 57_344
  },
  gatewaySignature: 'a'.repeat(86)
};

const result: BilibiliNativeSearchBatchWorkResult = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: item.workId,
  operationId: item.operationId,
  browserBindingId: item.browserBindingId,
  platform: 'bilibili',
  capability: 'bilibili.native_search_batch',
  executionTarget: 'collector_work_tab',
  state: 'completed',
  errorCode: null,
  terminalReason: 'search_batch_ready',
  completedAt: '2026-07-27T00:00:20.000Z',
  navigation: { attempted: true, attemptCount: 2 },
  workTabAcquisition: 'created',
  workTabDisposition: 'idle_reusable',
  observation: {
    pages: [page(1, 'BV1qZSLBYEpa'), page(2, 'BV1xx411c7mD')]
  }
};

describe('direct native-search batch artifacts', () => {
  test('persists a capability-bound two-page projection without query text or transient target URLs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'collector-direct-search-batch-artifacts-'));
    try {
      const store = await ExtensionWorkNativeSearchBatchArtifactStore.create(directory);
      const summary = await store.record({ item, result });
      const view = await store.get(summary.artifactId);
      expect(view).toMatchObject({
        summary: {
          capability: 'bilibili.native_search_batch',
          itemCount: 2,
          capturedPages: 2
        },
        provenance: {
          environment: 'user_owned_browser_extension',
          semanticActions: 0,
          platformNavigations: 2,
          responseBodies: 'not_read'
        },
        search: { requestedPages: [1, 2], observedPages: [1, 2] },
        actions: [
          { page: 1, attempted: true, attemptCount: 1, outcome: 'completed' },
          { page: 2, attempted: true, attemptCount: 1, outcome: 'completed' }
        ]
      });
      const serialized = await readFile(join(directory, 'extension-work-native-search-batch-artifacts', `${summary.artifactId}.json`), 'utf8');
      expect(serialized).not.toContain(item.input.query);
      expect(serialized).not.toContain('canonicalSearchUrl');
      expect(serialized).toContain('queryDigest');
      expect(serialized).not.toContain('not-persisted');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function page(pageNumber: 1 | 2, bvid: string) {
  return {
    page: pageNumber,
    searchInputVisible: true,
    resultListVisible: true,
    emptyStateVisible: false,
    resultType: 'comprehensive' as const,
    sort: 'relevance' as const,
    semanticResultCardCount: 1,
    cards: [{ bvid, title: '公开视频', visibleText: '公开可见卡片', thumbnailUrl: null }],
    loginOverlayVisible: false,
    risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
  };
}
