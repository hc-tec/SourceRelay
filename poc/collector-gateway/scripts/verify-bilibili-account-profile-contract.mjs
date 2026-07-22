import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-bilibili-account-profile-'));
const contractBundle = join(temporaryDirectory, 'bilibili-account-profile-contract.mjs');
const artifactBundle = join(temporaryDirectory, 'bilibili-account-profile-artifacts.mjs');

try {
  await Promise.all([
    build({
      entryPoints: [fileURLToPath(new URL('../src/bilibili-account-profile-contract.ts', import.meta.url))],
      outfile: contractBundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    }),
    build({
      entryPoints: [fileURLToPath(new URL('../src/bilibili-account-profile-artifacts.ts', import.meta.url))],
      outfile: artifactBundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    })
  ]);
  const contract = await import(pathToFileURL(contractBundle).href);
  const { BilibiliAccountProfileArtifactStore } = await import(pathToFileURL(artifactBundle).href);
  const canonicalProfileUrl = 'https://space.bilibili.com/123456';
  const snapshot = contract.projectBilibiliAccountProfileDom({
    stableAccountId: '123456',
    displayName: '公开账号',
    visibleDescription: '公开简介',
    avatarUrl: 'https://i1.hdslb.com/bfs/face/avatar.jpg@96w_96h_1c.webp?credential=discard',
    bannerUrl: 'https://i0.hdslb.com/bfs/space/banner.png@1920w_200h.webp',
    textBadges: ['Lv6', '普通文字不得进入 badge'],
    imageBadges: [{
      url: 'https://i2.hdslb.com/bfs/face/member.png@120w.webp',
      label: '年度大会员'
    }],
    statistics: [
      { label: '关注数', value: '17' },
      { label: '粉丝数', value: '14.4万' },
      { label: '当前用户', value: 'must-not-survive' }
    ],
    navigation: [
      { label: '主页', value: null, href: canonicalProfileUrl },
      { label: '投稿', value: '338', href: `${canonicalProfileUrl}/upload` },
      { label: '消息', value: '99+', href: 'https://message.bilibili.com/' }
    ],
    announcementText: '公开公告',
    chargeText: '32人充电',
    highlights: [
      { bvid: 'BV1qZSLBYEpa', title: '公开代表作' },
      { bvid: 'BV1qZSLBYEpa', title: '重复项不得进入' }
    ],
    currentViewerIdentity: 'must-not-survive'
  }, canonicalProfileUrl, '2026-07-20T00:00:00.000Z');
  assert.ok(snapshot);
  assert.equal(snapshot.media.avatarUrl, 'https://i1.hdslb.com/bfs/face/avatar.jpg');
  assert.equal(snapshot.media.bannerUrl, 'https://i0.hdslb.com/bfs/space/banner.png');
  assert.equal(
    contract.projectBilibiliAccountProfileDom({
      stableAccountId: '123456',
      displayName: '公开账号',
      avatarUrl: 'http://i1.hdslb.com/bfs/face/avatar.jpg'
    }, canonicalProfileUrl, '2026-07-20T00:00:00.000Z').media.avatarUrl,
    'https://i1.hdslb.com/bfs/face/avatar.jpg'
  );
  assert.equal(snapshot.badges.length, 2);
  assert.equal(snapshot.publicFields.length, 4);
  assert.equal(snapshot.highlights.length, 1);
  assert.equal(JSON.stringify(snapshot).includes('must-not-survive'), false);

  const stateDirectory = join(temporaryDirectory, 'state');
  const store = await BilibiliAccountProfileArtifactStore.create(stateDirectory);
  const run = {
    schemaVersion: 1,
    runId: '11111111-1111-4111-8111-111111111111',
    collectorVersion: '0.4.24',
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'account_profile',
    targetUrlDigest: 'a'.repeat(64),
    strategyCandidate: {
      strategyId: 'bilibili.account.profile.dom.v2',
      version: '0.1.0',
      admissionEligible: false
    },
    state: 'completed',
    errorCode: null,
    startedAt: '2026-07-20T00:00:00.000Z',
    completedAt: '2026-07-20T00:00:01.000Z',
    snapshot,
    visualEvidence: {
      phase: 'baseline',
      actionId: 'open_account_profile',
      evidenceId: 'visual-1',
      capturedAt: '2026-07-20T00:00:00.500Z',
      viewport: { cssWidth: 1280, cssHeight: 720, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      screenshot: { fileName: 'visual-1.png', byteLength: 1024, sha256: 'b'.repeat(64) }
    },
    actions: [{
      actionId: 'open_account_profile',
      intent: 'Open the canonical public account profile.',
      attempted: true,
      attemptCount: 1,
      outcome: 'completed',
      errorCode: null
    }],
    coverage: {
      identityCaptured: true,
      avatarCaptured: true,
      bannerCaptured: true,
      badgeCount: snapshot.badges.length,
      publicFieldCount: snapshot.publicFields.length,
      announcementCaptured: true,
      chargeSectionCaptured: true,
      highlightCount: snapshot.highlights.length,
      terminalReason: 'profile_captured'
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'bounded_visible_account_dom',
      responseBody: 'not_read',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      queryAndFragmentValues: 'discarded',
      currentViewerIdentity: 'excluded',
      semanticActionDelivery: 'at_most_once',
      runDeadlineMs: 60_000,
      targetTabSelection: 'created_new_managed_tab',
      targetPage: 'retained_after_run',
      admissionEligible: false
    }
  };
  const summary = await store.record(run);
  const duplicate = await store.record(run);
  assert.equal(duplicate.artifactId, summary.artifactId);
  const artifact = await store.get(summary.artifactId);
  assert.equal(artifact.snapshot.displayName, '公开账号');
  const recovered = await BilibiliAccountProfileArtifactStore.create(stateDirectory);
  assert.equal((await recovered.get(summary.artifactId)).summary.manifestSha256, summary.manifestSha256);
  const artifactDirectory = join(stateDirectory, 'bilibili-account-profiles', summary.artifactId);
  assert.deepEqual((await readdir(artifactDirectory)).sort(), ['manifest.json', 'profile-snapshot.json']);
  const persisted = (await Promise.all((await readdir(artifactDirectory)).map((name) =>
    readFile(join(artifactDirectory, name), 'utf8')
  ))).join('\n');
  for (const forbidden of [
    'profileId', 'browserProfileId', 'currentViewerIdentity": "must-not-survive',
    'credential=discard', 'must-not-survive', 'Authorization'
  ]) assert.equal(persisted.includes(forbidden), false, `forbidden persisted value: ${forbidden}`);

  console.log(JSON.stringify({
    ok: true,
    gate: 'bilibili-account-profile-pure-contract-and-artifact',
    platformRequests: 0,
    profileAndBrowserRuntimeIdsOmitted: true,
    currentViewerFieldsOmitted: true,
    publicMediaUrlsNormalised: true,
    manifestAndSnapshotDigestsVerified: true,
    restartReloadVerified: true
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
