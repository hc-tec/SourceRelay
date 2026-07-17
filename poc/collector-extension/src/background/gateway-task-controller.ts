import type {
  ApprovedEvidencePlan,
  GatewayPreflightRequestEnvelope,
  GatewayRuntimeStatus,
  GatewayStageReceipt,
  GatewayTaskDispatchEnvelope,
  GatewayWorkItem
} from '../shared/control-plane';
import {
  evidencePlanDigestPayload,
  unsignedGatewayEnvelope
} from '../shared/control-plane';
import type { ResearchTaskContract } from '../shared/collection-contracts';
import {
  canonicalJson,
  sha256Hex,
  verifyGatewaySignature
} from '../shared/cryptography';
import { buildEvidencePlan } from '../shared/control-plane';
import { authenticatedGatewayRequest } from './gateway-client';
import { getGatewayPairing } from './pairing-store';
import { createCollectionWindowLease, listStageLeases } from './stage-leases';

export const GATEWAY_POLL_ALARM = 'collector.gateway.poll.v1';
const GATEWAY_RUNTIME_STATUS_KEY = 'collector.gateway-runtime-status.v1';
const ACCEPTED_GATEWAY_NONCES_KEY = 'collector.gateway-accepted-nonces.v1';
const MAX_ACCEPTED_NONCES = 128;

let activePoll: Promise<void> | null = null;

function isResearchTask(value: unknown): value is ResearchTaskContract {
  if (!value || typeof value !== 'object') return false;
  const task = value as Partial<ResearchTaskContract>;
  return (
    task.schemaVersion === 1 &&
    typeof task.taskId === 'string' &&
    task.taskId.length <= 100 &&
    typeof task.researchQuestion === 'string' &&
    task.researchQuestion.length <= 500 &&
    typeof task.decisionContext === 'string' &&
    task.decisionContext.length <= 1_000 &&
    Array.isArray(task.targets) && task.targets.length > 0 && task.targets.length <= 20 &&
    Array.isArray(task.platforms) && task.platforms.length > 0 && task.platforms.length <= 4 &&
    Array.isArray(task.evidenceObjectives) && task.evidenceObjectives.length > 0 && task.evidenceObjectives.length <= 6 &&
    Boolean(task.budget) &&
    Boolean(task.consent)
  );
}

function isPreflightWork(value: unknown): value is GatewayPreflightRequestEnvelope {
  if (!value || typeof value !== 'object') return false;
  const work = value as Partial<GatewayPreflightRequestEnvelope>;
  return (
    work.schemaVersion === 1 &&
    work.protocolVersion === 1 &&
    work.kind === 'preflight_request' &&
    typeof work.gatewayInstanceId === 'string' &&
    typeof work.taskId === 'string' &&
    typeof work.nonce === 'string' &&
    typeof work.issuedAt === 'string' &&
    typeof work.expiresAt === 'string' &&
    typeof work.signature === 'string' &&
    isResearchTask(work.task) &&
    work.task.taskId === work.taskId
  );
}

function isApprovedPlan(value: unknown): value is ApprovedEvidencePlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<ApprovedEvidencePlan>;
  return (
    plan.schemaVersion === 1 &&
    typeof plan.planId === 'string' &&
    typeof plan.taskId === 'string' &&
    Array.isArray(plan.stages) && plan.stages.length > 0 && plan.stages.length <= 100 &&
    plan.approval?.status === 'approved' &&
    typeof plan.approval.planDigest === 'string'
  );
}

function isDispatch(value: unknown): value is GatewayTaskDispatchEnvelope {
  if (!value || typeof value !== 'object') return false;
  const dispatch = value as Partial<GatewayTaskDispatchEnvelope>;
  return (
    dispatch.schemaVersion === 1 &&
    dispatch.protocolVersion === 1 &&
    typeof dispatch.gatewayInstanceId === 'string' &&
    typeof dispatch.taskId === 'string' &&
    typeof dispatch.stageId === 'string' &&
    typeof dispatch.nonce === 'string' &&
    typeof dispatch.issuedAt === 'string' &&
    typeof dispatch.expiresAt === 'string' &&
    typeof dispatch.planDigest === 'string' &&
    typeof dispatch.signature === 'string' &&
    isResearchTask(dispatch.task) &&
    isApprovedPlan(dispatch.plan) &&
    dispatch.task.taskId === dispatch.taskId &&
    dispatch.plan.taskId === dispatch.taskId
  );
}

