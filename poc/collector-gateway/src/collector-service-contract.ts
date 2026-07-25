import {
  isSupportedPlatform,
  type SupportedPlatform
} from '../../collector-extension/src/shared/collection-contracts';
import {
  COLLECTOR_SERVICE_INPUT_SCHEMA_REVISION,
  collectorServiceInputSchema,
  type CollectorServiceInputJsonSchema
} from './collector-service-input-schemas';

export const COLLECTOR_SERVICE_SCHEMA_VERSION = 1 as const;

/**
 * Stable service-level names.  They intentionally describe the collection
 * intent, not a platform selector or a browser implementation detail.
 */
export const COLLECTOR_SERVICE_CAPABILITIES = [
  'bilibili.native_search',
  'bilibili.native_search_batch',
  'bilibili.account_profile',
  'bilibili.account_inventory',
  'bilibili.account_inventory.pagination',
  'bilibili.video_detail',
  'bilibili.transcript',
  'bilibili.discussion',
  'bilibili.danmaku',
  'bilibili.dynamic',
  'bilibili.collection_series.overview',
  'bilibili.collection_series.detail'
] as const;

export type CollectorServiceCapability = (typeof COLLECTOR_SERVICE_CAPABILITIES)[number];

export type CollectorServiceCapabilityStatus = 'available' | 'experimental';

export type CollectorServiceInputSchema =
  | 'bilibili_native_search_input'
  | 'bilibili_native_search_batch_input'
  | 'bilibili_account_profile_input'
  | 'bilibili_account_inventory_input'
  | 'bilibili_account_inventory_pagination_input'
  | 'bilibili_video_detail_input'
  | 'bilibili_transcript_input'
  | 'bilibili_discussion_input'
  | 'bilibili_danmaku_input'
  | 'bilibili_dynamic_input'
  | 'bilibili_collection_series_overview_input'
  | 'bilibili_collection_series_detail_input';

export interface CollectorServiceProfileRequirement {
  kind: 'collection';
  accountCategory: 'user_managed';
}

export interface CollectorServiceCapabilityDescriptor {
  schemaVersion: typeof COLLECTOR_SERVICE_SCHEMA_VERSION;
  capability: CollectorServiceCapability;
  platform: SupportedPlatform;
  status: CollectorServiceCapabilityStatus;
  execution: 'synchronous_runner_mvp';
  requiresProfile: CollectorServiceProfileRequirement;
  input: CollectorServiceInputSchema;
  inputSchemaRevision: typeof COLLECTOR_SERVICE_INPUT_SCHEMA_REVISION;
  inputSchema: CollectorServiceInputJsonSchema;
  output: 'operation_summary_and_artifact_reference';
}

export interface CollectorServiceRequest {
  schemaVersion: typeof COLLECTOR_SERVICE_SCHEMA_VERSION;
  profileId: string;
  platform: SupportedPlatform;
  capability: CollectorServiceCapability;
  input: Record<string, unknown>;
}

export interface CollectorServiceResult {
  schemaVersion: typeof COLLECTOR_SERVICE_SCHEMA_VERSION;
  capability: CollectorServiceCapability;
  platform: SupportedPlatform;
  profileId: string;
  operationId: string;
  operationKind: 'run' | 'batch';
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  terminalReason: string | null;
  coverage: unknown;
  artifact: CollectorServiceArtifactReference;
}

export interface CollectorServiceArtifactReference {
  artifactId: string;
  retrievalPath: string;
  summary: Record<string, unknown>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COLLECTION_PROFILE: CollectorServiceProfileRequirement = {
  kind: 'collection',
  accountCategory: 'user_managed'
};

const INPUT_SCHEMAS: Readonly<Record<CollectorServiceCapability, CollectorServiceInputSchema>> = {
  'bilibili.native_search': 'bilibili_native_search_input',
  'bilibili.native_search_batch': 'bilibili_native_search_batch_input',
  'bilibili.account_profile': 'bilibili_account_profile_input',
  'bilibili.account_inventory': 'bilibili_account_inventory_input',
  'bilibili.account_inventory.pagination': 'bilibili_account_inventory_pagination_input',
  'bilibili.video_detail': 'bilibili_video_detail_input',
  'bilibili.transcript': 'bilibili_transcript_input',
  'bilibili.discussion': 'bilibili_discussion_input',
  'bilibili.danmaku': 'bilibili_danmaku_input',
  'bilibili.dynamic': 'bilibili_dynamic_input',
  'bilibili.collection_series.overview': 'bilibili_collection_series_overview_input',
  'bilibili.collection_series.detail': 'bilibili_collection_series_detail_input'
};

const DESCRIPTORS: readonly CollectorServiceCapabilityDescriptor[] =
  COLLECTOR_SERVICE_CAPABILITIES.map((capability) => ({
    schemaVersion: COLLECTOR_SERVICE_SCHEMA_VERSION,
    capability,
    platform: 'bilibili',
    status: 'experimental',
    execution: 'synchronous_runner_mvp',
    requiresProfile: COLLECTION_PROFILE,
    input: INPUT_SCHEMAS[capability],
    inputSchemaRevision: COLLECTOR_SERVICE_INPUT_SCHEMA_REVISION,
    inputSchema: collectorServiceInputSchema(capability),
    output: 'operation_summary_and_artifact_reference'
  }));

export function collectorServiceCapabilities(): readonly CollectorServiceCapabilityDescriptor[] {
  return DESCRIPTORS.map((descriptor) => structuredClone(descriptor));
}

export function isCollectorServiceCapability(value: unknown): value is CollectorServiceCapability {
  return typeof value === 'string' &&
    (COLLECTOR_SERVICE_CAPABILITIES as readonly string[]).includes(value);
}

export function isCollectorServiceArtifactId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function collectorServiceRequestInput(value: unknown): CollectorServiceRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('collector_service_request_invalid');
  }
  const candidate = value as Partial<CollectorServiceRequest>;
  const allowedKeys = new Set(['schemaVersion', 'profileId', 'platform', 'capability', 'input']);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key)) ||
    candidate.schemaVersion !== COLLECTOR_SERVICE_SCHEMA_VERSION ||
    typeof candidate.profileId !== 'string' || !UUID_PATTERN.test(candidate.profileId) ||
    !isSupportedPlatform(candidate.platform) ||
    !isCollectorServiceCapability(candidate.capability) ||
    !candidate.input || typeof candidate.input !== 'object' || Array.isArray(candidate.input)) {
    throw new Error('collector_service_request_invalid');
  }
  if (Object.prototype.hasOwnProperty.call(candidate.input, 'profileId')) {
    throw new Error('collector_service_input_profile_id_forbidden');
  }
  if (candidate.platform !== 'bilibili' || !candidate.capability.startsWith('bilibili.')) {
    throw new Error('collector_service_capability_unavailable');
  }
  return {
    schemaVersion: COLLECTOR_SERVICE_SCHEMA_VERSION,
    profileId: candidate.profileId,
    platform: candidate.platform,
    capability: candidate.capability,
    input: structuredClone(candidate.input as Record<string, unknown>)
  };
}

