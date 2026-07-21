import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvidencePlan, GatewayPreflightSubmission } from '../../collector-extension/src/shared/control-plane.js';
import type { BrowserProfileBinding } from '../../collector-extension/src/shared/collection-contracts.js';
import { afterEach, describe, expect, test } from 'vitest';
import { AccountSafetyRegistry } from '../src/account-safety.js';
import type { GatewayEvidenceRegistry } from '../src/evidence.js';
import type { LoadedGatewayIdentity } from '../src/identity.js';
import { GatewayTaskQueue, bilibiliDetailTaskInput, scoutTaskInput } from '../src/tasks.js';

const temporaryDirectories: string[] = [];
const profileId = '11111111-1111-4111-8111-111111111111';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function accountSafety(): Promise<AccountSafetyRegistry> {
  const directory = await mkdtemp(join(tmpdir(), 'collector-task-inputs-unit-'));
  temporaryDirectories.push(directory);
  return AccountSafetyRegistry.create(directory, new Date('2026-07-22T00:00:00.000Z'));
}

const profileBinding: BrowserProfileBinding = {
  profileId,
  kind: 'collection',
  platform: 'bilibili',
  account: { category: 'user_managed', label: 'Unit test collection profile' }
};

describe('Gateway task input contracts', () => {
  test('normalises a bounded scout request and rejects duplicate or unbound platforms', () => {
    expect(scoutTaskInput({
      researchQuestion: '  What changed? ',
      decisionContext: '  Decision context ',
      query: '  collector test ',
      platforms: ['bilibili'],
      profileIds: { bilibili: profileId }
    })).toEqual({
      researchQuestion: 'What changed?',
      decisionContext: 'Decision context',
      query: 'collector test',
      platforms: ['bilibili'],
      profileIds: { bilibili: profileId }
    });
    expect(() => scoutTaskInput({
      researchQuestion: 'question',
      decisionContext: 'context',
      query: 'query',
      platforms: ['bilibili', 'bilibili'],
      profileIds: { bilibili: profileId }
    })).toThrow('task_platforms_invalid');
    expect(() => scoutTaskInput({
      researchQuestion: 'question',
      decisionContext: 'context',
      query: 'query',
      platforms: ['bilibili'],
      profileIds: { zhihu: profileId }
    })).toThrow('task_profile_bindings_invalid');
  });

  test('sorts explicit deep-dive ranks and rejects undeclared input fields', () => {
    expect(bilibiliDetailTaskInput({
      researchQuestion: 'detail',
      decisionContext: 'context',
      sourceTaskId: '22222222-2222-4222-8222-222222222222',
      sourceEvidenceBatchId: '33333333-3333-4333-8333-333333333333',
      selectedRanks: [3, 1],
      profileId
    }).selectedRanks).toEqual([1, 3]);
    expect(() => bilibiliDetailTaskInput({
      researchQuestion: 'detail',
      decisionContext: 'context',
      sourceTaskId: '22222222-2222-4222-8222-222222222222',
      sourceEvidenceBatchId: '33333333-3333-4333-8333-333333333333',
      selectedRanks: [1],
      profileId,
      automaticEscalation: true
    })).toThrow('task_detail_input_invalid');
  });

  test('binds a preflight to exactly one extension and makes identical preflight delivery idempotent', async () => {
    const queue = new GatewayTaskQueue(
      {
        publicIdentity: { gatewayInstanceId: '44444444-4444-4444-8444-444444444444' },
        signPayload: () => 'unit-signature'
      } as unknown as LoadedGatewayIdentity,
      {} as unknown as GatewayEvidenceRegistry,
      await accountSafety()
    );
    const summary = queue.createScoutTask(scoutTaskInput({
      researchQuestion: 'check task routing',
      decisionContext: 'pure state-machine unit test',
      query: 'collector',
      platforms: ['bilibili'],
      profileIds: { bilibili: profileId }
    }), { bilibili: profileBinding }, new Date('2026-07-22T00:00:00.000Z'));

    const work = await queue.nextWork('extension-a', Date.parse('2026-07-22T00:00:01.000Z'));
    expect(work).toMatchObject({ kind: 'preflight_request', taskId: summary.taskId, signature: 'unit-signature' });
    expect(await queue.nextWork('extension-b', Date.parse('2026-07-22T00:00:02.000Z'))).toBeNull();

    const plan = {
      schemaVersion: 1,
      planId: `${summary.taskId}.plan`,
      taskId: summary.taskId,
      generatedAt: '2026-07-22T00:00:01.000Z',
      stages: [{ stageId: `${summary.taskId}.stage.1`, preflight: { status: 'ready' } }],
      approval: { status: 'pending' }
    } as unknown as EvidencePlan;
    const submission = { schemaVersion: 1, taskId: summary.taskId, plan } as GatewayPreflightSubmission;
    expect(() => queue.submitPreflight(submission, 'extension-b')).toThrow('task_extension_mismatch');
    expect(queue.submitPreflight(submission, 'extension-a')).toMatchObject({ state: 'awaiting_plan_approval' });
    expect(queue.submitPreflight(submission, 'extension-a')).toMatchObject({ state: 'awaiting_plan_approval' });
  });
});
