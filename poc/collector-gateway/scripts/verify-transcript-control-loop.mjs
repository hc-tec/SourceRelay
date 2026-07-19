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

function snapshot(state) {
  return {
    schemaVersion: 1,
    collectorVersion: '0.4.17',
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
    terminalStatus: state === 'completed' ? 'completed' : null,
    errorCode: null,
    startedAt: '2026-07-19T00:00:00.000Z',
    expiresAt: '2026-07-19T00:00:45.000Z',
    completedAt: state === 'completed' ? '2026-07-19T00:00:04.000Z' : null,
    interaction: null,
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
  const completed = await runTranscriptValidationControlLoop({
    runId,
    profileId,
    canonicalUrl,
    extensionVersion: '0.4.17',
    pollingDelayMs: 0,
    sendMessage: async (message) => {
      if (message.type === 'collector.startTranscriptCapabilityValidation') {
        starts += 1;
        return { ok: true, validation: snapshot('navigating') };
      }
      reads += 1;
      return { ok: true, validation: snapshot(reads >= 2 ? 'completed' : 'collecting') };
    }
  });
  assert.equal(completed.state, 'completed');
  assert.equal(starts, 1);
  assert.equal(reads, 2);

  starts = 0;
  reads = 0;
  const recovered = await runTranscriptValidationControlLoop({
    runId,
    profileId,
    canonicalUrl,
    extensionVersion: '0.4.17',
    pollingDelayMs: 0,
    sendMessage: async (message) => {
      if (message.type === 'collector.startTranscriptCapabilityValidation') {
        starts += 1;
        throw new Error('local_start_response_lost');
      }
      reads += 1;
      return { ok: true, validation: snapshot('completed') };
    }
  });
  assert.equal(recovered.state, 'completed');
  assert.equal(starts, 1, 'a lost local response must never repeat the platform-starting message');
  assert.equal(reads, 1);

  assert.throws(
    () => transcriptValidationSnapshot({
      ok: true,
      validation: { ...snapshot('completed'), collectorVersion: 'stale' }
    }, runId, profileId, '0.4.17'),
    (error) => error instanceof Error && error.message === 'transcript_validation_extension_version_mismatch'
  );
  await assert.rejects(
    () => runTranscriptValidationControlLoop({
      runId,
      profileId,
      canonicalUrl,
      extensionVersion: '0.4.17',
      pollingDelayMs: 0,
      maximumPollAttempts: 1,
      sendMessage: async () => ({ ok: true, validation: snapshot('navigating') })
    }),
    (error) => error instanceof Error && error.message === 'transcript_validation_gateway_wait_timed_out'
  );

  console.log(JSON.stringify({
    ok: true,
    gate: 'gateway-transcript-extension-control-loop',
    platformRequests: 0,
    startMessageCount: 1,
    lostResponseRecoveredByLocalRead: true,
    platformStartRetried: false,
    versionAndSafeguardValidation: true,
    boundedPollingTimeout: true
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
