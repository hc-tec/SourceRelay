import type {
  GatewayEvidenceBatchSummary,
  GatewayEvidenceSubmission,
  StageLease
} from '../shared/control-plane';
import { COLLECTOR_CORE_VERSION, type VisibleCollectionResult } from '../shared/protocol';
import { authenticatedGatewayRequest } from './gateway-client';
import { getGatewayPairing } from './pairing-store';
import { stageLeaseForTab, updateStageLeaseStatus } from './stage-leases';

const PENDING_EVIDENCE_KEY_PREFIX = 'collector.pending-evidence.v1.';
const RESULT_KEY_PREFIX = 'collector.visible-result.';
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

interface PendingEvidenceSubmission {
  schemaVersion: 1;
  tabId: number;
  queuedAt: string;
  submission: GatewayEvidenceSubmission;
}

const inFlight = new Map<string, Promise<GatewayEvidenceBatchSummary>>();

function pendingKey(taskId: string, stageId: string): string {
  return `${PENDING_EVIDENCE_KEY_PREFIX}${taskId}.${stageId}`;
}

function resultKey(taskId: string, stageId: string): string {
  return `${RESULT_KEY_PREFIX}${taskId}.${stageId}`;
}

function isPendingEvidence(value: unknown): value is PendingEvidenceSubmission {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PendingEvidenceSubmission>;
  const submission = candidate.submission as Partial<GatewayEvidenceSubmission> | undefined;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.tabId === 'number' && Number.isSafeInteger(candidate.tabId) && candidate.tabId >= 0 &&
    typeof candidate.queuedAt === 'string' && Number.isFinite(Date.parse(candidate.queuedAt)) &&
    submission?.schemaVersion === 1 &&
    typeof submission.taskId === 'string' &&
    typeof submission.stageId === 'string' &&
    typeof submission.leaseId === 'string' && UUID_PATTERN.test(submission.leaseId) &&
    Boolean(submission.result)
  );
}

function evidenceSummary(value: unknown, pending: PendingEvidenceSubmission): GatewayEvidenceBatchSummary {
  if (!value || typeof value !== 'object') throw new Error('gateway_evidence_response_invalid');
  const response = value as { evidence?: Partial<GatewayEvidenceBatchSummary> };
  const evidence = response.evidence;
  if (
    evidence?.schemaVersion !== 1 ||
    typeof evidence.batchId !== 'string' || !UUID_PATTERN.test(evidence.batchId) ||
    evidence.taskId !== pending.submission.taskId ||
    evidence.stageId !== pending.submission.stageId ||
    typeof evidence.digest !== 'string' || !/^[0-9a-f]{64}$/.test(evidence.digest) ||
    evidence.itemCount !== pending.submission.result.itemCount ||
    typeof evidence.receivedAt !== 'string' || !Number.isFinite(Date.parse(evidence.receivedAt))
  ) throw new Error('gateway_evidence_response_invalid');
  return evidence as GatewayEvidenceBatchSummary;
}

async function postPending(
  key: string,
  pending: PendingEvidenceSubmission
): Promise<GatewayEvidenceBatchSummary> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const operation = (async () => {
    const pairing = await getGatewayPairing();
    if (!pairing) throw new Error('gateway_pairing_missing');
    const lease = await stageLeaseForTab(pending.tabId);
    if (!lease) throw new Error('gateway_evidence_lease_missing');
    if (
      lease.gatewayInstanceId !== pairing.gatewayInstanceId ||
      lease.taskId !== pending.submission.taskId ||
      lease.stageId !== pending.submission.stageId ||
      lease.leaseId !== pending.submission.leaseId ||
      (lease.status !== 'active' && lease.status !== 'awaiting_evidence')
    ) throw new Error('gateway_evidence_lease_mismatch');

    const response = await authenticatedGatewayRequest({
      pairing,
      method: 'POST',
      pathname: '/v1/extension/evidence',
      body: pending.submission
    });
    const evidence = evidenceSummary(response, pending);
    await chrome.storage.session.set({
      [resultKey(pending.submission.taskId, pending.submission.stageId)]: pending.submission.result
    });
    await updateStageLeaseStatus(pending.tabId, 'completed');
    await chrome.storage.local.remove(key);
    // Collection windows are stage-scoped product surfaces. Once the Gateway
    // has durably acknowledged Evidence, keep the control page but close this
    // leased window so completed tasks cannot accumulate tabs/windows.
    await chrome.windows.remove(lease.windowId).catch(() => undefined);
    return evidence;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, operation);
  return operation;
}

export async function submitStageEvidence(
  lease: StageLease,
  result: VisibleCollectionResult
): Promise<GatewayEvidenceBatchSummary> {
  if (
    lease.status !== 'active' ||
    result.platform !== lease.platform ||
    !result.strategy ||
    result.strategy.strategyId !== lease.strategyId ||
    result.strategy.version !== lease.strategyVersion
  ) throw new Error('gateway_evidence_result_mismatch');

  const submission: GatewayEvidenceSubmission = {
    schemaVersion: 1,
    collectorVersion: COLLECTOR_CORE_VERSION,
    taskId: lease.taskId,
    stageId: lease.stageId,
    leaseId: lease.leaseId,
    platform: lease.platform,
    strategy: result.strategy,
    capturedAt: new Date().toISOString(),
    result
  };
  const pending: PendingEvidenceSubmission = {
    schemaVersion: 1,
    tabId: lease.tabId,
    queuedAt: new Date().toISOString(),
    submission
  };
  const key = pendingKey(lease.taskId, lease.stageId);
  await chrome.storage.local.set({ [key]: pending });
  await updateStageLeaseStatus(lease.tabId, 'awaiting_evidence');
  return postPending(key, pending);
}

export async function flushPendingEvidenceSubmissions(): Promise<void> {
  const stored = await chrome.storage.local.get(null);
  const pending = Object.entries(stored)
    .filter(([key]) => key.startsWith(PENDING_EVIDENCE_KEY_PREFIX))
    .map(([key, value]) => ({ key, value }))
    .filter((entry): entry is { key: string; value: PendingEvidenceSubmission } => isPendingEvidence(entry.value));
  for (const entry of pending) {
    await postPending(entry.key, entry.value);
  }
}
