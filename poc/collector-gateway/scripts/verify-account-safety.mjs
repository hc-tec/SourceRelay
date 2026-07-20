import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  const readyAfterRun = await registry.finishAuthenticatedRun(
    profileId,
    'bilibili',
    permit.runId,
    'interaction_risk_network_unstable',
    new Date(baseTime.getTime() + 4_000)
  );
  assert.equal(readyAfterRun.state, 'ready');
  assert.equal(readyAfterRun.schemaVersion, 2);
  assert.equal(readyAfterRun.manualUnlockRequired, false);
  assert.equal(readyAfterRun.reasonCode, 'interaction_risk_network_unstable');
  assert.equal('cooldownUntil' in readyAfterRun, false);
  const persistedAfterRun = await readFile(join(temporaryDirectory, 'account-safety.json'), 'utf8');
  assert.equal(persistedAfterRun.includes('cooldownUntil'), false);

  const articleInventoryPermit = await registry.beginAuthenticatedRun(
    profileId,
    'bilibili',
    'authenticated_article_inventory_reconnaissance',
    new Date(baseTime.getTime() + 5_000)
  );
  await registry.finishAuthenticatedRun(
    profileId,
    'bilibili',
    articleInventoryPermit.runId,
    'article_inventory_completed',
    new Date(baseTime.getTime() + 6_000)
  );
  const seriesDetailPermit = await registry.beginAuthenticatedRun(
    profileId,
    'bilibili',
    'authenticated_series_detail_reconnaissance',
    new Date(baseTime.getTime() + 7_000)
  );
  await registry.finishAuthenticatedRun(
    profileId,
    'bilibili',
    seriesDetailPermit.runId,
    'series_detail_completed',
    new Date(baseTime.getTime() + 8_000)
  );
  const articleDetailPermit = await registry.beginAuthenticatedRun(
    profileId,
    'bilibili',
    'authenticated_article_detail_reconnaissance',
    new Date(baseTime.getTime() + 9_000)
  );
  await registry.finishAuthenticatedRun(
    profileId,
    'bilibili',
    articleDetailPermit.runId,
    'article_detail_completed',
    new Date(baseTime.getTime() + 10_000)
  );
  const dynamicPermit = await registry.beginAuthenticatedRun(
    profileId,
    'bilibili',
    'authenticated_dynamic_reconnaissance',
    new Date(baseTime.getTime() + 11_000)
  );
  assert.match(dynamicPermit.runId, /^[0-9a-f-]{36}$/i);

  const afterInterruptedRestart = await AccountSafetyRegistry.create(
    temporaryDirectory,
    new Date(baseTime.getTime() + 12_000)
  );
  const interrupted = afterInterruptedRestart.get(profileId, 'bilibili');
  assert.equal(interrupted.state, 'locked');
  assert.equal(interrupted.reasonCode, 'previous_run_interrupted_manual_review_required');
  assert.equal(interrupted.manualUnlockRequired, true);
  assert.equal(interrupted.activeRun, null);

  const legacyDirectory = join(temporaryDirectory, 'legacy-cooldown');
  await mkdir(legacyDirectory, { recursive: true });
  await writeFile(join(legacyDirectory, 'account-safety.json'), JSON.stringify([{
    schemaVersion: 1,
    profileId,
    platform: 'bilibili',
    state: 'cooldown',
    reasonCode: 'legacy_completed_cooldown',
    manualUnlockRequired: false,
    cooldownUntil: new Date(baseTime.getTime() + 30 * 60 * 1_000).toISOString(),
    activeRun: null,
    lastRunAt: baseTime.toISOString(),
    updatedAt: baseTime.toISOString()
  }]), 'utf8');
  const migratedRegistry = await AccountSafetyRegistry.create(
    legacyDirectory,
    new Date(baseTime.getTime() + 7_000)
  );
  const migrated = migratedRegistry.get(profileId, 'bilibili');
  assert.equal(migrated.state, 'ready');
  assert.equal(migrated.schemaVersion, 2);
  assert.equal('cooldownUntil' in migrated, false);
  assert.equal((await readFile(join(legacyDirectory, 'account-safety.json'), 'utf8')).includes('cooldownUntil'), false);

  const legacyLockedDirectory = join(temporaryDirectory, 'legacy-locked');
  await mkdir(legacyLockedDirectory, { recursive: true });
  await writeFile(join(legacyLockedDirectory, 'account-safety.json'), JSON.stringify([{
    schemaVersion: 1,
    profileId,
    platform: 'bilibili',
    state: 'locked',
    reasonCode: 'user_safety_pause',
    manualUnlockRequired: true,
    cooldownUntil: null,
    activeRun: null,
    lastRunAt: baseTime.toISOString(),
    updatedAt: baseTime.toISOString()
  }]), 'utf8');
  const migratedLockedRegistry = await AccountSafetyRegistry.create(
    legacyLockedDirectory,
    new Date(baseTime.getTime() + 8_000)
  );
  const migratedLocked = migratedLockedRegistry.get(profileId, 'bilibili');
  assert.equal(migratedLocked.state, 'locked');
  assert.equal(migratedLocked.schemaVersion, 2);
  assert.equal(migratedLocked.manualUnlockRequired, true);
  assert.equal(migratedLocked.reasonCode, 'user_safety_pause');
  assert.equal('cooldownUntil' in migratedLocked, false);

  console.log(JSON.stringify({
    ok: true,
    gate: 'account-safety-offline-state-machine',
    platformRequests: 0,
    verified: [
      'manual_pause_lock',
      'typed_unlock_acknowledgement',
      'at_most_once_action',
      'normal_finish_returns_ready_without_cooldown',
      'legacy_cooldown_migrates_to_ready',
      'legacy_locked_state_remains_locked',
      'series_article_and_dynamic_purposes_persist',
      'interrupted_dynamic_run_restart_lock'
    ]
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
