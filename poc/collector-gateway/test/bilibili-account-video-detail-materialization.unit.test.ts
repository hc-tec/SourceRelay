import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { BilibiliAccountVideoDetailMaterializationArtifactStore } from '../src/bilibili-account-video-detail-materialization-artifacts.js';
import {
  BILIBILI_ACCOUNT_VIDEO_DETAIL_MATERIALIZATION_MAX_DETAILS,
  materializationSource,
  selectBilibiliAccountVideoDetailMaterializations
} from '../src/bilibili-account-video-detail-materialization-contract.js';
import { createBilibiliAccountVideoDetailMaterializationRunRecord } from '../src/bilibili-account-video-detail-materialization-run-record.js';
import type { BilibiliAccountVideoPaginationArtifactView } from '../src/bilibili-account-video-pagination-artifacts.js';

const directories: string[] = [];
const sourceArtifactId = '11111111-1111-4111-8111-111111111111';
const sourceManifestSha256 = 'a'.repeat(64);

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function sourceArtifact(): BilibiliAccountVideoPaginationArtifactView {
  const bvidOne = 'BV1qZSLBYEpa';
  const bvidTwo = 'BV1xx411c7mD';
  return {
    summary: {
      schemaVersion: 1,
      artifactId: sourceArtifactId,
      runId: '22222222-2222-4222-8222-222222222222',
      platform: 'bilibili',
      capturedAt: '2026-07-22T06:29:55.884Z',
      state: 'completed',
      targetUrlDigest: 'b'.repeat(64),
      stableAccountId: '7481602',
      requestedPages: 2,
      capturedPages: 2,
      capturedItems: 2,
      uniqueBvidCount: 2,
      duplicateBvidCount: 0,
      terminalReason: 'requested_page_budget_reached',
      manifestSha256: sourceManifestSha256
    },
    manifest: {
      schemaVersion: 1,
      artifactId: sourceArtifactId,
      runId: '22222222-2222-4222-8222-222222222222',
      platform: 'bilibili',
      capturedAt: '2026-07-22T06:29:55.884Z',
      state: 'completed',
      targetUrlDigest: 'b'.repeat(64),
      stableAccountId: '7481602',
      requestedPages: 2,
      capturedPages: 2,
      capturedItems: 2,
      uniqueBvidCount: 2,
      duplicateBvidCount: 0,
      terminalReason: 'requested_page_budget_reached',
      collectorVersion: '0.7.8',
      strategyCandidate: {
        strategyId: 'bilibili.account.video-inventory.pagination.dom.v2',
        version: '0.2.0',
        admissionEligible: false
      },
      actions: [],
      coverage: {
        requestedPages: 2,
        capturedPages: 2,
        capturedItems: 2,
        uniqueBvidCount: 2,
        duplicateBvidCount: 0,
        unresolvedCardCount: 0,
        loginOverlayVisible: false,
        terminalReason: 'requested_page_budget_reached'
      },
      safeguards: {
        environment: 'local_user_controlled_collection_profile',
        browser: 'visible_playwright_chromium',
        acquisition: 'trusted_adjacent_page_click_plus_bounded_dom_projection',
        requestHeaders: 'not_read',
        requestBody: 'not_read',
        cookiesAndTokens: 'not_read',
        networkQueryAndFragmentValues: 'not_read',
        responseBodies: 'not_read',
        networkMetadata: 'route_method_status_only',
        pagination: 'direct_numeric_pages_one_through_seven_only',
        sortAndFilter: 'excluded_separate_capability',
        articleAudioAndSeries: 'excluded_separate_capability',
        semanticActionDelivery: 'at_most_once',
        runDeadlineMs: 60_000,
        targetTabSelection: 'created_new_managed_tab',
        targetPage: 'retained_after_run',
        admissionEligible: false
      },
      pageFiles: []
    },
    pages: [
      {
        pageNumber: 1,
        bvidSetDigest: 'c'.repeat(64),
        projection: {
          schemaVersion: 1,
          stableAccountId: '7481602',
          items: [{
            bvid: bvidOne,
            canonicalVideoUrl: `https://www.bilibili.com/video/${bvidOne}`,
            title: '公开视频一',
            visibleText: '公开视频一的可见卡片文本',
            thumbnailUrl: null
          }],
          visibleCardCount: 1,
          unresolvedCardCount: 0,
          loginOverlayVisible: false,
          risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false },
          capturedAt: '2026-07-22T06:29:55.000Z'
        }
      },
      {
        pageNumber: 2,
        bvidSetDigest: 'd'.repeat(64),
        projection: {
          schemaVersion: 1,
          stableAccountId: '7481602',
          items: [{
            bvid: bvidTwo,
            canonicalVideoUrl: `https://www.bilibili.com/video/${bvidTwo}`,
            title: '公开视频二',
            visibleText: '公开视频二的可见卡片文本',
            thumbnailUrl: null
          }],
          visibleCardCount: 1,
          unresolvedCardCount: 0,
          loginOverlayVisible: false,
          risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false },
          capturedAt: '2026-07-22T06:29:56.000Z'
        }
      }
    ]
  };
}

