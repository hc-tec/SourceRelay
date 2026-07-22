import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvidencePlan } from '../../collector-extension/src/shared/control-plane.js';
import type { BrowserProfileBinding, ResearchTaskContract } from '../../collector-extension/src/shared/collection-contracts.js';
import { afterEach, expect, test } from 'vitest';
import { AccountSafetyRegistry } from '../src/account-safety.js';
import { GatewayEvidenceRegistry } from '../src/evidence.js';
import type { LoadedGatewayIdentity } from '../src/identity.js';
import { GatewayTaskQueue, scoutTaskInput } from '../src/tasks.js';

const temporaryDirectories: string[] = [];
const profileId = '11111111-1111-4111-8111-111111111111';
const profileBinding: BrowserProfileBinding = {
  profileId,
  kind: 'collection',
  platform: 'bilibili',
  account: { category: 'user_managed', label: 'Terminal-state unit profile' }
};
const extensionInstanceId = 'extension-terminal-state-unit';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function prepareFormalScoutStage(maxDurationMs: number) {
  const directory = await mkdtemp(join(tmpdir(), 'collector-task-terminal-unit-'));
  temporaryDirectories.push(directory);
  const safety = await AccountSafetyRegistry.create(directory, new Date('2026-07-22T00:00:00.000Z'));
  const evidence = await GatewayEvidenceRegistry.create(directory);
  const queue = new GatewayTaskQueue(
    {
      publicIdentity: { gatewayInstanceId: '44444444-4444-4444-8444-444444444444' },
      signPayload: () => 'unit-signature'
    } as unknown as LoadedGatewayIdentity,
    evidence,
    safety
  );
  const task = queue.createScoutTask(scoutTaskInput({
    researchQuestion: 'Exercise terminal account-safety transitions.',
    decisionContext: 'Pure Gateway task-state validation without browser activity.',
    query: 'collector terminal safety',
    platforms: ['bilibili'],
    profileIds: { bilibili: profileId }
  }), { bilibili: profileBinding }, new Date('2026-07-22T00:00:00.000Z'));

  const preflight = await queue.nextWork(extensionInstanceId, Date.parse('2026-07-22T00:00:01.000Z'));
  if (!preflight || preflight.kind !== 'preflight_request') throw new Error('terminal_test_preflight_missing');
  const plan = formalScoutPlan(preflight.task, task.taskId, maxDurationMs);
  queue.submitPreflight({ schemaVersion: 1, taskId: task.taskId, plan }, extensionInstanceId);
  await queue.approve(task.taskId, new Date('2026-07-22T00:00:02.000Z'));
  return { queue, safety, taskId: task.taskId };
}

async function dispatch(queue: GatewayTaskQueue, at: Date) {
  const work = await queue.nextWork(extensionInstanceId, at.getTime());
  if (!work || work.kind !== 'approved_dispatch') throw new Error('terminal_test_dispatch_missing');
  return work;
}

test('a blocked receipt finishes the active safety run and locks rate-limited Profile activity', async () => {
  const { queue, safety, taskId } = await prepareFormalScoutStage(10_000);
  const dispatched = await dispatch(queue, new Date('2026-07-22T00:00:03.000Z'));
  expect(safety.get(profileId, 'bilibili')).toMatchObject({ state: 'running' });

  const blocked = await queue.submitStageReceipt({
    schemaVersion: 1,
    taskId,
    stageId: dispatched.dispatch.stageId,
    status: 'blocked',
    errorCode: 'rate_limited',
    recordedAt: '2026-07-22T00:00:04.000Z'
  }, extensionInstanceId);

  expect(blocked).toMatchObject({
    state: 'blocked',
    statusMessage: 'rate_limited',
    stageProgress: [{ stageId: dispatched.dispatch.stageId, state: 'blocked', errorCode: 'rate_limited' }]
  });
  expect(safety.get(profileId, 'bilibili')).toMatchObject({
    state: 'locked',
    reasonCode: 'rate_limited',
    manualUnlockRequired: true,
    activeRun: null
  });
  expect(await queue.nextWork(extensionInstanceId, Date.parse('2026-07-22T00:00:05.000Z'))).toBeNull();
});

