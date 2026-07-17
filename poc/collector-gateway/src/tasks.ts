import { randomUUID } from 'node:crypto';
import type {
  ApprovedEvidencePlan,
  EvidencePlan,
  GatewayApprovedDispatchWorkItem,
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
  type ResearchTaskContract,
  type SupportedPlatform
} from '../../collector-extension/src/shared/collection-contracts';
import { canonicalJson, sha256Hex } from '../../collector-extension/src/shared/cryptography';
import type { LoadedGatewayIdentity } from './identity';

const WORK_ITEM_TTL_MS = 2 * 60 * 1000;
const PREFLIGHT_REDELIVERY_MS = 30_000;

type TaskState =
  | 'queued_for_preflight'
  | 'preflight_dispatched'
  | 'awaiting_plan_approval'
  | 'approved'
  | 'stage_dispatched'
  | 'stage_active'
  | 'blocked';

interface TaskRecord {
  task: ResearchTaskContract;
  state: TaskState;
  createdAt: string;
  lastDispatchedAt?: number;
  plan?: EvidencePlan;
  approvedPlan?: ApprovedEvidencePlan;
  assignedExtensionInstanceId?: string;
  statusMessage?: string;
}

export interface ScoutTaskInput {
  researchQuestion: string;
  decisionContext: string;
  query: string;
  platforms: SupportedPlatform[];
  profileIds: Partial<Record<SupportedPlatform, string>>;
}

export interface ConsoleTaskSummary {
  taskId: string;
  researchQuestion: string;
  platforms: readonly SupportedPlatform[];
  state: TaskState;
  createdAt: string;
  profileBindings: Partial<Record<SupportedPlatform, BrowserProfileBinding>>;
  plan?: EvidencePlan;
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

export class GatewayTaskQueue {
  readonly #identity: LoadedGatewayIdentity;
  readonly #tasks = new Map<string, TaskRecord>();

  constructor(identity: LoadedGatewayIdentity) {
    this.#identity = identity;
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
      createdAt: now.toISOString()
    };
    this.#tasks.set(taskId, record);
    return this.#summary(record);
  }

  list(): ConsoleTaskSummary[] {
    return [...this.#tasks.values()].map((record) => this.#summary(record));
  }

  async nextWork(extensionInstanceId: string, now = Date.now()): Promise<GatewayWorkItem | null> {
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
      (record.state === 'approved' ||
        (record.state === 'stage_dispatched' && now - (record.lastDispatchedAt ?? 0) >= PREFLIGHT_REDELIVERY_MS)) &&
      record.approvedPlan &&
      record.assignedExtensionInstanceId === extensionInstanceId
    );
    if (!approved?.approvedPlan) return null;
    const stage = approved.approvedPlan.stages.find((candidate) => candidate.preflight.status === 'ready');
    if (!stage) {
      approved.state = 'blocked';
      approved.statusMessage = 'approved_plan_has_no_ready_stage';
      return null;
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
    approved.lastDispatchedAt = now;
    return work;
  }

  submitPreflight(submission: GatewayPreflightSubmission, extensionInstanceId: string): ConsoleTaskSummary {
    const record = this.#tasks.get(submission.taskId);
    if (!record || submission.plan.taskId !== submission.taskId) throw new Error('task_not_found');
    if (record.assignedExtensionInstanceId !== extensionInstanceId) throw new Error('task_extension_mismatch');
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

  submitStageReceipt(receipt: GatewayStageReceipt, extensionInstanceId: string): ConsoleTaskSummary {
    const record = this.#tasks.get(receipt.taskId);
    if (!record?.approvedPlan) throw new Error('task_not_found');
    if (record.assignedExtensionInstanceId !== extensionInstanceId) throw new Error('task_extension_mismatch');
    if (!record.approvedPlan.stages.some((stage) => stage.stageId === receipt.stageId)) {
      throw new Error('task_stage_mismatch');
    }
    if (receipt.status === 'accepted') {
      if (!receipt.leaseId || !/^[0-9a-f-]{36}$/i.test(receipt.leaseId)) throw new Error('task_lease_invalid');
      record.state = 'stage_active';
      record.statusMessage = `stage_accepted:${receipt.stageId}`;
    } else {
      if (!receipt.errorCode || !/^[a-z0-9_]{1,80}$/.test(receipt.errorCode)) {
        throw new Error('task_block_reason_invalid');
      }
      record.state = 'blocked';
      record.statusMessage = receipt.errorCode;
    }
    return this.#summary(record);
  }

  async approve(taskId: string, now = new Date()): Promise<ConsoleTaskSummary> {
    const record = this.#tasks.get(taskId);
    if (!record?.plan) throw new Error('task_plan_not_available');
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
    record.state = 'approved';
    record.statusMessage = undefined;
    return this.#summary(record);
  }

  #summary(record: TaskRecord): ConsoleTaskSummary {
    return {
      taskId: record.task.taskId,
      researchQuestion: record.task.researchQuestion,
      platforms: record.task.platforms,
      state: record.state,
      createdAt: record.createdAt,
      profileBindings: structuredClone(record.task.profileBindings),
      ...(record.plan ? { plan: record.plan } : {}),
      ...(record.statusMessage ? { statusMessage: record.statusMessage } : {})
    };
  }
}
