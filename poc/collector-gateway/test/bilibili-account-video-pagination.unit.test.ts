import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { BilibiliAccountVideoPaginationArtifactStore } from '../src/bilibili-account-video-pagination-artifacts.js';
import {
  bilibiliAccountVideoBvidSetDigest,
  bilibiliAccountVideoPaginationInput,
  type BilibiliAccountVideoPaginationPage
} from '../src/bilibili-account-video-pagination-contract.js';
import { createBilibiliAccountVideoPaginationRunRecord } from '../src/bilibili-account-video-pagination-run-record.js';
import { paginationFailure } from '../src/bilibili-account-video-pagination-run-logic.js';
import type { BilibiliAccountVideoInventoryProjection } from '../src/bilibili-account-video-inventory-contract.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function page(pageNumber: number, bvid: string): BilibiliAccountVideoPaginationPage {
  const projection: BilibiliAccountVideoInventoryProjection = {
    schemaVersion: 1,
    stableAccountId: '7481602',
    items: [{
      bvid,
      canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
      title: `公开视频 ${pageNumber}`,
      visibleText: `公开视频 ${pageNumber} 的可见卡片文本`,
      thumbnailUrl: null
    }],
    visibleCardCount: 1,
    unresolvedCardCount: 0,
    loginOverlayVisible: false,
    risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false },
    capturedAt: '2026-07-22T00:00:00.000Z'
  };
  return { pageNumber, projection, bvidSetDigest: bilibiliAccountVideoBvidSetDigest(projection) };
}

describe('Bilibili account-video pagination domain contract', () => {
  test('requires an explicit bounded page budget and canonical profile identity', () => {
    expect(bilibiliAccountVideoPaginationInput({
      canonicalProfileUrl: 'https://space.bilibili.com/7481602',
      maxPages: 3
    })).toEqual({ canonicalProfileUrl: 'https://space.bilibili.com/7481602', maxPages: 3 });
    expect(() => bilibiliAccountVideoPaginationInput({
      canonicalProfileUrl: 'https://space.bilibili.com/7481602',
      maxPages: 8
    })).toThrow('bilibili_account_video_pagination_input_invalid');
    expect(() => bilibiliAccountVideoPaginationInput({
      canonicalProfileUrl: 'https://space.bilibili.com/7481602',
      maxPages: 3,
      hiddenUnlimitedMode: true
    })).toThrow('bilibili_account_video_pagination_input_invalid');
  });

  test('classifies a malformed post-click Host response as an unknown platform outcome, not a retryable DOM miss', () => {
    expect(paginationFailure(new Error('browser_host_bilibili_page_click_response_invalid'))).toMatchObject({
      state: 'failed',
      terminalReason: 'platform_action_outcome_unknown',
      uncertainPageOutcome: true
    });
  });

  test('keeps raw-first multi-page artifacts ordered, digest-checked, and recoverable without browser state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'collector-account-video-pagination-unit-'));
    directories.push(directory);
    const pages = [page(1, 'BV1qZSLBYEpa'), page(2, 'BV1xx411c7mD')];
    const run = createBilibiliAccountVideoPaginationRunRecord({
      runId: '11111111-1111-4111-8111-111111111111',
      collectorVersion: '0.7.10',
      canonicalInventoryUrl: 'https://space.bilibili.com/7481602/upload/video',
      stableAccountId: '7481602',
      startedAt: '2026-07-22T00:00:00.000Z',
      completedAt: '2026-07-22T00:00:03.000Z',
      requestedPages: 2,
      state: 'completed',
      errorCode: null,
      pages,
      actions: [{
        actionId: 'navigate_account_video_inventory',
        kind: 'navigation',
        intent: 'Open the canonical Bilibili account video inventory exactly once.',
        attempted: true,
        attemptCount: 1,
        outcome: 'completed',
        errorCode: null,
        visualEvidence: null
      }],
      terminalReason: 'requested_page_budget_reached',
      targetTabSelection: 'created_new_managed_tab',
      targetPage: 'retained_after_run'
    });
    expect(run.coverage).toMatchObject({ capturedPages: 2, capturedItems: 2, uniqueBvidCount: 2, duplicateBvidCount: 0 });

    const store = await BilibiliAccountVideoPaginationArtifactStore.create(directory);
    const summary = await store.record(run);
    const restored = await store.get(summary.artifactId);
    expect(restored?.summary).toMatchObject({
      requestedPages: 2,
      capturedPages: 2,
      capturedItems: 2,
      uniqueBvidCount: 2,
      duplicateBvidCount: 0
    });
    expect(restored?.pages.map((entry) => entry.pageNumber)).toEqual([1, 2]);
    expect(restored?.pages.flatMap((entry) => entry.projection.items.map((item) => item.bvid))).toEqual([
      'BV1qZSLBYEpa',
      'BV1xx411c7mD'
    ]);
  });
});