test('an active stage deadline blocks the task, finishes safety, and never dispatches again', async () => {
  const deadlineMs = 1_000;
  const { queue, safety, taskId } = await prepareFormalScoutStage(deadlineMs);
  const acceptedAt = new Date('2026-07-22T00:00:03.000Z');
  const dispatched = await dispatch(queue, acceptedAt);
  await queue.submitStageReceipt({
    schemaVersion: 1,
    taskId,
    stageId: dispatched.dispatch.stageId,
    status: 'accepted',
    leaseId: '88888888-8888-4888-8888-888888888888',
    recordedAt: acceptedAt.toISOString()
  }, extensionInstanceId);
  expect(safety.get(profileId, 'bilibili')).toMatchObject({ state: 'running' });

  const beforeDeadline = await queue.list(acceptedAt.getTime() + deadlineMs - 1);
  expect(beforeDeadline.find((task) => task.taskId === taskId)).toMatchObject({ state: 'stage_active' });

  const afterDeadline = await queue.list(acceptedAt.getTime() + deadlineMs);
  expect(afterDeadline.find((task) => task.taskId === taskId)).toMatchObject({
    state: 'blocked',
    statusMessage: 'gateway_stage_budget_expired',
    stageProgress: [{
      stageId: dispatched.dispatch.stageId,
      state: 'blocked',
      errorCode: 'gateway_stage_budget_expired'
    }]
  });
  expect(safety.get(profileId, 'bilibili')).toMatchObject({
    state: 'ready',
    reasonCode: 'gateway_stage_budget_expired',
    manualUnlockRequired: false,
    activeRun: null
  });
  expect(await queue.nextWork(extensionInstanceId, acceptedAt.getTime() + deadlineMs + 1)).toBeNull();
});

function formalScoutPlan(task: ResearchTaskContract, taskId: string, maxDurationMs: number): EvidencePlan {
  const target = task.targets[0];
  const budget = task.budget.perPlatform.bilibili;
  if (!target || target.type !== 'keyword_query' || !budget) throw new Error('terminal_test_scout_contract_invalid');
  const strategy = {
    strategyId: 'bilibili.search.breadth.dom.v1',
    version: '1.1.0',
    platform: 'bilibili' as const,
    evidenceObjectives: ['breadth_search'],
    acquisition: ['native_navigation', 'visible_dom'],
    maturity: 'live_anonymous_verified' as const,
    liveValidation: {
      category: 'anonymous' as const,
      recordId: 'bb91e996-7758-4447-ba94-486bc99b7872',
      verifiedAt: '2026-07-22T00:00:00.000Z',
      environment: 'local_user_controlled_validation_profile' as const
    }
  };
  return {
    schemaVersion: 1,
    planId: `${taskId}.plan`,
    taskId,
    generatedAt: '2026-07-22T00:00:01.000Z',
    stages: [{
      stageId: `${taskId}.stage.1`,
      targetIndex: 0,
      target,
      targetType: 'keyword_query',
      platform: 'bilibili',
      evidenceObjective: 'breadth_search',
      strategy,
      preflight: {
        platform: 'bilibili',
        targetType: 'keyword_query',
        evidenceObjective: 'breadth_search',
        status: 'ready',
        releaseTrack: 'formal',
        strategy,
        lastVerifiedAt: strategy.liveValidation.verifiedAt,
        profileBinding,
        requiredHostPermissions: ['https://search.bilibili.com/*', 'https://www.bilibili.com/*'],
        missingHostPermissions: [],
        requiredConsent: ['native_navigation', 'visible_dom'],
        missingConsent: [],
        objectiveApproved: true,
        budgetStatus: 'accepted',
        requiredUserActions: [],
        estimatedReadOnlyActions: 0,
        knownGaps: [],
        externalDiscoveryOnly: false,
        checkedAt: '2026-07-22T00:00:01.000Z'
      },
      budget: { ...budget, maxDurationMs }
    }],
    approval: { status: 'pending' }
  } as EvidencePlan;
}
