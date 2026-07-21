import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-bilibili-video-detail-'));
const contractBundle = join(temporaryDirectory, 'bilibili-video-detail-contract.mjs');
const observationBundle = join(temporaryDirectory, 'bilibili-video-detail-observation.mjs');
const runRecordBundle = join(temporaryDirectory, 'bilibili-video-detail-run-record.mjs');
const artifactBundle = join(temporaryDirectory, 'bilibili-video-detail-artifacts.mjs');

try {
  await Promise.all([
    [new URL('../src/bilibili-video-detail-contract.ts', import.meta.url), contractBundle],
    [new URL('../src/bilibili-video-detail-observation.ts', import.meta.url), observationBundle],
    [new URL('../src/bilibili-video-detail-run-record.ts', import.meta.url), runRecordBundle],
    [new URL('../src/bilibili-video-detail-artifacts.ts', import.meta.url), artifactBundle]
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
  const { BilibiliVideoDetailArtifactStore } = await import(pathToFileURL(artifactBundle).href);

  const bvid = 'BV1qZSLBYEpa';
  const canonicalVideoUrl = `https://www.bilibili.com/video/${bvid}`;
  assert.deepEqual(contract.bilibiliVideoDetailInput({ canonicalVideoUrl }), { canonicalVideoUrl });
  assert.equal(contract.canonicalBilibiliVideoDetailUrl(`${canonicalVideoUrl}/`), canonicalVideoUrl);
  assert.equal(contract.bvidFromCanonicalBilibiliVideoDetailUrl(canonicalVideoUrl), bvid);
  assert.throws(
    () => contract.bilibiliVideoDetailInput({ canonicalVideoUrl: `${canonicalVideoUrl}?credential=discard` }),
    /bilibili_video_detail_input_invalid/
  );

  const result = {
    schemaVersion: 1,
    type: 'collector_strategy_observation',
    strategyId: 'bilibili.video.detail.dom.v2',
    observerBindingId: '11111111-1111-4111-8111-111111111111',
    pageAlias: 'page-1',
    documentGeneration: 1,
    routeGeneration: 0,
    capturedAt: '2026-07-21T01:00:00.000Z',
    payloadBytes: 1024,
    payload: {
      schemaVersion: 1,
      strategyId: 'bilibili.video.detail.dom.v2',
      bvid,
      documentId: 'document-1',
      dom: {
        bvid,
        title: '公开视频标题',
        metadataVisibleText: '公开观看信息 公开发布时间',
        description: '公开视频简介',
        creator: { displayName: '公开创作者', publicAccountId: '123456' },
        tagTexts: ['人工智能', '学习'],
        episodeSummaryText: '视频选集 （1/10）',
        titleVisible: true,
        playerVisible: true,
        loginOverlayVisible: true,
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      }
    }
  };
  const observed = observation.bilibiliVideoDetailStrategyObservation(result, bvid);
  const detail = contract.projectBilibiliVideoDetailDom(observed.dom, bvid, '2026-07-21T01:00:01.000Z');
  assert.ok(detail);
  assert.equal(detail.bvid, bvid);
  assert.equal(detail.titleVisible, true);
  assert.equal(detail.playerVisible, true);
  assert.deepEqual(detail.tagTexts, ['人工智能', '学习']);
  assert.equal(detail.loginOverlayVisible, true);
  assert.equal(detail.creator.publicAccountId, '123456');

  const invalidIdentity = structuredClone(observed.dom);
  invalidIdentity.bvid = 'BV1xA411c7mD';
  assert.equal(contract.projectBilibiliVideoDetailDom(invalidIdentity, bvid, '2026-07-21T01:00:01.000Z'), null);
  const invalidOptional = structuredClone(observed.dom);
  invalidOptional.tagTexts = ['x'.repeat(101)];
  assert.equal(contract.projectBilibiliVideoDetailDom(invalidOptional, bvid, '2026-07-21T01:00:01.000Z'), null);

  const run = runRecord.createBilibiliVideoDetailRunRecord({
    runId: '22222222-2222-4222-8222-222222222222',
    collectorVersion: '0.7.5',
    canonicalVideoUrl,
    bvid,
    startedAt: '2026-07-21T01:00:00.000Z',
    completedAt: '2026-07-21T01:00:02.000Z',
    state: 'completed',
    errorCode: null,
    detail,
    visualEvidence: {
      phase: 'baseline',
      actionId: 'navigate_video_detail_22222222',
      evidenceId: 'visual-1',
      capturedAt: '2026-07-21T01:00:01.000Z',
      viewport: { cssWidth: 1280, cssHeight: 720, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      screenshot: { fileName: 'visual-1.png', byteLength: 1024, sha256: 'a'.repeat(64) }
    },
    actions: [{
      actionId: 'navigate_video_detail_22222222',
      kind: 'navigation',
      intent: 'Open the canonical public Bilibili video page exactly once.',
      attempted: true,
      attemptCount: 1,
      outcome: 'completed',
      errorCode: null
    }],
    terminalReason: 'detail_ready',
    targetTabSelection: 'created_new_managed_tab',
    targetPage: 'retained_after_run'
  });
  assert.equal(run.coverage.capturedDetails, 1);
  assert.equal(run.coverage.tagCount, 2);
  assert.equal(run.coverage.loginOverlayVisible, true);
  assert.equal(run.safeguards.responseBodies, 'not_read');

  const stateDirectory = join(temporaryDirectory, 'state');
  const store = await BilibiliVideoDetailArtifactStore.create(stateDirectory);
  const summary = await store.record(run);
  assert.equal((await store.record(run)).artifactId, summary.artifactId);
  assert.equal(summary.titleCaptured, true);
  assert.equal(summary.tagCount, 2);
  const artifact = await store.get(summary.artifactId);
  assert.equal(artifact.detail.bvid, bvid);
  assert.equal(artifact.manifest.detailFile, 'detail.json');
  const recovered = await BilibiliVideoDetailArtifactStore.create(stateDirectory);
  assert.equal((await recovered.get(summary.artifactId)).summary.manifestSha256, summary.manifestSha256);

  const artifactDirectory = join(stateDirectory, 'bilibili-video-detail', summary.artifactId);
  assert.deepEqual((await readdir(artifactDirectory)).sort(), ['detail.json', 'manifest.json']);
  const persisted = (await Promise.all((await readdir(artifactDirectory)).map((name) =>
    readFile(join(artifactDirectory, name), 'utf8')
  ))).join('\n');
  for (const forbidden of [
    'canonicalVideoUrl', 'credential=discard', 'Cookie', 'Authorization', 'responseBody', 'documentId'
  ]) assert.equal(persisted.includes(forbidden), false, `forbidden persisted value: ${forbidden}`);

  console.log(JSON.stringify({
    ok: true,
    gate: 'bilibili-video-detail-dom-only-contract-and-artifact',
    platformRequests: 0,
    canonicalBvidOnly: true,
    titlePlayerAndOptionalPublicFieldsBounded: true,
    responseObservationExcluded: true,
    noQueryCredentialsOrRawResponsePersisted: true,
    manifestAndDetailDigestVerified: true
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
