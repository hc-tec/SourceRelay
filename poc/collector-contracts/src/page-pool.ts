export const PAGE_POOL_SCHEMA_VERSION = 1 as const;
export const PAGE_RECORD_SCHEMA_VERSION = 1 as const;
export const PAGE_LEASE_SCHEMA_VERSION = 1 as const;

export const MANAGED_PAGE_STATES = [
  'leased_pre_navigation',
  'leased',
  'idle_reusable',
  'idle_stale',
  'retained_for_review',
  'quarantined',
  'reclaim_pending',
  'closed'
] as const;

export type ManagedPageState = (typeof MANAGED_PAGE_STATES)[number];
export type ManagedPageOwnershipSource = 'direct_created' | 'action_created';

export type ManagedPageSelection =
  | 'reused_exact_target'
  | 'reused_same_role'
  | 'reused_same_profile'
  | 'created_new_page';

export type PageReleaseDisposition =
  | 'idle_reusable'
  | 'retained_for_review'
  | 'quarantined';

export interface PageIdentityExpectation {
  platform: string;
  pageRole: string;
  targetUrlDigest: string | null;
}

export interface PageLeaseSnapshot {
  schemaVersion: typeof PAGE_LEASE_SCHEMA_VERSION;
  pageLeaseId: string;
  controllerGeneration: string;
  profileId: string;
  taskId: string;
  runId: string;
  stageLeaseId: string | null;
  platform: string;
  pageRole: string;
  issuedAt: string;
  expiresAt: string;
}

export interface ManagedPageSummary {
  schemaVersion: typeof PAGE_RECORD_SCHEMA_VERSION;
  recordVersion: number;
  pageAlias: string;
  ownershipSource: ManagedPageOwnershipSource;
  platform: string;
  pageRole: string;
  state: ManagedPageState;
  documentGeneration: number;
  routeGeneration: number;
  extensionGeneration: number;
  maxIdleTrustMs: number;
  activeLease: PageLeaseSnapshot | null;
  createdAt: string;
  lastUsedAt: string;
  lastReconciledAt: string;
  stateChangedAt: string;
  quarantineReason: string | null;
  reclaimEligible: boolean;
}

export interface BrowserProfilePagePoolSummary {
  profileId: string;
  browserSessionId: string;
  browserProcessId: number | null;
  running: boolean;
  maximumManagedPages: number;
  managedPages: number;
  leasedPages: number;
  idleReusablePages: number;
  idleStalePages: number;
  retainedPages: number;
  quarantinedPages: number;
  reclaimPendingPages: number;
  closedPages: number;
  unmanagedPages: number;
  extensionPages: number;
  livePlatformRequests: number;
  pages: readonly ManagedPageSummary[];
}

export interface PagePoolSnapshot {
  schemaVersion: typeof PAGE_POOL_SCHEMA_VERSION;
  hostInstanceId: string;
  hostProcessId: number;
  browserSessionId: string | null;
  controllerGeneration: string | null;
  snapshotRevision: number;
  capturedAt: string;
  profiles: readonly BrowserProfilePagePoolSummary[];
}

export interface LaunchProfileRequest {
  profileId: string;
  maximumManagedPages?: number;
  headless?: boolean;
  offlineOnly?: boolean;
}

export interface AcquirePageRequest {
  profileId: string;
  taskId: string;
  runId: string;
  stageLeaseId?: string | null;
  platform: string;
  pageRole: string;
  targetUrl?: string | null;
  maximumManagedPages?: number;
  maxIdleTrustMs?: number;
  leaseDurationMs: number;
}

export interface AcquirePageResult {
  page: ManagedPageSummary;
  lease: PageLeaseSnapshot;
  selection: ManagedPageSelection;
}

export interface ReleasePageRequest {
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  disposition: PageReleaseDisposition;
  quarantineReason?: string | null;
}

export interface NavigatePageRequest {
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  actionId: string;
  url: string;
  waitUntil?: 'commit' | 'domcontentloaded' | 'load';
  timeoutMs: number;
}

export interface ReconcilePageRequest {
  profileId: string;
  pageAlias: string;
}

export interface CreateReclaimPlanRequest {
  profileId: string;
  maximumPagesToClose: number;
  expiresInMs: number;
}

export interface ReclaimPlanCandidate {
  pageAlias: string;
  pageRole: string;
  recordVersion: number;
  idleSince: string;
  selectionReason: 'least_recently_used';
}

export interface ReclaimPlan {
  schemaVersion: 1;
  reclaimPlanId: string;
  profileId: string;
  browserSessionId: string;
  createdAt: string;
  expiresAt: string;
  candidates: readonly ReclaimPlanCandidate[];
}

export interface ExecuteReclaimPlanRequest {
  reclaimPlanId: string;
}

export interface ReclaimExecutionItem {
  pageAlias: string;
  status: 'closed' | 'skipped' | 'changed';
  reason: string;
}

export interface ReclaimExecutionResult {
  reclaimPlanId: string;
  items: readonly ReclaimExecutionItem[];
}
