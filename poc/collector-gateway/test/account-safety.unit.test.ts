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
  test('recovers an interrupted action to ready across restart', async () => {
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
      state: 'ready',
      reasonCode: 'previous_run_interrupted',
      manualUnlockRequired: false,
      activeRun: null
    });
    await expect(restarted.beginAuthenticatedRun(profileId, 'bilibili')).resolves.toMatchObject({
      profileId,
      platform: 'bilibili'
    });
  });

  test('does not require an acknowledgement and keeps pause non-blocking', async () => {
    const { registry } = await createRegistry('2026-07-21T00:00:00.000Z');
    await registry.pause(profileId, 'bilibili', 'user_safety_pause', new Date('2026-07-21T00:00:01.000Z'));

    expect(registry.get(profileId, 'bilibili')).toMatchObject({
      state: 'ready',
      reasonCode: 'user_safety_pause',
      manualUnlockRequired: false
    });
    const acknowledgement = accountSafetyUnlockInput({});
    const unlocked = await registry.unlock(profileId, 'bilibili', acknowledgement, new Date('2026-07-21T00:00:02.000Z'));
    expect(unlocked).toMatchObject({ state: 'ready', manualUnlockRequired: false, reasonCode: null });
  });

  test('records hard platform failure without locking and returns completion to ready', async () => {
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
    const finished = await registry.finishAuthenticatedRun(
      profileId,
      'bilibili',
      risky.runId,
      'verification_required',
      new Date('2026-07-21T00:00:02.000Z')
    );
    expect(finished).toMatchObject({
      state: 'ready',
      manualUnlockRequired: false,
      reasonCode: 'verification_required'
    });
  });

  test('records an invalid browser action response without locking', async () => {
    const { registry } = await createRegistry('2026-07-22T00:00:00.000Z');
    const permit = await registry.beginAuthenticatedRun(
      profileId,
      'bilibili',
      'authenticated_account_video_pagination_reconnaissance'
    );
    await registry.recordActionAttempt(profileId, 'bilibili', permit.runId, 'advance_account_video_page_2');
    const finished = await registry.finishAuthenticatedRun(
      profileId,
      'bilibili',
      permit.runId,
      'browser_host_bilibili_page_click_response_invalid'
    );
    expect(finished).toMatchObject({
      state: 'ready',
      manualUnlockRequired: false,
      reasonCode: 'browser_host_bilibili_page_click_response_invalid'
    });
  });

  test('does not hard-lock a profile for a run timeout after all platform actions completed', async () => {
    const { registry } = await createRegistry('2026-07-22T00:00:00.000Z');
    const permit = await registry.beginAuthenticatedRun(profileId, 'bilibili');
    const completed = await registry.finishAuthenticatedRun(
      profileId,
      'bilibili',
      permit.runId,
      'run_deadline_exceeded',
      new Date('2026-07-22T00:00:01.000Z'),
      false
    );
    expect(completed).toMatchObject({ state: 'ready', manualUnlockRequired: false });
  });

  test('keeps reserved action intent separate from trusted platform input', async () => {
    const { registry } = await createRegistry('2026-07-22T00:00:00.000Z');
    const permit = await registry.beginAuthenticatedRun(profileId, 'bilibili');
    const reserved = await registry.recordActionAttempt(
      profileId,
      'bilibili',
      permit.runId,
      'scroll_comments_once'
    );
    expect(reserved.activeRun).toMatchObject({
      attemptedActionIds: ['scroll_comments_once'],
      platformActionIds: []
    });

    const afterHostInput = await registry.recordPlatformActionAttempt(
      profileId,
      'bilibili',
      permit.runId,
      'scroll_comments_once'
    );
    expect(afterHostInput.activeRun).toMatchObject({
      attemptedActionIds: ['scroll_comments_once'],
      platformActionIds: ['scroll_comments_once']
    });
    await expect(registry.recordPlatformActionAttempt(
      profileId,
      'bilibili',
      permit.runId,
      'scroll_comments_once'
    )).rejects.toThrow('account_safety_platform_action_already_recorded');
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
    await expect(registry.assertPlatformNavigationAllowed(profileId, 'bilibili')).resolves.toBeUndefined();
    await expect(registry.assertPlatformNavigationAllowed(profileId, 'zhihu')).resolves.toBeUndefined();
  });
});
