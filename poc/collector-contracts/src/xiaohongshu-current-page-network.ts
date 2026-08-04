import type { XiaohongshuNotePublicCommentsProjection } from './extension-work-xiaohongshu-note-public-comments.js';
import {
  isXiaohongshuPublicReplyThreadProjection,
  type XiaohongshuPublicReplyThreadProjection
} from './extension-work-xiaohongshu-note-public-comment-replies.js';

/**
 * The first Xiaohongshu surface is intentionally a policy/contract boundary,
 * not a generic network interceptor.  It can describe only an explicitly
 * selected, already-existing document and it grants no browser action.
 *
 * A later response-body capability must use a new capability ID and pass a
 * separate live route-admission run.  It must not loosen this contract.
 */
export const XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION = 2 as const;
export const XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY =
  'xiaohongshu.current_page.network_metadata' as const;
export const XIAOHONGSHU_PUBLIC_NOTES_SEARCH_CAPABILITY =
  'xiaohongshu.search.public_notes.v1' as const;
export const XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_CAPABILITY =
  'xiaohongshu.account.public_notes.v1' as const;
export const XIAOHONGSHU_PUBLIC_NOTES_SEARCH_BUDGET = Object.freeze({
  maximumPlatformNavigations: 0,
  maximumPageReloads: 0,
  maximumPageInitiatedNewDocuments: 0,
  maximumSemanticActions: 1,
  maximumNetworkResponseBodies: 8,
  maximumProjectedItems: 40,
  maximumRawPayloadBytesStored: 0
} as const);
/** Upper bound for optional, same-document detail enrichment of ranked cards. */
export const XIAOHONGSHU_PUBLIC_NOTES_SEARCH_MAX_DETAILS = 20 as const;
/**
 * Natural author-avatar discovery spends one trusted click before the profile
 * directory work. A platform-created profile document is bounded to one;
 * the service never creates or replays a tab itself.
 */
export const XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_DISCOVERY_BUDGET = Object.freeze({
  maximumPlatformNavigations: 0,
  maximumPageReloads: 0,
  maximumPageInitiatedNewDocuments: 1,
  maximumSemanticActions: 21,
  maximumNetworkResponseBodies: 8,
  maximumProjectedItems: 200,
  maximumRawPayloadBytesStored: 0
} as const);
/**
 * Detail enrichment is deliberately bounded to the existing search document:
 * it may click and close at most twenty visible cards, but it never navigates,
 * reloads, opens a page-initiated document, or stores raw payloads.
 */
export const XIAOHONGSHU_PUBLIC_NOTES_SEARCH_DEPTH_BUDGET = Object.freeze({
  maximumPlatformNavigations: 0,
  maximumPageReloads: 0,
  maximumPageInitiatedNewDocuments: 0,
  maximumSemanticActions: 41,
  maximumNetworkResponseBodies: 8,
  maximumProjectedItems: 40,
  maximumRawPayloadBytesStored: 0
} as const);
/**
 * Optional detail-plus-comments mode. The bound covers one search action,
 * twenty detail clicks, three bounded comment scrolls and one close action per
 * detail. Response/projected-item ceilings are aggregate safety ceilings for
 * the composed operation; raw payloads are still never stored.
 */
export const XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_DEPTH_BUDGET = Object.freeze({
  maximumPlatformNavigations: 0,
  maximumPageReloads: 0,
  maximumPageInitiatedNewDocuments: 0,
  maximumSemanticActions: 101,
  maximumNetworkResponseBodies: 168,
  maximumProjectedItems: 1640,
  maximumRawPayloadBytesStored: 0
} as const);
/**
 * Optional detail-plus-comments-plus-one-reply-thread mode. The reply
 * expansion is still strictly bounded to one thread per requested detail;
 * its extra response-body ceiling is an aggregate upper bound, not a replay
 * budget. Raw payloads remain projection-only and are never persisted.
 */
