import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-bilibili-series-detail-'));
const contractBundle = join(temporaryDirectory, 'bilibili-series-detail-contract.mjs');
const responseBundle = join(temporaryDirectory, 'bilibili-series-detail-response.mjs');
const artifactBundle = join(temporaryDirectory, 'bilibili-series-detail-artifacts.mjs');

try {
  await Promise.all([
    build({
      entryPoints: [fileURLToPath(new URL('../src/bilibili-series-detail-contract.ts', import.meta.url))],
      outfile: contractBundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    }),
    build({
      entryPoints: [fileURLToPath(new URL('../src/bilibili-series-detail-response.ts', import.meta.url))],
      outfile: responseBundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    }),
    build({
      entryPoints: [fileURLToPath(new URL('../src/bilibili-series-detail-artifacts.ts', import.meta.url))],
      outfile: artifactBundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    })
  ]);

  const contract = await import(pathToFileURL(contractBundle).href);
  const response = await import(pathToFileURL(responseBundle).href);
  const { BilibiliSeriesDetailArtifactStore } = await import(pathToFileURL(artifactBundle).href);
  const accountId = '123456';
  const seriesId = '1001';
  const canonicalProfileUrl = `https://space.bilibili.com/${accountId}`;
  assert.deepEqual(contract.bilibiliSeriesDetailInput({
    canonicalProfileUrl,
    stableSeriesId: seriesId,
    listType: 'series',
    maxPages: 2
  }), { canonicalProfileUrl, stableSeriesId: seriesId, listType: 'series', maxPages: 2 });
  assert.throws(() => contract.bilibiliSeriesDetailInput({
    canonicalProfileUrl,
    stableSeriesId: seriesId,
    maxPages: 2,
    query: 'must-not-be-accepted'
  }), /bilibili_series_detail_input_invalid/);
  assert.equal(
    contract.canonicalBilibiliSeriesDetailUrl(canonicalProfileUrl, seriesId),
    `${canonicalProfileUrl}/lists/${seriesId}?type=series`
  );
  assert.equal(
    contract.canonicalBilibiliSeriesDetailUrl(canonicalProfileUrl, seriesId, 'season'),
    `${canonicalProfileUrl}/lists/${seriesId}?type=season`
  );

  const metadata = contract.projectBilibiliSeriesMetadataResponse({
    code: 0,
    data: {
      meta: {
        series_id: Number(seriesId),
        mid: Number(accountId),
        name: '公开系列',
        description: '公开说明',
        total: 3,
        cover: 'http://i1.hdslb.com/bfs/archive/series.jpg@672w.webp?credential=discard',
        last_update_ts: 1_753_000_000
      }
    }
  }, accountId, seriesId);
  assert.ok(metadata);
  assert.equal(metadata.coverUrl, 'https://i1.hdslb.com/bfs/archive/series.jpg');

  const rawPages = [
    {
      code: 0,
      data: {
        page: { page_num: 1, page_size: 2, total: 3 },
        archives: [
          {
            bvid: 'BV1qZSLBYEpa',
            title: '公开视频一',
            pic: '//i2.hdslb.com/bfs/archive/one.jpg@672w.webp',
            duration: 61,
            pubdate: 1_753_000_001,
            stat: { view: 101, danmaku: 7 }
          },
          {
            bvid: 'BV1xA411c7mD',
            title: '公开视频二',
            pic: 'https://i0.hdslb.com/bfs/archive/two.png',
            duration: 62,
            pubdate: 1_753_000_002,
            stat: { view: 102, danmaku: 8 }
          }
        ]
      }
    },
    {
      code: 0,
      data: {
        page: { page_num: 2, page_size: 2, total: 3 },
        archives: [{
          bvid: 'BV1GJ411x7h7',
          title: '公开视频三',
          pic: 'https://i0.hdslb.com/bfs/archive/three.png',
          duration: 63,
          pubdate: 1_753_000_003,
          stat: { view: 103, danmaku: 9 }
        }]
      }
    }
  ];
  const pageCandidates = rawPages.map((value, index) =>
    contract.projectBilibiliSeriesPageResponse(value, accountId, index + 1)
  );
  assert.equal(pageCandidates[0].items.length, 2);
  assert.equal(pageCandidates[1].items.length, 1);

  const boundedPages = rawPages.map((value, index) => ({
    value,
    status: 200,
    bodyBytes: 1_000 + index,
    bodySha256: String(index + 1).repeat(64),
    queryKeyNames: ['mid', 'page_num', 'page_size', 'season_id', 'sort_reverse'],
    schemaPaths: [
      { path: '$', type: 'object' },
      { path: '$.data.archives', type: 'array', arrayLength: value.data.archives.length }
    ],
    sensitiveFieldPathsOmitted: 0
  }));
  const pages = boundedPages.map((bounded, index) => {
    const candidate = pageCandidates[index];
    return response.projectBilibiliSeriesPageWithDom(
      bounded,
      accountId,
      index + 1,
      {
        stableAccountId: accountId,
        stableSeriesId: seriesId,
        visibleTitle: metadata.title,
        declaredItemCount: metadata.declaredItemCount,
        activePageNumber: index + 1,
        videoIds: candidate.items.map((item) => item.bvid),
        titleCandidates: Object.fromEntries(candidate.items.map((item) => [item.bvid, [item.title]])),
        sortLabels: ['默认排序', '倒序排序'],
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      },
      `2026-07-20T00:00:0${index + 1}.000Z`
    );
  });
  assert.equal(pages.every((page) => page?.domCrossCheck.exactIdentityMatch), true);
  assert.equal(pages.flatMap((page) => page.items).length, 3);

  const metadataResponseEvidence = {
    pathname: '/x/polymer/web-space/seasons_archives_list',
    responseStatus: 200,
    responseBodyBytes: 900,
    responseBodySha256: 'a'.repeat(64),
    queryKeyNames: ['series_id'],
    schemaPaths: [
      { path: '$', type: 'object' },
      { path: '$.data.meta', type: 'object' }
    ],
    sensitiveFieldPathsOmitted: 0
  };
  const run = {
    schemaVersion: 1,
    runId: '11111111-1111-4111-8111-111111111111',
    collectorVersion: '0.4.24',
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'series_detail',
    targetUrlDigest: 'f'.repeat(64),
    strategyCandidate: {
      strategyId: 'bilibili.collection-series.series-detail.response.v1',
      version: '1.0.0',
      admissionEligible: false
    },
    state: 'completed',
    errorCode: null,
    startedAt: '2026-07-20T00:00:00.000Z',
    completedAt: '2026-07-20T00:00:03.000Z',
    metadata,
    metadataResponseEvidence,
    failedPageResponseEvidence: null,
    pages,
    actions: [
      {
        actionId: 'open_series_detail',
        intent: 'Open the canonical series detail in platform-default order.',
        expectedPageNumber: 1,
        attempted: true,
        attemptCount: 1,
        outcome: 'completed',
        errorCode: null,
        observedPageNumber: 1
      },
      {
        actionId: 'open_series_page_2',
        intent: 'Open series detail page 2.',
        expectedPageNumber: 2,
        attempted: true,
        attemptCount: 1,
        outcome: 'completed',
        errorCode: null,
        observedPageNumber: 2
      }
    ],
    coverage: {
      declaredTotal: 3,
      declaredPages: 2,
      plannedMaximumPages: 2,
      capturedPages: 2,
      capturedItems: 3,
      uniqueItems: 3,
      duplicateItems: 0,
      completeWithinDeclaredSeries: true,
      terminalReason: 'declared_terminal_reached'
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'trusted_series_navigation_and_pagination_plus_dom_response_projection',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'discarded',
      canonicalPageQuery: 'stable_type_series_or_season',
      responseProjection: 'public_series_metadata_and_card_fields_allowlist',
      unknownResponseValues: 'not_persisted',
      sortRole: 'platform_default',
      semanticActionDelivery: 'at_most_once',
      runDeadlineMs: 60_000,
      targetTabSelection: 'created_new_managed_tab',
      targetPage: 'retained_after_run',
      admissionEligible: false
    }
  };

  const stateDirectory = join(temporaryDirectory, 'state');
  const store = await BilibiliSeriesDetailArtifactStore.create(stateDirectory);
  const summary = await store.record(run);
  assert.equal((await store.record(run)).artifactId, summary.artifactId);
  const artifact = await store.get(summary.artifactId);
  assert.equal(artifact.metadata.stableSeriesId, seriesId);
  assert.deepEqual(artifact.pages.map((page) => page.items.length), [2, 1]);
  assert.equal(artifact.failedPageResponseEvidence, null);
  const recovered = await BilibiliSeriesDetailArtifactStore.create(stateDirectory);
  assert.equal((await recovered.get(summary.artifactId)).summary.manifestSha256, summary.manifestSha256);

  const artifactDirectory = join(stateDirectory, 'bilibili-series-detail', summary.artifactId);
  assert.deepEqual((await readdir(artifactDirectory)).sort(), [
    'manifest.json',
    'metadata-response-schema.json',
    'metadata.json',
    'page-001.json',
    'page-002.json'
  ]);
  const persisted = (await Promise.all((await readdir(artifactDirectory)).map((name) =>
    readFile(join(artifactDirectory, name), 'utf8')
  ))).join('\n');
  for (const forbidden of [
    'profileId', 'browserProfileId', 'Cookie', 'Authorization', 'credential=discard',
    'series_id=1001', 'mid=123456', 'pn=1', 'ps=2'
  ]) assert.equal(persisted.includes(forbidden), false, `forbidden persisted value: ${forbidden}`);

  console.log(JSON.stringify({
    ok: true,
    gate: 'bilibili-series-detail-pure-contract-and-artifact',
    platformRequests: 0,
    stableSeriesMetadataProjected: true,
    pageIdentityAndTitlesCrossChecked: true,
    networkQueryValuesOmitted: true,
    manifestMetadataPageAndSchemaDigestsVerified: true,
    restartReloadVerified: true
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
