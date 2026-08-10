import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'collector-task-safety-resume-'));
const tasksBundle = join(temporaryDirectory, 'tasks.mjs');
const safetyBundle = join(temporaryDirectory, 'account-safety.mjs');
const protocolBundle = join(temporaryDirectory, 'protocol.mjs');
const extensionInstanceId = 'fixture-extension-instance';
const profileId = '11111111-1111-4111-8111-111111111111';
const sourceTaskId = '22222222-2222-4222-8222-222222222222';
const sourceBatchId = '33333333-3333-4333-8333-333333333333';
const firstUrl = 'https://www.bilibili.com/video/BV1qZSLBYEpa';
const secondUrl = 'https://www.bilibili.com/video/BV1xx411c7mD';
const base = new Date('2026-07-19T00:00:00.000Z');

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ':' + canonicalJson(value[key])
    ).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function at(offsetMs) {
  return new Date(base.getTime() + offsetMs);
}

function detailResult(stage, title) {
  return {
    schemaVersion: 1,
    platform: 'bilibili',
    operation: 'detail_read',
    strategy: stage.strategy,
    sourceUrl: stage.target.url,
    pageState: 'results_visible',
    partial: true,
    itemCount: 1,
    detail: {
      contentId: new URL(stage.target.url).pathname.split('/').filter(Boolean).at(-1),
      contentType: 'video',
      canonicalUrl: stage.target.url,
      title,
      creator: null,
      description: '公开可见的 fixture 简介',
      publishedText: '2026-07-19',
      visibleMetrics: [
        { label: '播放', value: '1' },
        { label: '点赞', value: '1' }
      ],
      tags: []
    },
    warnings: []
  };
}

function formalPlan(task, now) {
  const strategy = {
    strategyId: 'bilibili.video.detail.dom.fixture',
    version: '1.0.0',
    maturity: 'live_authenticated_verified',
    validatedAt: now.toISOString()
  };
  return {
    schemaVersion: 1,
    planId: `${task.taskId}.plan.fixture`,
    taskId: task.taskId,
    generatedAt: now.toISOString(),
    stages: task.targets.map((target, index) => ({
      stageId: `${task.taskId}.stage.${index + 1}`,
      targetIndex: index,
      target,
      targetType: target.type,
      platform: 'bilibili',
      evidenceObjective: 'detail_read',
      strategy,
      preflight: {
        platform: 'bilibili',
        targetType: target.type,
        evidenceObjective: 'detail_read',
        status: 'ready',
        releaseTrack: 'formal',
        strategy,
        lastVerifiedAt: now.toISOString(),
        profileBinding: task.profileBindings.bilibili,
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
        checkedAt: now.toISOString()
      },
      budget: task.budget.perPlatform.bilibili
    })),
    approval: { status: 'pending' }
  };
}

async function createApprovedTask(queue, now) {
  const summary = queue.createBilibiliDetailTask({
    researchQuestion: '验证多阶段账号安全显式恢复',
    decisionContext: '纯本地状态机 fixture，不打开浏览器或平台页面。',
    sourceTaskId,
    sourceEvidenceBatchId: sourceBatchId,
    selectedRanks: [1, 2],
    profileId
  }, {
    profileId,
    kind: 'collection',
    platform: 'bilibili',
    account: { category: 'user_managed', label: 'B站状态机 fixture' }
  }, now);
  const preflight = await queue.nextWork(extensionInstanceId, now.getTime());
  assert.equal(preflight?.kind, 'preflight_request');
  assert.equal(preflight.taskId, summary.taskId);
  const plan = formalPlan(preflight.task, now);
  queue.submitPreflight({ schemaVersion: 1, taskId: summary.taskId, plan }, extensionInstanceId);
  return { taskId: summary.taskId, approved: await queue.approve(summary.taskId, now) };
}

async function acceptAndSubmit(queue, dispatchWork, leaseId, capturedAt, title, collectorVersion) {
  assert.equal(dispatchWork?.kind, 'approved_dispatch');
  const dispatch = dispatchWork.dispatch;
  const stage = dispatch.plan.stages.find((candidate) => candidate.stageId === dispatch.stageId);
  assert.ok(stage?.strategy && stage.budget);
  await queue.submitStageReceipt({
    schemaVersion: 1,
    taskId: dispatch.taskId,
    stageId: dispatch.stageId,
    status: 'accepted',
    leaseId,
    recordedAt: capturedAt.toISOString()
  }, extensionInstanceId);
  const result = detailResult(stage, title);
  await assert.rejects(
    () => queue.submitEvidence({
      schemaVersion: 1,
      collectorVersion: collectorVersion + '.mismatch',
      taskId: dispatch.taskId,
      stageId: dispatch.stageId,
      leaseId,
      platform: 'bilibili',
      strategy: stage.strategy,
      capturedAt: capturedAt.toISOString(),
      result
    }, extensionInstanceId, capturedAt),
    (error) => error instanceof Error && error.message === 'task_collector_version_mismatch'
  );
  return queue.submitEvidence({
    schemaVersion: 1,
    collectorVersion,
    taskId: dispatch.taskId,
    stageId: dispatch.stageId,
    leaseId,
    platform: 'bilibili',
    strategy: stage.strategy,
    capturedAt: capturedAt.toISOString(),
    result
  }, extensionInstanceId, capturedAt);
}

