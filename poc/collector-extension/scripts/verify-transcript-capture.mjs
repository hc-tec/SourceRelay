import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-transcript-capture-'));
const bundlePath = join(temporaryDirectory, 'network-capture.mjs');
const urlBundlePath = join(temporaryDirectory, 'bilibili-video-url.mjs');
const protocolBundlePath = join(temporaryDirectory, 'protocol.mjs');

try {
  await Promise.all([
    build({
      entryPoints: [fileURLToPath(new URL('../src/shared/network-capture.ts', import.meta.url))],
      outfile: bundlePath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    }),
    build({
      entryPoints: [fileURLToPath(new URL('../src/shared/bilibili-video-url.ts', import.meta.url))],
      outfile: urlBundlePath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    }),
    build({
      entryPoints: [fileURLToPath(new URL('../src/shared/protocol.ts', import.meta.url))],
      outfile: protocolBundlePath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    })
  ]);
  const capture = await import(pathToFileURL(bundlePath).href);
  const urls = await import(pathToFileURL(urlBundlePath).href);
  const protocol = await import(pathToFileURL(protocolBundlePath).href);
  const canonicalVideoUrl = 'https://www.bilibili.com/video/BV1qZSLBYEpa';
  assert.equal(urls.canonicalBilibiliVideoUrl(canonicalVideoUrl), canonicalVideoUrl);
  assert.equal(urls.canonicalBilibiliVideoUrl(`${canonicalVideoUrl}?vd_source=${'a'.repeat(32)}`), null);
  assert.equal(
    urls.canonicalBilibiliVideoUrl(
      `${canonicalVideoUrl}/?vd_source=${'a'.repeat(32)}`,
      'observed_document'
    ),
    canonicalVideoUrl
  );
  assert.equal(urls.canonicalBilibiliVideoUrl(`${canonicalVideoUrl}?foo=bar`, 'observed_document'), null);
  assert.equal(urls.canonicalBilibiliVideoUrl(`${canonicalVideoUrl}?vd_source=short`, 'observed_document'), null);
  const interaction = {
    schemaVersion: 1,
    canonicalUrl: canonicalVideoUrl,
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
    completedAt: '2026-07-19T00:00:05.000Z'
  };
  assert.equal(protocol.COLLECTOR_CORE_VERSION, '0.4.20');
  assert.equal(protocol.isTranscriptInteractionResult(interaction), true);
  assert.equal(protocol.isCompleteTranscriptCapabilityValidationMessage({
    type: 'collector.completeTranscriptCapabilityValidation',
    runId: '11111111-1111-4111-8111-111111111111',
    result: interaction
  }), true);
  assert.equal(protocol.isCompleteTranscriptCapabilityValidationMessage({
    type: 'collector.completeTranscriptCapabilityValidation',
    runId: '11111111-1111-4111-8111-111111111111',
    result: { ...interaction, actions: interaction.actions.slice(1) }
  }), false);
  assert.equal(protocol.isCompleteTranscriptCapabilityValidationMessage({
    type: 'collector.transcriptInteractionResult',
    runId: '11111111-1111-4111-8111-111111111111',
    result: interaction
  }), false);
  const routeIds = capture.bilibiliTranscriptResearchRouteIds();
  assert.deepEqual(routeIds, [
    'bilibili.video.transcript.track-directory.response.v1',
    'bilibili.video.transcript.document.response.v1'
  ]);
  assert.deepEqual(capture.approvedNetworkCaptureRouteIds('bilibili'), []);

  const directoryUrl = 'https://api.bilibili.com/x/player/wbi/v2?aid=1&token=must-discard';
  const directoryRoute = capture.findNetworkCaptureRoute('bilibili', directoryUrl, routeIds);
  assert.equal(directoryRoute?.id, routeIds[0]);
  assert.equal(capture.findNetworkCaptureRoute('bilibili', directoryUrl), null);
  assert.equal(capture.findNetworkCaptureRoute(
    'bilibili',
    'https://api.bilibili.com/x/player/wbi/v2/lookalike',
    routeIds
  ), null);

  const subtitleUrl = 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/' + 'a'.repeat(64) + '?auth_key=must-discard';
  const subtitleRoute = capture.findNetworkCaptureRoute('bilibili', subtitleUrl, routeIds);
  assert.equal(subtitleRoute?.id, routeIds[1]);
  assert.equal(capture.findNetworkCaptureRoute(
    'bilibili',
    'https://evil.example/bfs/ai_subtitle/prod/' + 'a'.repeat(64),
    routeIds
  ), null);
  assert.equal(capture.findNetworkCaptureRoute(
    'bilibili',
    'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/a',
    routeIds
  ), null);

  const directoryPayload = {
    code: 0,
    data: {
      ip_info: { ip: 'must-not-survive' },
      login_mid_hash: 'must-not-survive',
      token: 'must-not-survive',
      subtitle: {
        lan: 'zh-CN',
        lan_doc: '中文',
        allow_submit: true,
        subtitles: [
          {
            id: 10,
            id_str: '10',
            lan: 'zh-CN',
            lan_doc: '中文（自动生成）',
            ai_status: 1,
            ai_type: 2,
            is_lock: false,
            type: 1,
            subtitle_url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/' + 'a'.repeat(64) + '?auth_key=secret',
            subtitle_url_v2: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/' + 'a'.repeat(64) + '?token=secret'
          },
          {
            id: 11,
            lan: 'en-US',
            lan_doc: 'English',
            subtitle_url: 'https://evil.example/subtitle.json'
          }
        ]
      }
    }
  };
  const directoryObservation = capture.createNetworkCaptureFromText({
    platform: 'bilibili',
    route: directoryRoute,
    method: 'GET',
    responseUrl: directoryUrl,
    contentType: 'application/json; charset=utf-8',
    httpStatus: 200
  }, JSON.stringify(directoryPayload));
  assert.equal(directoryObservation.status, 'captured');
  assert.equal(directoryObservation.admission, 'research_validation');
  assert.equal(directoryObservation.responseUrl, 'https://api.bilibili.com/x/player/wbi/v2');
  assert.equal(directoryObservation.body.artifactKind, 'bilibili_transcript_track_directory');
  assert.equal(directoryObservation.body.tracks.length, 2);
  assert.equal(directoryObservation.body.tracks[0].sourceRouteApproved, true);
  assert.equal(directoryObservation.body.tracks[0].sourceUrl.includes('?'), false);
  assert.equal(directoryObservation.body.tracks[1].sourceRouteApproved, false);
  assert.equal(JSON.stringify(directoryObservation.body).includes('must-not-survive'), false);
  assert.equal(JSON.stringify(directoryObservation.body).includes('auth_key'), false);

  const subtitlePayload = {
    lang: 'zh-CN',
    type: 'AIsubtitle',
    version: '1.0',
    background_alpha: 0.4,
    background_color: '#000000',
    font_color: '#ffffff',
    font_size: 1,
    Stroke: 'none',
    body: [
      { sid: 1, from: 0.25, to: 1.5, content: '第一句公开字幕', location: 2, music: 0 },
      { sid: 2, from: 1.5, to: 3.75, content: '第二句公开字幕', location: 2, music: 0 },
      { sid: 3, from: 5, to: 4, content: '非法时间片必须丢弃' }
    ],
    unknown_account_field: 'must-not-survive'
  };
  const subtitleObservation = capture.createNetworkCaptureFromText({
    platform: 'bilibili',
    route: subtitleRoute,
    method: 'GET',
    responseUrl: subtitleUrl,
    contentType: 'application/json',
    httpStatus: 200
  }, JSON.stringify(subtitlePayload));
  assert.equal(subtitleObservation.status, 'captured');
  assert.equal(subtitleObservation.responseUrl.includes('?'), false);
  assert.equal(subtitleObservation.body.artifactKind, 'bilibili_public_subtitle_document');
  assert.equal(subtitleObservation.body.language, 'zh-CN');
  assert.equal(subtitleObservation.body.sourceSegmentCount, 3);
  assert.equal(subtitleObservation.body.storedSegmentCount, 2);
  assert.equal(subtitleObservation.body.droppedSegmentCount, 1);
  assert.equal(subtitleObservation.body.partial, true);
  assert.equal(subtitleObservation.body.segments[0].segmentId, 1);
  assert.equal(subtitleObservation.body.segments[0].content, '第一句公开字幕');
  assert.equal(JSON.stringify(subtitleObservation.body).includes('unknown_account_field'), false);

  assert.equal(capture.sanitiseNetworkCaptureObservation(subtitleObservation), null);
  const resanitised = capture.sanitiseNetworkCaptureObservation({
    ...subtitleObservation,
    body: { ...subtitleObservation.body, injected: 'must-not-survive' }
  }, routeIds);
  assert.equal(resanitised.status, 'captured');
  assert.equal(JSON.stringify(resanitised.body).includes('must-not-survive'), false);
  assert.equal(resanitised.body.segments.length, 2);

  const oversized = capture.createNetworkCaptureFromText({
    platform: 'bilibili',
    route: directoryRoute,
    method: 'GET',
    responseUrl: directoryUrl,
    contentType: 'application/json',
    httpStatus: 200
  }, JSON.stringify({ data: { subtitle: { subtitles: [] } }, padding: 'x'.repeat(130 * 1024) }));
  assert.equal(oversized.status, 'payload_rejected');
  assert.equal(oversized.rejectionReason, 'payload_too_large');

  console.log(JSON.stringify({
    ok: true,
    gate: 'bilibili-transcript-research-projector',
    platformRequests: 0,
    productionRouteCount: capture.approvedNetworkCaptureRouteIds('bilibili').length,
    researchRouteCount: routeIds.length,
    directoryFieldsWhitelisted: true,
    publicSubtitleSegmentsPreserved: 2,
    gatewayOwnedCompletionProtocolValidated: true,
    observedDocumentTrackingQueryCanonicalized: true,
    queryValuesDiscarded: true,
    unknownAndSensitiveFieldsDiscarded: true,
    forgedResearchObservationRejectedWithoutArm: true
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
