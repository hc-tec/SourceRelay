import { createHash } from 'node:crypto';
import type {
  InteractionNetworkObservation,
  InteractionRouteSummary,
  NetworkOwnership,
  ResponseSchemaPath
} from './interaction-reconnaissance-contract';

const MAX_SCHEMA_PATHS = 240;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeInteractionErrorCode(value: unknown): string {
  const code = value instanceof Error ? value.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'interaction_reconnaissance_action_failed';
}

export function safeMimeType(value: string | null): string {
  const mime = (value ?? '').split(';', 1)[0].trim().toLowerCase();
  return mime && mime.length <= 120 && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)
    ? mime
    : 'unknown';
}

export function networkOwnership(url: URL): NetworkOwnership {
  if (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com')) return 'platform_api';
  if (url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com')) return 'platform_cdn';
  return 'third_party_or_unknown';
}

export function queryKeyNames(url: URL): string[] {
  return [...new Set([...url.searchParams.keys()]
    .filter((key) => key.length > 0 && key.length <= 100)
    .map((key) => key.replace(/[^a-zA-Z0-9_.\-\[\]]/g, '_')))].sort();
}

export function serialiseInteractionRoutes(
  observations: readonly InteractionNetworkObservation[]
): InteractionRouteSummary[] {
  const routes = new Map<string, InteractionRouteSummary>();
  for (const observation of observations) {
    const key = [observation.resourceType, observation.method, observation.origin, observation.pathname].join('\n');
    const existing = routes.get(key);
    if (!existing) {
      routes.set(key, {
        resourceType: observation.resourceType,
        method: observation.method,
        ownership: observation.ownership,
        origin: observation.origin,
        pathname: observation.pathname,
        queryKeyNames: [...observation.queryKeyNames],
        count: 1,
        statusCodes: [observation.httpStatus],
        mimeTypes: observation.mimeType === 'unknown' ? [] : [observation.mimeType],
        minimumDeclaredResponseBodyBytes: observation.declaredResponseBodyBytes,
        maximumDeclaredResponseBodyBytes: observation.declaredResponseBodyBytes
      });
      continue;
    }
    existing.count += 1;
    existing.queryKeyNames = [...new Set([...existing.queryKeyNames, ...observation.queryKeyNames])].sort();
    if (!existing.statusCodes.includes(observation.httpStatus)) existing.statusCodes.push(observation.httpStatus);
    if (observation.mimeType !== 'unknown' && !existing.mimeTypes.includes(observation.mimeType)) {
      existing.mimeTypes.push(observation.mimeType);
    }
    if (observation.declaredResponseBodyBytes !== null) {
      existing.minimumDeclaredResponseBodyBytes = existing.minimumDeclaredResponseBodyBytes === null
        ? observation.declaredResponseBodyBytes
        : Math.min(existing.minimumDeclaredResponseBodyBytes, observation.declaredResponseBodyBytes);
      existing.maximumDeclaredResponseBodyBytes = existing.maximumDeclaredResponseBodyBytes === null
        ? observation.declaredResponseBodyBytes
        : Math.max(existing.maximumDeclaredResponseBodyBytes, observation.declaredResponseBodyBytes);
    }
  }
  return [...routes.values()];
}

export function responseBodyRouteAllowed(url: URL): boolean {
  if (url.hostname === 'api.bilibili.com') {
    return [
      '/x/player/wbi/v2',
      '/x/v2/subtitle/web/view',
      '/x/v2/reply/wbi/main',
      '/x/v2/reply/reply'
    ].includes(url.pathname);
  }
  return (url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com')) &&
    /(?:^|[/_-])(?:ai_)?subtitle(?:[/_.-]|$)/i.test(url.pathname);
}

export function responseSchema(value: unknown): {
  schemaPaths: ResponseSchemaPath[];
  sensitiveFieldPathsOmitted: number;
} {
  const schemaPaths: ResponseSchemaPath[] = [];
  let sensitiveFieldPathsOmitted = 0;
  const sensitiveName = /cookie|token|password|secret|csrf|sess|authorization|email|phone|mobile|credential/i;
  const visit = (candidate: unknown, path: string, depth: number): void => {
    if (schemaPaths.length >= MAX_SCHEMA_PATHS || depth > 8) return;
    if (candidate === null) {
      schemaPaths.push({ path, type: 'null' });
      return;
    }
    if (Array.isArray(candidate)) {
      schemaPaths.push({ path, type: 'array', arrayLength: candidate.length });
      if (candidate.length > 0) visit(candidate[0], `${path}[0]`, depth + 1);
      return;
    }
    const primitive = typeof candidate;
    if (primitive === 'boolean' || primitive === 'number' || primitive === 'string') {
      schemaPaths.push({ path, type: primitive });
      return;
    }
    if (primitive !== 'object') return;
    schemaPaths.push({ path, type: 'object' });
    for (const [key, child] of Object.entries(candidate as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      if (schemaPaths.length >= MAX_SCHEMA_PATHS) break;
      if (sensitiveName.test(key)) {
        sensitiveFieldPathsOmitted += 1;
        continue;
      }
      const safeKey = key.length <= 100 ? key.replace(/[^a-zA-Z0-9_.-]/g, '_') : 'oversized_field_name';
      visit(child, `${path}.${safeKey}`, depth + 1);
    }
  };
  visit(value, '$', 0);
  return { schemaPaths, sensitiveFieldPathsOmitted };
}
