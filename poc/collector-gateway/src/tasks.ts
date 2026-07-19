import { randomUUID } from 'node:crypto';
import type {
  ApprovedEvidencePlan,
  EvidencePlan,
  GatewayApprovedDispatchWorkItem,
  GatewayEvidenceBatchSummary,
  GatewayEvidenceSubmission,
  GatewayPreflightRequestEnvelope,
  GatewayPreflightSubmission,
  GatewayStageReceipt,
  GatewayTaskDispatchEnvelope,
  GatewayWorkItem
} from '../../collector-extension/src/shared/control-plane';
import {
  evidencePlanDigestPayload
} from '../../collector-extension/src/shared/control-plane';
import {
  isSupportedPlatform,
  type BrowserProfileBinding,
  type CollectionBudgetLimits,
  type CollectionTaskTarget,
  type ResearchTaskContract,
  type SupportedPlatform
} from '../../collector-extension/src/shared/collection-contracts';
import { canonicalJson, sha256Hex } from '../../collector-extension/src/shared/cryptography';
import { buildNativeSearchUrl } from '../../collector-extension/src/shared/native-search';
import { COLLECTOR_CORE_VERSION } from '../../collector-extension/src/shared/protocol';
import type { GatewayEvidenceRegistry } from './evidence';
import type { LoadedGatewayIdentity } from './identity';
import type { AccountSafetyRegistry } from './account-safety';

const WORK_ITEM_TTL_MS = 2 * 60 * 1000;
const PREFLIGHT_REDELIVERY_MS = 30_000;

type TaskState =
  | 'queued_for_preflight'
  | 'preflight_dispatched'
  | 'awaiting_plan_approval'
  | 'approved'
  | 'stage_dispatched'
  | 'stage_active'
  | 'stage_completed'
  | 'waiting_for_user_resume'
  | 'evidence_received'
  | 'completed'
  | 'blocked';

interface TaskRecord {
  task: ResearchTaskContract;
  state: TaskState;
  createdAt: string;
  lastDispatchedAt?: number;
  plan?: EvidencePlan;
  approvedPlan?: ApprovedEvidencePlan;
  assignedExtensionInstanceId?: string;
  stageProgress: TaskStageProgress[];
  evidence: GatewayEvidenceBatchSummary[];
  statusMessage?: string;
}

export interface TaskStageProgress {
  stageId: string;
  state: 'pending' | 'dispatched' | 'active' | 'completed' | 'blocked';
  leaseId?: string;
  evidence?: GatewayEvidenceBatchSummary;
  errorCode?: string;
  activatedAt?: string;
  safetyRunId?: string;
}

export interface ScoutTaskInput {
  researchQuestion: string;
  decisionContext: string;
  query: string;
  platforms: SupportedPlatform[];
  profileIds: Partial<Record<SupportedPlatform, string>>;
}

export interface BilibiliDetailTaskInput {
  researchQuestion: string;
  decisionContext: string;
  sourceTaskId: string;
  sourceEvidenceBatchId: string;
  selectedRanks: number[];
  profileId: string;
}

export interface ConsoleTaskSummary {
  taskId: string;
  researchQuestion: string;
  platforms: readonly SupportedPlatform[];
  state: TaskState;
  createdAt: string;
  profileBindings: Partial<Record<SupportedPlatform, BrowserProfileBinding>>;
  profile: ResearchTaskContract['profile'];
  lineage: ResearchTaskContract['lineage'];
  plan?: EvidencePlan | ApprovedEvidencePlan;
  stageProgress: readonly TaskStageProgress[];
  evidence: readonly GatewayEvidenceBatchSummary[];
  statusMessage?: string;
}

function boundedText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${name}_invalid`);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name}_invalid`);
  return normalized;
}

function budgetLimits(overrides: Partial<CollectionBudgetLimits> = {}): CollectionBudgetLimits {
  return {
    maxDurationMs: 2 * 60 * 1000,
    maxRecords: 20,
    maxPages: 2,
    maxScrolls: 0,
    maxReadOnlyActions: 2,
    maxDetails: 0,
    maxCommentItems: 0,
    maxOriginalMediaBytes: 0,
    ...overrides
  };
}

