import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-bilibili-account-video-page-two-'));
const contractBundle = join(temporaryDirectory, 'contract.mjs');
const runRecordBundle = join(temporaryDirectory, 'run-record.mjs');
const artifactBundle = join(temporaryDirectory, 'artifacts.mjs');

try {
  await Promise.all([
    [new URL('../src/bilibili-account-video-page-two-contract.ts', import.meta.url), contractBundle],
    [new URL('../src/bilibili-account-video-page-two-run-record.ts', import.meta.url), runRecordBundle],
    [new URL('../src/bilibili-account-video-page-two-artifacts.ts', import.meta.url), artifactBundle]
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
  const runRecord = await import(pathToFileURL(runRecordBundle).href);
  const { BilibiliAccountVideoPageTwoArtifactStore } = await import(pathToFileURL(artifactBundle).href);

  const stableAccountId = '7481602';
  const canonicalProfileUrl = `https://space.bilibili.com/${stableAccountId}`;
  const canonicalInventoryUrl = `${canonicalProfileUrl}/upload/video`;
  assert.deepEqual(contract.bilibiliAccountVideoPageTwoInput({ canonicalProfileUrl }), { canonicalProfileUrl });
  assert.equal(contract.pageTwoInventoryUrl(canonicalProfileUrl), canonicalInventoryUrl);
  assert.equal(contract.pageTwoStableAccountId(canonicalProfileUrl), stableAccountId);
  assert.throws(
    () => contract.bilibiliAccountVideoPageTwoInput({ canonicalProfileUrl: `${canonicalProfileUrl}?credential=discard` }),
    /bilibili_account_video_inventory_input_invalid/
  );

  const pageOne = {
    schemaVersion: 1,
    stableAccountId,
    items: [{
      bvid: 'BV1qZSLBYEpa',
      canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
      title: '公开页面一标题',
      visibleText: '公开页面一卡片文本',
      thumbnailUrl: null
    }],
    visibleCardCount: 1,
    unresolvedCardCount: 0,
    loginOverlayVisible: false,
    risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false },
    capturedAt: '2026-07-21T03:00:00.000Z'
  };
  const pageTwo = {
    ...structuredClone(pageOne),
    items: [{
      bvid: 'BV1xA411c7mD',
      canonicalVideoUrl: 'https://www.bilibili.com/video/BV1xA411c7mD',
      title: '公开页面二标题',
      visibleText: '公开页面二卡片文本',
      thumbnailUrl: 'https://i0.hdslb.com/bfs/archive/example-two.png'
    }],
    capturedAt: '2026-07-21T03:00:02.000Z'
  };
  const beforeBvidSetDigest = contract.bvidSetDigest(pageOne);
  const afterBvidSetDigest = contract.bvidSetDigest(pageTwo);
  assert.match(beforeBvidSetDigest, /^[0-9a-f]{64}$/);
  assert.notEqual(beforeBvidSetDigest, afterBvidSetDigest);

  const run = runRecord.createBilibiliAccountVideoPageTwoRunRecord({
    runId: '22222222-2222-4222-8222-222222222222',
    collectorVersion: '0.7.9',
    canonicalInventoryUrl,
    stableAccountId,
    startedAt: '2026-07-21T03:00:00.000Z',
    completedAt: '2026-07-21T03:00:03.000Z',
    state: 'completed',
    errorCode: null,
    pageTwo,
    beforeBvidSetDigest,
    afterBvidSetDigest,
    pagination: {
      targetPage: 2,
      activePageBefore: 1,
      activePageAfter: 2,
      targetBounds: { x: 351, y: 653, width: 34, height: 34 },
      scrollToControlAttempted: true,
      matchedRouteStatuses: [200]
    },
    visualEvidence: {
      before: {
        phase: 'pagination_before',
        actionId: 'select_account_video_page_two_22222222',
        evidenceId: 'visual-before',
        capturedAt: '2026-07-21T03:00:01.000Z',
        viewport: { cssWidth: 1280, cssHeight: 720, devicePixelRatio: 1, scrollX: 0, scrollY: 1720 },
        screenshot: { fileName: 'visual-before.png', byteLength: 1024, sha256: 'a'.repeat(64) }
      },
      after: {
        phase: 'pagination_after',
        actionId: 'select_account_video_page_two_22222222',
        evidenceId: 'visual-after',
        capturedAt: '2026-07-21T03:00:02.000Z',
        viewport: { cssWidth: 1280, cssHeight: 720, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
        screenshot: { fileName: 'visual-after.png', byteLength: 1024, sha256: 'b'.repeat(64) }
      }
    },
    actions: [{
      actionId: 'navigate_account_video_inventory_22222222',
      kind: 'navigation',
      intent: 'Open the canonical Bilibili account video inventory exactly once.',
      attempted: true,
      attemptCount: 1,
      outcome: 'completed',
      errorCode: null
    }, {
      actionId: 'select_account_video_page_two_22222222',
      kind: 'pagination_click',
      intent: 'Select page two of the Bilibili account video inventory exactly once.',
      attempted: true,
      attemptCount: 1,
      outcome: 'completed',
      errorCode: null,
      scrollToControlAttempted: true
    }],
    terminalReason: 'page_two_ready',
    targetTabSelection: 'created_new_managed_tab',
    targetPage: 'retained_after_run'
  });
  assert.equal(run.coverage.bvidSetChanged, true);
  assert.equal(run.coverage.pageTwoCapturedItems, 1);
  assert.equal(run.safeguards.networkMetadata, 'route_method_status_only');

  const stateDirectory = join(temporaryDirectory, 'state');
  const store = await BilibiliAccountVideoPageTwoArtifactStore.create(stateDirectory);
  const summary = await store.record(run);
  assert.equal((await store.record(run)).artifactId, summary.artifactId);
  assert.equal(summary.bvidSetChanged, true);
  const artifact = await store.get(summary.artifactId);
  assert.equal(artifact.pageTwo.items.length, 1);
  assert.equal(artifact.manifest.pageFile, 'page-two.json');
  const recovered = await BilibiliAccountVideoPageTwoArtifactStore.create(stateDirectory);
  assert.equal((await recovered.get(summary.artifactId)).summary.manifestSha256, summary.manifestSha256);

  const artifactDirectory = join(stateDirectory, 'bilibili-account-video-page-two', summary.artifactId);
  assert.deepEqual((await readdir(artifactDirectory)).sort(), ['manifest.json', 'page-two.json']);
  const persisted = (await Promise.all((await readdir(artifactDirectory)).map((name) =>
    readFile(join(artifactDirectory, name), 'utf8')
  ))).join('\n');
  for (const forbidden of [
    'canonicalProfileUrl', 'credential=discard', 'Cookie', 'Authorization', 'responseBody', 'documentId'
  ]) assert.equal(persisted.includes(forbidden), false, `forbidden persisted value: ${forbidden}`);

  console.log(JSON.stringify({
    ok: true,
    gate: 'bilibili-account-video-page-two-contract-and-artifact',
    platformRequests: 0,
    pageTwoOnly: true,
    bvidSetChangeRequired: true,
    responseBodyExcluded: true,
    routeMethodStatusMetadataOnly: true,
    noQueryCredentialsOrRawResponsePersisted: true,
    manifestAndPageDigestVerified: true
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
