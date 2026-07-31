/**
 * Stable, de-identified operational log contract shared by the Gateway and
 * Browser Host.  It is intentionally separate from user-facing audit records:
 * audit answers "who requested what", while this stream answers "which
 * runtime phase failed and how long it took".
 */
export const OPERATIONAL_LOG_SCHEMA_VERSION = 1 as const;

export type OperationalLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type OperationalLogComponent = 'gateway' | 'browser_host' | 'extension';

export type OperationalLogOutcome =
  | 'started'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'denied'
  | 'skipped'
  | 'unknown';

export type OperationalLogScalar = string | number | boolean | null;

export type OperationalLogDetails = {
  readonly [key: string]: OperationalLogScalar | OperationalLogDetails | readonly OperationalLogScalar[];
};

export interface OperationalLogEvent {
  schemaVersion: typeof OPERATIONAL_LOG_SCHEMA_VERSION;
  eventId: string;
  occurredAt: string;
  component: OperationalLogComponent;
  level: OperationalLogLevel;
  eventType: string;
  requestId: string | null;
  commandId: string | null;
  operationId: string | null;
  workId: string | null;
  capability: string | null;
  durationMs: number | null;
  outcome: OperationalLogOutcome;
  errorCode: string | null;
  details: OperationalLogDetails;
}

export type OperationalLogInput = Omit<
  OperationalLogEvent,
  'schemaVersion' | 'eventId' | 'occurredAt' | 'details'
> & {
  details?: unknown;
};

const SENSITIVE_DETAIL_KEY = /(?:token|cookie|authorization|password|secret|credential|storage|user.?data|profile.?path|query|body|response|payload|html|text|content|selector|script|header)/i;
const SAFE_KEY = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
const SAFE_EVENT_TYPE = /^[a-z][a-z0-9_.-]{1,119}$/;
const SAFE_ERROR_CODE = /^[a-z0-9_.-]{1,120}$/i;
const MAX_DETAIL_DEPTH = 3;
const MAX_DETAIL_KEYS = 32;
const MAX_DETAIL_ITEMS = 20;
const MAX_DETAIL_STRING = 256;

/**
 * Logs must be useful for operations without becoming a second artifact store.
 * Callers can pass rich internal objects, but only bounded scalar metadata is
 * retained and known credential/page-content keys are replaced.
 */
export function sanitiseOperationalDetails(value: unknown): OperationalLogDetails {
  const result = sanitiseRecord(value, 0);
  return result ?? {};
}

function sanitiseRecord(value: unknown, depth: number): OperationalLogDetails | null {
  if (depth > MAX_DETAIL_DEPTH || value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_DETAIL_KEYS);
  const result: Record<string, OperationalLogScalar | OperationalLogDetails | readonly OperationalLogScalar[]> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = SAFE_KEY.test(rawKey) ? rawKey : 'invalid_key';
    if (SENSITIVE_DETAIL_KEY.test(rawKey)) {
      result[key] = '[redacted]';
      continue;
    }
    const sanitised = sanitiseDetailValue(rawValue, depth + 1);
    if (sanitised !== undefined) result[key] = sanitised;
  }
  return result;
}

function sanitiseDetailValue(
  value: unknown,
  depth: number
): OperationalLogScalar | OperationalLogDetails | readonly OperationalLogScalar[] | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.length <= MAX_DETAIL_STRING ? value : `${value.slice(0, MAX_DETAIL_STRING)}…`;
  if (Array.isArray(value)) {
    const items: OperationalLogScalar[] = [];
    for (const item of value.slice(0, MAX_DETAIL_ITEMS)) {
      const sanitised = sanitiseDetailValue(item, depth + 1);
      if (sanitised === null || typeof sanitised === 'string' || typeof sanitised === 'number' || typeof sanitised === 'boolean') {
        if (sanitised !== undefined) items.push(sanitised);
      }
    }
    return items;
  }
  return sanitiseRecord(value, depth);
}

export function isOperationalLogEvent(value: unknown): value is OperationalLogEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<OperationalLogEvent>;
  return candidate.schemaVersion === OPERATIONAL_LOG_SCHEMA_VERSION &&
    typeof candidate.eventId === 'string' && candidate.eventId.length > 0 &&
    typeof candidate.occurredAt === 'string' && Number.isFinite(Date.parse(candidate.occurredAt)) &&
    isOperationalLogComponent(candidate.component) &&
    isOperationalLogLevel(candidate.level) &&
    typeof candidate.eventType === 'string' && SAFE_EVENT_TYPE.test(candidate.eventType) &&
    nullableString(candidate.requestId) && nullableString(candidate.commandId) &&
    nullableString(candidate.operationId) && nullableString(candidate.workId) &&
    nullableString(candidate.capability) &&
    (candidate.durationMs === null || (typeof candidate.durationMs === 'number' && Number.isFinite(candidate.durationMs) && candidate.durationMs >= 0)) &&
    isOperationalLogOutcome(candidate.outcome) &&
    (candidate.errorCode === null || (typeof candidate.errorCode === 'string' && SAFE_ERROR_CODE.test(candidate.errorCode))) &&
    candidate.details !== null && typeof candidate.details === 'object' && !Array.isArray(candidate.details);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isOperationalLogComponent(value: unknown): value is OperationalLogComponent {
  return value === 'gateway' || value === 'browser_host' || value === 'extension';
}

function isOperationalLogLevel(value: unknown): value is OperationalLogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

function isOperationalLogOutcome(value: unknown): value is OperationalLogOutcome {
  return value === 'started' || value === 'completed' || value === 'failed' ||
    value === 'stopped' || value === 'denied' || value === 'skipped' || value === 'unknown';
}
