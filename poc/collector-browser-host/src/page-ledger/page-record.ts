import { createHash, randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import {
  PAGE_LEASE_SCHEMA_VERSION,
  PAGE_RECORD_SCHEMA_VERSION,
  type ManagedPageOwnershipSource,
  type ManagedPageState,
  type ManagedPageSummary,
  type PageIdentityExpectation,
  type PageLeaseSnapshot
} from '@intelligence/collector-contracts';

export interface ManagedPageRecord {
  schemaVersion: typeof PAGE_RECORD_SCHEMA_VERSION;
  recordVersion: number;
  pageAlias: string;
  targetId: string;
  targetIdentityDigest: string;
  page: Page;
  extensionTabId: number | null;
  ownershipSource: ManagedPageOwnershipSource;
  platform: string;
  pageRole: string;
  state: ManagedPageState;
  expectedIdentity: PageIdentityExpectation;
  documentGeneration: number;
  routeGeneration: number;
  extensionGeneration: number;
  maxIdleTrustMs: number;
  activeLease: PageLeaseSnapshot | null;
  attemptedActionIds: Set<string>;
  createdAt: string;
  lastUsedAt: string;
  lastReconciledAt: string;
  stateChangedAt: string;
  quarantineReason: string | null;
}

export function digestUrl(value: string): string {
  return createHash('sha256').update(canonicalUrlIdentity(value)).digest('hex');
}

export function canonicalUrlIdentity(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.searchParams.sort();
      return url.toString();
    }
    // URL.origin is deliberately "null" for non-standard schemes such as
    // chrome-extension:.  Preserve the actual extension host so distinct
    // extensions cannot collapse into the same page-identity namespace.
    if (url.protocol === 'chrome-extension:') return `${url.protocol}//${url.host}${url.pathname}`;
    return url.href;
  } catch {
    return value;
  }
}

export async function targetIdForPage(page: Page): Promise<string> {
  const session = await page.context().newCDPSession(page);
  try {
    const result = await session.send('Target.getTargetInfo') as { targetInfo?: { targetId?: unknown } };
    const targetId = result.targetInfo?.targetId;
    if (typeof targetId !== 'string' || targetId.length < 1) throw new Error('browser_target_id_unavailable');
    return targetId;
  } finally {
    await session.detach().catch(() => undefined);
  }
}

export function createLease(input: {
  controllerGeneration: string;
  profileId: string;
  taskId: string;
  runId: string;
  stageLeaseId: string | null;
  platform: string;
  pageRole: string;
  leaseDurationMs: number;
  now?: Date;
}): PageLeaseSnapshot {
  const now = input.now ?? new Date();
  return {
    schemaVersion: PAGE_LEASE_SCHEMA_VERSION,
    pageLeaseId: randomUUID(),
    controllerGeneration: input.controllerGeneration,
    profileId: input.profileId,
    taskId: input.taskId,
    runId: input.runId,
    stageLeaseId: input.stageLeaseId,
    platform: input.platform,
    pageRole: input.pageRole,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + input.leaseDurationMs).toISOString()
  };
}

export function touchRecord(record: ManagedPageRecord, now = new Date()): void {
  record.recordVersion += 1;
  record.lastUsedAt = now.toISOString();
  record.stateChangedAt = now.toISOString();
}

export function transitionRecord(
  record: ManagedPageRecord,
  state: ManagedPageState,
  reason: string | null,
  now = new Date()
): void {
  record.state = state;
  record.quarantineReason = state === 'quarantined' ? reason : null;
  touchRecord(record, now);
}

export function recordSummary(record: ManagedPageRecord): ManagedPageSummary {
  return {
    schemaVersion: PAGE_RECORD_SCHEMA_VERSION,
    recordVersion: record.recordVersion,
    pageAlias: record.pageAlias,
    ownershipSource: record.ownershipSource,
    platform: record.platform,
    pageRole: record.pageRole,
    state: record.state,
    documentGeneration: record.documentGeneration,
    routeGeneration: record.routeGeneration,
    extensionGeneration: record.extensionGeneration,
    extensionTabBound: record.extensionTabId !== null,
    maxIdleTrustMs: record.maxIdleTrustMs,
    activeLease: record.activeLease ? structuredClone(record.activeLease) : null,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    lastReconciledAt: record.lastReconciledAt,
    stateChangedAt: record.stateChangedAt,
    quarantineReason: record.quarantineReason,
    reclaimEligible: record.state === 'idle_reusable' && record.activeLease === null && !record.page.isClosed()
  };
}
