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
    typeof candidate.code === 'string' &&
    typeof candidate.category === 'string' &&
    typeof candidate.scope === 'string' &&
    typeof candidate.terminality === 'string' &&
    typeof candidate.retryClass === 'string' &&
    typeof candidate.platformActionAttempted === 'boolean' &&
    typeof candidate.pageDisposition === 'string' &&
    typeof candidate.profileSafetyDisposition === 'string' &&
    Boolean(candidate.safeDetails) &&
    typeof candidate.occurredAt === 'string';
}