export function collectorServiceResult(
  request: CollectorServiceRequest,
  value: unknown
): CollectorServiceResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('collector_service_runner_result_invalid');
  }
  const candidate = value as {
    run?: unknown;
    artifact?: unknown;
  };
  if (!candidate.run || typeof candidate.run !== 'object' || Array.isArray(candidate.run) ||
    !candidate.artifact || typeof candidate.artifact !== 'object' || Array.isArray(candidate.artifact)) {
    throw new Error('collector_service_runner_result_invalid');
  }
  const run = candidate.run as {
    runId?: unknown;
    batchId?: unknown;
    state?: unknown;
    errorCode?: unknown;
    coverage?: unknown;
  };
  const hasRunId = typeof run.runId === 'string';
  const hasBatchId = typeof run.batchId === 'string';
  if ((hasRunId && hasBatchId) || (!hasRunId && !hasBatchId) ||
    (run.state !== 'completed' && run.state !== 'partial' && run.state !== 'failed') ||
    (run.errorCode !== null && typeof run.errorCode !== 'string') ||
    !('coverage' in run)) {
    throw new Error('collector_service_runner_result_invalid');
  }
  const artifact = candidate.artifact as Record<string, unknown>;
  if (!isCollectorServiceArtifactId(artifact.artifactId)) {
    throw new Error('collector_service_runner_result_invalid');
  }
  const coverage = run.coverage as Record<string, unknown>;
  const terminalReason = coverage && typeof coverage.terminalReason === 'string'
    ? coverage.terminalReason
    : null;
  return {
    schemaVersion: COLLECTOR_SERVICE_SCHEMA_VERSION,
    capability: request.capability,
    platform: request.platform,
    profileId: request.profileId,
    operationId: hasRunId ? run.runId as string : run.batchId as string,
    operationKind: hasRunId ? 'run' : 'batch',
    state: run.state,
    errorCode: run.errorCode,
    terminalReason,
    coverage: structuredClone(run.coverage),
    artifact: {
      artifactId: artifact.artifactId,
      retrievalPath: artifactRetrievalPath(request.capability, artifact.artifactId),
      summary: structuredClone(artifact)
    }
  };
}

function artifactRetrievalPath(capability: CollectorServiceCapability, artifactId: string): string {
  const roots: Readonly<Record<CollectorServiceCapability, string>> = {
    'bilibili.native_search': '/v1/collect/artifacts/bilibili.native_search',
    'bilibili.native_search_batch': '/v1/collect/artifacts/bilibili.native_search_batch',
    'bilibili.account_profile': '/v1/collect/artifacts/bilibili.account_profile',
    'bilibili.account_inventory': '/v1/collect/artifacts/bilibili.account_inventory',
    'bilibili.account_inventory.pagination': '/v1/collect/artifacts/bilibili.account_inventory.pagination',
    'bilibili.video_detail': '/v1/collect/artifacts/bilibili.video_detail',
    'bilibili.transcript': '/v1/collect/artifacts/bilibili.transcript',
    'bilibili.discussion': '/v1/collect/artifacts/bilibili.discussion',
    'bilibili.danmaku': '/v1/collect/artifacts/bilibili.danmaku',
    'bilibili.dynamic': '/v1/collect/artifacts/bilibili.dynamic',
    'bilibili.collection_series.overview': '/v1/collect/artifacts/bilibili.collection_series.overview',
    'bilibili.collection_series.detail': '/v1/collect/artifacts/bilibili.collection_series.detail'
  };
  return `${roots[capability]}/${artifactId}`;
}