export function scoutTaskInput(value: unknown): ScoutTaskInput {
  if (!value || typeof value !== 'object') throw new Error('task_input_invalid');
  const candidate = value as Partial<ScoutTaskInput>;
  if (!Array.isArray(candidate.platforms)) throw new Error('task_platforms_invalid');
  const platforms = [...new Set(candidate.platforms.filter(isSupportedPlatform))];
  if (platforms.length === 0 || platforms.length !== candidate.platforms.length) {
    throw new Error('task_platforms_invalid');
  }
  if (!candidate.profileIds || typeof candidate.profileIds !== 'object' || Array.isArray(candidate.profileIds)) {
    throw new Error('task_profile_bindings_invalid');
  }
  const profileIds: Partial<Record<SupportedPlatform, string>> = {};
  for (const [platform, profileId] of Object.entries(candidate.profileIds)) {
    if (!isSupportedPlatform(platform) || !platforms.includes(platform) || typeof profileId !== 'string') {
      throw new Error('task_profile_bindings_invalid');
    }
    profileIds[platform] = profileId;
  }
  return {
    researchQuestion: boundedText(candidate.researchQuestion, 'research_question', 500),
    decisionContext: boundedText(candidate.decisionContext, 'decision_context', 1_000),
    query: boundedText(candidate.query, 'query', 200),
    platforms,
    profileIds
  };
}

export function bilibiliDetailTaskInput(value: unknown): BilibiliDetailTaskInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('task_detail_input_invalid');
  const candidate = value as Partial<BilibiliDetailTaskInput>;
  if (Object.keys(candidate).some((key) => ![
    'researchQuestion', 'decisionContext', 'sourceTaskId', 'sourceEvidenceBatchId',
    'selectedRanks', 'profileId'
  ].includes(key))) throw new Error('task_detail_input_invalid');
  if (
    typeof candidate.sourceTaskId !== 'string' || !/^[0-9a-f-]{36}$/i.test(candidate.sourceTaskId) ||
    typeof candidate.sourceEvidenceBatchId !== 'string' || !/^[0-9a-f-]{36}$/i.test(candidate.sourceEvidenceBatchId) ||
    typeof candidate.profileId !== 'string' || !/^[0-9a-f-]{36}$/i.test(candidate.profileId) ||
    !Array.isArray(candidate.selectedRanks) || candidate.selectedRanks.length === 0 ||
    candidate.selectedRanks.length > 3 ||
    candidate.selectedRanks.some((rank) => !Number.isSafeInteger(rank) || rank < 1 || rank > 20) ||
    new Set(candidate.selectedRanks).size !== candidate.selectedRanks.length
  ) throw new Error('task_detail_selection_invalid');
  return {
    researchQuestion: boundedText(candidate.researchQuestion, 'research_question', 500),
    decisionContext: boundedText(candidate.decisionContext, 'decision_context', 1_000),
    sourceTaskId: candidate.sourceTaskId,
    sourceEvidenceBatchId: candidate.sourceEvidenceBatchId,
    selectedRanks: [...candidate.selectedRanks].sort((left, right) => left - right),
    profileId: candidate.profileId
  };
}

export class GatewayTaskQueue {
  readonly #identity: LoadedGatewayIdentity;
  readonly #evidenceRegistry: GatewayEvidenceRegistry;
  readonly #accountSafety: AccountSafetyRegistry;
  readonly #tasks = new Map<string, TaskRecord>();

  constructor(
    identity: LoadedGatewayIdentity,
    evidenceRegistry: GatewayEvidenceRegistry,
    accountSafety: AccountSafetyRegistry
  ) {
    this.#identity = identity;
    this.#evidenceRegistry = evidenceRegistry;
    this.#accountSafety = accountSafety;
  }

