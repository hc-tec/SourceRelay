import { createHash } from 'node:crypto';
import type {
  SourceNetworkObservation,
  SourceRouteSummary
} from './source-reconnaissance-contract';

export function safePageUrl(value: string): string | null {
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

export function sourceSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeSourceMimeType(value: string | null): string {
  const mime = ((value ?? '').split(';', 1)[0] ?? '').trim().toLowerCase();
  return mime && mime.length <= 120 && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)
    ? mime
    : 'unknown';
}

export function safeSourceMethod(value: string): SourceNetworkObservation['method'] {
  const method = value.toUpperCase();
  if (
    method === 'GET' || method === 'POST' || method === 'PUT' || method === 'PATCH' ||
    method === 'DELETE' || method === 'HEAD' || method === 'OPTIONS'
  ) return method;
  return 'OTHER';
}

export function isBilibiliOwnedHostname(hostname: string): boolean {
  return hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com');
}

export function sourceReconnaissanceErrorCode(value: unknown): string {
  const code = value instanceof Error ? value.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'source_reconnaissance_run_failed';
}

export function serialiseSourceRouteSummary(
  observations: readonly SourceNetworkObservation[]
): SourceRouteSummary[] {
  const summaries = new Map<string, SourceRouteSummary>();
  for (const observation of observations) {
    const key = [observation.origin, observation.pathname, observation.method, observation.resourceType].join('\n');
    const existing = summaries.get(key);
    if (!existing) {
      summaries.set(key, {
        origin: observation.origin,
        pathname: observation.pathname,
        method: observation.method,
        resourceType: observation.resourceType,
        count: 1,
        firstSeenAtMs: observation.atMs,
        lastSeenAtMs: observation.atMs,
        phases: [observation.phase],
        statusCodes: observation.httpStatus === null ? [] : [observation.httpStatus],
        mimeTypes: observation.mimeType === 'unknown' ? [] : [observation.mimeType],
        minimumResponseBodyBytes: observation.responseBodyBytes,
        maximumResponseBodyBytes: observation.responseBodyBytes
      });
      continue;
    }
    existing.count += 1;
    existing.lastSeenAtMs = observation.atMs;
    if (!existing.phases.includes(observation.phase)) existing.phases.push(observation.phase);
    if (observation.httpStatus !== null && !existing.statusCodes.includes(observation.httpStatus)) {
      existing.statusCodes.push(observation.httpStatus);
    }
    if (observation.mimeType !== 'unknown' && !existing.mimeTypes.includes(observation.mimeType)) {
      existing.mimeTypes.push(observation.mimeType);
    }
    if (observation.responseBodyBytes !== null) {
      existing.minimumResponseBodyBytes = existing.minimumResponseBodyBytes === null
        ? observation.responseBodyBytes
        : Math.min(existing.minimumResponseBodyBytes, observation.responseBodyBytes);
      existing.maximumResponseBodyBytes = existing.maximumResponseBodyBytes === null
        ? observation.responseBodyBytes
        : Math.max(existing.maximumResponseBodyBytes, observation.responseBodyBytes);
    }
  }
  return [...summaries.values()].sort((left, right) => left.firstSeenAtMs - right.firstSeenAtMs);
}
