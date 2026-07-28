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

/**
 * Only public page signals are supplied to this classifier.  It never reads a
 * credential, query value, response body or browser identifier.  A known
 * verification route wins over a generic login phrase so an SMS-login form's
 * "verification code" cannot be confused with platform risk control.
 */
export interface XiaohongshuCurrentPageRiskSignalInput {
  pathname: string;
  title: string;
  visibleText: string;
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

export function classifyXiaohongshuCurrentPageRisk(
  input: XiaohongshuCurrentPageRiskSignalInput
): XiaohongshuCurrentPageNetworkMetadataObservation['risk'] {
  const pathname = boundedText(input.pathname, 240);
  const title = boundedText(input.title, 300);
  const visibleText = boundedText(input.visibleText, 12_000);
  const pageText = `${title}\n${visibleText}`;
  const verificationRequired = pathname === '/website-login/captcha' || pathname.startsWith('/website-login/') ||
    /\u5b89\u5168\u9a8c\u8bc1|\u9a8c\u8bc1\u8eab\u4efd|\u626b\u7801\u9a8c\u8bc1/.test(pageText);
  const rateLimited = /\u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41|\u8bbf\u95ee\u9891\u7e41|\u64cd\u4f5c\u9891\u7e41|\u7a0d\u540e\u518d\u8bd5|\u98ce\u63a7/.test(pageText);
  const sourceUnavailable = /\u9875\u9762\u4e0d\u5b58\u5728|\u52a0\u8f7d\u5931\u8d25|\u7f51\u7edc\u9519\u8bef|\u670d\u52a1\u4e0d\u53ef\u7528|\u6682\u65f6\u65e0\u6cd5\u6d4f\u89c8|\b404\b/.test(pageText);
  const loginRequired = !verificationRequired && /\u767b\u5f55\u540e|\u8bf7\u767b\u5f55|\u626b\u7801\u767b\u5f55|\u767b\u5f55\u5c0f\u7ea2\u4e66/.test(pageText);
  return { loginRequired, verificationRequired, rateLimited, sourceUnavailable };
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

function boundedText(value: string, maximumLength: number): string {
  return value.slice(0, maximumLength);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