export const XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_DEPTH_BUDGET = Object.freeze({
  maximumPlatformNavigations: 0,
  maximumPageReloads: 0,
  maximumPageInitiatedNewDocuments: 0,
  maximumSemanticActions: 121,
  maximumNetworkResponseBodies: 328,
  maximumProjectedItems: 2440,
  maximumRawPayloadBytesStored: 0
} as const);
/** Aggregate upper bound when two or three reply threads are requested per detail. */
export const XIAOHONGSHU_PUBLIC_NOTES_SEARCH_COMMENTS_REPLIES_MULTI_DEPTH_BUDGET = Object.freeze({
  maximumPlatformNavigations: 0,
  maximumPageReloads: 0,
  maximumPageInitiatedNewDocuments: 0,
  maximumSemanticActions: 161,
  maximumNetworkResponseBodies: 648,
  maximumProjectedItems: 4040,
  maximumRawPayloadBytesStored: 0
} as const);
export const XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_BUDGET = Object.freeze({
  maximumPlatformNavigations: 0,
  maximumPageReloads: 0,
  maximumPageInitiatedNewDocuments: 0,
  maximumSemanticActions: 3,
  maximumNetworkResponseBodies: 8,
  maximumProjectedItems: 40,
  maximumRawPayloadBytesStored: 0
} as const);
/** One-time user-supplied profile entry. The URL is never an artifact field. */
export const XIAOHONGSHU_ACCOUNT_PUBLIC_NOTES_LINK_BUDGET = Object.freeze({
  maximumPlatformNavigations: 1,
  maximumPageReloads: 0,
  maximumPageInitiatedNewDocuments: 0,
  maximumSemanticActions: 20,
  maximumNetworkResponseBodies: 8,
  maximumProjectedItems: 200,
  maximumRawPayloadBytesStored: 0
} as const);
export type XiaohongshuProfileScrollCount =
  1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20;
export type XiaohongshuProfileScrollCompletedCount = 0 | XiaohongshuProfileScrollCount;
export const XIAOHONGSHU_PROFILE_LINK_MAX_SCROLLS = 20 as const;
export const XIAOHONGSHU_PROFILE_LINK_MAX_PROJECTED_ITEMS = 200 as const;
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
  'search',
  'public_profile',
  'public_note_detail'
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
export const XIAOHONGSHU_CURRENT_PAGE_NETWORK_PERMISSION_STATES = [
  'permission_granted',
  'permission_required'
] as const;
export type XiaohongshuCurrentPageNetworkPermissionState =
  (typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_PERMISSION_STATES)[number];

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
  /**
   * This is a fixed, zero-input precondition read. It exposes neither a
   * permission prompt nor any browser/page identity, and a caller cannot use
   * it to request, expand or revoke an origin grant.
   */
  permissionState: XiaohongshuCurrentPageNetworkPermissionState;
  selection: XiaohongshuCurrentPageNetworkSelectionSummary;
  observation: XiaohongshuCurrentPageNetworkMetadataObservation;
}

/**
 * Local validation-browser control is bound to an already leased Browser Host
 * page. The request deliberately carries no URL, tab, document, selector,
 * script, route, query or action plan. Browser Host resolves the internal tab
 * identity from this exact PageLease and never exposes it to the caller.
 */
export interface XiaohongshuManagedPageNetworkObserverRequest {
  schemaVersion: typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION;
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  expectedRecordVersion: number;
  runId: string;
}

export interface XiaohongshuManagedPageNetworkObserverArmResult {
  schemaVersion: typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION;
  type: 'xiaohongshu_managed_page_network_observer_armed';
  pageAlias: string;
  runId: string;
  permissionState: XiaohongshuCurrentPageNetworkPermissionState;
  selection: XiaohongshuCurrentPageNetworkSelectionSummary;
}

export interface XiaohongshuManagedPageNetworkObservationResult {
  schemaVersion: typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION;
  type: 'xiaohongshu_managed_page_network_observation';
  pageAlias: string;
  runId: string;
  permissionState: XiaohongshuCurrentPageNetworkPermissionState;
  selection: XiaohongshuCurrentPageNetworkSelectionSummary;
  observation: XiaohongshuCurrentPageNetworkMetadataObservation;
}

export interface XiaohongshuPublicSearchItemProjection {
  rank: number;
  noteId: string;
  title: string;
  contentType: string;
  authorId: string;
  authorNickname: string;
  likedCountText: string;
}

