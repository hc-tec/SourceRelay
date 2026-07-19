import type {
  ApprovedEvidencePlan,
  GatewayPreflightRequestEnvelope,
  GatewayRuntimeStatus,
  GatewayStageReceipt,
  GatewayTaskDispatchEnvelope,
  StageLease,
  GatewayWorkItem
} from '../shared/control-plane';
import {
  evidencePlanDigestPayload,
  unsignedGatewayEnvelope
} from '../shared/control-plane';
import {
  isSupportedPlatform,
  type BrowserProfileBinding,
  type ResearchTaskContract,
  type SupportedPlatform
} from '../shared/collection-contracts';
import {
  canonicalJson,
  sha256Hex,
  verifyGatewaySignature
} from '../shared/cryptography';
import { COLLECT_VISIBLE_RESULTS, type VisibleCollectionResult } from '../shared/protocol';
import { buildEvidencePlan } from '../shared/control-plane';
import { authenticatedGatewayRequest } from './gateway-client';
import { flushPendingEvidenceSubmissions, submitStageEvidence } from './evidence-submission';
import { getGatewayPairing } from './pairing-store';
import {
  createCollectionWindowLease,
  ensureTaskContentInjected,
  listStageLeases,
  stageLeaseForTab,
  updateStageLeaseStatus
} from './stage-leases';

export const GATEWAY_POLL_ALARM = 'collector.gateway.poll.v1';
export const GATEWAY_CONTINUE_ALARM = 'collector.gateway.continue.v1';
export const STAGE_WATCHDOG_ALARM_PREFIX = 'collector.stage-watchdog.v1.';
const GATEWAY_RUNTIME_STATUS_KEY = 'collector.gateway-runtime-status.v1';
const ACCEPTED_GATEWAY_NONCES_KEY = 'collector.gateway-accepted-nonces.v1';
const STAGE_WATCHDOG_KEY_PREFIX = 'collector.stage-watchdog-record.v1.';
const MAX_ACCEPTED_NONCES = 128;
const STAGE_COLLECTION_WINDOW_MS = 30_000;
const STAGE_COLLECTION_POLL_MS = 500;
const STAGE_MESSAGE_TIMEOUT_MS = 1_500;
const STAGE_WATCHDOG_MS = 45_000;
const MAX_CONTENT_RECOVERIES = 3;
const LOCAL_EVIDENCE_FLUSH_ATTEMPTS = 3;
const LOCAL_EVIDENCE_FLUSH_RETRY_MS = 100;

let activePoll: Promise<void> | null = null;

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function withTimeout<T>(operation: Promise<T>, durationMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('chrome_operation_timeout')), durationMs);
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

export async function retryLocalEvidenceFlush(
  operation: () => Promise<void>,
  wait: (durationMs: number) => Promise<void> = delay
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < LOCAL_EVIDENCE_FLUSH_ATTEMPTS; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < LOCAL_EVIDENCE_FLUSH_ATTEMPTS) {
        await wait(LOCAL_EVIDENCE_FLUSH_RETRY_MS);
      }
    }
  }
  throw lastError;
}

async function flushPendingEvidenceWithReceiptBarrier(): Promise<void> {
  await retryLocalEvidenceFlush(() => flushPendingEvidenceSubmissions());
}

interface StageWatchdogRecord {
  schemaVersion: 1;
  alarmName: string;
  taskId: string;
  stageId: string;
  leaseId: string;
  tabId: number;
}

function stageWatchdogKey(leaseId: string): string {
  return `${STAGE_WATCHDOG_KEY_PREFIX}${leaseId}`;
}

function isStageWatchdogRecord(value: unknown): value is StageWatchdogRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StageWatchdogRecord>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.alarmName === 'string' &&
    typeof candidate.taskId === 'string' &&
    typeof candidate.stageId === 'string' &&
    typeof candidate.leaseId === 'string' &&
    typeof candidate.tabId === 'number'
  );
}

async function armStageWatchdog(lease: StageLease): Promise<void> {
  const alarmName = `${STAGE_WATCHDOG_ALARM_PREFIX}${lease.leaseId}`;
  const record: StageWatchdogRecord = {
    schemaVersion: 1,
    alarmName,
    taskId: lease.taskId,
    stageId: lease.stageId,
    leaseId: lease.leaseId,
    tabId: lease.tabId
  };
  await chrome.storage.session.set({ [stageWatchdogKey(lease.leaseId)]: record });
  await chrome.alarms.create(alarmName, { when: Date.now() + STAGE_WATCHDOG_MS });
}

