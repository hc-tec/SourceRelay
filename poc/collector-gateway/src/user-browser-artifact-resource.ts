import type { FoundUserBrowserArtifact } from './user-browser-artifact-reader-registry';
import { canonicalJson, sha256Hex } from './canonical-json';
import { USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION } from '@intelligence/collector-contracts';

export const USER_BROWSER_ARTIFACT_MAX_WINDOW_BYTES = 64 * 1024;
export const USER_BROWSER_ARTIFACT_DEFAULT_WINDOW_BYTES = 16 * 1024;

export interface UserBrowserArtifactMetadata {
  schemaVersion: 1;
  artifactId: string;
  operationId: string | null;
  capability: FoundUserBrowserArtifact['capability'];
  mediaType: 'application/json';
  representation: 'canonical_json_utf8';
  byteLength: number;
  sha256: string;
  capturedAt: string | null;
  terminalStatus: string | null;
  retentionClass: 'core_managed_local';
  retainedUntil: null;
  deletionState: 'retained';
  available: true;
}

export interface UserBrowserArtifactContentWindow {
  schemaVersion: 1;
  artifactId: string;
  capability: FoundUserBrowserArtifact['capability'];
  representation: 'canonical_json_utf8';
  encoding: 'utf-8';
  offset: number;
  endExclusive: number;
  byteLength: number;
  maximumBytes: number;
  nextOffset: number | null;
  truncated: boolean;
  sha256: string;
  chunkSha256: string;
  text: string;
}

export function userBrowserArtifactMetadata(found: FoundUserBrowserArtifact): UserBrowserArtifactMetadata {
  const representation = artifactRepresentation(found);
  const summary = artifactSummary(found.view);
  return {
    schemaVersion: 1,
    artifactId: found.artifactId,
    operationId: safeUuid(summary?.operationId) ?? safeUuid(summary?.runId),
    capability: found.capability,
    mediaType: 'application/json',
    representation: 'canonical_json_utf8',
    byteLength: representation.bytes.length,
    sha256: representation.sha256,
    capturedAt: safeTimestamp(summary?.capturedAt),
    terminalStatus: safeStatus(summary?.state),
    retentionClass: 'core_managed_local',
    retainedUntil: null,
    deletionState: 'retained',
    available: true
  };
}

export function userBrowserArtifactContentWindow(
  found: FoundUserBrowserArtifact,
  offset: number,
  maximumBytes: number
): UserBrowserArtifactContentWindow {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('collector_service_artifact_offset_invalid');
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 ||
    maximumBytes > USER_BROWSER_ARTIFACT_MAX_WINDOW_BYTES) {
    throw new Error('collector_service_artifact_window_invalid');
  }
  const representation = artifactRepresentation(found);
  if (offset > representation.bytes.length) throw new Error('collector_service_artifact_read_out_of_bounds');
  if (!utf8Boundary(representation.bytes, offset)) {
    throw new Error('collector_service_artifact_offset_not_utf8_boundary');
  }

  let endExclusive = Math.min(representation.bytes.length, offset + maximumBytes);
  while (endExclusive > offset && !utf8Boundary(representation.bytes, endExclusive)) endExclusive -= 1;
  if (endExclusive === offset && offset < representation.bytes.length) {
    throw new Error('collector_service_artifact_window_too_small');
  }
  const chunk = representation.bytes.subarray(offset, endExclusive);
  const text = chunk.toString('utf8');
  const truncated = endExclusive < representation.bytes.length;
  return {
    schemaVersion: 1,
    artifactId: found.artifactId,
    capability: found.capability,
    representation: 'canonical_json_utf8',
    encoding: 'utf-8',
    offset,
    endExclusive,
    byteLength: representation.bytes.length,
    maximumBytes,
    nextOffset: truncated ? endExclusive : null,
    truncated,
    sha256: representation.sha256,
    chunkSha256: `sha256:${sha256Hex(text)}`,
    text
  };
}

function artifactRepresentation(found: FoundUserBrowserArtifact): { bytes: Buffer; sha256: string } {
  const text = canonicalJson({
    schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
    capability: found.capability,
    artifact: found.view
  });
  return {
    bytes: Buffer.from(text, 'utf8'),
    sha256: `sha256:${sha256Hex(text)}`
  };
}

function artifactSummary(view: unknown): Record<string, unknown> | null {
  if (!record(view)) return null;
  return record(view.summary) ? view.summary : view;
}

function safeUuid(value: unknown): string | null {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function safeTimestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function safeStatus(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9_.-]{1,120}$/i.test(value) ? value : null;
}

function utf8Boundary(bytes: Buffer, offset: number): boolean {
  return offset === 0 || offset === bytes.length || (bytes[offset]! & 0xc0) !== 0x80;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
