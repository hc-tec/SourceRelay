import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvidencePlan } from '../../collector-extension/src/shared/control-plane.js';
import type { BrowserProfileBinding, ResearchTaskContract } from '../../collector-extension/src/shared/collection-contracts.js';
import { COLLECTOR_CORE_VERSION } from '../../collector-extension/src/shared/protocol.js';
import { afterEach, expect, test } from 'vitest';
import { AccountSafetyRegistry } from '../src/account-safety.js';
import { GatewayEvidenceRegistry, gatewayEvidenceSubmission } from '../src/evidence.js';
import type { LoadedGatewayIdentity } from '../src/identity.js';
import { GatewayTaskQueue, bilibiliDetailTaskInput } from '../src/tasks.js';

const temporaryDirectories: string[] = [];
const profileId = '11111111-1111-4111-8111-111111111111';
const profileBinding: BrowserProfileBinding = {
  profileId,
  kind: 'collection',
  platform: 'bilibili',
  account: { category: 'user_managed', label: 'Unit test collection profile' }
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function taskDependencies(): Promise<{
  accountSafety: AccountSafetyRegistry;
  evidence: GatewayEvidenceRegistry;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'collector-task-lifecycle-unit-'));
  temporaryDirectories.push(directory);
  return {
    accountSafety: await AccountSafetyRegistry.create(directory, new Date('2026-07-22T00:00:00.000Z')),
    evidence: await GatewayEvidenceRegistry.create(directory)
  };
}

// This is a pure Gateway state-machine test backed by its real local evidence
// store. It never starts a browser or treats generated values as platform data.
test('requires explicit user resume between formal stages while using real local evidence persistence', async () => {
  const { accountSafety: safety, evidence } = await taskDependencies();
  const queue = new GatewayTaskQueue(
    {
      publicIdentity: { gatewayInstanceId: '44444444-4444-4444-8444-444444444444' },
      signPayload: () => 'unit-signature'
    } as unknown as LoadedGatewayIdentity,
    evidence,
    safety
  );
  const sourceTaskId = '55555555-5555-4555-8555-555555555555';
  const sourceBatch = await evidence.record(gatewayEvidenceSubmission({
    schemaVersion: 1,
    collectorVersion: COLLECTOR_CORE_VERSION,
    taskId: sourceTaskId,
    stageId: 'source-stage',
    leaseId: '66666666-6666-4666-8666-666666666666',
    platform: 'bilibili',
    strategy: strategy('breadth_search'),
    capturedAt: '2026-07-22T00:00:00.000Z',
    result: {
      schemaVersion: 1,
      platform: 'bilibili',
      operation: 'breadth_search',
      strategy: strategy('breadth_search'),
      sourceUrl: 'https://search.bilibili.com/all?keyword=collector',
      pageState: 'results_visible',
      partial: true,
      itemCount: 2,
      items: [
        {
          rank: 1,
          title: 'first visible video',
          url: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
          contentType: 'video'
        },
        {
          rank: 2,
          title: 'second visible video',
          url: 'https://www.bilibili.com/video/BV1xx411c7mD',
          contentType: 'video'
        }
      ],
      warnings: []
    }
  }), '77777777-7777-4777-8777-777777777777', new Date('2026-07-22T00:00:00.000Z'));

  const task = queue.createBilibiliDetailTask(bilibiliDetailTaskInput({
    researchQuestion: 'read two explicitly selected videos',
    decisionContext: 'exercise the local task state machine only',
    sourceTaskId,
    sourceEvidenceBatchId: sourceBatch.batchId,
    selectedRanks: [1, 2],
    profileId
  }), profileBinding, new Date('2026-07-22T00:00:01.000Z'));

  const preflightWork = await queue.nextWork('extension-a', Date.parse('2026-07-22T00:00:02.000Z'));
  if (!preflightWork || preflightWork.kind !== 'preflight_request') throw new Error('preflight_not_dispatched');
  const plan = formalDetailPlan(preflightWork.task, task.taskId);
  queue.submitPreflight({ schemaVersion: 1, taskId: task.taskId, plan }, 'extension-a');
  expect(await queue.approve(task.taskId, new Date('2026-07-22T00:00:03.000Z'))).toMatchObject({ state: 'approved' });

  const first = await dispatchAndSubmitEvidence(
    queue, 'extension-a', new Date('2026-07-22T00:00:04.000Z'),
    '88888888-8888-4888-8888-888888888888', 'first detail'
  );
  expect(first.summary).toMatchObject({ state: 'waiting_for_user_resume' });
  expect(await queue.nextWork('extension-a', Date.parse('2026-07-22T00:00:05.000Z'))).toBeNull();
  expect(safety.get(profileId, 'bilibili')).toMatchObject({ state: 'ready', activeRun: null });

  expect(await queue.resumeAfterUserConfirmation(task.taskId, new Date('2026-07-22T00:00:06.000Z'))).toMatchObject({
    state: 'stage_completed'
  });
  const second = await dispatchAndSubmitEvidence(
    queue, 'extension-a', new Date('2026-07-22T00:00:07.000Z'),
    '99999999-9999-4999-8999-999999999999', 'second detail'
  );
  expect(second.summary).toMatchObject({ state: 'completed' });
  expect(second.summary.evidence).toHaveLength(2);
  expect(await queue.submitEvidence(second.submission, 'extension-a', new Date('2026-07-22T00:00:08.000Z'))).toMatchObject({
    state: 'completed',
    evidence: second.summary.evidence
  });
});

