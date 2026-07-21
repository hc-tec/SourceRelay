import type { Page } from 'playwright';
import type { AcquirePageRequest, ManagedPageState } from '@intelligence/collector-contracts';
import { digestUrl, type ManagedPageRecord } from '../../src/page-ledger/page-record.js';

export const profileId = 'profile-one';
export const now = '2026-07-22T00:00:00.000Z';

// A minimal local record boundary for pure lease/reclamation state tests. It
// models only url/isClosed/close and is never used as browser-platform proof.
export interface PageDouble {
  page: Page;
  setUrl(value: string): void;
  readonly closed: boolean;
  readonly closeCalls: number;
}

function pageDouble(initialUrl: string): PageDouble {
  let currentUrl = initialUrl;
  let closed = false;
  let closeCalls = 0;
  const page = {
    url: () => currentUrl,
    isClosed: () => closed,
    close: async () => {
      closeCalls += 1;
      closed = true;
    }
  } as unknown as Page;
  return {
    page,
    setUrl(value: string) { currentUrl = value; },
    get closed() { return closed; },
    get closeCalls() { return closeCalls; }
  };
}

export function record(input: Partial<{
  alias: string;
  url: string;
  state: ManagedPageState;
  platform: string;
  pageRole: string;
  lastUsedAt: string;
  targetUrl: string;
}> = {}): { record: ManagedPageRecord; browserPage: PageDouble } {
  const browserPage = pageDouble(input.url ?? 'https://example.test/current');
  const targetUrl = input.targetUrl ?? input.url ?? 'https://example.test/current';
  const alias = input.alias ?? 'page-1';
  return {
    browserPage,
    record: {
      schemaVersion: 1,
      recordVersion: 1,
      pageAlias: alias,
      targetId: `target-${alias}`,
      targetIdentityDigest: digestUrl(`target-${alias}`),
      page: browserPage.page,
      extensionTabId: 1,
      ownershipSource: 'direct_created',
      platform: input.platform ?? 'bilibili',
      pageRole: input.pageRole ?? 'detail',
      state: input.state ?? 'idle_reusable',
      expectedIdentity: {
        platform: input.platform ?? 'bilibili',
        pageRole: input.pageRole ?? 'detail',
        targetUrlDigest: digestUrl(targetUrl)
      },
      documentGeneration: 0,
      routeGeneration: 0,
      extensionGeneration: 1,
      maxIdleTrustMs: 15 * 60 * 1_000,
      activeLease: null,
      attemptedActionIds: new Set(),
      createdAt: now,
      lastUsedAt: input.lastUsedAt ?? now,
      lastReconciledAt: now,
      stateChangedAt: now,
      quarantineReason: null
    }
  };
}

export function acquireRequest(overrides: Partial<AcquirePageRequest> = {}): AcquirePageRequest {
  return {
    profileId,
    taskId: 'task-1',
    runId: 'run-1',
    platform: 'bilibili',
    pageRole: 'detail',
    targetUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
    leaseDurationMs: 60_000,
    ...overrides
  };
}