export async function clearStageWatchdog(leaseId: string): Promise<void> {
  await chrome.alarms.clear(`${STAGE_WATCHDOG_ALARM_PREFIX}${leaseId}`);
  await chrome.storage.session.remove(stageWatchdogKey(leaseId));
}

function isSubmissionReady(result: VisibleCollectionResult): boolean {
  if (result.pageState !== 'layout_unrecognized' && result.pageState !== 'results_visible') return true;
  if (result.operation === 'breadth_search') return result.pageState === 'results_visible';
  return Boolean(
    result.detail?.publishedText &&
    result.detail.visibleMetrics.length >= 2 &&
    (result.detail.description || result.detail.creator)
  );
}

async function collectApprovedStage(lease: StageLease): Promise<void> {
  const deadline = Math.min(Date.parse(lease.expiresAt), Date.now() + STAGE_COLLECTION_WINDOW_MS);
  let contentRecoveries = 0;
  while (Date.now() < deadline) {
    const currentLease = await stageLeaseForTab(lease.tabId);
    if (!currentLease || currentLease.leaseId !== lease.leaseId) throw new Error('gateway_stage_lease_inactive');
    if (currentLease.status === 'completed') return;
    if (currentLease.status === 'awaiting_evidence') {
      await flushPendingEvidenceWithReceiptBarrier();
      return;
    }
    if (currentLease.status !== 'active') throw new Error('gateway_stage_lease_inactive');
    let response: { ok?: unknown; result?: unknown } | null = null;
    try {
      response = await withTimeout(
        chrome.tabs.sendMessage(lease.tabId, { type: COLLECT_VISIBLE_RESULTS }),
        STAGE_MESSAGE_TIMEOUT_MS
      ) as { ok?: unknown; result?: unknown };
    } catch {
      if (contentRecoveries < MAX_CONTENT_RECOVERIES) {
        contentRecoveries += 1;
        await ensureTaskContentInjected(currentLease);
      }
      await delay(STAGE_COLLECTION_POLL_MS);
      continue;
    }
    const result = response?.result as VisibleCollectionResult | undefined;
    if (response?.ok === true && result?.schemaVersion === 1 && isSubmissionReady(result)) {
      // Revalidate the exact target URL after reading the DOM. A player-driven
      // recommendation navigation must never be admitted as the selected item.
      await ensureTaskContentInjected(currentLease);
      const verifiedLease = await stageLeaseForTab(lease.tabId);
      if (!verifiedLease || verifiedLease.leaseId !== lease.leaseId || verifiedLease.status !== 'active') {
        throw new Error('gateway_stage_lease_inactive');
      }
      await submitStageEvidence(verifiedLease, result);
      await clearStageWatchdog(lease.leaseId);
      await scheduleGatewayContinuation();
      return;
    }
    await delay(STAGE_COLLECTION_POLL_MS);
  }
  throw new Error('gateway_stage_render_timeout');
}

function isCollectionProfileBinding(value: unknown, platform: SupportedPlatform): value is BrowserProfileBinding {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Partial<BrowserProfileBinding>;
  return (
    typeof binding.profileId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(binding.profileId) &&
    binding.kind === 'collection' &&
    binding.platform === platform &&
    binding.account?.category === 'user_managed' &&
    typeof binding.account.label === 'string' &&
    binding.account.label.length > 0 &&
    binding.account.label.length <= 80 &&
    (binding.account.expectedVisibleIdentity === undefined ||
      (typeof binding.account.expectedVisibleIdentity === 'string' &&
        binding.account.expectedVisibleIdentity.length <= 160))
  );
}

function hasValidProfileBindings(task: Partial<ResearchTaskContract>): boolean {
  if (!task.profileBindings || typeof task.profileBindings !== 'object' || Array.isArray(task.profileBindings)) {
    return false;
  }
  const platforms = Array.isArray(task.platforms)
    ? task.platforms.filter(isSupportedPlatform)
    : [];
  return Object.entries(task.profileBindings).every(([platform, binding]) =>
    isSupportedPlatform(platform) &&
    platforms.includes(platform) &&
    isCollectionProfileBinding(binding, platform)
  );
}