function strategy(objective: 'breadth_search' | 'detail_read') {
  return {
    strategyId: `bilibili.visible-dom.${objective}.v1`,
    version: '1.0.0',
    platform: 'bilibili' as const,
    evidenceObjectives: [objective],
    acquisition: ['visible_dom'],
    maturity: 'live_authenticated_verified' as const,
    liveValidation: null
  };
}

function formalDetailPlan(task: ResearchTaskContract, taskId: string): EvidencePlan {
  const detailStrategy = strategy('detail_read');
  const budget = task.budget.perPlatform.bilibili;
  if (!budget) throw new Error('bilibili_budget_missing');
  const targets = task.targets.map((target) => {
    if (target.type !== 'known_url') throw new Error('detail_target_not_known_url');
    return target;
  });
  return {
    schemaVersion: 1,
    planId: `${taskId}.plan`,
    taskId,
    generatedAt: '2026-07-22T00:00:02.000Z',
    stages: targets.map((target, index) => ({
      stageId: `${taskId}.stage.${index + 1}`,
      targetIndex: index,
      target,
      targetType: 'known_url',
      platform: 'bilibili',
      evidenceObjective: 'detail_read',
      strategy: detailStrategy,
      preflight: {
        platform: 'bilibili',
        targetType: 'known_url',
        evidenceObjective: 'detail_read',
        status: 'ready',
        releaseTrack: 'formal',
        strategy: detailStrategy,
        lastVerifiedAt: '2026-07-22T00:00:00.000Z',
        profileBinding,
        requiredHostPermissions: ['https://www.bilibili.com/*'],
        missingHostPermissions: [],
        requiredConsent: ['detail_navigation', 'visible_dom'],
        missingConsent: [],
        objectiveApproved: true,
        budgetStatus: 'accepted',
        requiredUserActions: [],
        estimatedReadOnlyActions: 0,
        knownGaps: [],
        externalDiscoveryOnly: false,
        checkedAt: '2026-07-22T00:00:00.000Z'
      },
      budget
    })),
    approval: { status: 'pending' }
  } as unknown as EvidencePlan;
}

async function dispatchAndSubmitEvidence(
  queue: GatewayTaskQueue,
  extensionInstanceId: string,
  at: Date,
  leaseId: string,
  title: string
) {
  const work = await queue.nextWork(extensionInstanceId, at.getTime());
  if (!work || work.kind !== 'approved_dispatch') throw new Error('approved_dispatch_not_available');
  const stage = work.dispatch.plan.stages.find((candidate) => candidate.stageId === work.dispatch.stageId);
  if (!stage?.strategy || !stage.budget || stage.target.type !== 'known_url') throw new Error('formal_stage_invalid');
  await queue.submitStageReceipt({
    schemaVersion: 1,
    taskId: work.dispatch.taskId,
    stageId: work.dispatch.stageId,
    status: 'accepted',
    leaseId,
    recordedAt: at.toISOString()
  }, extensionInstanceId);
  const bvid = stage.target.url.split('/').at(-1);
  if (!bvid) throw new Error('detail_bvid_missing');
  const submission = gatewayEvidenceSubmission({
    schemaVersion: 1,
    collectorVersion: COLLECTOR_CORE_VERSION,
    taskId: work.dispatch.taskId,
    stageId: work.dispatch.stageId,
    leaseId,
    platform: 'bilibili',
    strategy: stage.strategy,
    capturedAt: at.toISOString(),
    result: {
      schemaVersion: 1,
      platform: 'bilibili',
      operation: 'detail_read',
      strategy: stage.strategy,
      sourceUrl: stage.target.url,
      pageState: 'results_visible',
      partial: true,
      itemCount: 1,
      detail: {
        contentId: bvid,
        contentType: 'video',
        canonicalUrl: stage.target.url,
        title,
        creator: null,
        description: 'visible description',
        publishedText: '2026-07-22',
        visibleMetrics: [{ label: 'plays', value: '1' }, { label: 'likes', value: '1' }],
        tags: []
      },
      warnings: []
    }
  });
  return {
    submission,
    summary: await queue.submitEvidence(submission, extensionInstanceId, at)
  };
}
