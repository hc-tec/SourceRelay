import { isSupportedPlatform, type SupportedPlatform } from './collection-contracts';
import {
  BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID,
  BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID,
  BILIBILI_TRANSCRIPT_RESEARCH_ROUTE_IDS,
  projectBilibiliTranscriptDirectoryProtobuf,
  projectBilibiliTranscriptRouteBody
} from './transcript-capture';

// This module is deliberately usable in both content-script worlds.  It has
// no chrome.* dependency: the page-facing observer, isolated-world bridge,
// and service worker all apply the same route and redaction contract.

export const NETWORK_CAPTURE_OBSERVED = 'collector.networkCaptureObserved' as const;
export const NETWORK_CAPTURE_BRIDGE_READY_MESSAGE = 'collector.networkCaptureBridgeReady' as const;
export const NETWORK_CAPTURE_WINDOW_CHANNEL = 'personal-intelligence.collector.network-capture.v1' as const;
export const NETWORK_CAPTURE_BRIDGE_READY = 'bridge-ready' as const;
export const NETWORK_CAPTURE_OBSERVER_READY = 'observer-ready' as const;
export const NETWORK_CAPTURE_WINDOW_OBSERVED = 'response-observed' as const;

// These are deliberately small.  The extension is an observation bridge, not
// a general-purpose response archive; larger raw artifacts belong behind a
// later, explicitly paired local gateway.
export const NETWORK_CAPTURE_MAX_BODY_BYTES = 96 * 1024;
export const NETWORK_CAPTURE_MAX_PER_PAGE = 3;
export const BILIBILI_DYNAMIC_FEED_ROUTE_ID = 'bilibili.dynamic.account-feed.response.v1' as const;
export const BILIBILI_COLLECTION_SERIES_OVERVIEW_ROUTE_ID =
  'bilibili.collection-series.overview.response.v1' as const;
export const BILIBILI_COLLECTION_SERIES_DETAIL_ROUTE_ID =
  'bilibili.collection-series.detail.response.v1' as const;

const MAX_JSON_DEPTH = 8;
const MAX_OBJECT_PROPERTIES = 80;
const MAX_ARRAY_ITEMS = 80;
const MAX_STRING_LENGTH = 4_000;
const MAX_KEY_LENGTH = 160;

const sensitiveFieldFragments = [
  'cookie',
  'authorization',
  'proxyauthorization',
  'token',
  'session',
  'csrf',
  'xsrf',
  'xsec',
  'zc0',
  'password',
  'passwd',
  'captcha',
  'verify',
  'phone',
  'email',
  'apikey',
  'secret'
] as const;

