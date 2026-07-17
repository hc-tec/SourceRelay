import type {
  ApprovedEvidencePlan,
  EvidencePlanStage,
  GatewayPairingRecord,
  StageLease,
  StageLeaseStatus
} from '../shared/control-plane';
import { buildNativeSearchUrl } from '../shared/native-search';
import { strategiesFor } from '../shared/strategy-registry';

const RUNTIME_SESSION_ID_KEY = 'collector.runtime-session-id';
const STAGE_LEASE_KEY_PREFIX = 'collector.stage-lease.';
const MAX_STAGE_LEASE_MS = 30 * 60 * 1000;

function stageLeaseKey(tabId: number): string {
  return `${STAGE_LEASE_KEY_PREFIX}${tabId}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function runtimeSessionId(): Promise<string> {
  const stored = await chrome.storage.session.get(RUNTIME_SESSION_ID_KEY);
  const existing = stored[RUNTIME_SESSION_ID_KEY];
  if (typeof existing === 'string' && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const created = crypto.randomUUID();
  await chrome.storage.session.set({ [RUNTIME_SESSION_ID_KEY]: created });
  return created;
}

function isStageLease(value: unknown): value is StageLease {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StageLease>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.leaseId === 'string' &&
    typeof candidate.runtimeSessionId === 'string' &&
    typeof candidate.gatewayInstanceId === 'string' &&
    typeof candidate.taskId === 'string' &&
    typeof candidate.planId === 'string' &&
    typeof candidate.stageId === 'string' &&
    typeof candidate.evidenceObjective === 'string' &&
    typeof candidate.strategyId === 'string' &&
    typeof candidate.strategyVersion === 'string' &&
    typeof candidate.windowId === 'number' &&
    typeof candidate.tabId === 'number' &&
    typeof candidate.navigationUrlDigest === 'string' &&
    typeof candidate.issuedAt === 'string' &&
    typeof candidate.expiresAt === 'string' &&
    typeof candidate.status === 'string'
  );
}

function navigationUrlForStage(stage: EvidencePlanStage): URL {
  if (
    stage.target.type === 'keyword_query' &&
    stage.evidenceObjective === 'breadth_search' &&
    stage.strategy
  ) {
    return buildNativeSearchUrl(stage.platform, stage.target.query);
  }
  throw new Error('The selected strategy does not yet define a safe native navigation for this target.');
}

export async function createCollectionWindowLease(input: {
  pairing: GatewayPairingRecord;
  plan: ApprovedEvidencePlan;
  stageId: string;
}): Promise<StageLease> {
  const { pairing, plan } = input;
  if (plan.approval.status !== 'approved') throw new Error('The evidence plan is not approved.');
  const stage = plan.stages.find((candidate) => candidate.stageId === input.stageId);
  if (!stage) throw new Error('The stage does not belong to the approved plan.');
  if (stage.preflight.status !== 'ready') {
    throw new Error(`The stage cannot start while preflight is ${stage.preflight.status}.`);
  }
  if (!stage.strategy || !stage.budget) throw new Error('The stage has no admitted strategy or platform budget.');
  const currentStrategy = strategiesFor(stage.platform, stage.evidenceObjective).find(
    (candidate) =>
      candidate.strategyId === stage.strategy?.strategyId &&
      candidate.version === stage.strategy?.version
  );
  if (
    !currentStrategy ||
    (currentStrategy.maturity !== 'live_anonymous_verified' &&
      currentStrategy.maturity !== 'live_authenticated_verified')
  ) {
    throw new Error('The strategy is not currently admitted for live collection.');
  }
  const hasOrigins = await chrome.permissions.contains({
    origins: [...currentStrategy.browser.optionalHostPermissions]
  });
  if (!hasOrigins) throw new Error('The strategy no longer has its approved optional host permission.');

  const navigationUrl = navigationUrlForStage(stage);
  const createdWindow = await chrome.windows.create({
    url: 'about:blank',
    focused: true,
    type: 'normal'
  });
  if (!createdWindow) throw new Error('Chrome did not create the dedicated Collection Window.');
  const tab = createdWindow.tabs?.[0];
  if (typeof createdWindow.id !== 'number' || typeof tab?.id !== 'number') {
    if (typeof createdWindow.id === 'number') await chrome.windows.remove(createdWindow.id).catch(() => undefined);
    throw new Error('Chrome did not create the dedicated Collection Window.');
  }

  const issuedAt = new Date();
  const leaseDurationMs = Math.min(stage.budget.maxDurationMs, MAX_STAGE_LEASE_MS);
  const lease: StageLease = {
    schemaVersion: 1,
    leaseId: crypto.randomUUID(),
    runtimeSessionId: await runtimeSessionId(),
    gatewayInstanceId: pairing.gatewayInstanceId,
    taskId: plan.taskId,
    planId: plan.planId,
    stageId: stage.stageId,
    platform: stage.platform,
    evidenceObjective: stage.evidenceObjective,
    strategyId: stage.strategy.strategyId,
    strategyVersion: stage.strategy.version,
    windowId: createdWindow.id,
    tabId: tab.id,
    navigationUrlDigest: await sha256(navigationUrl.href),
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + leaseDurationMs).toISOString(),
    status: 'active'
  };

  await chrome.storage.session.set({ [stageLeaseKey(tab.id)]: lease });
  try {
    await chrome.tabs.update(tab.id, { url: navigationUrl.href, active: true });
  } catch (error) {
    await updateStageLeaseStatus(tab.id, 'cancelled');
    await chrome.windows.remove(createdWindow.id).catch(() => undefined);
    throw error;
  }
  return lease;
}

export async function stageLeaseForTab(tabId: number): Promise<StageLease | null> {
  const key = stageLeaseKey(tabId);
  const value = (await chrome.storage.session.get(key))[key];
  if (!isStageLease(value)) return null;
  if (value.status === 'active' && Date.parse(value.expiresAt) <= Date.now()) {
    const expired = { ...value, status: 'expired' as const };
    await chrome.storage.session.set({ [key]: expired });
    return expired;
  }
  return value;
}

export async function activeStageLeaseForSender(
  tabId: number,
  senderUrl: string | undefined,
  documentId: string | undefined
): Promise<StageLease | null> {
  if (!senderUrl || !documentId) return null;
  const lease = await stageLeaseForTab(tabId);
  if (!lease || lease.status !== 'active') return null;
  if ((await sha256(senderUrl)) !== lease.navigationUrlDigest) return null;
  if (lease.documentId && lease.documentId !== documentId) return null;
  if (!lease.documentId) {
    const bound = { ...lease, documentId };
    await chrome.storage.session.set({ [stageLeaseKey(tabId)]: bound });
    return bound;
  }
  return lease;
}

export async function updateStageLeaseStatus(tabId: number, status: StageLeaseStatus): Promise<void> {
  const lease = await stageLeaseForTab(tabId);
  if (!lease) return;
  await chrome.storage.session.set({ [stageLeaseKey(tabId)]: { ...lease, status } });
}

export async function markTaskContextChanged(tabId: number, changedUrl: string): Promise<void> {
  const lease = await stageLeaseForTab(tabId);
  if (!lease || lease.status !== 'active') return;
  if ((await sha256(changedUrl)) !== lease.navigationUrlDigest) {
    await updateStageLeaseStatus(tabId, 'task_context_changed');
  }
}

export async function listStageLeases(): Promise<StageLease[]> {
  const stored = await chrome.storage.session.get(null);
  const leases = Object.entries(stored)
    .filter(([key]) => key.startsWith(STAGE_LEASE_KEY_PREFIX))
    .map(([, value]) => value)
    .filter(isStageLease);
  for (const lease of leases) {
    if (lease.status === 'active' && Date.parse(lease.expiresAt) <= Date.now()) {
      await updateStageLeaseStatus(lease.tabId, 'expired');
    }
  }
  const refreshed = await chrome.storage.session.get(null);
  return Object.entries(refreshed)
    .filter(([key]) => key.startsWith(STAGE_LEASE_KEY_PREFIX))
    .map(([, value]) => value)
    .filter(isStageLease);
}

export async function markWindowClosed(windowId: number): Promise<void> {
  const leases = await listStageLeases();
  await Promise.all(
    leases
      .filter((lease) => lease.windowId === windowId && lease.status === 'active')
      .map((lease) => updateStageLeaseStatus(lease.tabId, 'window_closed'))
  );
}

export async function invalidateLeasesWithoutPermissions(): Promise<void> {
  const leases = await listStageLeases();
  for (const lease of leases.filter((candidate) => candidate.status === 'active')) {
    const strategy = strategiesFor(lease.platform, lease.evidenceObjective).find(
      (candidate) => candidate.strategyId === lease.strategyId && candidate.version === lease.strategyVersion
    );
    const stillGranted = strategy
      ? await chrome.permissions.contains({ origins: [...strategy.browser.optionalHostPermissions] })
      : false;
    if (!stillGranted) await updateStageLeaseStatus(lease.tabId, 'permission_revoked');
  }
}