describe('Bilibili account-video detail materialization domain contract', () => {
  test('selects only explicit BVIDs already present in a completed pagination artifact', () => {
    const source = sourceArtifact();
    const selected = selectBilibiliAccountVideoDetailMaterializations(source, {
      bvids: ['BV1xx411c7mD', 'BV1qZSLBYEpa']
    });
    expect(selected).toEqual([
      {
        bvid: 'BV1xx411c7mD',
        sourcePageNumber: 2,
        canonicalVideoUrl: 'https://www.bilibili.com/video/BV1xx411c7mD'
      },
      {
        bvid: 'BV1qZSLBYEpa',
        sourcePageNumber: 1,
        canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa'
      }
    ]);
    expect(() => selectBilibiliAccountVideoDetailMaterializations(source, {
      bvids: ['BV1qZSLBYEpa', 'BV1qZSLBYEpa']
    })).toThrow('bilibili_account_video_detail_materialization_input_invalid');
    expect(() => selectBilibiliAccountVideoDetailMaterializations(source, {
      bvids: ['BV1qZSLBYEpa', 'BV1xx411c7mD', 'BV1zz411c7mD', 'BV1aa411c7mD']
    })).toThrow('bilibili_account_video_detail_materialization_input_invalid');
    expect(BILIBILI_ACCOUNT_VIDEO_DETAIL_MATERIALIZATION_MAX_DETAILS).toBe(3);
    expect(() => selectBilibiliAccountVideoDetailMaterializations(source, {
      bvids: ['BV1zz411c7mD']
    })).toThrow('bilibili_account_video_detail_materialization_bvid_not_in_source');
  });

  test('keeps batch provenance and detail artifact references recoverable without browser state', async () => {
    const source = sourceArtifact();
    const [selection] = selectBilibiliAccountVideoDetailMaterializations(source, { bvids: ['BV1qZSLBYEpa'] });
    const run = createBilibiliAccountVideoDetailMaterializationRunRecord({
      runId: '33333333-3333-4333-8333-333333333333',
      collectorVersion: '0.7.8',
      source: materializationSource(source),
      startedAt: '2026-07-22T06:30:00.000Z',
      completedAt: '2026-07-22T06:30:01.000Z',
      state: 'completed',
      errorCode: null,
      terminalReason: 'all_selected_details_materialized',
      items: [{
        ...selection!,
        detailRunStarted: true,
        navigationAttempted: true,
        navigationAttemptCount: 1,
        outcome: 'completed',
        errorCode: null,
        detailRunId: '44444444-4444-4444-8444-444444444444',
        detailArtifact: {
          schemaVersion: 1,
          artifactId: '55555555-5555-4555-8555-555555555555',
          runId: '44444444-4444-4444-8444-444444444444',
          platform: 'bilibili',
          capturedAt: '2026-07-22T06:30:01.000Z',
          state: 'completed',
          targetUrlDigest: 'e'.repeat(64),
          bvid: 'BV1qZSLBYEpa',
          titleCaptured: true,
          descriptionCaptured: true,
          creatorCaptured: true,
          tagCount: 3,
          episodeSummaryCaptured: false,
          loginOverlayVisible: false,
          terminalReason: 'detail_ready',
          manifestSha256: 'f'.repeat(64)
        }
      }]
    });
    const directory = await mkdtemp(join(tmpdir(), 'collector-detail-materialization-unit-'));
    directories.push(directory);
    const store = await BilibiliAccountVideoDetailMaterializationArtifactStore.create(directory);
    const summary = await store.record(run);
    const restored = await store.get(summary.artifactId);
    expect(restored?.summary).toMatchObject({
      sourceArtifactId,
      sourceManifestSha256,
      requestedDetails: 1,
      completedDetails: 1,
      notAttemptedDetails: 0
    });
    expect(restored?.manifest.items[0]).toMatchObject({
      bvid: 'BV1qZSLBYEpa',
      sourcePageNumber: 1,
      navigationAttempted: true,
      detailArtifact: { artifactId: '55555555-5555-4555-8555-555555555555' }
    });
  });
});
