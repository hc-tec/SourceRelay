import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-bilibili-native-search-'));
const contractBundle = join(temporaryDirectory, 'bilibili-native-search-contract.mjs');
const observationBundle = join(temporaryDirectory, 'bilibili-native-search-observation.mjs');
const runRecordBundle = join(temporaryDirectory, 'bilibili-native-search-run-record.mjs');
const artifactBundle = join(temporaryDirectory, 'bilibili-native-search-artifacts.mjs');

try {
  await Promise.all([
    [new URL('../src/bilibili-native-search-contract.ts', import.meta.url), contractBundle],
    [new URL('../src/bilibili-native-search-observation.ts', import.meta.url), observationBundle],
    [new URL('../src/bilibili-native-search-run-record.ts', import.meta.url), runRecordBundle],
    [new URL('../src/bilibili-native-search-artifacts.ts', import.meta.url), artifactBundle]
  ].map(([entry, outfile]) => build({
    entryPoints: [fileURLToPath(entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })));
  const contract = await import(pathToFileURL(contractBundle).href);
  const observation = await import(pathToFileURL(observationBundle).href);
  const runRecord = await import(pathToFileURL(runRecordBundle).href);
  const { BilibiliNativeSearchArtifactStore } = await import(pathToFileURL(artifactBundle).href);

  const query = '人工智能';
  const canonicalSearchUrl = contract.canonicalBilibiliNativeSearchUrlForQuery(query);
  assert.deepEqual(contract.bilibiliNativeSearchInput({ query: `  ${query}  ` }), {
    query,
    resultType: 'comprehensive',
    sort: 'relevance',
    page: 1
  });
  assert.equal(canonicalSearchUrl, 'https://search.bilibili.com/all?keyword=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD');
  assert.throws(
    () => contract.bilibiliNativeSearchInput({ query: 'unsafe\u0000query' }),
    /bilibili_native_search_input_invalid/
  );

  const result = {
    schemaVersion: 1,
    type: 'collector_strategy_observation',
    strategyId: 'bilibili.search.breadth.dom.v2',
    observerBindingId: '11111111-1111-4111-8111-111111111111',
    pageAlias: 'page-1',
    documentGeneration: 1,
    routeGeneration: 0,
    capturedAt: '2026-07-22T02:00:00.000Z',
    payloadBytes: 2_048,
    payload: {
      schemaVersion: 1,
      strategyId: 'bilibili.search.breadth.dom.v2',
      documentId: 'document-1',
      dom: {
        searchInputVisible: true,
        resultListVisible: true,
        emptyStateVisible: false,
        resultType: 'comprehensive',
        sort: 'relevance',
        semanticResultCardCount: 2,
        cards: [
          {
            bvid: 'BV1qZSLBYEpa',
            title: '公开视频标题一',
            visibleText: '公开视频标题一 播放 1 万',
            thumbnailUrl: 'https://i0.hdslb.com/bfs/archive/cover-one.jpg'
          },
          {
            bvid: 'BV1xA411c7mD',
            title: '公开视频标题二',
            visibleText: '公开视频标题二 播放 2 万',
            thumbnailUrl: null
          }
        ],
        loginOverlayVisible: false,
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      }
    }
  };
  const observed = observation.bilibiliNativeSearchStrategyObservation(result);
  const projected = contract.projectBilibiliNativeSearchDom(observed.dom, '2026-07-22T02:00:01.000Z', {
    resultType: 'comprehensive',
    sort: 'relevance',
    page: 1
  });
  assert.ok(projected);
  assert.equal(projected.resultState, 'video_results');
  assert.deepEqual(projected.items.map((item) => [item.rank, item.bvid]), [
    [1, 'BV1qZSLBYEpa'],
    [2, 'BV1xA411c7mD']
  ]);
  assert.equal(projected.items[0].canonicalVideoUrl, 'https://www.bilibili.com/video/BV1qZSLBYEpa');

  const empty = contract.projectBilibiliNativeSearchDom({
    ...observed.dom,
    resultListVisible: false,
    emptyStateVisible: true,
    semanticResultCardCount: 0,
    cards: []
  }, '2026-07-22T02:00:02.000Z', {
    resultType: 'comprehensive',
    sort: 'relevance',
    page: 1
  });
  assert.equal(empty?.resultState, 'no_video_results');
  const unsafePayload = structuredClone(result);
  unsafePayload.payload.query = query;
  assert.throws(
    () => observation.bilibiliNativeSearchStrategyObservation(unsafePayload),
    /native_search_observation_payload_context_invalid/
  );

  const run = runRecord.createBilibiliNativeSearchRunRecord({
    runId: '22222222-2222-4222-8222-222222222222',
    collectorVersion: '0.7.17',
    search: { query, resultType: 'comprehensive', sort: 'relevance', page: 1 },
    canonicalSearchUrl,
    startedAt: '2026-07-22T02:00:00.000Z',
    completedAt: '2026-07-22T02:00:03.000Z',
    state: 'completed',
    errorCode: null,
    results: projected,
    visualEvidence: {
      phase: 'baseline',
      actionId: 'navigate_bilibili_native_search_22222222',
      evidenceId: 'visual-1',
      capturedAt: '2026-07-22T02:00:01.000Z',
      viewport: { cssWidth: 1280, cssHeight: 720, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      screenshot: { fileName: 'visual-1.png', byteLength: 1024, sha256: 'a'.repeat(64) }
    },
    actions: [{
      actionId: 'navigate_bilibili_native_search_22222222',
      kind: 'navigation',
      intent: 'Open the canonical first-party Bilibili search page exactly once.',
      attempted: true,
      attemptCount: 1,
      outcome: 'completed',
      errorCode: null
    }],
    terminalReason: 'search_ready',
    targetTabSelection: 'created_new_managed_tab',
    targetPage: 'retained_after_run'
  });
  assert.equal(run.coverage.capturedItems, 2);
  assert.equal(run.safeguards.responseBodies, 'not_read');
  assert.notEqual(run.queryDigest, query);

  const stateDirectory = join(temporaryDirectory, 'state');
  const store = await BilibiliNativeSearchArtifactStore.create(stateDirectory);
  const summary = await store.record(run);
  assert.equal((await store.record(run)).artifactId, summary.artifactId);
  assert.equal(summary.capturedItems, 2);
  const artifact = await store.get(summary.artifactId);
  assert.equal(artifact.results.items[0].rank, 1);
  assert.equal(artifact.manifest.resultsFile, 'results.json');
  const recovered = await BilibiliNativeSearchArtifactStore.create(stateDirectory);
  assert.equal((await recovered.get(summary.artifactId)).summary.manifestSha256, summary.manifestSha256);

  const artifactDirectory = join(stateDirectory, 'bilibili-native-search', summary.artifactId);
  assert.deepEqual((await readdir(artifactDirectory)).sort(), ['manifest.json', 'results.json']);
  const persisted = (await Promise.all((await readdir(artifactDirectory)).map((name) =>
    readFile(join(artifactDirectory, name), 'utf8')
  ))).join('\n');
  for (const forbidden of [
    query,
    canonicalSearchUrl,
    'keyword=',
    'document-1',
    'Cookie',
    'Authorization',
    'responseBody'
  ]) assert.equal(persisted.includes(forbidden), false, `forbidden persisted value: ${forbidden}`);

  console.log(JSON.stringify({
    ok: true,
    gate: 'bilibili-native-search-dom-only-contract-and-artifact',
    platformRequests: 0,
    queryPersistedAsDigestOnly: true,
    visibleVideoCardsBounded: true,
    mixedObjectsExcluded: true,
    responseObservationExcluded: true,
    manifestAndResultsDigestVerified: true
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
