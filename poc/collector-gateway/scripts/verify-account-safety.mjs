import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-account-safety-'));
const bundledModule = join(temporaryDirectory, 'account-safety.mjs');
const profileId = '11111111-1111-4111-8111-111111111111';
const baseTime = new Date('2026-07-19T00:00:00.000Z');

async function rejectsCode(operation, code) {
  await assert.rejects(operation, (error) => error instanceof Error && error.message === code);
}

try {
  await build({
    entryPoints: [new URL('../src/account-safety.ts', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (match) => match.slice(1))],
    outfile: bundledModule,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  });
  const {
    AccountSafetyRegistry,
    accountSafetyUnlockInput
  } = await import(`${pathToFileURL(bundledModule).href}?v=${Date.now()}`);

  const registry = await AccountSafetyRegistry.create(temporaryDirectory, baseTime);
  assert.equal(registry.get(profileId, 'bilibili', baseTime).state, 'ready');

  const paused = await registry.pause(profileId, 'bilibili', 'user_safety_pause', baseTime);
  assert.equal(paused.state, 'locked');
  assert.equal(paused.manualUnlockRequired, true);
  await rejectsCode(
    () => registry.beginAuthenticatedRun(profileId, 'bilibili', 'authenticated_interaction_reconnaissance', baseTime),
    'account_safety_manual_unlock_required'
  );

  assert.throws(
    () => accountSafetyUnlockInput({ acknowledgement: 'yes' }),
    (error) => error instanceof Error && error.message === 'account_safety_unlock_acknowledgement_required'
  );
  const unlockInput = accountSafetyUnlockInput({
    acknowledgement: 'resume_authenticated_platform_actions'
  });
  const unlocked = await registry.unlock(profileId, 'bilibili', unlockInput, baseTime);
  assert.equal(unlocked.state, 'ready');

  const permit = await registry.beginAuthenticatedRun(
    profileId,
    'bilibili',
    'authenticated_interaction_reconnaissance',
    new Date(baseTime.getTime() + 1_000)
  );
  await registry.recordActionAttempt(
    profileId,
    'bilibili',
    permit.runId,
    'open_caption_menu',
    new Date(baseTime.getTime() + 2_000)
  );
  await rejectsCode(
    () => registry.recordActionAttempt(
      profileId,
      'bilibili',
      permit.runId,
      'open_caption_menu',
      new Date(baseTime.getTime() + 3_000)
    ),
    'account_safety_action_already_attempted'
  );

  const cooldown = await registry.finishAuthenticatedRun(
    profileId,
    'bilibili',
    permit.runId,
    'interaction_risk_network_unstable',
    new Date(baseTime.getTime() + 4_000)
  );
  assert.equal(cooldown.state, 'cooldown');
  assert.equal(cooldown.manualUnlockRequired, false);
  await rejectsCode(
    () => registry.beginAuthenticatedRun(
      profileId,
      'bilibili',
      'authenticated_interaction_reconnaissance',
      new Date(baseTime.getTime() + 5_000)
    ),
    'account_safety_cooldown_active'
  );

  const laterPermit = await registry.beginAuthenticatedRun(
    profileId,
    'bilibili',
    'authenticated_interaction_reconnaissance',
    new Date(baseTime.getTime() + 31 * 60 * 1_000)
  );
  assert.match(laterPermit.runId, /^[0-9a-f-]{36}$/i);

  const afterInterruptedRestart = await AccountSafetyRegistry.create(
    temporaryDirectory,
    new Date(baseTime.getTime() + 32 * 60 * 1_000)
  );
  const interrupted = afterInterruptedRestart.get(profileId, 'bilibili');
  assert.equal(interrupted.state, 'locked');
  assert.equal(interrupted.reasonCode, 'previous_run_interrupted_manual_review_required');
  assert.equal(interrupted.manualUnlockRequired, true);
  assert.equal(interrupted.activeRun, null);

  console.log(JSON.stringify({
    ok: true,
    gate: 'account-safety-offline-state-machine',
    platformRequests: 0,
    verified: [
      'manual_pause_lock',
      'typed_unlock_acknowledgement',
      'at_most_once_action',
      'network_failure_cooldown',
      'interrupted_run_restart_lock'
    ]
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