/**
 * A public note description that was already present in an admitted search or
 * profile response.  This is deliberately separate from the ranked card so an
 * upper application can tell the difference between a card-only result and a
 * response-backed public text projection without issuing another navigation.
 */
export interface XiaohongshuPublicNoteDetailProjection {
  noteId: string;
  publicText: string;
  authorNickname: string;
  interactionText: string;
  /** Present only when the caller explicitly enables comment collection. */
  comments?: XiaohongshuNotePublicCommentsProjection;
  /** Present only when the caller explicitly enables one reply thread. */
  replyThread?: XiaohongshuPublicReplyThreadProjection;
  /** Present when the caller requests more than one reply thread. */
  replyThreads?: XiaohongshuPublicReplyThreadProjection[];
}

export interface XiaohongshuManagedSearchProjectionResult {
  schemaVersion: typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION;
  type: 'xiaohongshu_managed_search_projection';
  pageAlias: string;
  runId: string;
  matchedPayloadCount: number;
  bodyBytesRead: number;
  rawPayloadStored: false;
  responseUrlsStored: false;
  items: XiaohongshuPublicSearchItemProjection[];
  /** Additive field; older v1 producers may omit it. */
  details?: XiaohongshuPublicNoteDetailProjection[];
}

export interface XiaohongshuManagedProfileNotesProjectionResult {
  schemaVersion: typeof XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION;
  type: 'xiaohongshu_managed_profile_notes_projection';
  pageAlias: string;
  runId: string;
  matchedPayloadCount: number;
  bodyBytesRead: number;
  rawPayloadStored: false;
  responseUrlsStored: false;
  items: XiaohongshuPublicSearchItemProjection[];
  /** Additive field; older v1 producers may omit it. */
  details?: XiaohongshuPublicNoteDetailProjection[];
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
  if (!record(value) || !exactKeys(value, ['schemaVersion', 'type', 'permissionState', 'selection', 'observation'])) {
    return false;
  }
  return value.schemaVersion === XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION &&
    value.type === 'xiaohongshu_current_page_network_observation' &&
    (value.permissionState === 'permission_granted' || value.permissionState === 'permission_required') &&
    isXiaohongshuCurrentPageNetworkSelectionSummary(value.selection) &&
    isXiaohongshuCurrentPageNetworkMetadataObservation(value.observation);
}

export function isXiaohongshuManagedPageNetworkObserverRequest(
  value: unknown
): value is XiaohongshuManagedPageNetworkObserverRequest {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'profileId', 'pageAlias', 'pageLeaseId', 'expectedRecordVersion', 'runId'
  ])) return false;
  return value.schemaVersion === XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION &&
    boundedIdentifier(value.profileId) && boundedIdentifier(value.pageAlias) &&
    boundedIdentifier(value.pageLeaseId) && boundedIdentifier(value.runId) &&
    Number.isSafeInteger(value.expectedRecordVersion) && Number(value.expectedRecordVersion) > 0;
}

export function isXiaohongshuManagedPageNetworkObserverArmResult(
  value: unknown
): value is XiaohongshuManagedPageNetworkObserverArmResult {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'type', 'pageAlias', 'runId', 'permissionState', 'selection'
  ])) return false;
  return value.schemaVersion === XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION &&
    value.type === 'xiaohongshu_managed_page_network_observer_armed' &&
    boundedIdentifier(value.pageAlias) && boundedIdentifier(value.runId) &&
    isPermissionState(value.permissionState) &&
    isXiaohongshuCurrentPageNetworkSelectionSummary(value.selection);
}

export function isXiaohongshuManagedPageNetworkObservationResult(
  value: unknown
): value is XiaohongshuManagedPageNetworkObservationResult {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'type', 'pageAlias', 'runId', 'permissionState', 'selection', 'observation'
  ])) return false;
  return value.schemaVersion === XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION &&
    value.type === 'xiaohongshu_managed_page_network_observation' &&
    boundedIdentifier(value.pageAlias) && boundedIdentifier(value.runId) &&
    isPermissionState(value.permissionState) &&
    isXiaohongshuCurrentPageNetworkSelectionSummary(value.selection) &&
    isXiaohongshuCurrentPageNetworkMetadataObservation(value.observation);
}