function isGatewayWork(value: unknown): value is GatewayWorkItem {
  if (isPreflightWork(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const work = value as { schemaVersion?: unknown; protocolVersion?: unknown; kind?: unknown; dispatch?: unknown };
  return work.schemaVersion === 1 && work.protocolVersion === 1 && work.kind === 'approved_dispatch' && isDispatch(work.dispatch);
}

async function setRuntimeStatus(status: GatewayRuntimeStatus): Promise<void> {
  await chrome.storage.session.set({ [GATEWAY_RUNTIME_STATUS_KEY]: status });
}

export async function gatewayRuntimeStatus(): Promise<GatewayRuntimeStatus> {
  const pairing = await getGatewayPairing();
  if (!pairing) return { state: 'unpaired', lastPollAt: null, lastErrorCode: null };
  const stored = (await chrome.storage.session.get(GATEWAY_RUNTIME_STATUS_KEY))[GATEWAY_RUNTIME_STATUS_KEY];
  if (stored && typeof stored === 'object') return stored as GatewayRuntimeStatus;
  return { state: 'idle', lastPollAt: null, lastErrorCode: null };
}

async function acceptFreshNonce(nonce: string, expiresAt: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(nonce)) throw new Error('gateway_nonce_invalid');
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('gateway_envelope_expired');
  const stored = (await chrome.storage.session.get(ACCEPTED_GATEWAY_NONCES_KEY))[ACCEPTED_GATEWAY_NONCES_KEY];
  const current = Array.isArray(stored)
    ? stored.filter((item): item is { nonce: string; expiresAt: number } =>
        Boolean(item) && typeof item.nonce === 'string' && typeof item.expiresAt === 'number' && item.expiresAt > Date.now()
      )
    : [];
  if (current.some((item) => item.nonce === nonce)) throw new Error('gateway_nonce_replayed');
  current.push({ nonce, expiresAt: expiry });
  await chrome.storage.session.set({
    [ACCEPTED_GATEWAY_NONCES_KEY]: current.slice(-MAX_ACCEPTED_NONCES)
  });
}

async function verifyEnvelope(
  pairing: NonNullable<Awaited<ReturnType<typeof getGatewayPairing>>>,
  envelope: GatewayPreflightRequestEnvelope | GatewayTaskDispatchEnvelope
): Promise<void> {
  if (envelope.gatewayInstanceId !== pairing.gatewayInstanceId) throw new Error('gateway_identity_changed');
  if (Date.parse(envelope.issuedAt) > Date.now() + 30_000) throw new Error('gateway_envelope_not_yet_valid');
  const valid = await verifyGatewaySignature({
    publicKeyJwk: pairing.signingPublicKeyJwk,
    payload: canonicalJson(unsignedGatewayEnvelope(envelope)),
    signature: envelope.signature
  });
  if (!valid) throw new Error('gateway_envelope_signature_invalid');
  await acceptFreshNonce(envelope.nonce, envelope.expiresAt);
}

async function processPreflight(
  pairing: NonNullable<Awaited<ReturnType<typeof getGatewayPairing>>>,
  work: GatewayPreflightRequestEnvelope
): Promise<void> {
  await verifyEnvelope(pairing, work);
  const plan = await buildEvidencePlan(
    work.task,
    (origins) => chrome.permissions.contains({ origins: [...origins] })
  );
  await authenticatedGatewayRequest({
    pairing,
    method: 'POST',
    pathname: '/v1/extension/preflight',
    body: { schemaVersion: 1, taskId: work.taskId, plan }
  });
}

async function processDispatch(
  pairing: NonNullable<Awaited<ReturnType<typeof getGatewayPairing>>>,
  dispatch: GatewayTaskDispatchEnvelope
): Promise<void> {
  await verifyEnvelope(pairing, dispatch);
  let receipt: GatewayStageReceipt;
  try {
    const digest = await sha256Hex(canonicalJson(evidencePlanDigestPayload(dispatch.plan)));
    if (digest !== dispatch.planDigest || digest !== dispatch.plan.approval.planDigest) {
      throw new Error('gateway_plan_digest_invalid');
    }
    const currentPlan = await buildEvidencePlan(
      dispatch.task,
      (origins) => chrome.permissions.contains({ origins: [...origins] })
    );
    const currentStage = currentPlan.stages.find((stage) => stage.stageId === dispatch.stageId);
    const approvedStage = dispatch.plan.stages.find((stage) => stage.stageId === dispatch.stageId);
    if (
      !currentStage ||
      !approvedStage ||
      currentStage.preflight.status !== 'ready' ||
      currentStage.strategy?.strategyId !== approvedStage.strategy?.strategyId ||
      currentStage.strategy?.version !== approvedStage.strategy?.version
    ) {
      throw new Error('gateway_dispatch_preflight_changed');
    }

    const existingLease = (await listStageLeases()).find(
      (lease) => lease.taskId === dispatch.taskId && lease.stageId === dispatch.stageId
    );
    if (existingLease && existingLease.status !== 'active' && existingLease.status !== 'completed') {
      throw new Error('gateway_stage_has_terminal_lease');
    }
    const lease = existingLease ?? await createCollectionWindowLease({
      pairing,
      plan: dispatch.plan,
      stageId: dispatch.stageId
    });
    receipt = {
      schemaVersion: 1,
      taskId: dispatch.taskId,
      stageId: dispatch.stageId,
      status: 'accepted',
      leaseId: lease.leaseId,
      recordedAt: new Date().toISOString()
    };
  } catch (error) {
    const candidate = error instanceof Error ? error.message : '';
    const errorCode = /^[a-z0-9_]{1,80}$/.test(candidate) ? candidate : 'gateway_stage_rejected';
    receipt = {
      schemaVersion: 1,
      taskId: dispatch.taskId,
      stageId: dispatch.stageId,
      status: 'blocked',
      errorCode,
      recordedAt: new Date().toISOString()
    };
  }
  await authenticatedGatewayRequest({
    pairing,
    method: 'POST',
    pathname: '/v1/extension/stage-receipt',
    body: receipt
  });
  if (receipt.status === 'blocked') throw new Error(receipt.errorCode ?? 'gateway_stage_rejected');
}

async function performPoll(): Promise<void> {
  const pairing = await getGatewayPairing();
  if (!pairing) {
    await setRuntimeStatus({ state: 'unpaired', lastPollAt: null, lastErrorCode: null });
    return;
  }
  const pollAt = new Date().toISOString();
  await setRuntimeStatus({ state: 'polling', lastPollAt: pollAt, lastErrorCode: null });
  try {
    const value = await authenticatedGatewayRequest({
      pairing,
      method: 'GET',
      pathname: '/v1/extension/work'
    });
    if (value !== null) {
      if (!isGatewayWork(value)) throw new Error('gateway_work_item_invalid');
      if (value.kind === 'preflight_request') await processPreflight(pairing, value);
      else await processDispatch(pairing, value.dispatch);
    }
    await setRuntimeStatus({ state: 'idle', lastPollAt: pollAt, lastErrorCode: null });
  } catch (error) {
    const candidate = error instanceof Error ? error.message : '';
    const errorCode = /^[a-z0-9_]{1,80}$/.test(candidate) ? candidate : 'gateway_unavailable';
    await setRuntimeStatus({ state: 'error', lastPollAt: pollAt, lastErrorCode: errorCode });
  }
}

export function pollGatewayTasks(): Promise<void> {
  if (!activePoll) {
    activePoll = performPoll().finally(() => {
      activePoll = null;
    });
  }
  return activePoll;
}

export async function synchroniseGatewayPolling(): Promise<void> {
  const pairing = await getGatewayPairing();
  if (!pairing) {
    await chrome.alarms.clear(GATEWAY_POLL_ALARM);
    await setRuntimeStatus({ state: 'unpaired', lastPollAt: null, lastErrorCode: null });
    return;
  }
  await chrome.alarms.create(GATEWAY_POLL_ALARM, { periodInMinutes: 1 });
}
