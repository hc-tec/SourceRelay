import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-transcript-artifacts-'));
const registryBundle = join(temporaryDirectory, 'transcript-artifacts.mjs');
const captureBundle = join(temporaryDirectory, 'network-capture.mjs');
const canonicalUrl = 'https://www.bilibili.com/video/BV1qZSLBYEpa';

try {
  await Promise.all([
    build({
      entryPoints: [fileURLToPath(new URL('../src/transcript-artifacts.ts', import.meta.url))],
      outfile: registryBundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    }),
    build({
      entryPoints: [fileURLToPath(new URL('../../collector-extension/src/shared/network-capture.ts', import.meta.url))],
      outfile: captureBundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    })
  ]);
  const { TranscriptArtifactRegistry } = await import(pathToFileURL(registryBundle).href);
  const capture = await import(pathToFileURL(captureBundle).href);
  const routeIds = capture.bilibiliTranscriptResearchRouteIds();
  const directoryUrl = 'https://api.bilibili.com/x/player/wbi/v2?token=must-discard';
  const subtitleUrl = 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/' + 'a'.repeat(64) + '?auth_key=must-discard';
  const directoryRoute = capture.findNetworkCaptureRoute('bilibili', directoryUrl, routeIds);
  const subtitleRoute = capture.findNetworkCaptureRoute('bilibili', subtitleUrl, routeIds);
  const directory = capture.createNetworkCaptureFromText({
    platform: 'bilibili',
    route: directoryRoute,
    method: 'GET',
    responseUrl: directoryUrl,
    contentType: 'application/json',
    httpStatus: 200
  }, JSON.stringify({
    data: {
      ip_info: { ip: 'must-not-survive' },
      login_mid_hash: 'must-not-survive',
      subtitle: {
        lan: 'zh-CN',
        lan_doc: '中文',
        subtitles: [{
          id_str: '10',
          lan: 'zh-CN',
          lan_doc: '中文（自动生成）',
          subtitle_url: subtitleUrl
        }]
      }
    }
  }));
  const document = capture.createNetworkCaptureFromText({
    platform: 'bilibili',
    route: subtitleRoute,
    method: 'GET',
    responseUrl: subtitleUrl,
    contentType: 'application/json',
    httpStatus: 200
  }, JSON.stringify({
    lang: 'zh-CN',
    type: 'AIsubtitle',
    version: '1.0',
    body: [
      { sid: 1, from: 0, to: 1, content: '持久化字幕第一句' },
      { sid: 2, from: 1, to: 2, content: '持久化字幕第二句' }
    ]
  }));
  const snapshot = {
    schemaVersion: 1,
    collectorVersion: '0.4.21',
    runId: '11111111-1111-4111-8111-111111111111',
    profileId: '22222222-2222-4222-8222-222222222222',
    platform: 'bilibili',
    accountCategory: 'user_managed',
    evidenceObjective: 'transcript_read',
    strategy: { strategyId: 'bilibili.video.transcript.response.v1', version: '1.0.0' },
    targetUrlDigest: 'a'.repeat(64),
    navigationUrlDigest: 'a'.repeat(64),
    windowId: 100,
    tabId: 101,
    documentId: 'must-not-survive',
    state: 'completed',
    terminalStatus: 'completed',
    errorCode: null,
    startedAt: '2026-07-19T00:00:00.000Z',
    expiresAt: '2026-07-19T00:00:45.000Z',
    completedAt: '2026-07-19T00:00:04.000Z',
    interaction: {
      schemaVersion: 1,
      canonicalUrl,
      state: 'completed',
      objective: {
        status: 'satisfied',
        requiredActions: ['reveal_player_controls', 'open_caption_menu', 'select_caption_language'],
        completedActions: ['reveal_player_controls', 'open_caption_menu', 'select_caption_language']
      },
      actions: [
        {
          action: 'reveal_player_controls', attempted: true, outcome: 'completed',
          visibleLabels: ['字幕'], selectedLabel: null, postconditionAcknowledged: true
        },
        {
          action: 'open_caption_menu', attempted: true, outcome: 'completed',
          visibleLabels: ['关闭', '中文'], selectedLabel: null, postconditionAcknowledged: true
        },
        {
          action: 'select_caption_language', attempted: true, outcome: 'completed',
          visibleLabels: ['中文'], selectedLabel: '中文', postconditionAcknowledged: true
        }
      ],
      errorCode: null,
      completedAt: '2026-07-19T00:00:04.000Z'
    },
    captures: [directory, document],
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      admissionEligible: false,
      semanticActionDelivery: 'at_most_once',
      productionResponseRoutes: 'unchanged_empty',
      cookiesAndTokens: 'not_read',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      queryAndFragmentValues: 'discarded',
      targetPage: 'retained_after_validation'
    }
  };
  const stateDirectory = join(temporaryDirectory, 'state');
  const registry = await TranscriptArtifactRegistry.create(stateDirectory);
  const manifest = await registry.record(snapshot, new Date('2026-07-19T00:00:05.000Z'));
  assert.equal(manifest.segmentCount, 2);
  assert.equal(manifest.language, 'zh-CN');
  assert.equal(manifest.objectiveStatus, 'satisfied');
  assert.equal(manifest.safeguards.admissionEligible, false);
  const duplicate = await registry.record(snapshot, new Date('2026-07-19T00:00:06.000Z'));
  assert.equal(duplicate.recordId, manifest.recordId);

  const artifact = await registry.get(manifest.recordId);
  assert.equal(artifact.transcriptDocument.segments.length, 2);
  assert.equal(artifact.transcriptDocument.segments[0].content, '持久化字幕第一句');
  assert.equal(artifact.trackDirectory.tracks[0].sourceRouteApproved, true);
  assert.equal(artifact.sources.every((source) => !source.responseUrl.includes('?')), true);
  const reloaded = await TranscriptArtifactRegistry.create(stateDirectory);
  assert.equal(reloaded.list().length, 1);
  assert.equal((await reloaded.get(manifest.recordId)).manifest.transcriptDocumentSha256, manifest.transcriptDocumentSha256);

  const recordDirectory = join(stateDirectory, 'transcripts', manifest.recordId);
  assert.deepEqual((await readdir(recordDirectory)).sort(), [
    'manifest.json', 'sources.json', 'track-directory.json', 'transcript-document.json'
  ]);
  const persistedText = (await Promise.all((await readdir(recordDirectory)).map((name) =>
    readFile(join(recordDirectory, name), 'utf8')
  ))).join('\n') + await readFile(join(stateDirectory, 'transcript-artifacts.json'), 'utf8');
  for (const forbidden of [
    'profileId', 'windowId', 'tabId', 'documentId', canonicalUrl,
    'auth_key', 'must-discard', 'must-not-survive', 'login_mid_hash', 'ip_info'
  ]) assert.equal(persistedText.includes(forbidden), false, `forbidden persisted value: ${forbidden}`);

  await assert.rejects(
    () => registry.record({ ...snapshot, runId: '33333333-3333-4333-8333-333333333333', captures: [] }),
    (error) => error instanceof Error && error.message === 'transcript_artifact_has_no_public_content'
  );
  console.log(JSON.stringify({
    ok: true,
    gate: 'gateway-local-raw-transcript-artifact',
    platformRequests: 0,
    artifactFiles: 4,
    segmentCount: manifest.segmentCount,
    idempotentByRunId: true,
    profileAndBrowserRuntimeIdsOmitted: true,
    queryAndCredentialValuesOmitted: true,
    restartReloadVerified: true,
    admissionEligible: false
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