export function isXiaohongshuManagedSearchProjectionResult(
  value: unknown
): value is XiaohongshuManagedSearchProjectionResult {
  if (!record(value) || !projectionKeys(value)) return false;
  return value.schemaVersion === XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION &&
    value.type === 'xiaohongshu_managed_search_projection' && boundedIdentifier(value.pageAlias) &&
    boundedIdentifier(value.runId) && boundedProjectionCount(value.matchedPayloadCount, 8) &&
    boundedProjectionCount(value.bodyBytesRead, 16 * 1024 * 1024) && value.rawPayloadStored === false &&
    value.responseUrlsStored === false && Array.isArray(value.items) && value.items.length <= 40 &&
    value.items.every((item) => isPublicSearchItemProjection(item, 40)) &&
    optionalPublicNoteDetails(value.details, 40);
}

export function isXiaohongshuManagedProfileNotesProjectionResult(
  value: unknown
): value is XiaohongshuManagedProfileNotesProjectionResult {
  if (!record(value) || !projectionKeys(value)) return false;
  return value.schemaVersion === XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION &&
    value.type === 'xiaohongshu_managed_profile_notes_projection' && boundedIdentifier(value.pageAlias) &&
    boundedIdentifier(value.runId) && boundedProjectionCount(value.matchedPayloadCount, 8) &&
    boundedProjectionCount(value.bodyBytesRead, 16 * 1024 * 1024) && value.rawPayloadStored === false &&
    value.responseUrlsStored === false && Array.isArray(value.items) && value.items.length <= 200 &&
    value.items.every((item) => isPublicSearchItemProjection(item, 200)) &&
    optionalPublicNoteDetails(value.details, 200);
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
  return (surface === null || surface === 'explore' || surface === 'search' || surface === 'public_profile') &&
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
  if (/^\/user\/profile\/[^/]+\/?$/.test(url.pathname)) return 'public_profile';
  return url.pathname === '/search_result' || url.pathname === '/search_result/' ||
    url.pathname === '/search_result_ai' || url.pathname === '/search_result_ai/' ? 'search' : null;
}

/**
 * Validate a caller-supplied public profile entry without exposing or storing
 * its query/signature. The returned value is used only by the short-lived
 * signed work item and is never copied into an artifact or operation summary.
 */
export function canonicalXiaohongshuPublicProfileUrl(value: string): string | null {
  if (typeof value !== 'string' || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value) || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com' || url.port ||
      url.username || url.password || url.hash || !/^\/user\/profile\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
      return null;
    }
    // Validate the parsed URL, but preserve the caller's exact query/signature
    // bytes.  Re-serialising a short-lived signed link can change escaping and
    // invalidate an otherwise still-live platform entry.
    return value;
  } catch {
    return null;
  }
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
  // “风控” is ordinary public-domain vocabulary (for example, a note about
  // AI-powered financial risk control). It is not a platform-level blocking
  // signal by itself. Keep only phrases that explicitly describe the current
  // request or interaction as throttled.
  const rateLimited = /\u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41|\u8bbf\u95ee\u9891\u7e41|\u64cd\u4f5c\u9891\u7e41|\u7a0d\u540e\u518d\u8bd5/.test(pageText);
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

function isPublicSearchItemProjection(
  value: unknown,
  maximumRank: 40 | 200
): value is XiaohongshuPublicSearchItemProjection {
  if (!record(value) || !exactKeys(value, [
    'rank', 'noteId', 'title', 'contentType', 'authorId', 'authorNickname', 'likedCountText'
  ])) return false;
  return Number.isSafeInteger(value.rank) && Number(value.rank) >= 1 && Number(value.rank) <= maximumRank &&
    boundedProjectionText(value.noteId, 80, true) && boundedProjectionText(value.title, 500, true) &&
    boundedProjectionText(value.contentType, 40) && boundedProjectionText(value.authorId, 80) &&
    boundedProjectionText(value.authorNickname, 200) && boundedProjectionText(value.likedCountText, 40);
}

function projectionKeys(value: Record<string, unknown>): boolean {
  const base = [
    'schemaVersion', 'type', 'pageAlias', 'runId', 'matchedPayloadCount', 'bodyBytesRead',
    'rawPayloadStored', 'responseUrlsStored', 'items'
  ] as const;
  return exactKeys(value, base) || exactKeys(value, [...base, 'details']);
}