  createScoutTask(
    input: ScoutTaskInput,
    profileBindings: Partial<Record<SupportedPlatform, BrowserProfileBinding>>,
    now = new Date()
  ): ConsoleTaskSummary {
    const taskId = randomUUID();
    const perPlatform = Object.fromEntries(
      input.platforms.map((platform) => [platform, budgetLimits()])
    );
    const task: ResearchTaskContract = {
      schemaVersion: 1,
      taskId,
      researchQuestion: input.researchQuestion,
      decisionContext: input.decisionContext,
      profile: 'scout',
      lineage: null,
      targets: [{ type: 'keyword_query', query: input.query }],
      platforms: input.platforms,
      profileBindings,
      evidenceObjectives: ['breadth_search'],
      budget: {
        total: budgetLimits({
          maxDurationMs: 5 * 60 * 1000,
          maxRecords: 80,
          maxPages: 8,
          maxReadOnlyActions: 8
        }),
        perPlatform,
        unusedBudgetTransfer: 'explicit_approval_required'
      },
      consent: {
        approvedBy: 'user',
        approvedAt: now.toISOString(),
        approvedActions: ['native_navigation', 'visible_dom'],
        approvedObjectives: ['breadth_search'],
        escalationPolicy: 'explicit_approval_required'
      }
    };
    const record: TaskRecord = {
      task,
      state: 'queued_for_preflight',
      createdAt: now.toISOString(),
      stageProgress: [],
      evidence: []
    };
    this.#tasks.set(taskId, record);
    return this.#summary(record);
  }