const textRedactions = [
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:cookie|authorization|proxy-authorization|token|access_token|refresh_token|session(?:id)?|sid|csrf|xsrf|xsec_token|z_c0|user_token|password|passwd|captcha|verify|phone|email|api[_-]?key|secret)\b\s*[:=]\s*["']?[^,\s;"'}\]]+/gi,
  /(?:^|[\s?&,{;])(?:[A-Za-z0-9]+[_-])sid\s*[:=]\s*["']?[^,\s;"'}\]]+/g,
  /(?:^|[\s?&,{;])[A-Za-z0-9]+Sid\s*[:=]\s*["']?[^,\s;"'}\]]+/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
] as const;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type NetworkCaptureRouteId = `${SupportedPlatform}.${string}.response.v${number}`;

export type NetworkCaptureRejectionReason =
  | 'mime_not_allowed'
  | 'response_status_not_allowed'
  | 'payload_too_large'
  | 'invalid_json'
  | 'payload_rejected'
  | 'unreadable_response';

export interface NetworkCaptureRoute {
  id: NetworkCaptureRouteId;
  platform: SupportedPlatform;
  origin: string;
  pathname: string;
  pathnameMatch: 'exact' | 'opaque_suffix_prefix';
  maximumBodyBytes: number;
  projector: 'bounded_json' | 'bilibili_transcript';
  responseEncoding: 'json' | 'protobuf';
  admission: 'production' | 'research_validation';
}

export interface NetworkCaptureObservation {
  schemaVersion: 1;
  platform: SupportedPlatform;
  routeId: NetworkCaptureRouteId;
  status: 'captured' | 'payload_rejected';
  method: 'GET' | 'POST' | 'OTHER';
  responseUrl: string;
  contentType: string;
  httpStatus: number;
  capturedAt: number;
  admission: NetworkCaptureRoute['admission'];
  bodyBytes?: number;
  bodySha256?: string;
  queryKeyNames?: string[];
  body?: JsonValue;
  rejectionReason?: NetworkCaptureRejectionReason;
}

export interface NetworkCaptureObservedMessage {
  type: typeof NETWORK_CAPTURE_OBSERVED;
  observation: NetworkCaptureObservation;
}

interface ObservationInput {
  platform: SupportedPlatform;
  route: NetworkCaptureRoute;
  method: string | undefined;
  responseUrl: string;
  contentType: string | null | undefined;
  httpStatus: number;
}

// Production begins intentionally empty.  A real platform route is added only
// after a low-frequency, user-authorised observation confirms the current
// origin/path contract.  Historical GitHub examples and private API recipes
// are not evidence that a route remains valid or safe to enable.
const productionRoutes: readonly NetworkCaptureRoute[] = [];

const researchValidationRoutes: readonly NetworkCaptureRoute[] = [
  {
    id: BILIBILI_DYNAMIC_FEED_ROUTE_ID,
    platform: 'bilibili',
    origin: 'https://api.bilibili.com',
    pathname: '/x/polymer/web-dynamic/v1/feed/space',
    pathnameMatch: 'exact',
    maximumBodyBytes: 2 * 1024 * 1024,
    projector: 'bounded_json',
    responseEncoding: 'json',
    admission: 'research_validation'
  },
  {
    id: BILIBILI_COLLECTION_SERIES_OVERVIEW_ROUTE_ID,
    platform: 'bilibili',
    origin: 'https://api.bilibili.com',
    pathname: '/x/polymer/web-space/seasons_series_list',
    pathnameMatch: 'exact',
    maximumBodyBytes: 2 * 1024 * 1024,
    projector: 'bounded_json',
    responseEncoding: 'json',
    admission: 'research_validation'
  },
  {
    id: BILIBILI_COLLECTION_SERIES_DETAIL_ROUTE_ID,
    platform: 'bilibili',
    origin: 'https://api.bilibili.com',
    pathname: '/x/polymer/web-space/seasons_archives_list',
    pathnameMatch: 'exact',
    maximumBodyBytes: 2 * 1024 * 1024,
    projector: 'bounded_json',
    responseEncoding: 'json',
    admission: 'research_validation'
  },
  {
    id: BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID,
    platform: 'bilibili',
    origin: 'https://api.bilibili.com',
    pathname: '/x/player/wbi/v2',
    pathnameMatch: 'exact',
    maximumBodyBytes: 128 * 1024,
    projector: 'bilibili_transcript',
    responseEncoding: 'json',
    admission: 'research_validation'
  },
  {
    // Since August 2026 Bilibili serves the subtitle directory as a protobuf
    // envelope instead of JSON from the legacy player response.
    id: BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID,
    platform: 'bilibili',
    origin: 'https://api.bilibili.com',
    pathname: '/x/v2/subtitle/web/view',
    pathnameMatch: 'exact',
    maximumBodyBytes: 128 * 1024,
    projector: 'bilibili_transcript',
    responseEncoding: 'protobuf',
    admission: 'research_validation'
  },
  {
    id: BILIBILI_TRANSCRIPT_DOCUMENT_ROUTE_ID,
    platform: 'bilibili',
    origin: 'https://aisubtitle.hdslb.com',
    pathname: '/bfs/ai_subtitle/prod/',
    pathnameMatch: 'opaque_suffix_prefix',
    maximumBodyBytes: 512 * 1024,
    projector: 'bilibili_transcript',
    responseEncoding: 'json',
    admission: 'research_validation'
  },
];

const allKnownRoutes: readonly NetworkCaptureRoute[] = [...productionRoutes, ...researchValidationRoutes];

export function bilibiliTranscriptResearchRouteIds(): readonly NetworkCaptureRouteId[] {
  return [...BILIBILI_TRANSCRIPT_RESEARCH_ROUTE_IDS];
}

export function bilibiliDynamicResearchRouteIds(): readonly NetworkCaptureRouteId[] {
  return [BILIBILI_DYNAMIC_FEED_ROUTE_ID];
}

export function bilibiliCollectionSeriesResearchRouteIds(): readonly NetworkCaptureRouteId[] {
  return [BILIBILI_COLLECTION_SERIES_OVERVIEW_ROUTE_ID];
}

export function bilibiliCollectionSeriesDetailResearchRouteIds(): readonly NetworkCaptureRouteId[] {
  return [BILIBILI_COLLECTION_SERIES_DETAIL_ROUTE_ID];
}

export function approvedNetworkCaptureRouteIds(platform: SupportedPlatform): readonly NetworkCaptureRouteId[] {
  return productionRoutes.filter((route) => route.platform === platform).map((route) => route.id);
}

export function validateNetworkCaptureRouteIds(
  platform: SupportedPlatform,
  routeIds: readonly string[],
  admission: NetworkCaptureRoute['admission']
): readonly NetworkCaptureRouteId[] | null {
  if (routeIds.length === 0 || new Set(routeIds).size !== routeIds.length) return null;
  const routes = routeIds.map((routeId) => allKnownRoutes.find((route) => route.id === routeId));
  if (routes.some((route) => !route || route.platform !== platform || route.admission !== admission)) return null;
  return routes.map((route) => route!.id);
}

function normaliseFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveFieldName(value: string): boolean {
  const normalised = normaliseFieldName(value);
  // `sid` is short enough that a generic substring rule would falsely remove
  // harmless fields such as `inside`. Split delimiters and camelCase so
  // `sid`, `user_sid`, and `userSid` are removed without overmatching.
  const keySegments = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return keySegments.includes('sid') || sensitiveFieldFragments.some((fragment) => normalised.includes(fragment));
}

function isDangerousObjectKey(value: string): boolean {
  return value === '__proto__' || value === 'constructor' || value === 'prototype';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitiseText(value: string): string {
  let result = value.slice(0, MAX_STRING_LENGTH);
  for (const pattern of textRedactions) result = result.replace(pattern, '[redacted]');
  return result;
}

/**
 * Converts arbitrary JSON-like input into a bounded, recursively redacted
 * value.  It intentionally drops sensitive keys rather than retaining them
 * with a placeholder, so downstream artifacts cannot accidentally be treated
 * as a credential inventory.
 */
export function sanitiseNetworkJson(value: unknown, depth = 0): JsonValue | undefined {
  if (depth > MAX_JSON_DEPTH) return '[truncated: depth limit]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return sanitiseText(value);

  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (const item of value.slice(0, MAX_ARRAY_ITEMS)) {
      const sanitised = sanitiseNetworkJson(item, depth + 1);
      if (sanitised !== undefined) result.push(sanitised);
    }
    return result;
  }

  if (!isRecord(value)) return undefined;
  const result = Object.create(null) as { [key: string]: JsonValue };
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, MAX_OBJECT_PROPERTIES)) {
    if (!rawKey || rawKey.length > MAX_KEY_LENGTH || isDangerousObjectKey(rawKey) || isSensitiveFieldName(rawKey)) {
      continue;
    }
    const sanitised = sanitiseNetworkJson(rawValue, depth + 1);
    if (sanitised !== undefined) result[rawKey] = sanitised;
  }
  return result;
}

export function isJsonContentType(value: string | null | undefined): boolean {
  const mediaType = ((value ?? '').split(';', 1)[0] ?? '').trim().toLowerCase();
  return mediaType === 'application/json' || mediaType === 'text/json' || mediaType.endsWith('+json');
}

function safeContentType(value: string | null | undefined): string {
  const mediaType = ((value ?? '').split(';', 1)[0] ?? '').trim().toLowerCase();
  if (!mediaType || mediaType.length > 120 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType)) {
    return 'unknown';
  }
  return mediaType;
}

function safeHttpStatus(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 599 ? value : 0;
}

function safeMethod(value: string | undefined): NetworkCaptureObservation['method'] {
  const method = (value ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'POST') return method;
  return 'OTHER';
}

export function sanitiseCaptureUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function routeMatchesNetworkCaptureUrl(route: NetworkCaptureRoute, responseUrl: string): boolean {
  try {
    const url = new URL(responseUrl);
    if (route.origin !== url.origin) return false;
    if (route.pathnameMatch === 'exact') return route.pathname === url.pathname;
    if (!url.pathname.startsWith(route.pathname)) return false;
    const suffix = url.pathname.slice(route.pathname.length);
    return /^[A-Za-z0-9_-]{20,200}$/.test(suffix);
  } catch {
    return false;
  }
}

export function isNetworkCaptureResponseContentType(
  route: NetworkCaptureRoute,
  value: string | null | undefined
): boolean {
  if (isJsonContentType(value)) return route.responseEncoding === 'json';
  const mediaType = ((value ?? '').split(';', 1)[0] ?? '').trim().toLowerCase();
  return route.responseEncoding === 'protobuf' && mediaType === 'application/octet-stream';
}

export function findNetworkCaptureRoute(
  platform: SupportedPlatform,
  responseUrl: string,
  allowedRouteIds: readonly string[] = approvedNetworkCaptureRouteIds(platform)
): NetworkCaptureRoute | null {
  const allowed = new Set(allowedRouteIds);
  return allKnownRoutes.find((route) =>
    allowed.has(route.id) && route.platform === platform && routeMatchesNetworkCaptureUrl(route, responseUrl)
  ) ?? null;
}

export function hasApprovedNetworkCaptureRoute(platform: SupportedPlatform): boolean {
  return productionRoutes.some((route) => route.platform === platform);
}

function baseObservation(input: ObservationInput): Omit<NetworkCaptureObservation, 'status' | 'body' | 'rejectionReason'> | null {
  const responseUrl = sanitiseCaptureUrl(input.responseUrl);
  if (!responseUrl) return null;
  return {
    schemaVersion: 1,
    platform: input.platform,
    routeId: input.route.id,
    method: safeMethod(input.method),
    responseUrl,
    contentType: safeContentType(input.contentType),
    httpStatus: safeHttpStatus(input.httpStatus),
    capturedAt: Date.now(),
    admission: input.route.admission
  };
}

export function createNetworkCaptureRejection(
  input: ObservationInput,
  rejectionReason: NetworkCaptureRejectionReason
): NetworkCaptureObservation | null {
  const base = baseObservation(input);
  return base ? { ...base, status: 'payload_rejected', rejectionReason } : null;
}

export function createNetworkCaptureFromText(
  input: ObservationInput,
  responseText: string
): NetworkCaptureObservation | null {
  if (!isJsonContentType(input.contentType)) return createNetworkCaptureRejection(input, 'mime_not_allowed');
  if (new TextEncoder().encode(responseText).byteLength > input.route.maximumBodyBytes) {
    return createNetworkCaptureRejection(input, 'payload_too_large');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return createNetworkCaptureRejection(input, 'invalid_json');
  }

  const body = input.route.projector === 'bilibili_transcript'
    ? projectBilibiliTranscriptRouteBody(input.route.id, parsed) as unknown as JsonValue | null
    : sanitiseNetworkJson(parsed);
  const base = baseObservation(input);
  if (!base || body === undefined) return base ? { ...base, status: 'payload_rejected', rejectionReason: 'payload_rejected' } : null;
  return { ...base, status: 'captured', body };
}

export function createNetworkCaptureFromBytes(
  input: ObservationInput,
  responseBytes: Uint8Array
): NetworkCaptureObservation | null {
  if (responseBytes.byteLength > input.route.maximumBodyBytes) {
    return createNetworkCaptureRejection(input, 'payload_too_large');
  }
  if (input.route.responseEncoding === 'protobuf') {
    const body = input.route.id === BILIBILI_TRANSCRIPT_DIRECTORY_ROUTE_ID
      ? projectBilibiliTranscriptDirectoryProtobuf(responseBytes)
      : null;
    const base = baseObservation(input);
    return !base ? null : body === null
      ? { ...base, status: 'payload_rejected', rejectionReason: 'payload_rejected' }
      : { ...base, status: 'captured', body: body as unknown as JsonValue };
  }
  return createNetworkCaptureFromText(
    input,
    new TextDecoder('utf-8', { fatal: false }).decode(responseBytes)
  );
}

function isRejectionReason(value: unknown): value is NetworkCaptureRejectionReason {
  return (
    value === 'mime_not_allowed' ||
    value === 'response_status_not_allowed' ||
    value === 'payload_too_large' ||
    value === 'invalid_json' ||
    value === 'payload_rejected' ||
    value === 'unreadable_response'
  );
}

/**
 * Page-world messages are untrusted.  This re-validates their route and
 * recursively applies redaction before an isolated script or worker stores
 * anything.  A forged page message can at most add bounded, de-sensitised
 * evidence; it cannot invoke a privileged browser action.
 */
export function sanitiseNetworkCaptureObservation(
  value: unknown,
  allowedRouteIds: readonly string[] = []
): NetworkCaptureObservation | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isSupportedPlatform(value.platform)) return null;
  if (typeof value.responseUrl !== 'string' || typeof value.routeId !== 'string') return null;

  const responseUrl = sanitiseCaptureUrl(value.responseUrl);
  if (!responseUrl) return null;
  const route = findNetworkCaptureRoute(value.platform, responseUrl, allowedRouteIds);
  if (!route || route.id !== value.routeId) return null;
  if (value.status !== 'captured' && value.status !== 'payload_rejected') return null;

  const base = {
    schemaVersion: 1 as const,
    platform: value.platform,
    routeId: route.id,
    status: value.status,
    method: safeMethod(typeof value.method === 'string' ? value.method : undefined),
    responseUrl,
    contentType: safeContentType(typeof value.contentType === 'string' ? value.contentType : undefined),
    httpStatus: safeHttpStatus(typeof value.httpStatus === 'number' ? value.httpStatus : 0),
    capturedAt: typeof value.capturedAt === 'number' && Number.isFinite(value.capturedAt) ? Math.trunc(value.capturedAt) : Date.now(),
    admission: route.admission
  };
  const bodyEvidence = Number.isSafeInteger(value.bodyBytes) && Number(value.bodyBytes) >= 0 &&
    Number(value.bodyBytes) <= route.maximumBodyBytes &&
    typeof value.bodySha256 === 'string' && /^[0-9a-f]{64}$/.test(value.bodySha256) &&
    Array.isArray(value.queryKeyNames) && value.queryKeyNames.length <= 100 &&
    value.queryKeyNames.every((key) => typeof key === 'string' && /^[A-Za-z0-9_.\-\[\]]{1,100}$/.test(key))
    ? {
        bodyBytes: Number(value.bodyBytes),
        bodySha256: value.bodySha256,
        queryKeyNames: [...new Set(value.queryKeyNames as string[])].sort()
      }
    : {};

  if (value.status === 'payload_rejected') {
    if (!isRejectionReason(value.rejectionReason)) return null;
    return { ...base, ...bodyEvidence, status: 'payload_rejected', rejectionReason: value.rejectionReason };
  }

  const body = route.projector === 'bilibili_transcript'
    ? projectBilibiliTranscriptRouteBody(route.id, value.body) as unknown as JsonValue | null
    : sanitiseNetworkJson(value.body);
  if (body === undefined) return null;
  return { ...base, ...bodyEvidence, status: 'captured', body };
}
