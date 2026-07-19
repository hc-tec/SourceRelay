import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-interaction-reconnaissance-'));
const runnerModulePath = join(temporaryDirectory, 'interaction-reconnaissance.mjs');
const registryModulePath = join(temporaryDirectory, 'interaction-reconnaissance-registry.mjs');
const sourcePath = (relativePath) => new URL(relativePath, import.meta.url).pathname
  .replace(/^\/(?:[A-Za-z]:)/, (match) => match.slice(1));

try {
  await Promise.all([
    build({
      entryPoints: [sourcePath('../src/interaction-reconnaissance.ts')],
      outfile: runnerModulePath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    }),
    build({
      entryPoints: [sourcePath('../src/interaction-reconnaissance-registry.ts')],
      outfile: registryModulePath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    })
  ]);

  const runner = await import(pathToFileURL(runnerModulePath).href);
  const { InteractionReconnaissanceRegistry } = await import(pathToFileURL(registryModulePath).href);

  assert.equal(runner.captionMenuReadyFromLabels(['字幕']), false);
  assert.equal(runner.captionMenuReadyFromLabels(['字幕', '中文']), true);
  assert.equal(runner.captionMenuReadyFromLabels(['字幕设置']), true);
  assert.equal(runner.interactionOutcomeWasAttempted('postcondition_unmet'), true);
  assert.equal(runner.interactionOutcomeWasAttempted('prerequisite_unmet'), false);
  assert.equal(runner.interactionOutcomeWasAttempted('option_unavailable'), false);

  const partialActions = [
    { action: 'open_caption_menu', outcome: 'completed' },
    { action: 'select_caption_language', outcome: 'prerequisite_unmet' }
  ];
  assert.deepEqual(runner.interactionObjectiveAssessment('subtitle', partialActions), {
    scope: 'subtitle',
    status: 'partial',
    requiredActions: ['open_caption_menu', 'select_caption_language'],
    completedActions: ['open_caption_menu']
  });
  assert.equal(runner.interactionObjectiveAssessment('subtitle', [
    { action: 'open_caption_menu', outcome: 'postcondition_unmet' },
    { action: 'select_caption_language', outcome: 'prerequisite_unmet' }
  ]).status, 'not_satisfied');
  assert.equal(runner.interactionObjectiveAssessment('subtitle', [
    { action: 'open_caption_menu', outcome: 'completed' },
    { action: 'select_caption_language', outcome: 'completed' }
  ]).status, 'satisfied');

  assert.deepEqual(runner.bilibiliInteractionReconnaissanceInput({
    canonicalUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa/',
    actionScope: 'subtitle',
    responseBodyMapping: 'schema_only'
  }), {
    canonicalUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
    actionScope: 'subtitle',
    responseBodyMapping: 'schema_only'
  });
  assert.throws(
    () => runner.bilibiliInteractionReconnaissanceInput({
      canonicalUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa/?credential=forbidden'
    }),
    /interaction_reconnaissance_url_invalid/
  );

  const stateDirectory = join(temporaryDirectory, 'state');
  const registry = await InteractionReconnaissanceRegistry.create(stateDirectory);
  const record = {
    schemaVersion: 1,
    recordId: '11111111-1111-4111-8111-111111111111',
    runId: '22222222-2222-4222-8222-222222222222',
    collectorVersion: '0.4.19',
    profileId: '33333333-3333-4333-8333-333333333333',
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'video_detail',
    targetUrlDigest: 'a'.repeat(64),
    actionScope: 'subtitle',
    objective: runner.interactionObjectiveAssessment('subtitle', partialActions),
    state: 'inconclusive',
    errorCode: null,
    startedAt: '2026-07-19T00:00:00.000Z',
    completedAt: '2026-07-19T00:00:10.000Z',
    baseline: {
      captionControlVisible: true,
      commentsHostPresent: false,
      routeSummary: []
    },
    actions: [
      {
        action: 'open_caption_menu',
        attempted: true,
        outcome: 'completed',
        errorCode: null,
        dom: {
          captionControlVisible: true,
          captionMenuReady: true,
          visibleCaptionLabels: ['字幕', '中文'],
          rawVisibleText: 'must-not-persist'
        },
        network: []
      },
      {
        action: 'select_caption_language',
        attempted: false,
        outcome: 'prerequisite_unmet',
        errorCode: null,
        dom: { prerequisite: 'caption_menu_ready', captionMenuReady: false },
        network: []
      }
    ],
    responseBodyMappings: [{
      phase: 'navigation_baseline',
      origin: 'https://api.bilibili.com',
      pathname: '/x/player/wbi/v2',
      httpStatus: 200,
      mimeType: 'application/json',
      bodyBytes: 128,
      bodySha256: 'b'.repeat(64),
      contentKind: 'json',
      schemaPaths: [
        { path: '$', type: 'object' },
        { path: '$.data.subtitle', type: 'object' }
      ],
      sensitiveFieldPathsOmitted: 1
    }],
    counters: {
      networkObservations: 1,
      networkObservationsDroppedByLimit: 0,
      failedXhrFetchRequests: 0
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      observationMode: 'authenticated_bounded_interaction_network_metadata',
      productionResponseRoutes: 'unchanged_empty',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      responseHeaders: 'mime_and_content_length_only',
      responseBody: 'schema_only_explicit_research_allowlist',
      cookiesAndTokens: 'not_read',
      queryAndFragmentValues: 'discarded',
      actionTailMs: 3_000,
      maximumSemanticActions: 5,
      runDeadlineMs: 60_000,
      semanticActionDelivery: 'at_most_once',
      captchaAndRiskControl: 'stop_and_persist_lock',
      networkFailure: 'stop_without_action_retry',
      observedTargetPages: 'closed_after_reconnaissance',
      captionMenuReadyTimeoutMs: 2_500,
      admissionEligible: false
    }
  };

  const persisted = await registry.record(record);
  assert.equal('profileId' in persisted, false);
  assert.equal('rawVisibleText' in persisted.actions[0].dom, false);
  assert.equal(persisted.responseBodyMappings[0].schemaPaths.length, 2);

  const duplicate = await registry.record(record);
  assert.equal(duplicate.recordId, persisted.recordId);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.list()[0].responseBodyMappings[0].schemaPathCount, 2);
  assert.equal('schemaPaths' in registry.list()[0].responseBodyMappings[0], false);

  const registryText = await readFile(join(stateDirectory, 'interaction-reconnaissance-runs.json'), 'utf8');
  assert.equal(registryText.includes('profileId'), false);
  assert.equal(registryText.includes('must-not-persist'), false);
  assert.equal(registryText.includes('rawVisibleText'), false);
  assert.equal(registryText.includes('$.data.subtitle'), true);

  const recovered = await InteractionReconnaissanceRegistry.create(stateDirectory);
  assert.equal(recovered.list().length, 1);
  assert.equal(recovered.get(record.recordId)?.responseBodyMappings[0].schemaPaths.length, 2);

  console.log(JSON.stringify({
    ok: true,
    gate: 'interaction-reconnaissance-offline-contract',
    platformRequests: 0,
    verified: [
      'caption_menu_bounded_postcondition',
      'prerequisite_skip_is_not_attempted',
      'scope_objective_controls_run_success',
      'atomic_safe_artifact_persistence',
      'profile_id_and_unknown_dom_fields_omitted',
      'compact_list_and_full_detail_views'
    ]
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