function optionalPublicNoteDetails(value: unknown, maximumItems: 40 | 200): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) && value.length <= maximumItems && value.every((entry) => {
    if (!record(entry) || !detailProjectionKeys(entry)) return false;
    return boundedProjectionText(entry.noteId, 80, true) &&
      boundedProjectionText(entry.publicText, 12_000, true) &&
      boundedProjectionText(entry.authorNickname, 200) &&
      boundedProjectionText(entry.interactionText, 1_000) &&
      (entry.comments === undefined || isXiaohongshuNotePublicCommentsProjection(entry.comments)) &&
      (entry.replyThread === undefined || isXiaohongshuPublicReplyThreadProjection(entry.replyThread)) &&
      (entry.replyThreads === undefined || (Array.isArray(entry.replyThreads) && entry.replyThreads.length >= 1 &&
        entry.replyThreads.length <= 3 && entry.replyThreads.every(isXiaohongshuPublicReplyThreadProjection)));
  });
}

function detailProjectionKeys(value: Record<string, unknown>): boolean {
  const base = ['noteId', 'publicText', 'authorNickname', 'interactionText'] as const;
  return exactKeys(value, base) || exactKeys(value, [...base, 'comments']) ||
    exactKeys(value, [...base, 'replyThread']) || exactKeys(value, [...base, 'replyThreads']) ||
    exactKeys(value, [...base, 'comments', 'replyThread']) ||
    exactKeys(value, [...base, 'comments', 'replyThreads']) ||
    exactKeys(value, [...base, 'replyThread', 'replyThreads']) ||
    exactKeys(value, [...base, 'comments', 'replyThread', 'replyThreads']);
}

function isXiaohongshuNotePublicCommentsProjection(value: unknown): value is XiaohongshuNotePublicCommentsProjection {
  if (!record(value) || !exactKeys(value, [
    'schemaVersion', 'captureMode', 'network', 'renderedCommentCount', 'comments', 'rawPayloadStored', 'responseUrlsStored'
  ])) return false;
  return value.schemaVersion === 1 &&
    (value.captureMode === 'network_projection' || value.captureMode === 'dom_fallback' || value.captureMode === 'hybrid') &&
    record(value.network) && exactKeys(value.network, ['matchedPayloadCount', 'bodyBytesRead', 'hasMore', 'cursorObserved']) &&
    boundedProjectionCount(value.network.matchedPayloadCount, 8) &&
    boundedProjectionCount(value.network.bodyBytesRead, 16 * 1024 * 1024) &&
    (value.network.hasMore === null || typeof value.network.hasMore === 'boolean') &&
    typeof value.network.cursorObserved === 'boolean' && boundedProjectionCount(value.renderedCommentCount, 200) &&
    Array.isArray(value.comments) && value.comments.length <= 80 && value.comments.every(isPublicCommentProjection) &&
    value.rawPayloadStored === false && value.responseUrlsStored === false;
}

function isPublicCommentProjection(value: unknown): boolean {
  return record(value) && exactKeys(value, [
    'rank', 'commentId', 'publicText', 'authorNickname', 'likedCountText', 'subCommentCountText',
    'createdAtText', 'locationText', 'source'
  ]) && boundedProjectionCount(value.rank, 80) && boundedProjectionText(value.commentId, 100, true) &&
    boundedProjectionText(value.publicText, 2_000, true) && boundedProjectionText(value.authorNickname, 200) &&
    boundedProjectionText(value.likedCountText, 40) && boundedProjectionText(value.subCommentCountText, 40) &&
    boundedProjectionText(value.createdAtText, 100) && boundedProjectionText(value.locationText, 100) &&
    (value.source === 'network' || value.source === 'dom');
}

function boundedProjectionText(value: unknown, maximum: number, required = false): value is string {
  return typeof value === 'string' && value.length <= maximum && (!required || value.length > 0) &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function boundedProjectionCount(value: unknown, maximum: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 180 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

function isPermissionState(value: unknown): value is XiaohongshuCurrentPageNetworkPermissionState {
  return value === 'permission_granted' || value === 'permission_required';
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
