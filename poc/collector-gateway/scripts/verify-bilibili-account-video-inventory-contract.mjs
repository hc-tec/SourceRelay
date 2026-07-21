import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-bilibili-account-video-inventory-'));
const contractBundle = join(temporaryDirectory, 'bilibili-account-video-inventory-contract.mjs');
const observationBundle = join(temporaryDirectory, 'bilibili-account-video-inventory-observation.mjs');
const runRecordBundle = join(temporaryDirectory, 'bilibili-account-video-inventory-run-record.mjs');
const artifactBundle = join(temporaryDirectory, 'bilibili-account-video-inventory-artifacts.mjs');

try {
  await Promise.all([
    [new URL('../src/bilibili-account-video-inventory-contract.ts', import.meta.url), contractBundle],
    [new URL('../src/bilibili-account-video-inventory-observation.ts', import.meta.url), observationBundle],
    [new URL('../src/bilibili-account-video-inventory-run-record.ts', import.meta.url), runRecordBundle],
    [new URL('../src/bilibili-account-video-inventory-artifacts.ts', import.meta.url), artifactBundle]
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
  const { BilibiliAccountVideoInventoryArtifactStore } = await import(pathToFileURL(artifactBundle).href);

  const stableAccountId = '7481602';
  const canonicalProfileUrl = `https://space.bilibili.com/${stableAccountId}`;
  const canonicalInventoryUrl = `${canonicalProfileUrl}/upload/video`;
  assert.deepEqual(contract.bilibiliAccountVideoInventoryInput({ canonicalProfileUrl }), { canonicalProfileUrl });
  assert.equal(contract.accountVideoInventoryUrl(canonicalProfileUrl), canonicalInventoryUrl);
  assert.equal(contract.stableAccountIdFromCanonicalBilibiliProfileUrl(canonicalProfileUrl), stableAccountId);
  assert.throws(
    () => contract.bilibiliAccountVideoInventoryInput({ canonicalProfileUrl: `${canonicalProfileUrl}?credential=discard` }),
    /bilibili_account_video_inventory_input_invalid/
  );

  const result = {
    schemaVersion: 1,
    type: 'collector_strategy_observation',
    strategyId: 'bilibili.account.video-inventory.dom.v1',
    observerBindingId: '11111111-1111-4111-8111-111111111111',
    pageAlias: 'page-1',
    documentGeneration: 1,
    routeGeneration: 0,
    capturedAt: '2026-07-21T02:00:00.000Z',
    payloadBytes: 2048,
    payload: {
      schemaVersion: 1,
      strategyId: 'bilibili.account.video-inventory.dom.v1',
      stableAccountId,
      documentId: 'document-1',
      dom: {
        stableAccountId,
        videoListVisible: true,
        cards: [
          {
            bvid: 'BV1qZSLBYEpa',
            title: '公开视频标题一',
            visibleText: '公开卡片文本一',
            thumbnailUrl: 'https://i0.hdslb.com/bfs/archive/example-one.png'
          },
          {
            bvid: 'BV1xA411c7mD',
            title: '公开视频标题二',
            visibleText: '公开卡片文本二',
            thumbnailUrl: null
          }
        ],
        loginOverlayVisible: true,
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      }
    }
  };
  const observed = observation.bilibiliAccountVideoInventoryStrategyObservation(result, stableAccountId);
  const page = contract.projectBilibiliAccountVideoInventoryDom(
    observed.dom,
    stableAccountId,
    '2026-07-21T02:00:01.000Z'
  );
  assert.ok(page);
  assert.equal(page.items.length, 2);
  assert.equal(page.unresolvedCardCount, 0);
  assert.equal(page.items[0].canonicalVideoUrl, 'https://www.bilibili.com/video/BV1qZSLBYEpa');
  assert.equal(page.loginOverlayVisible, true);

  const invalid = structuredClone(observed.dom);
  invalid.cards[1].bvid = 'invalid';
  const partialPage = contract.projectBilibiliAccountVideoInventoryDom(
    invalid,
    stableAccountId,
    '2026-07-21T02:00:01.000Z'
  );
  assert.ok(partialPage);
  assert.equal(partialPage.items.length, 1);
  assert.equal(partialPage.unresolvedCardCount, 1);

  const run = runRecord.createBilibiliAccountVideoInventoryRunRecord({
    runId: '22222222-2222-4222-8222-222222222222',
    collectorVersion: '0.7.6',
    canonicalInventoryUrl,
    stableAccountId,
    startedAt: '2026-07-21T02:00:00.000Z',
    completedAt: '2026-07-21T02:00:02.000Z',
    state: 'completed',
    errorCode: null,
    page,
    visualEvidence: {
      phase: 'baseline',
      actionId: 'navigate_account_video_inventory_22222222',
      evidenceId: 'visual-1',
      capturedAt: '2026-07-21T02:00:01.000Z',
      viewport: { cssWidth: 1280, cssHeight: 720, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      screenshot: { fileName: 'visual-1.png', byteLength: 1024, sha256: 'a'.repeat(64) }
    },
    actions: [{
      actionId: 'navigate_account_video_inventory_22222222',
      kind: 'navigation',
      intent: 'Open the canonical public Bilibili account video inventory exactly once.',
      attempted: true,
      attemptCount: 1,
      outcome: 'completed',
      errorCode: null
    }],
    terminalReason: 'page_one_ready',
    targetTabSelection: 'created_new_managed_tab',
    targetPage: 'retained_after_run'
  });
  assert.equal(run.coverage.capturedPages, 1);
  assert.equal(run.coverage.capturedItems, 2);
  assert.equal(run.safeguards.responseBodies, 'not_read');

  const stateDirectory = join(temporaryDirectory, 'state');
  const store = await BilibiliAccountVideoInventoryArtifactStore.create(stateDirectory);
  const summary = await store.record(run);
  assert.equal((await store.record(run)).artifactId, summary.artifactId);
  assert.equal(summary.capturedItems, 2);
  const artifact = await store.get(summary.artifactId);
  assert.equal(artifact.page.items.length, 2);
  assert.equal(artifact.manifest.pageFile, 'page-one.json');
  const recovered = await BilibiliAccountVideoInventoryArtifactStore.create(stateDirectory);
  assert.equal((await recovered.get(summary.artifactId)).summary.manifestSha256, summary.manifestSha256);

  const artifactDirectory = join(stateDirectory, 'bilibili-account-video-inventory', summary.artifactId);
  assert.deepEqual((await readdir(artifactDirectory)).sort(), ['manifest.json', 'page-one.json']);
  const persisted = (await Promise.all((await readdir(artifactDirectory)).map((name) =>
    readFile(join(artifactDirectory, name), 'utf8')
  ))).join('\n');
  for (const forbidden of [
    'canonicalProfileUrl', 'credential=discard', 'Cookie', 'Authorization', 'responseBody', 'documentId'
  ]) assert.equal(persisted.includes(forbidden), false, `forbidden persisted value: ${forbidden}`);

  console.log(JSON.stringify({
    ok: true,
    gate: 'bilibili-account-video-inventory-dom-only-contract-and-artifact',
    platformRequests: 0,
    canonicalProfileAndPageOneOnly: true,
    bvidExtractedWithoutPersistingLinkQuery: true,
    boundedPublicCardsAndPartialCoverageVerified: true,
    responseObservationExcluded: true,
    noQueryCredentialsOrRawResponsePersisted: true,
    manifestAndPageDigestVerified: true
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
