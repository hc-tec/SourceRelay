import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-transcript-control-loop-'));
const bundlePath = join(temporaryDirectory, 'transcript-control-loop.mjs');
const runId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const canonicalUrl = 'https://www.bilibili.com/video/BV1qZSLBYEpa';

const interaction = {
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
};

function snapshot(state) {
  const isTerminal = state === 'completed' || state === 'inconclusive' || state === 'failed';
  return {
    schemaVersion: 1,
    collectorVersion: '0.4.19',
    runId,
    profileId,
    platform: 'bilibili',
    accountCategory: 'user_managed',
    evidenceObjective: 'transcript_read',
    strategy: { strategyId: 'bilibili.video.transcript.response.v1', version: '1.0.0' },
    targetUrlDigest: 'a'.repeat(64),
    navigationUrlDigest: 'a'.repeat(64),
    windowId: 1,
    tabId: 2,
    state,
    terminalStatus: state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : null,
    errorCode: null,
    startedAt: '2026-07-19T00:00:00.000Z',
    expiresAt: '2026-07-19T00:00:45.000Z',
    completedAt: isTerminal ? '2026-07-19T00:00:04.000Z' : null,
    interaction: state === 'completed' ? interaction : null,
    captures: [],
    safeguards: {
      admissionEligible: false,
      productionResponseRoutes: 'unchanged_empty'
    }
  };
}

try {
  await build({
    entryPoints: [fileURLToPath(new URL('../src/transcript-control-loop.ts', import.meta.url))],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  });
  const { runTranscriptValidationControlLoop, transcriptValidationSnapshot } =
    await import(pathToFileURL(bundlePath).href);

  let starts = 0;
  let reads = 0;
  let interactions = 0;
  let completions = 0;
  const completed = await runTranscriptValidationControlLoop({
    runId,
    profileId,
    canonicalUrl,
    extensionVersion: '0.4.19',
    pollingDelayMs: 0,
    executeInteraction: async () => {
      interactions += 1;
      return interaction;
    },
    sendMessage: async (message) => {
      if (message.type === 'collector.startTranscriptCapabilityValidation') {
        starts += 1;
        return { ok: true, validation: snapshot('navigating') };
      }
      if (message.type === 'collector.completeTranscriptCapabilityValidation') {
        completions += 1;
        assert.deepEqual(message.result, interaction);
        return { ok: true, validation: snapshot('completed') };
      }
      reads += 1;
      return { ok: true, validation: snapshot('collecting') };
    }
  });
  assert.equal(completed.state, 'completed');
  assert.equal(starts, 1);
  assert.equal(reads, 1);
  assert.equal(interactions, 1);
  assert.equal(completions, 1);

  starts = 0;
  reads = 0;
  interactions = 0;
  completions = 0;
  const recoveredStart = await runTranscriptValidationControlLoop({
    runId,
    profileId,
    canonicalUrl,
    extensionVersion: '0.4.19',
    pollingDelayMs: 0,
    executeInteraction: async () => {
      interactions += 1;
      return interaction;
    },
    sendMessage: async (message) => {
      if (message.type === 'collector.startTranscriptCapabilityValidation') {
        starts += 1;
        throw new Error('local_start_response_lost');
      }
      if (message.type === 'collector.completeTranscriptCapabilityValidation') {
        completions += 1;
        return { ok: true, validation: snapshot('completed') };
      }
      reads += 1;
      return { ok: true, validation: snapshot('collecting') };
    }
  });
  assert.equal(recoveredStart.state, 'completed');
  assert.equal(starts, 1, 'a lost local start response must never repeat the platform-starting message');
  assert.equal(reads, 1);
  assert.equal(interactions, 1);
  assert.equal(completions, 1);

  starts = 0;
  reads = 0;
  interactions = 0;
  completions = 0;
  const recoveredCompletion = await runTranscriptValidationControlLoop({
    runId,
    profileId,
    canonicalUrl,
    extensionVersion: '0.4.19',
    pollingDelayMs: 0,
    executeInteraction: async () => {
      interactions += 1;
      return interaction;
    },
    sendMessage: async (message) => {
      if (message.type === 'collector.startTranscriptCapabilityValidation') {
        starts += 1;
        return { ok: true, validation: snapshot('collecting') };
      }
      if (message.type === 'collector.completeTranscriptCapabilityValidation') {
        completions += 1;
        throw new Error('local_completion_response_lost');
      }
      reads += 1;
      return { ok: true, validation: snapshot('completed') };
    }
  });
  assert.equal(recoveredCompletion.state, 'completed');
  assert.equal(starts, 1);
  assert.equal(interactions, 1, 'a lost completion response must never repeat browser interaction');
  assert.equal(completions, 1, 'a lost completion response must never repeat completion delivery');
  assert.equal(reads, 1);

  assert.throws(
    () => transcriptValidationSnapshot({
      ok: true,
      validation: { ...snapshot('completed'), collectorVersion: 'stale' }
    }, runId, profileId, '0.4.19'),
    (error) => error instanceof Error && error.message === 'transcript_validation_extension_version_mismatch'
  );

  let timeoutInteractions = 0;
  await assert.rejects(
    () => runTranscriptValidationControlLoop({
      runId,
      profileId,
      canonicalUrl,
      extensionVersion: '0.4.19',
      pollingDelayMs: 0,
      maximumPollAttempts: 1,
      executeInteraction: async () => {
        timeoutInteractions += 1;
        return interaction;
      },
      sendMessage: async () => ({ ok: true, validation: snapshot('navigating') })
    }),
    (error) => error instanceof Error && error.message === 'transcript_validation_gateway_wait_timed_out'
  );
  assert.equal(timeoutInteractions, 0, 'browser interaction must wait for exact document binding');

  console.log(JSON.stringify({
    ok: true,
    gate: 'gateway-transcript-extension-control-loop',
    platformRequests: 0,
    startMessageCount: 1,
    interactionExecutionCount: 1,
    completionMessageCount: 1,
    lostStartResponseRecoveredByLocalRead: true,
    lostCompletionResponseRecoveredByLocalRead: true,
    browserInteractionRetried: false,
    completionRetried: false,
    versionAndSafeguardValidation: true,
    documentBindingRequiredBeforeInteraction: true
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
