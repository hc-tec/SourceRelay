import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-bilibili-collection-series-'));
const contractBundle = join(temporaryDirectory, 'bilibili-collection-series-contract.mjs');
const artifactBundle = join(temporaryDirectory, 'bilibili-collection-series-artifacts.mjs');

try {
  await Promise.all([
    build({
      entryPoints: [fileURLToPath(new URL('../src/bilibili-collection-series-contract.ts', import.meta.url))],
      outfile: contractBundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    }),
    build({
      entryPoints: [fileURLToPath(new URL('../src/bilibili-collection-series-artifacts.ts', import.meta.url))],
      outfile: artifactBundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    })
  ]);
  const contract = await import(pathToFileURL(contractBundle).href);
  const { BilibiliCollectionSeriesArtifactStore } = await import(pathToFileURL(artifactBundle).href);
  const accountId = '123456';
  const canonicalProfileUrl = `https://space.bilibili.com/${accountId}`;
  const responseProjection = contract.projectBilibiliCollectionSeriesOverviewResponse({
    code: 0,
    data: {
      items_lists: {
        page: { total: 2 },
        series_list: [{
          meta: {
            series_id: 1001,
            mid: Number(accountId),
            name: '公开系列',
            description: '公开说明',
            total: 31,
            cover: 'https://i1.hdslb.com/bfs/archive/series.jpg@672w.webp'
          },
          archives: [{
            bvid: 'BV1qZSLBYEpa',
            title: '系列预览视频',
            pic: 'https://i2.hdslb.com/bfs/archive/video.jpg@672w.webp'
          }]
        }],
        seasons_list: [{
          meta: {
            season_id: '2002',
            mid: accountId,
            title: '公开合集',
            intro: '合集说明',
            total: 1,
            cover: 'https://i0.hdslb.com/bfs/archive/season.png'
          },
          archives: [{
            bvid: 'BV1xA411c7mD',
            title: '合集预览视频',
            cover: 'https://i0.hdslb.com/bfs/archive/preview.png'
          }]
        }]
      }
    }
  }, accountId);
  assert.ok(responseProjection);
  assert.equal(responseProjection.items.length, 2);
  assert.equal(responseProjection.items[0].coverUrl.includes('@'), false);
  const overview = contract.crossCheckBilibiliCollectionSeriesOverview(responseProjection, {
    stableAccountId: accountId,
    declaredNavigationCount: 2,
    items: [
      {
        listType: 'series',
        title: '公开系列',
        declaredItemCount: 31,
        visiblePreviewBvids: ['BV1qZSLBYEpa'],
        visiblePreviewTitles: { BV1qZSLBYEpa: ['系列预览视频'] },
        structure: { sectionClassName: 'series-section', headingAncestorClasses: ['series-title'], nearbyNumberCandidates: [31] }
      },
      {
        listType: 'season',
        title: '公开合集',
        declaredItemCount: 1,
        visiblePreviewBvids: ['BV1xA411c7mD'],
        visiblePreviewTitles: { BV1xA411c7mD: ['合集预览视频'] },
        structure: { sectionClassName: 'season-section', headingAncestorClasses: ['season-title'], nearbyNumberCandidates: [1] }
      }
    ],
    risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
  }, canonicalProfileUrl, '2026-07-20T00:00:00.000Z');
  assert.ok(overview);
  assert.equal(overview.domCrossCheck.exactItemIdentityMatch, true);

  const responseEvidence = {
    pathname: '/x/polymer/web-space/seasons_series_list',
    responseStatus: 200,
    responseBodyBytes: 1024,
    responseBodySha256: 'b'.repeat(64),
    queryKeyNames: ['mid', 'page_num', 'page_size'],
    schemaPaths: [
      { path: '$', type: 'object' },
      { path: '$.data.items_lists.series_list', type: 'array', arrayLength: 1 }
    ],
    sensitiveFieldPathsOmitted: 0,
    projectionFailureCode: null
  };
  const run = {
    schemaVersion: 1,
    runId: '11111111-1111-4111-8111-111111111111',
    collectorVersion: '0.4.24',
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'collection_series_overview',
    targetUrlDigest: 'a'.repeat(64),
    strategyCandidate: {
      strategyId: 'bilibili.collection-series.overview.response.v1',
      version: '1.0.0',
      admissionEligible: false
    },
    state: 'completed',
    errorCode: null,
    startedAt: '2026-07-20T00:00:00.000Z',
    completedAt: '2026-07-20T00:00:01.000Z',
    overview,
    responseEvidence,
    actions: [{
      actionId: 'open_collection_series_overview',
      intent: 'Open the canonical public collection and series overview.',
      attempted: true,
      attemptCount: 1,
      outcome: 'completed',
      errorCode: null
    }],
    coverage: {
      declaredListCount: 2,
      capturedLists: 2,
      seriesCount: 1,
      seasonCount: 1,
      previewItems: 2,
      exactDomResponseMatch: true,
      terminalReason: 'overview_captured'
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'trusted_navigation_plus_visible_dom_plus_current_overview_response_projection',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'discarded',
      responseProjection: 'public_collection_series_fields_allowlist',
      unknownResponseValues: 'not_persisted',
      semanticActionDelivery: 'at_most_once',
      runDeadlineMs: 60_000,
      targetTabSelection: 'created_new_managed_tab',
      targetPage: 'retained_after_run',
      admissionEligible: false
    }
  };
  const stateDirectory = join(temporaryDirectory, 'state');
  const store = await BilibiliCollectionSeriesArtifactStore.create(stateDirectory);
  const summary = await store.record(run);
  assert.equal((await store.record(run)).artifactId, summary.artifactId);
  const artifact = await store.get(summary.artifactId);
  assert.equal(artifact.overview.items.length, 2);
  assert.equal(artifact.responseEvidence.schemaPaths.length, 2);
  const recovered = await BilibiliCollectionSeriesArtifactStore.create(stateDirectory);
  assert.equal((await recovered.get(summary.artifactId)).summary.manifestSha256, summary.manifestSha256);
  const artifactDirectory = join(stateDirectory, 'bilibili-collection-series', summary.artifactId);
  assert.deepEqual((await readdir(artifactDirectory)).sort(), [
    'manifest.json', 'overview.json', 'response-schema.json'
  ]);
  const persisted = (await Promise.all((await readdir(artifactDirectory)).map((name) =>
    readFile(join(artifactDirectory, name), 'utf8')
  ))).join('\n');
  for (const forbidden of [
    'profileId', 'browserProfileId', 'Cookie', 'Authorization', 'requestHeaders": {',
    'mid=123456', 'page_num=1'
  ]) assert.equal(persisted.includes(forbidden), false, `forbidden persisted value: ${forbidden}`);

  console.log(JSON.stringify({
    ok: true,
    gate: 'bilibili-collection-series-pure-contract-and-artifact',
    platformRequests: 0,
    seriesAndSeasonProjected: true,
    domResponseCrossCheck: true,
    networkQueryValuesOmitted: true,
    manifestOverviewAndSchemaDigestsVerified: true,
    restartReloadVerified: true
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
