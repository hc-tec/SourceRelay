import type {
  ApprovedEvidencePlan,
  EvidencePlanStage,
  GatewayPairingRecord,
  StageLease,
  StageLeaseStatus
} from '../shared/control-plane';
import { buildNativeSearchUrl } from '../shared/native-search';
import { PROBE_CONTENT_INSTALLATION } from '../shared/protocol';
import { strategiesFor } from '../shared/strategy-registry';

const RUNTIME_SESSION_ID_KEY = 'collector.runtime-session-id';
const STAGE_LEASE_KEY_PREFIX = 'collector.stage-lease.';
const MAX_STAGE_LEASE_MS = 30 * 60 * 1000;
const CONTENT_INJECTION_ATTEMPTS = 20;
const CONTENT_INJECTION_RETRY_MS = 500;
const CONTENT_INJECTION_ATTEMPT_TIMEOUT_MS = 2_000;
const contentInjectionFlights = new Map<string, Promise<void>>();

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
  if (
    stage.target.type === 'known_url' &&
    stage.platform === 'bilibili' &&
    stage.evidenceObjective === 'detail_read' &&
    stage.strategy &&
    /^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}$/.test(stage.target.url)
  ) return new URL(stage.target.url);
  throw new Error('The selected strategy does not yet define a safe native navigation for this target.');
}

function normaliseLeaseNavigationUrl(value: string, lease: StageLease): string | null {
  try {
    const url = new URL(value);
    if (lease.platform === 'bilibili' && lease.evidenceObjective === 'detail_read') {
      const match = url.hostname === 'www.bilibili.com' && url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
      if (url.protocol !== 'https:' || !match || url.username || url.password) return null;
      return `https://www.bilibili.com/video/${match[1]}`;
    }
    return url.href;
  } catch {
    return null;
  }
}

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

async function tabHasExpectedLeaseUrl(tab: chrome.tabs.Tab, lease: StageLease): Promise<boolean> {
  if (!tab.url) return false;
  const normalised = normaliseLeaseNavigationUrl(tab.url, lease);
  return Boolean(normalised && (await sha256(normalised)) === lease.navigationUrlDigest);
}

async function performTaskContentInjection(lease: StageLease): Promise<void> {
  for (let attempt = 1; attempt <= CONTENT_INJECTION_ATTEMPTS; attempt += 1) {
    const currentLease = await stageLeaseForTab(lease.tabId);
    if (!currentLease || currentLease.leaseId !== lease.leaseId || currentLease.status !== 'active') {
      throw new Error('gateway_stage_lease_inactive');
    }
    try {
      const tab = await withTimeout(
        chrome.tabs.get(lease.tabId),
        CONTENT_INJECTION_ATTEMPT_TIMEOUT_MS
      );
      if (await tabHasExpectedLeaseUrl(tab, lease)) {
        await withTimeout(
          chrome.scripting.executeScript({
            target: { tabId: lease.tabId },
            files: ['content.js']
          }),
          CONTENT_INJECTION_ATTEMPT_TIMEOUT_MS
        );
        const receipt = await withTimeout(
          chrome.tabs.sendMessage(lease.tabId, { type: PROBE_CONTENT_INSTALLATION }),
          CONTENT_INJECTION_ATTEMPT_TIMEOUT_MS
        );
        const receiptUrl = typeof receipt?.pageUrl === 'string'
          ? normaliseLeaseNavigationUrl(receipt.pageUrl, lease)
          : null;
        if (
          receipt?.ok === true &&
          receipt.installed === true &&
          receiptUrl &&
          (await sha256(receiptUrl)) === lease.navigationUrlDigest
        ) return;
      }
    } catch {
      // Navigation commit and renderer creation are asynchronous. A bounded
      // retry is expected here; no arbitrary script or additional origin is used.
    }
    if (attempt < CONTENT_INJECTION_ATTEMPTS) await delay(CONTENT_INJECTION_RETRY_MS);
  }
  await updateStageLeaseStatus(lease.tabId, 'cancelled');
  await chrome.windows.remove(lease.windowId).catch(() => undefined);
  throw new Error('gateway_content_injection_failed');
}

export function ensureTaskContentInjected(lease: StageLease): Promise<void> {
  const existing = contentInjectionFlights.get(lease.leaseId);
  if (existing) return existing;
  const pending = performTaskContentInjection(lease).finally(() => {
    if (contentInjectionFlights.get(lease.leaseId) === pending) {
      contentInjectionFlights.delete(lease.leaseId);
    }
  });
  contentInjectionFlights.set(lease.leaseId, pending);
  return pending;
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
    await ensureTaskContentInjected(lease);
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
  const normalisedSenderUrl = normaliseLeaseNavigationUrl(senderUrl, lease);
  if (!normalisedSenderUrl || (await sha256(normalisedSenderUrl)) !== lease.navigationUrlDigest) return null;
  if (!lease.documentId || lease.documentId !== documentId) {
    // Some platform pages replace the top-level document while keeping the
    // same canonical URL. The exact leased tab + URL digest remains the trust
    // boundary; the newest matching extension document may take over.
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
  // The dedicated window is intentionally created on about:blank before its
  // leased navigation. Chrome may deliver that scaffolding update late.
  if (changedUrl === 'about:blank') return;
  const normalisedChangedUrl = normaliseLeaseNavigationUrl(changedUrl, lease);
  if (!normalisedChangedUrl || (await sha256(normalisedChangedUrl)) !== lease.navigationUrlDigest) {
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