  createBilibiliDetailTask(
    input: BilibiliDetailTaskInput,
    profileBinding: BrowserProfileBinding,
    now = new Date()
  ): ConsoleTaskSummary {
    if (
      profileBinding.kind !== 'collection' ||
      profileBinding.platform !== 'bilibili' ||
      profileBinding.account.category !== 'user_managed' ||
      profileBinding.profileId !== input.profileId
    ) throw new Error('task_detail_profile_invalid');
    const sourceBatch = this.#evidenceRegistry.getBatch(
      input.sourceEvidenceBatchId,
      input.sourceTaskId
    );
    const sourceResult = sourceBatch?.result;
    if (
      !sourceBatch ||
      sourceBatch.platform !== 'bilibili' ||
      !sourceResult ||
      sourceResult.operation !== 'breadth_search' ||
      sourceResult.pageState !== 'results_visible'
    ) throw new Error('task_detail_source_evidence_invalid');
    const selectedItems = input.selectedRanks.map((rank) => {
      const item = sourceResult.items.find((candidate) => candidate.rank === rank);
      if (!item || item.contentType !== 'video') throw new Error('task_detail_selection_invalid');
      return { sourceRank: rank, canonicalUrl: item.url };
    });
    const taskId = randomUUID();
    const platformBudget = budgetLimits({
      maxRecords: 1,
      maxPages: 1,
      maxReadOnlyActions: 0,
      maxDetails: selectedItems.length
    });
    const task: ResearchTaskContract = {
      schemaVersion: 1,
      taskId,
      researchQuestion: input.researchQuestion,
      decisionContext: input.decisionContext,
      profile: 'deep_dive',
      lineage: {
        parentTaskId: input.sourceTaskId,
        sourceEvidenceBatchId: input.sourceEvidenceBatchId,
        selectionPolicy: 'explicit_user_selected_ranks',
        selectedItems
      },
      targets: selectedItems.map((item) => ({ type: 'known_url' as const, url: item.canonicalUrl })),
      platforms: ['bilibili'],
      profileBindings: { bilibili: profileBinding },
      evidenceObjectives: ['detail_read'],
      budget: {
        total: budgetLimits({
          maxDurationMs: selectedItems.length * 2 * 60 * 1000,
          maxRecords: selectedItems.length,
          maxPages: selectedItems.length,
          maxReadOnlyActions: 0,
          maxDetails: selectedItems.length
        }),
        perPlatform: { bilibili: platformBudget },
        unusedBudgetTransfer: 'explicit_approval_required'
      },
      consent: {
        approvedBy: 'user',
        approvedAt: now.toISOString(),
        approvedActions: ['detail_navigation', 'visible_dom'],
        approvedObjectives: ['detail_read'],
        escalationPolicy: 'explicit_approval_required'
      }
    };
    const record: TaskRecord = {
      task,
      state: 'queued_for_preflight',
      createdAt: now.toISOString(),
      stageProgress: [],
      evidence: []
    };
    this.#tasks.set(taskId, record);
    return this.#summary(record);
  }

  async list(now = Date.now()): Promise<ConsoleTaskSummary[]> {
    await this.#expireActiveStages(now);
    return [...this.#tasks.values()].map((record) => this.#summary(record));
  }

  async nextWork(extensionInstanceId: string, now = Date.now()): Promise<GatewayWorkItem | null> {
    await this.#expireActiveStages(now);
    const preflight = [...this.#tasks.values()].find((record) =>
      (!record.assignedExtensionInstanceId || record.assignedExtensionInstanceId === extensionInstanceId) &&
      (
        record.state === 'queued_for_preflight' ||
        (record.state === 'preflight_dispatched' &&
          now - (record.lastDispatchedAt ?? 0) >= PREFLIGHT_REDELIVERY_MS)
      )
    );
    if (preflight) {
      const issuedAt = new Date(now);
      const unsigned: Omit<GatewayPreflightRequestEnvelope, 'signature'> = {
        schemaVersion: 1,
        protocolVersion: 1,
        kind: 'preflight_request',
        gatewayInstanceId: this.#identity.publicIdentity.gatewayInstanceId,
        taskId: preflight.task.taskId,
        nonce: randomUUID(),
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(now + WORK_ITEM_TTL_MS).toISOString(),
        task: preflight.task
      };
      preflight.state = 'preflight_dispatched';
      preflight.assignedExtensionInstanceId = extensionInstanceId;
      preflight.lastDispatchedAt = now;
      return {
        ...unsigned,
        signature: this.#identity.signPayload(canonicalJson(unsigned))
      };
    }

    const approved = [...this.#tasks.values()].find((record) =>
      record.approvedPlan &&
      record.assignedExtensionInstanceId === extensionInstanceId &&
      (
        ((record.state === 'approved' || record.state === 'stage_completed') &&
          record.stageProgress.some((stage) => stage.state === 'pending')) ||
        (record.state === 'stage_dispatched' &&
          now - (record.lastDispatchedAt ?? 0) >= PREFLIGHT_REDELIVERY_MS &&
          record.stageProgress.some((stage) => stage.state === 'dispatched'))
      )
    );
    if (!approved?.approvedPlan) return null;
    const progress = approved.state === 'stage_dispatched'
      ? approved.stageProgress.find((candidate) => candidate.state === 'dispatched')
      : approved.stageProgress.find((candidate) => candidate.state === 'pending');
    const stage = progress
      ? approved.approvedPlan.stages.find((candidate) => candidate.stageId === progress.stageId)
      : undefined;
    if (!stage || !progress || stage.preflight.status !== 'ready') {
      approved.state = 'blocked';
      approved.statusMessage = 'approved_plan_has_no_ready_stage';
      return null;
    }
    const profileBinding = approved.task.profileBindings[stage.platform];
    if (!profileBinding) {
      approved.state = 'blocked';
      approved.statusMessage = 'approved_stage_profile_binding_missing';
      return null;
    }
    if (!progress.safetyRunId) {
      const safety = this.#accountSafety.get(profileBinding.profileId, stage.platform);
      if (safety.state !== 'ready') {
        approved.state = 'waiting_for_user_resume';
        approved.statusMessage = this.#accountSafetyStatus(profileBinding.profileId, stage.platform);
        return null;
      }
      try {
        const permit = await this.#accountSafety.beginAuthenticatedRun(
          profileBinding.profileId,
          stage.platform,
          'formal_collection_stage'
        );
        progress.safetyRunId = permit.runId;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('account_safety_')) throw error;
        approved.state = 'waiting_for_user_resume';
        approved.statusMessage = this.#accountSafetyStatus(profileBinding.profileId, stage.platform);
        return null;
      }
    } else {
      const safety = this.#accountSafety.get(profileBinding.profileId, stage.platform);
      if (safety.state !== 'running' || safety.activeRun?.runId !== progress.safetyRunId) {
        approved.statusMessage = 'account_safety_dispatch_run_not_active';
        return null;
      }
    }
    const nowDate = new Date(now);
    const unsignedDispatch: Omit<GatewayTaskDispatchEnvelope, 'signature'> = {
      schemaVersion: 1,
      protocolVersion: 1,
      gatewayInstanceId: this.#identity.publicIdentity.gatewayInstanceId,
      taskId: approved.task.taskId,
      stageId: stage.stageId,
      nonce: randomUUID(),
      issuedAt: nowDate.toISOString(),
      expiresAt: new Date(now + WORK_ITEM_TTL_MS).toISOString(),
      planDigest: approved.approvedPlan.approval.planDigest,
      task: approved.task,
      plan: approved.approvedPlan
    };
    const dispatch: GatewayTaskDispatchEnvelope = {
      ...unsignedDispatch,
      signature: this.#identity.signPayload(canonicalJson(unsignedDispatch))
    };
    const work: GatewayApprovedDispatchWorkItem = {
      schemaVersion: 1,
      protocolVersion: 1,
      kind: 'approved_dispatch',
      dispatch
    };
    approved.state = 'stage_dispatched';
    progress.state = 'dispatched';
    approved.lastDispatchedAt = now;
    return work;
  }

  submitPreflight(submission: GatewayPreflightSubmission, extensionInstanceId: string): ConsoleTaskSummary {
    const record = this.#tasks.get(submission.taskId);
    if (!record || submission.plan.taskId !== submission.taskId) throw new Error('task_not_found');
    if (record.assignedExtensionInstanceId !== extensionInstanceId) throw new Error('task_extension_mismatch');
    if (record.state === 'awaiting_plan_approval' && record.plan) {
      if (canonicalJson(record.plan) === canonicalJson(submission.plan)) return this.#summary(record);
      throw new Error('task_preflight_already_recorded');
    }
    if (record.state !== 'preflight_dispatched') throw new Error('task_preflight_state_invalid');
    if (submission.plan.approval.status !== 'pending') throw new Error('preflight_plan_must_be_pending');
    if (submission.plan.stages.length === 0 || submission.plan.stages.length > 100) {
      throw new Error('preflight_stage_count_invalid');
    }
    record.plan = submission.plan;
    record.state = 'awaiting_plan_approval';
    record.statusMessage = submission.plan.stages.every((stage) => stage.preflight.status === 'ready')
      ? undefined
      : 'one_or_more_capabilities_are_not_ready';
    return this.#summary(record);
  }

  async submitStageReceipt(
    receipt: GatewayStageReceipt,
    extensionInstanceId: string
  ): Promise<ConsoleTaskSummary> {
    const record = this.#tasks.get(receipt.taskId);
    if (!record?.approvedPlan) throw new Error('task_not_found');
    if (record.assignedExtensionInstanceId !== extensionInstanceId) throw new Error('task_extension_mismatch');
    if (!record.approvedPlan.stages.some((stage) => stage.stageId === receipt.stageId)) {
      throw new Error('task_stage_mismatch');
    }
    const progress = record.stageProgress.find((stage) => stage.stageId === receipt.stageId);
    if (!progress) throw new Error('task_stage_progress_missing');
    if (progress.state === 'completed') {
      if (
        receipt.status === 'accepted' &&
        progress.leaseId === receipt.leaseId
      ) return this.#summary(record);
      throw new Error('task_already_completed');
    }
    if (record.state !== 'stage_dispatched' && record.state !== 'stage_active') {
      throw new Error('task_stage_receipt_state_invalid');
    }
    if (receipt.status === 'accepted') {
      if (!receipt.leaseId || !/^[0-9a-f-]{36}$/i.test(receipt.leaseId)) throw new Error('task_lease_invalid');
      if (
        progress.leaseId && progress.leaseId !== receipt.leaseId
      ) throw new Error('task_lease_mismatch');
      progress.leaseId = receipt.leaseId;
      progress.state = 'active';
      progress.activatedAt = receipt.recordedAt;
      record.state = 'stage_active';
      record.statusMessage = `stage_accepted:${receipt.stageId}`;
    } else {
      if (!receipt.errorCode || !/^[a-z0-9_]{1,80}$/.test(receipt.errorCode)) {
        throw new Error('task_block_reason_invalid');
      }
      const stage = record.approvedPlan.stages.find((candidate) => candidate.stageId === receipt.stageId);
      const binding = stage ? record.task.profileBindings[stage.platform] : undefined;
      if (binding && stage && progress.safetyRunId) {
        const safety = this.#accountSafety.get(binding.profileId, stage.platform);
        if (safety.state === 'running' && safety.activeRun?.runId === progress.safetyRunId) {
          await this.#accountSafety.finishAuthenticatedRun(
            binding.profileId,
            stage.platform,
            progress.safetyRunId,
            receipt.errorCode
          );
        }
      }
      progress.state = 'blocked';
      progress.errorCode = receipt.errorCode;
      record.state = 'blocked';
      record.statusMessage = receipt.errorCode;
    }
    return this.#summary(record);
  }

  async submitEvidence(
    submission: GatewayEvidenceSubmission,
    extensionInstanceId: string,
    now = new Date()
  ): Promise<ConsoleTaskSummary> {
    const record = this.#tasks.get(submission.taskId);
    if (!record?.approvedPlan) throw new Error('task_not_found');
    if (record.assignedExtensionInstanceId !== extensionInstanceId) throw new Error('task_extension_mismatch');
    const progress = record.stageProgress.find((stage) => stage.stageId === submission.stageId);
    if (!progress || (progress.state !== 'active' && progress.state !== 'completed')) {
      throw new Error('task_stage_not_active');
    }
    if (progress.leaseId !== submission.leaseId) throw new Error('task_lease_mismatch');
    if (submission.collectorVersion !== COLLECTOR_CORE_VERSION) throw new Error('task_collector_version_mismatch');

    const stage = record.approvedPlan.stages.find((candidate) => candidate.stageId === submission.stageId);
    if (!stage?.strategy || !stage.budget) throw new Error('task_stage_mismatch');
    if (
      stage.platform !== submission.platform ||
      canonicalJson(stage.strategy) !== canonicalJson(submission.strategy) ||
      submission.result.platform !== submission.platform ||
      canonicalJson(submission.result.strategy) !== canonicalJson(stage.strategy)
    ) throw new Error('task_strategy_mismatch');
    if (
      submission.result.itemCount > stage.budget.maxRecords ||
      (submission.result.operation === 'breadth_search' &&
        submission.result.items.length !== submission.result.itemCount) ||
      (submission.result.operation === 'detail_read' &&
        submission.result.itemCount > stage.budget.maxDetails)
    ) throw new Error('task_evidence_budget_exceeded');
    const capturedAt = Date.parse(submission.capturedAt);
    if (
      !Number.isFinite(capturedAt) ||
      capturedAt > now.getTime() + 30_000 ||
      capturedAt < Date.parse(record.createdAt) - 30_000
    ) throw new Error('task_evidence_timestamp_invalid');
    this.#validateStageResult(stage.target, submission);

    const submittedDigest = await sha256Hex(canonicalJson(submission.result));
    if (progress.state === 'completed') {
      if (progress.evidence?.digest !== submittedDigest) {
        throw new Error('task_evidence_already_completed');
      }
      // An idempotent retry for an earlier stage must not overwrite a newer
      // stage_active / stage_dispatched task state.
      if (progress.safetyRunId) {
        const binding = record.task.profileBindings[stage.platform];
        const safety = binding ? this.#accountSafety.get(binding.profileId, stage.platform) : null;
        if (binding && safety?.state === 'running' && safety.activeRun?.runId === progress.safetyRunId) {
          await this.#accountSafety.finishAuthenticatedRun(
            binding.profileId,
            stage.platform,
            progress.safetyRunId,
            'formal_collection_stage_completed',
            now
          );
        }
      }
      return this.#summary(record);
    }

    const evidence = await this.#evidenceRegistry.record(submission, extensionInstanceId, now);
    if (evidence.digest !== submittedDigest) throw new Error('task_evidence_digest_mismatch');
    const binding = record.task.profileBindings[stage.platform];
    if (!binding || !progress.safetyRunId) throw new Error('account_safety_stage_run_missing');
    await this.#accountSafety.finishAuthenticatedRun(
      binding.profileId,
      stage.platform,
      progress.safetyRunId,
      'formal_collection_stage_completed',
      now
    );
    progress.evidence = evidence;
    progress.state = 'completed';
    if (!record.evidence.some((candidate) => candidate.batchId === evidence.batchId)) {
      record.evidence.push(evidence);
    }
    record.state = 'evidence_received';
    record.statusMessage = `evidence_received:${evidence.batchId}`;
    if (record.stageProgress.every((stageProgress) => stageProgress.state === 'completed')) {
      record.state = 'completed';
      record.statusMessage = `completed:${submission.stageId}`;
    } else {
      const next = this.#nextPendingStage(record);
      record.state = 'waiting_for_user_resume';
      record.statusMessage = `user_resume_required:${next?.stage.stageId ?? 'pending_stage'}`;
    }
    return this.#summary(record);
  }

  async approve(taskId: string, now = new Date()): Promise<ConsoleTaskSummary> {
    const record = this.#tasks.get(taskId);
    if (!record?.plan) throw new Error('task_plan_not_available');
    if (record.approvedPlan) return this.#summary(record);
    if (record.state !== 'awaiting_plan_approval') throw new Error('task_plan_approval_state_invalid');
    if (!record.plan.stages.every(
      (stage) => stage.preflight.status === 'ready' && stage.preflight.releaseTrack === 'formal'
    )) {
      record.state = 'blocked';
      record.statusMessage = 'task_plan_contains_unreleased_capabilities';
      throw new Error(record.statusMessage);
    }
    const planDigest = await sha256Hex(canonicalJson(evidencePlanDigestPayload(record.plan)));
    record.approvedPlan = {
      ...record.plan,
      approval: {
        status: 'approved',
        approvedBy: 'user',
        approvedAt: now.toISOString(),
        planDigest
      }
    };
    record.stageProgress = record.approvedPlan.stages.map((stage) => ({
      stageId: stage.stageId,
      state: 'pending'
    }));
    const next = this.#nextPendingStage(record);
    if (!next) {
      record.state = 'blocked';
      record.statusMessage = 'approved_plan_has_no_pending_stage';
      throw new Error(record.statusMessage);
    }
    if (!next.profileBinding) {
      record.state = 'blocked';
      record.statusMessage = 'approved_stage_profile_binding_missing';
      throw new Error(record.statusMessage);
    }
    try {
      await this.#accountSafety.assertPlatformNavigationAllowed(
        next.profileBinding.profileId,
        next.stage.platform,
        now
      );
      record.state = 'approved';
      record.statusMessage = undefined;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('account_safety_')) throw error;
      record.state = 'waiting_for_user_resume';
      record.statusMessage = this.#accountSafetyStatus(next.profileBinding.profileId, next.stage.platform);
    }
    return this.#summary(record);
  }

  async resumeAfterUserConfirmation(taskId: string, now = new Date()): Promise<ConsoleTaskSummary> {
    const record = this.#tasks.get(taskId);
    if (!record?.approvedPlan) throw new Error('task_plan_not_approved');
    if (record.state !== 'waiting_for_user_resume') {
      throw new Error('task_resume_state_invalid');
    }
    const next = this.#nextPendingStage(record);
    if (!next) throw new Error('task_resume_pending_stage_missing');
    if (!next.profileBinding) throw new Error('task_resume_profile_binding_missing');
    try {
      await this.#accountSafety.assertPlatformNavigationAllowed(
        next.profileBinding.profileId,
        next.stage.platform,
        now
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('account_safety_')) {
        record.statusMessage = this.#accountSafetyStatus(next.profileBinding.profileId, next.stage.platform);
      }
      throw error;
    }
    record.state = record.stageProgress.some((stage) => stage.state === 'completed')
      ? 'stage_completed'
      : 'approved';
    record.statusMessage = `user_resumed:${next.stage.stageId}`;
    return this.#summary(record);
  }

  #nextPendingStage(record: TaskRecord) {
    if (!record.approvedPlan) return null;
    const progress = record.stageProgress.find((candidate) => candidate.state === 'pending');
    if (!progress) return null;
    const stage = record.approvedPlan.stages.find((candidate) => candidate.stageId === progress.stageId);
    if (!stage) return null;
    return {
      progress,
      stage,
      profileBinding: record.task.profileBindings[stage.platform]
    };
  }

  #accountSafetyStatus(profileId: string, platform: SupportedPlatform): string {
    const safety = this.#accountSafety.get(profileId, platform);
    return `account_safety_${safety.state}:${safety.reasonCode ?? 'not_ready'}`;
  }

  #summary(record: TaskRecord): ConsoleTaskSummary {
    return {
      taskId: record.task.taskId,
      researchQuestion: record.task.researchQuestion,
      platforms: record.task.platforms,
      state: record.state,
      createdAt: record.createdAt,
      profileBindings: structuredClone(record.task.profileBindings),
      profile: record.task.profile,
      lineage: structuredClone(record.task.lineage),
      stageProgress: structuredClone(record.stageProgress),
      evidence: structuredClone(record.evidence),
      ...(record.approvedPlan
        ? { plan: structuredClone(record.approvedPlan) }
        : record.plan
          ? { plan: structuredClone(record.plan) }
          : {}),
      ...(record.statusMessage ? { statusMessage: record.statusMessage } : {})
    };
  }

  async #expireActiveStages(now: number): Promise<void> {
    for (const record of this.#tasks.values()) {
      if (record.state !== 'stage_active' || !record.approvedPlan) continue;
      const progress = record.stageProgress.find((candidate) => candidate.state === 'active');
      if (!progress?.activatedAt) continue;
      const stage = record.approvedPlan.stages.find((candidate) => candidate.stageId === progress.stageId);
      const activatedAt = Date.parse(progress.activatedAt);
      if (!stage?.budget || !Number.isFinite(activatedAt)) continue;
      if (activatedAt + stage.budget.maxDurationMs > now) continue;
      const binding = record.task.profileBindings[stage.platform];
      if (binding && progress.safetyRunId) {
        const safety = this.#accountSafety.get(binding.profileId, stage.platform);
        if (safety.state === 'running' && safety.activeRun?.runId === progress.safetyRunId) {
          await this.#accountSafety.finishAuthenticatedRun(
            binding.profileId,
            stage.platform,
            progress.safetyRunId,
            'gateway_stage_budget_expired',
            new Date(now)
          );
        }
      }
      progress.state = 'blocked';
      progress.errorCode = 'gateway_stage_budget_expired';
      record.state = 'blocked';
      record.statusMessage = progress.errorCode;
    }
  }

  #validateStageResult(target: CollectionTaskTarget, submission: GatewayEvidenceSubmission): void {
    if (submission.platform !== 'bilibili') throw new Error('task_evidence_platform_not_admitted');
    if (target.type === 'keyword_query' && submission.result.operation === 'breadth_search') {
      const expectedSource = buildNativeSearchUrl(submission.platform, target.query);
      expectedSource.search = '';
      expectedSource.hash = '';
      if (submission.result.sourceUrl !== expectedSource.href) throw new Error('task_evidence_source_mismatch');
      for (const item of submission.result.items) {
        if (
          item.contentType !== 'video' ||
          !/^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}$/.test(item.url)
        ) throw new Error('task_evidence_item_invalid');
      }
      return;
    }
    if (target.type !== 'known_url' || submission.result.operation !== 'detail_read') {
      throw new Error('task_evidence_operation_mismatch');
    }
    if (
      !/^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}$/.test(target.url) ||
      submission.result.sourceUrl !== target.url
    ) throw new Error('task_evidence_source_mismatch');
    const detail = submission.result.detail;
    if (!detail) return;
    if (
      detail.canonicalUrl !== target.url ||
      detail.contentType !== 'video' ||
      !detail.publishedText ||
      detail.visibleMetrics.length < 2 ||
      (!detail.description && !detail.creator)
    ) throw new Error('task_evidence_detail_invalid');
  }
}
