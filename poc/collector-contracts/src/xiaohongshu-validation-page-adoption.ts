export const XIAOHONGSHU_VALIDATION_PAGE_ADOPTION_SCHEMA_VERSION = 1 as const;
/**
 * A composed live validation run keeps one already-visible page leased while
 * search, same-document detail, comments and bounded replies complete.  Five
 * minutes is long enough for that bounded sequence while remaining a finite
 * validation-only lease (the generic page pool still permits its separate
 * one-hour upper bound).
 */
export const XIAOHONGSHU_VALIDATION_PAGE_ADOPTION_MAX_LEASE_MS = 300_000 as const;

export interface XiaohongshuValidationPageAdoptionRequest {
  schemaVersion: typeof XIAOHONGSHU_VALIDATION_PAGE_ADOPTION_SCHEMA_VERSION;
  profileId: string;
  taskId: string;
  runId: string;
  leaseDurationMs: number;
}

export function isXiaohongshuValidationPageAdoptionRequest(
  value: unknown
): value is XiaohongshuValidationPageAdoptionRequest {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'profileId', 'taskId', 'runId', 'leaseDurationMs'
  ])) return false;
  return value.schemaVersion === XIAOHONGSHU_VALIDATION_PAGE_ADOPTION_SCHEMA_VERSION &&
    identifier(value.profileId) && identifier(value.taskId) && identifier(value.runId) &&
    Number.isSafeInteger(value.leaseDurationMs) && Number(value.leaseDurationMs) >= 5_000 &&
    Number(value.leaseDurationMs) <= XIAOHONGSHU_VALIDATION_PAGE_ADOPTION_MAX_LEASE_MS;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 180 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
