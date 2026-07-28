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
export const XIAOHONGSHU_CURRENT_PAGE_NETWORK_SELECTION_TTL_MS = 60_000 as const;

/**
 * This is deliberately smaller than the long-term product boundary.  These
 * are the only public document shapes that the first local, user-selected
 * pre-arm can recognise without retaining a URL, query value or account
 * identity. Detail pages and every account-scoped surface need separate
 * live admission before they can be added.
 */
export const XIAOHONGSHU_CURRENT_PAGE_NETWORK_PUBLIC_SURFACES = [
  'explore',
  'search'
] as const;
export type XiaohongshuCurrentPageNetworkPublicSurface =
  (typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_PUBLIC_SURFACES)[number];

/**
 * Authentication in a dedicated validation browser can make public pages
 * visible, but it must never turn the current account's own surfaces into a
 * collection source.  This is a capability-wide prohibition rather than a
 * best-effort URL block list, so a future route change cannot silently make
 * favourites, messages, notifications, account management or creator tools
 * eligible for collection.
 */
export const XIAOHONGSHU_CURRENT_PAGE_ACCOUNT_SCOPED_SURFACES = 'forbidden' as const;

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
  accountScopedSurfaces: typeof XIAOHONGSHU_CURRENT_PAGE_ACCOUNT_SCOPED_SURFACES;
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
 * An extension-private user gesture can pre-arm exactly one future document
 * in the active tab. This summary intentionally exposes no tab/window/
 * document identifiers, URL, query value, title or visible page text.
 */
export interface XiaohongshuCurrentPageNetworkSelectionSummary {
  state: 'not_selected' | 'armed_next_document' | 'observing' | 'stopped';
  publicSurface: XiaohongshuCurrentPageNetworkPublicSurface | null;
  selectedAt: string | null;
  expiresAt: string | null;
}

/**
 * The native Browser Host may read this local, de-sensitised result after an
 * extension-popup selection. It cannot name a tab, document, URL, route,
 * selector or action and it does not turn this catalog-only policy into a
 * Gateway-dispatchable collection request.
 */
export interface XiaohongshuCurrentPageNetworkObservationResult {
  schemaVersion: typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION;
  type: 'xiaohongshu_current_page_network_observation';
  selection: XiaohongshuCurrentPageNetworkSelectionSummary;
  observation: XiaohongshuCurrentPageNetworkMetadataObservation;
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
  accountScopedSurfaces: XIAOHONGSHU_CURRENT_PAGE_ACCOUNT_SCOPED_SURFACES,
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

export function isXiaohongshuCurrentPageNetworkObservationResult(
  value: unknown
): value is XiaohongshuCurrentPageNetworkObservationResult {
  if (!record(value) || !exactKeys(value, ['schemaVersion', 'type', 'selection', 'observation'])) return false;
  return value.schemaVersion === XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION &&
    value.type === 'xiaohongshu_current_page_network_observation' &&
    isXiaohongshuCurrentPageNetworkSelectionSummary(value.selection) &&
    isXiaohongshuCurrentPageNetworkMetadataObservation(value.observation);
}

export function isXiaohongshuCurrentPageNetworkSelectionSummary(
  value: unknown
): value is XiaohongshuCurrentPageNetworkSelectionSummary {
  if (!record(value) || !exactKeys(value, ['state', 'publicSurface', 'selectedAt', 'expiresAt'])) return false;
  const state = value.state;
  const surface = value.publicSurface;
  if (state === 'not_selected') {
    return surface === null && value.selectedAt === null && value.expiresAt === null;
  }
  if (state !== 'armed_next_document' && state !== 'observing' && state !== 'stopped') return false;
  return (surface === null || surface === 'explore' || surface === 'search') &&
    typeof value.selectedAt === 'string' && typeof value.expiresAt === 'string' &&
    Number.isFinite(Date.parse(value.selectedAt)) && Number.isFinite(Date.parse(value.expiresAt)) &&
    Date.parse(value.expiresAt) > Date.parse(value.selectedAt);
}

/**
 * This function returns only an enum. Callers must never retain or return the
 * input URL, path segment, query value or hash. `search_result` is allowed to
 * contain a user-entered query because this contract does not expose it.
 */
export function xiaohongshuCurrentPageNetworkPublicSurface(
  value: string
): XiaohongshuCurrentPageNetworkPublicSurface | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com' ||
    url.port || url.username || url.password || url.hash) return null;
  if ((url.pathname === '/explore' || url.pathname === '/explore/') && !url.search) return 'explore';
  return url.pathname === '/search_result' || url.pathname === '/search_result/' ? 'search' : null;
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
    boundedCount(value.configurationOrTelemetry) && boundedCount(value.other) &&
    Number(value.authenticationOrIdentity) + Number(value.securityOrRisk) +
      Number(value.configurationOrTelemetry) + Number(value.other) <= 24;
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