function hasValidLineage(task: Partial<ResearchTaskContract>): boolean {
  if (task.lineage === null) return true;
  const lineage = task.lineage;
  return Boolean(
    lineage &&
    typeof lineage === 'object' &&
    /^[0-9a-f-]{36}$/i.test(lineage.parentTaskId) &&
    /^[0-9a-f-]{36}$/i.test(lineage.sourceEvidenceBatchId) &&
    lineage.selectionPolicy === 'explicit_user_selected_ranks' &&
    Array.isArray(lineage.selectedItems) &&
    lineage.selectedItems.length > 0 && lineage.selectedItems.length <= 3 &&
    lineage.selectedItems.every((item) =>
      Number.isSafeInteger(item.sourceRank) && item.sourceRank >= 1 && item.sourceRank <= 20 &&
      /^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}$/.test(item.canonicalUrl)
    )
  );
}

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
    task.platforms.every(isSupportedPlatform) &&
    hasValidProfileBindings(task) &&
    hasValidLineage(task) &&
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
  let acceptedLease: StageLease | null = null;
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
    if (existingLease) await ensureTaskContentInjected(lease);
    acceptedLease = lease;
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
  if (!acceptedLease) throw new Error('gateway_stage_lease_missing');
  await armStageWatchdog(acceptedLease);
  // Navigation can render quickly enough for the content script to queue its
  // result before the accepted lease receipt reaches the Gateway. Retrying
  // here closes that race without weakening the Gateway's stage-active check.
  await flushPendingEvidenceWithReceiptBarrier();
  try {
    await collectApprovedStage(acceptedLease);
  } catch (error) {
    const candidate = error instanceof Error ? error.message : '';
    const errorCode = /^[a-z0-9_]{1,80}$/.test(candidate) ? candidate : 'gateway_stage_collection_failed';
    const blockedReceipt: GatewayStageReceipt = {
      schemaVersion: 1,
      taskId: dispatch.taskId,
      stageId: dispatch.stageId,
      status: 'blocked',
      errorCode,
      recordedAt: new Date().toISOString()
    };
    await authenticatedGatewayRequest({
      pairing,
      method: 'POST',
      pathname: '/v1/extension/stage-receipt',
      body: blockedReceipt
    });
    await clearStageWatchdog(acceptedLease.leaseId);
    await chrome.windows.remove(acceptedLease.windowId).catch(() => undefined);
    throw error;
  }
}

export async function handleStageWatchdogAlarm(alarmName: string): Promise<void> {
  if (!alarmName.startsWith(STAGE_WATCHDOG_ALARM_PREFIX)) return;
  const leaseId = alarmName.slice(STAGE_WATCHDOG_ALARM_PREFIX.length);
  const key = stageWatchdogKey(leaseId);
  const record = (await chrome.storage.session.get(key))[key];
  if (!isStageWatchdogRecord(record) || record.alarmName !== alarmName) return;
  const lease = await stageLeaseForTab(record.tabId);
  if (!lease || lease.leaseId !== record.leaseId || lease.status === 'completed') {
    await clearStageWatchdog(record.leaseId);
    return;
  }
  const pairing = await getGatewayPairing();
  if (!pairing) return;
  const receipt: GatewayStageReceipt = {
    schemaVersion: 1,
    taskId: record.taskId,
    stageId: record.stageId,
    status: 'blocked',
    errorCode: 'gateway_stage_watchdog_expired',
    recordedAt: new Date().toISOString()
  };
  await authenticatedGatewayRequest({
    pairing,
    method: 'POST',
    pathname: '/v1/extension/stage-receipt',
    body: receipt
  });
  await updateStageLeaseStatus(record.tabId, 'cancelled');
  await chrome.windows.remove(lease.windowId).catch(() => undefined);
  await clearStageWatchdog(record.leaseId);
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
    // Pending Evidence is loopback-only and idempotent. Recover it before
    // asking for new work so a content-driven result that raced the accepted
    // receipt cannot remain stranded until the stage watchdog fires.
    await flushPendingEvidenceWithReceiptBarrier();
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

export async function scheduleGatewayContinuation(): Promise<void> {
  if (!(await getGatewayPairing())) return;
  setTimeout(() => void pollGatewayTasks(), 1_000);
  // Chromium clamps short extension alarms. Keep a 30-second alarm as a
  // durable fallback if the MV3 worker is suspended before the in-memory
  // continuation fires.
  await chrome.alarms.create(GATEWAY_CONTINUE_ALARM, { when: Date.now() + 30_000 });
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
