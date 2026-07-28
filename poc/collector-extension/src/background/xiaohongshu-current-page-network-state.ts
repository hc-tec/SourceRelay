import {
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET,
  type XiaohongshuCurrentPageNetworkMetadataObservation,
  type XiaohongshuCurrentPageNetworkPublicSurface,
  type XiaohongshuCurrentPageNetworkSelectionSummary
} from '@intelligence/collector-contracts';

export type XiaohongshuExcludedRouteCategory =
  keyof XiaohongshuCurrentPageNetworkMetadataObservation['excludedRouteCounts'];

export interface XiaohongshuCurrentPageNetworkRecord {
  schemaVersion: 1;
  tabId: number;
  windowId: number;
  /** null for a popup/user selection; exact run identity for managed testing. */
  managedRunId: string | null;
  initialDocumentId: string;
  documentId: string | null;
  state: Exclude<XiaohongshuCurrentPageNetworkSelectionSummary['state'], 'not_selected'>;
  publicSurface: XiaohongshuCurrentPageNetworkPublicSurface | null;
  selectedAt: string;
  expiresAt: string;
  navigationStarted: boolean;
  stopReason: 'document_changed' | 'risk' | 'source_unavailable' | 'tab_closed' | null;
  observedRouteCount: number;
  excludedRouteCounts: XiaohongshuCurrentPageNetworkMetadataObservation['excludedRouteCounts'];
  risk: XiaohongshuCurrentPageNetworkMetadataObservation['risk'];
}

export interface XiaohongshuRiskSignal {
  pathname: string;
  title: string;
  visibleText: string;
}

export function observationFor(
  record: XiaohongshuCurrentPageNetworkRecord | null
): XiaohongshuCurrentPageNetworkMetadataObservation {
  const observerState = !record || record.state === 'armed_next_document'
    ? 'not_armed'
    : record.stopReason === 'document_changed' || record.stopReason === 'tab_closed'
      ? 'document_changed'
      : 'armed_same_document';
  return {
    observerState,
    // No public route has completed independent live route admission. Unknown
    // routes stay excluded rather than silently becoming content evidence.
    publicContentRouteCount: 0,
    excludedRouteCounts: record ? { ...record.excludedRouteCounts } : emptyExcludedRouteCounts(),
    responseBodiesRead: false,
    rawPayloadBytesRead: 0,
    risk: record ? { ...record.risk } : emptyRisk()
  };
}

export function selectionSummary(
  record: XiaohongshuCurrentPageNetworkRecord
): XiaohongshuCurrentPageNetworkSelectionSummary {
  return {
    state: record.state,
    publicSurface: record.publicSurface,
    selectedAt: record.selectedAt,
    expiresAt: record.expiresAt
  };
}

export function noSelectionSummary(): XiaohongshuCurrentPageNetworkSelectionSummary {
  return { state: 'not_selected', publicSurface: null, selectedAt: null, expiresAt: null };
}

export function emptyExcludedRouteCounts(): XiaohongshuCurrentPageNetworkMetadataObservation['excludedRouteCounts'] {
  return {
    authenticationOrIdentity: 0,
    securityOrRisk: 0,
    configurationOrTelemetry: 0,
    other: 0
  };
}

export function emptyRisk(): XiaohongshuCurrentPageNetworkMetadataObservation['risk'] {
  return { loginRequired: false, verificationRequired: false, rateLimited: false, sourceUnavailable: false };
}

/** The URL is parsed only long enough to increment an opaque category count. */
export function classifyExcludedRouteCategory(rawUrl: string): XiaohongshuExcludedRouteCategory {
  let pathname = '';
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com') return 'other';
    pathname = url.pathname.toLowerCase();
  } catch {
    return 'other';
  }
  if (/website-login|captcha|security|risk|anti[_-]?spam/.test(pathname)) return 'securityOrRisk';
  if (/login|logout|passport|auth|identity|session|account/.test(pathname)) return 'authenticationOrIdentity';
  if (/config|telemetry|report|tracking|analytics|advert/.test(pathname)) return 'configurationOrTelemetry';
  return 'other';
}

