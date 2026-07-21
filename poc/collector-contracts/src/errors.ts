export const BROWSER_HOST_ERROR_SCHEMA_VERSION = 1 as const;

export type BrowserHostErrorScope =
  | 'host'
  | 'browser_session'
  | 'profile'
  | 'page'
  | 'lease'
  | 'action'
  | 'stage';

export type BrowserHostRetryClass =
  | 'never'
  | 'local_query_only'
  | 'new_run_required'
  | 'user_action_required';

export type PageDisposition =
  | 'unchanged'
  | 'idle_reusable'
  | 'idle_stale'
  | 'retained_for_review'
  | 'quarantined'
  | 'closed'
  | 'session_lost';

export type ProfileSafetyDisposition =
  | 'ready'
  | 'stop_run_no_retry'
  | 'authentication_required'
  | 'manual_review_required'
  | 'locked'
  | 'host_blocked';

const ERROR_SCOPES: readonly BrowserHostErrorScope[] = [
  'host',
  'browser_session',
  'profile',
  'page',
  'lease',
  'action',
  'stage'
];

const RETRY_CLASSES: readonly BrowserHostRetryClass[] = [
  'never',
  'local_query_only',
  'new_run_required',
  'user_action_required'
];

const PAGE_DISPOSITIONS: readonly PageDisposition[] = [
  'unchanged',
  'idle_reusable',
  'idle_stale',
  'retained_for_review',
  'quarantined',
  'closed',
  'session_lost'
];

const PROFILE_SAFETY_DISPOSITIONS: readonly ProfileSafetyDisposition[] = [
  'ready',
  'stop_run_no_retry',
  'authentication_required',
  'manual_review_required',
  'locked',
  'host_blocked'
];

function safeCode(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_.-]{1,120}$/i.test(value);
}

function safeDetails(value: unknown): value is Readonly<Record<string, string | number | boolean | null>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.entries(value).every(([key, detail]) =>
    /^[a-z0-9_.-]{1,80}$/i.test(key) &&
    (detail === null || typeof detail === 'boolean' ||
      (typeof detail === 'number' && Number.isFinite(detail)) ||
      (typeof detail === 'string' && detail.length <= 1_000))
  );
}

export interface BrowserHostErrorRecord {
  schemaVersion: typeof BROWSER_HOST_ERROR_SCHEMA_VERSION;
  code: string;
  category: string;
  scope: BrowserHostErrorScope;
  terminality: 'terminal' | 'non_terminal';
  retryClass: BrowserHostRetryClass;
  platformActionAttempted: boolean;
  pageDisposition: PageDisposition;
  profileSafetyDisposition: ProfileSafetyDisposition;
  safeDetails: Readonly<Record<string, string | number | boolean | null>>;
  occurredAt: string;
}

export class BrowserHostError extends Error {
  readonly record: BrowserHostErrorRecord;

  constructor(record: BrowserHostErrorRecord) {
    super(record.code);
    this.name = 'BrowserHostError';
    this.record = record;
  }
}

export function browserHostError(input: Omit<BrowserHostErrorRecord, 'schemaVersion' | 'occurredAt'>): BrowserHostError {
  return new BrowserHostError({
    schemaVersion: BROWSER_HOST_ERROR_SCHEMA_VERSION,
    occurredAt: new Date().toISOString(),
    ...input
  });
}

export function isBrowserHostErrorRecord(value: unknown): value is BrowserHostErrorRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BrowserHostErrorRecord>;
  return candidate.schemaVersion === BROWSER_HOST_ERROR_SCHEMA_VERSION &&
    safeCode(candidate.code) &&
    safeCode(candidate.category) &&
    ERROR_SCOPES.includes(candidate.scope as BrowserHostErrorScope) &&
    (candidate.terminality === 'terminal' || candidate.terminality === 'non_terminal') &&
    RETRY_CLASSES.includes(candidate.retryClass as BrowserHostRetryClass) &&
    typeof candidate.platformActionAttempted === 'boolean' &&
    PAGE_DISPOSITIONS.includes(candidate.pageDisposition as PageDisposition) &&
    PROFILE_SAFETY_DISPOSITIONS.includes(candidate.profileSafetyDisposition as ProfileSafetyDisposition) &&
    safeDetails(candidate.safeDetails) &&
    typeof candidate.occurredAt === 'string' && Number.isFinite(Date.parse(candidate.occurredAt));
}