try {
  await Promise.all([
    build({
      entryPoints: [fileURLToPath(new URL('../src/tasks.ts', import.meta.url))],
      outfile: tasksBundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    }),
    build({
      entryPoints: [fileURLToPath(new URL('../src/account-safety.ts', import.meta.url))],
      outfile: safetyBundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    }),
    build({
      entryPoints: [fileURLToPath(new URL('../../collector-extension/src/shared/protocol.ts', import.meta.url))],
      outfile: protocolBundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      logLevel: 'silent'
    })
  ]);
  const { GatewayTaskQueue } = await import(pathToFileURL(tasksBundle).href);
  const { AccountSafetyRegistry } = await import(pathToFileURL(safetyBundle).href);
  const { COLLECTOR_CORE_VERSION } = await import(pathToFileURL(protocolBundle).href);
  const accountSafety = await AccountSafetyRegistry.create(temporaryDirectory, base);
  const batches = [];
  const evidenceRegistry = {
    getBatch(batchId, taskId) {
      if (batchId !== sourceBatchId || taskId !== sourceTaskId) return undefined;
      return {
        schemaVersion: 1,
        batchId: sourceBatchId,
        taskId: sourceTaskId,
        stageId: `${sourceTaskId}.stage.1`,
        digest: 'a'.repeat(64),
        itemCount: 2,
        receivedAt: base.toISOString(),
        platform: 'bilibili',
        result: {
          operation: 'breadth_search',
          pageState: 'results_visible',
          items: [
            { rank: 1, contentType: 'video', url: firstUrl, title: 'fixture 1' },
            { rank: 2, contentType: 'video', url: secondUrl, title: 'fixture 2' }
          ]
        }
      };
    },
    async record(submission, _extensionInstanceId, now) {
      const summary = {
        schemaVersion: 1,
        batchId: randomUUID(),
        taskId: submission.taskId,
        stageId: submission.stageId,
        digest: digest(submission.result),
        itemCount: submission.result.itemCount,
        receivedAt: now.toISOString()
      };
      batches.push(summary);
      return summary;
    }
  };
  const identity = {
    publicIdentity: { gatewayInstanceId: '44444444-4444-4444-8444-444444444444' },
    signPayload: () => 'fixture-signature'
  };
  const queue = new GatewayTaskQueue(identity, evidenceRegistry, accountSafety);

  const first = await createApprovedTask(queue, base);
  assert.equal(first.approved.state, 'approved');
  const stageOneDispatch = await queue.nextWork(extensionInstanceId, at(1_000).getTime());
  const afterStageOne = await acceptAndSubmit(
    queue,
    stageOneDispatch,
    '55555555-5555-4555-8555-555555555555',
    at(2_000),
    'fixture detail 1',
    COLLECTOR_CORE_VERSION
  );
  assert.equal(afterStageOne.state, 'waiting_for_user_resume');
  assert.match(afterStageOne.statusMessage, /^user_resume_required:/);
  assert.equal((await queue.nextWork(extensionInstanceId, at(3_000).getTime())), null);
  assert.equal(accountSafety.get(profileId, 'bilibili').activeRun, null);
  assert.equal(accountSafety.get(profileId, 'bilibili').state, 'ready');

  const resumed = await queue.resumeAfterUserConfirmation(first.taskId, at(4_000));
  assert.equal(resumed.state, 'stage_completed');
  assert.match(resumed.statusMessage, /^user_resumed:/);
  await assert.rejects(
    () => queue.resumeAfterUserConfirmation(first.taskId, at(4_001)),
    (error) => error instanceof Error && error.message === 'task_resume_state_invalid'
  );

  const stageTwoDispatch = await queue.nextWork(extensionInstanceId, at(5_000).getTime());
  assert.equal(stageTwoDispatch?.kind, 'approved_dispatch');
  assert.notEqual(stageTwoDispatch.dispatch.stageId, stageOneDispatch.dispatch.stageId);
  const running = accountSafety.get(profileId, 'bilibili');
  assert.equal(running.state, 'running');
  assert.equal(running.activeRun?.purpose, 'formal_collection_stage');
  const completed = await acceptAndSubmit(
    queue,
    stageTwoDispatch,
    '66666666-6666-4666-8666-666666666666',
    at(6_000),
    'fixture detail 2',
    COLLECTOR_CORE_VERSION
  );
  assert.equal(completed.state, 'completed');
  assert.equal(completed.stageProgress.every((stage) => stage.state === 'completed'), true);
  await assert.rejects(
    () => queue.resumeAfterUserConfirmation(first.taskId, at(7_000)),
    (error) => error instanceof Error && error.message === 'task_resume_state_invalid'
  );

  await accountSafety.pause(profileId, 'bilibili', 'user_safety_pause', at(8_000));
  const second = await createApprovedTask(queue, at(9_000));
  assert.equal(second.approved.state, 'approved');
  assert.equal(second.approved.plan.approval.status, 'approved');
  assert.equal(second.approved.statusMessage, undefined);
  const secondDispatch = await queue.nextWork(extensionInstanceId, at(11_000).getTime());
  assert.equal(secondDispatch?.kind, 'approved_dispatch');

  assert.equal(batches.length, 2);
  console.log(JSON.stringify({
    ok: true,
    gate: 'task-explicit-user-resume',
    platformRequests: 0,
    browserWindows: 0,
    verified: [
      'non_final_stage_waits',
      'no_background_resume',
      'normal_finish_is_immediately_ready',
      'explicit_user_resume_has_no_time_delay',
      'exact_next_stage_dispatch',
      'repeated_resume_rejected',
      'completed_task_resume_rejected',
      'approval_remains_dispatchable_after_pause',
      'paused_profile_does_not_require_manual_resume'
    ]
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
