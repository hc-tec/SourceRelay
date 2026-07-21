import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { AccountSafetyRegistry, accountSafetyUnlockInput } from '../src/account-safety.js';

const profileId = '11111111-1111-4111-8111-111111111111';
const stateDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(stateDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createRegistry(at: string): Promise<{ registry: AccountSafetyRegistry; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'collector-account-safety-unit-'));
  stateDirectories.push(directory);
  return { registry: await AccountSafetyRegistry.create(directory, new Date(at)), directory };
}

describe('Account safety state machine', () => {
  test('persists an interrupted action as a manual-review lock across restart', async () => {
    const { registry, directory } = await createRegistry('2026-07-21T00:00:00.000Z');
    const permit = await registry.beginAuthenticatedRun(
      profileId,
      'bilibili',
      'authenticated_account_video_page_two_reconnaissance',
      new Date('2026-07-21T00:00:01.000Z')
    );
    await registry.recordActionAttempt(
      profileId,
      'bilibili',
      permit.runId,
      'navigate_account_inventory',
      new Date('2026-07-21T00:00:02.000Z')
    );
    await expect(registry.recordActionAttempt(
      profileId,
      'bilibili',
      permit.runId,
      'navigate_account_inventory',
      new Date('2026-07-21T00:00:03.000Z')
    )).rejects.toThrow('account_safety_action_already_attempted');

    const restarted = await AccountSafetyRegistry.create(directory, new Date('2026-07-21T00:01:00.000Z'));
    expect(restarted.get(profileId, 'bilibili')).toMatchObject({
      state: 'locked',
      reasonCode: 'previous_run_interrupted_manual_review_required',
      manualUnlockRequired: true,
      activeRun: null
    });
    await expect(restarted.beginAuthenticatedRun(profileId, 'bilibili')).rejects.toThrow(
      'account_safety_manual_unlock_required'
    );
  });

  test('requires the fixed acknowledgement before a locked profile becomes ready', async () => {
    const { registry } = await createRegistry('2026-07-21T00:00:00.000Z');
    await registry.pause(profileId, 'bilibili', 'user_safety_pause', new Date('2026-07-21T00:00:01.000Z'));

    expect(() => accountSafetyUnlockInput({ acknowledgement: 'anything_else' })).toThrow(
      'account_safety_unlock_acknowledgement_required'
    );
    const acknowledgement = accountSafetyUnlockInput({ acknowledgement: 'resume_authenticated_platform_actions' });
    const unlocked = await registry.unlock(profileId, 'bilibili', acknowledgement, new Date('2026-07-21T00:00:02.000Z'));
    expect(unlocked).toMatchObject({ state: 'ready', manualUnlockRequired: false, reasonCode: null });
  });

  test('locks hard platform failure but returns a normal completion directly to ready', async () => {
    const { registry } = await createRegistry('2026-07-21T00:00:00.000Z');
    const normal = await registry.beginAuthenticatedRun(profileId, 'bilibili', 'authenticated_interaction_reconnaissance');
    const completed = await registry.finishAuthenticatedRun(
      profileId,
      'bilibili',
      normal.runId,
      'completed',
      new Date('2026-07-21T00:00:01.000Z')
    );
    expect(completed).toMatchObject({ state: 'ready', manualUnlockRequired: false, reasonCode: 'completed' });

    const risky = await registry.beginAuthenticatedRun(profileId, 'bilibili', 'authenticated_interaction_reconnaissance');
    const locked = await registry.finishAuthenticatedRun(
      profileId,
      'bilibili',
      risky.runId,
      'verification_required',
      new Date('2026-07-21T00:00:02.000Z')
    );
    expect(locked).toMatchObject({ state: 'locked', manualUnlockRequired: true, reasonCode: 'verification_required' });
  });

  test('keeps action budgets and locks isolated to one profile-platform pair', async () => {
    const { registry } = await createRegistry('2026-07-21T00:00:00.000Z');
    const permit = await registry.beginAuthenticatedRun(
      profileId,
      'bilibili',
      'authenticated_interaction_reconnaissance',
      new Date('2026-07-21T00:00:01.000Z')
    );
    for (let index = 0; index < 20; index += 1) {
      await registry.recordActionAttempt(
        profileId,
        'bilibili',
        permit.runId,
        `bounded_action_${index}`,
        new Date(`2026-07-21T00:00:${String(index + 2).padStart(2, '0')}.000Z`)
      );
    }
    await expect(registry.recordActionAttempt(
      profileId,
      'bilibili',
      permit.runId,
      'action_after_budget',
      new Date('2026-07-21T00:01:00.000Z')
    )).rejects.toThrow('account_safety_action_budget_exceeded');

    await registry.finishAuthenticatedRun(
      profileId,
      'bilibili',
      permit.runId,
      'completed',
      new Date('2026-07-21T00:01:01.000Z')
    );
    await registry.pause(profileId, 'bilibili', 'user_safety_pause', new Date('2026-07-21T00:01:02.000Z'));
    await expect(registry.assertPlatformNavigationAllowed(profileId, 'bilibili')).rejects.toThrow(
      'account_safety_manual_unlock_required'
    );
    await expect(registry.assertPlatformNavigationAllowed(profileId, 'zhihu')).resolves.toBeUndefined();
  });
});
