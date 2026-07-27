/**
 * The first Xiaohongshu surface is intentionally a policy/contract boundary,
 * not a generic network interceptor.  It can describe only an explicitly
 * selected, already-existing document and it grants no browser action.
 *
 * A later response-body capability must use a new capability ID and pass a
 * separate live route-admission run.  It must not loosen this contract.
 */
export const XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION = 1 as const;
export const XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY =
  'xiaohongshu.current_page.network_metadata' as const;

export interface XiaohongshuCurrentPageNetworkBudget {
  maximumPlatformNavigations: 0;
  maximumPageReloads: 0;
  maximumPageInitiatedNewDocuments: 0;
  maximumSemanticActions: 0;
  maximumNetworkResponseBodies: 0;
  maximumNetworkMetadataObservations: 24;
  maximumRawPayloadBytes: 0;
}

export const XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET = {
  maximumPlatformNavigations: 0,
  maximumPageReloads: 0,
  maximumPageInitiatedNewDocuments: 0,
  maximumSemanticActions: 0,
  maximumNetworkResponseBodies: 0,
  maximumNetworkMetadataObservations: 24,
  maximumRawPayloadBytes: 0
} as const satisfies XiaohongshuCurrentPageNetworkBudget;

export interface XiaohongshuCurrentPageNetworkPolicy {
  schemaVersion: typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION;
  platform: 'xiaohongshu';
  capability: typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY;
  executionTarget: 'user_selected_tab';
  requiresExplicitCurrentPageSelection: true;
  requiresPrearmedSameDocumentObserver: true;
  responseBodies: 'not_read';
  budget: XiaohongshuCurrentPageNetworkBudget;
}

/**
 * The caller deliberately names no URL, tab, document, selector, script,
 * request route or action plan.  The identity of the current page remains in
 * the extension-private one-time document lease.
 */
export interface XiaohongshuCurrentPageNetworkRequest {
  schemaVersion: typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION;
  platform: 'xiaohongshu';
  capability: typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY;
  executionTarget: 'user_selected_tab';
  input: Record<never, never>;
}

/**
 * A bounded, body-free report shape for a future selected-tab work result.
 * It exposes only categorised counts so authentication, security and telemetry
 * routes cannot become an accidental network inventory for upper applications.
 */
export interface XiaohongshuCurrentPageNetworkMetadataObservation {
  observerState: 'not_armed' | 'armed_same_document' | 'document_changed';
  publicContentRouteCount: number;
  excludedRouteCounts: {
    authenticationOrIdentity: number;
    securityOrRisk: number;
    configurationOrTelemetry: number;
    other: number;
  };
  responseBodiesRead: false;
  rawPayloadBytesRead: 0;
  risk: {
    loginRequired: boolean;
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

export const XIAOHONGSHU_CURRENT_PAGE_NETWORK_POLICY: XiaohongshuCurrentPageNetworkPolicy = Object.freeze({
  schemaVersion: XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION,
  platform: 'xiaohongshu',
  capability: XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY,
  executionTarget: 'user_selected_tab',
  requiresExplicitCurrentPageSelection: true,
  requiresPrearmedSameDocumentObserver: true,
  responseBodies: 'not_read',
  budget: XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET
});

export function isXiaohongshuCurrentPageNetworkRequest(
  value: unknown
): value is XiaohongshuCurrentPageNetworkRequest {
  if (!record(value) || !exactKeys(value, ['schemaVersion', 'platform', 'capability', 'executionTarget', 'input'])) {
    return false;
  }
  return value.schemaVersion === XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION &&
    value.platform === 'xiaohongshu' &&
    value.capability === XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY &&
    value.executionTarget === 'user_selected_tab' && record(value.input) && Object.keys(value.input).length === 0;
}

export function isXiaohongshuCurrentPageNetworkMetadataObservation(
  value: unknown
): value is XiaohongshuCurrentPageNetworkMetadataObservation {
  if (!record(value) || !exactKeys(value, [
    'observerState', 'publicContentRouteCount', 'excludedRouteCounts', 'responseBodiesRead', 'rawPayloadBytesRead', 'risk'
  ])) return false;
  return (value.observerState === 'not_armed' || value.observerState === 'armed_same_document' ||
      value.observerState === 'document_changed') &&
    boundedCount(value.publicContentRouteCount) && isExcludedRouteCounts(value.excludedRouteCounts) &&
    value.responseBodiesRead === false && value.rawPayloadBytesRead === 0 && isRisk(value.risk);
}

function isExcludedRouteCounts(value: unknown): boolean {
  return record(value) && exactKeys(value, [
    'authenticationOrIdentity', 'securityOrRisk', 'configurationOrTelemetry', 'other'
  ]) && boundedCount(value.authenticationOrIdentity) && boundedCount(value.securityOrRisk) &&
    boundedCount(value.configurationOrTelemetry) && boundedCount(value.other);
}

function isRisk(value: unknown): boolean {
  return record(value) && exactKeys(value, [
    'loginRequired', 'verificationRequired', 'rateLimited', 'sourceUnavailable'
  ]) && typeof value.loginRequired === 'boolean' && typeof value.verificationRequired === 'boolean' &&
    typeof value.rateLimited === 'boolean' && typeof value.sourceUnavailable === 'boolean';
}

function boundedCount(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 24;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