export function parseXiaohongshuCurrentPageNetworkRecord(
  value: unknown
): XiaohongshuCurrentPageNetworkRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<XiaohongshuCurrentPageNetworkRecord>;
  const tabId = candidate.tabId;
  const windowId = candidate.windowId;
  const state = candidate.state;
  const publicSurface = candidate.publicSurface;
  const documentId = candidate.documentId;
  const managedRunId = candidate.managedRunId;
  const observedRouteCount = candidate.observedRouteCount;
  if (
    candidate.schemaVersion !== 1 || typeof tabId !== 'number' || !Number.isSafeInteger(tabId) ||
    typeof windowId !== 'number' || !Number.isSafeInteger(windowId) ||
    (managedRunId !== null && (typeof managedRunId !== 'string' || !validManagedRunId(managedRunId))) ||
    typeof candidate.initialDocumentId !== 'string' || candidate.initialDocumentId.length === 0 ||
    (documentId !== null && (typeof documentId !== 'string' || documentId.length === 0)) ||
    !validRecordState(state) || !validPublicSurface(publicSurface) ||
    typeof candidate.selectedAt !== 'string' || typeof candidate.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.selectedAt)) || !Number.isFinite(Date.parse(candidate.expiresAt)) ||
    Date.parse(candidate.expiresAt) <= Date.parse(candidate.selectedAt) ||
    typeof candidate.navigationStarted !== 'boolean' || !validStopReason(candidate.stopReason) ||
    typeof observedRouteCount !== 'number' || !Number.isSafeInteger(observedRouteCount) || observedRouteCount < 0 ||
    observedRouteCount > XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET.maximumNetworkMetadataObservations ||
    !validExcludedRouteCounts(candidate.excludedRouteCounts) || !validRisk(candidate.risk)
  ) return null;
  return {
    schemaVersion: 1,
    tabId,
    windowId,
    managedRunId,
    initialDocumentId: candidate.initialDocumentId,
    documentId,
    state,
    publicSurface,
    selectedAt: candidate.selectedAt,
    expiresAt: candidate.expiresAt,
    navigationStarted: candidate.navigationStarted,
    stopReason: candidate.stopReason,
    observedRouteCount,
    excludedRouteCounts: { ...candidate.excludedRouteCounts },
    risk: { ...candidate.risk }
  };
}

export function recordMatchesManagedPageRun(
  record: XiaohongshuCurrentPageNetworkRecord | null,
  tabId: number,
  runId: string
): record is XiaohongshuCurrentPageNetworkRecord {
  return record !== null && record.tabId === tabId && record.managedRunId === runId;
}

export function isXiaohongshuRiskSignal(value: unknown): value is XiaohongshuRiskSignal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<XiaohongshuRiskSignal>;
  return typeof candidate.pathname === 'string' && typeof candidate.title === 'string' &&
    typeof candidate.visibleText === 'string';
}

function validRecordState(
  value: unknown
): value is XiaohongshuCurrentPageNetworkRecord['state'] {
  return value === 'armed_next_document' || value === 'observing' || value === 'stopped';
}

function validManagedRunId(value: string): boolean {
  return value.length >= 1 && value.length <= 180 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function validPublicSurface(
  value: unknown
): value is XiaohongshuCurrentPageNetworkPublicSurface | null {
  return value === null || value === 'explore' || value === 'search' || value === 'public_profile' ||
    value === 'public_note_detail';
}

function validStopReason(value: unknown): value is XiaohongshuCurrentPageNetworkRecord['stopReason'] {
  return value === null || value === 'document_changed' || value === 'risk' ||
    value === 'source_unavailable' || value === 'tab_closed';
}

function validExcludedRouteCounts(
  value: unknown
): value is XiaohongshuCurrentPageNetworkMetadataObservation['excludedRouteCounts'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<XiaohongshuCurrentPageNetworkMetadataObservation['excludedRouteCounts']>;
  const authenticationOrIdentity = candidate.authenticationOrIdentity;
  const securityOrRisk = candidate.securityOrRisk;
  const configurationOrTelemetry = candidate.configurationOrTelemetry;
  const other = candidate.other;
  if (!validMetadataCount(authenticationOrIdentity) || !validMetadataCount(securityOrRisk) ||
    !validMetadataCount(configurationOrTelemetry) || !validMetadataCount(other)) return false;
  return authenticationOrIdentity + securityOrRisk + configurationOrTelemetry + other <=
    XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET.maximumNetworkMetadataObservations;
}

function validMetadataCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 &&
    value <= XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET.maximumNetworkMetadataObservations;
}

function validRisk(value: unknown): value is XiaohongshuCurrentPageNetworkMetadataObservation['risk'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<XiaohongshuCurrentPageNetworkMetadataObservation['risk']>;
  return typeof candidate.loginRequired === 'boolean' && typeof candidate.verificationRequired === 'boolean' &&
    typeof candidate.rateLimited === 'boolean' && typeof candidate.sourceUnavailable === 'boolean';
}
