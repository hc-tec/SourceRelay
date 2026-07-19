import type {
  DetailCapabilityValidationRunSnapshot,
  VisibleDetailCollectionResult,
  VisiblePageState
} from '../../collector-extension/src/shared/protocol';

export type SourceDomTrigger = 'main_frame_navigated' | 'domcontentloaded' | 'load' | 'interval' | 'final';
export type SourceNetworkPhase =
  | 'target_loading'
  | 'target_domcontentloaded'
  | 'target_load'
  | 'target_post_load'
  | 'navigated_away';

export interface SourceReconnaissanceInput {
  canonicalUrl: string;
}

export interface SourceLifecycleEvent {
  sequence: number;
  atMs: number;
  event: 'main_frame_navigated' | 'domcontentloaded' | 'load' | 'page_closed';
  documentSequence: number;
  pageUrlDigest: string;
  targetMatch: boolean;
}

export interface SourceDomObservation {
  sequence: number;
  atMs: number;
  trigger: SourceDomTrigger;
  documentSequence: number;
  pageUrlDigest: string;
  targetMatch: boolean;
  readyState: 'loading' | 'interactive' | 'complete' | 'unknown';
  visibleTextLength: number;
  pageStateSignal: VisiblePageState;
  collectorReadiness: 'ready' | 'partial' | 'terminal_state';
  contentScriptMarkerPresent: boolean;
  fieldSignals: {
    title: boolean;
    creator: boolean;
    description: boolean;
    publishedText: boolean;
    visibleMetricCount: number;
    visibleTagCount: number;
  };
}

export interface SourceNetworkObservation {
  sequence: number;
  atMs: number;
  phase: SourceNetworkPhase;
  documentSequence: number;
  pageTargetMatch: boolean;
  frameScope: 'top' | 'child';
  resourceType: 'xhr' | 'fetch';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'OTHER';
  origin: string;
  pathname: string;
  httpStatus: number | null;
  mimeType: string;
  responseBodyBytes: number | null;
  outcome: 'response' | 'request_failed';
}

export interface SourceExtensionEvent {
  sequence: number;
  atMs: number;
  state: DetailCapabilityValidationRunSnapshot['state'];
  documentId: string | null;
  navigationUrlDigest: string;
  terminalStatus: DetailCapabilityValidationRunSnapshot['terminalStatus'];
  errorCode: string | null;
}

export interface SourceRouteSummary {
  origin: string;
  pathname: string;
  method: SourceNetworkObservation['method'];
  resourceType: SourceNetworkObservation['resourceType'];
  count: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  phases: SourceNetworkPhase[];
  statusCodes: number[];
  mimeTypes: string[];
  minimumResponseBodyBytes: number | null;
  maximumResponseBodyBytes: number | null;
}

export interface BilibiliDetailSourceReconnaissanceRecord {
  schemaVersion: 1;
  recordId: string;
  runId: string;
  collectorVersion: string;
  profileId: string;
  platform: 'bilibili';
  pageRole: 'video_detail';
  evidenceObjective: 'detail_read';
  accountCategory: 'anonymous';
  targetUrlDigest: string;
  state: 'completed' | 'inconclusive' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  validation: {
    state: DetailCapabilityValidationRunSnapshot['state'] | null;
    terminalStatus: DetailCapabilityValidationRunSnapshot['terminalStatus'];
    errorCode: string | null;
    result: VisibleDetailCollectionResult | null;
  };
  lifecycle: SourceLifecycleEvent[];
  domObservations: SourceDomObservation[];
  extensionTimeline: SourceExtensionEvent[];
  networkObservations: SourceNetworkObservation[];
  routeSummary: SourceRouteSummary[];
  counters: {
    attachedPages: number;
    targetDocuments: number;
    networkObservationsDroppedByLimit: number;
    externalNetworkEventsExcluded: number;
  };
  safeguards: {
    environment: 'local_user_controlled_validation_profile';
    browser: 'visible_playwright_chromium';
    observationMode: 'parallel_dom_and_network_metadata';
    productionResponseRoutes: 'unchanged_empty';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    responseHeaders: 'mime_and_content_length_only';
    responseBody: 'not_read';
    cookiesAndTokens: 'not_read';
    queryAndFragmentValues: 'discarded';
    postTerminalObservationMs: 5_000;
    observedTargetPages: 'closed_after_reconnaissance';
    admissionEligible: false;
  };
}

export function canonicalBilibiliVideoUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.hostname === 'www.bilibili.com' && url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
    if (url.protocol !== 'https:' || !match || url.username || url.password || url.search || url.hash) return null;
    return `https://www.bilibili.com/video/${match[1]}`;
  } catch {
    return null;
  }
}

export function sourceReconnaissanceInput(value: unknown): SourceReconnaissanceInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('source_reconnaissance_input_invalid');
  }
  const candidate = value as Partial<SourceReconnaissanceInput>;
  if (Object.keys(candidate).some((key) => key !== 'canonicalUrl')) {
    throw new Error('source_reconnaissance_input_invalid');
  }
  const canonicalUrl = typeof candidate.canonicalUrl === 'string'
    ? canonicalBilibiliVideoUrl(candidate.canonicalUrl)
    : null;
  if (!canonicalUrl) throw new Error('source_reconnaissance_url_invalid');
  return { canonicalUrl };
}
