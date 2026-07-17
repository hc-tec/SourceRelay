import type {
  CapabilityPreflight,
  CollectionBudgetLimits,
  CollectionTaskTarget,
  BrowserProfileBinding,
  ConsentAction,
  EvidenceObjective,
  ResearchTaskContract,
  StrategyProvenance,
  SupportedPlatform,
  TaskTargetType
} from './collection-contracts';
import {
  strategiesFor,
  strategyProvenance,
  type StaticPlatformStrategy
} from './strategy-registry';

export const COLLECTOR_CONTROL_PROTOCOL_VERSION = 1 as const;
export const STAGE_LEASE_SCHEMA_VERSION = 1 as const;

export interface GatewayIdentity {
  schemaVersion: 1;
  protocolVersion: typeof COLLECTOR_CONTROL_PROTOCOL_VERSION;
  gatewayInstanceId: string;
  displayName: string;
  loopbackOrigin: string;
  signingPublicKeyJwk: JsonWebKey;
  identityFingerprint: string;
}

export interface GatewayPairingChallenge {
  schemaVersion: 1;
  protocolVersion: typeof COLLECTOR_CONTROL_PROTOCOL_VERSION;
  pairingSessionId: string;
  gateway: GatewayIdentity;
  extensionChallenge: string;
  pairingCodeChallenge: string;
  pairingAuthorizationFingerprint: string;
  issuedAt: string;
  expiresAt: string;
  gatewaySignature: string;
}

export interface GatewayPairingRecord {
  schemaVersion: 1;
  gatewayInstanceId: string;
  displayName: string;
  loopbackOrigin: string;
  signingPublicKeyJwk: JsonWebKey;
  identityFingerprint: string;
  extensionInstanceId: string;
  pairingAuthorization: string;
  pairedAt: string;
}

export type GatewayPairingSummary = Omit<GatewayPairingRecord, 'pairingAuthorization' | 'signingPublicKeyJwk'>;

export interface GatewayPairingClaimResponse {
  schemaVersion: 1;
  challenge: GatewayPairingChallenge;
  pairingAuthorization: string;
}

export interface EvidencePlanStage {
  stageId: string;
  targetIndex: number;
  target: CollectionTaskTarget;
  targetType: TaskTargetType;
  platform: SupportedPlatform;
  evidenceObjective: EvidenceObjective;
  strategy: StrategyProvenance | null;
  preflight: CapabilityPreflight;
  budget: CollectionBudgetLimits | null;
}

export interface EvidencePlan {
  schemaVersion: 1;
  planId: string;
  taskId: string;
  generatedAt: string;
  stages: readonly EvidencePlanStage[];
  approval: {
    status: 'pending';
  };
}

export interface ApprovedEvidencePlan extends Omit<EvidencePlan, 'approval'> {
  approval: {
    status: 'approved';
    approvedBy: 'user';
    approvedAt: string;
    planDigest: string;
  };
}

export interface GatewayTaskDispatchEnvelope {
  schemaVersion: 1;
  protocolVersion: typeof COLLECTOR_CONTROL_PROTOCOL_VERSION;
  gatewayInstanceId: string;
  taskId: string;
  stageId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  planDigest: string;
  task: ResearchTaskContract;
  plan: ApprovedEvidencePlan;
  signature: string;
}

export interface GatewayPreflightRequestEnvelope {
  schemaVersion: 1;
  protocolVersion: typeof COLLECTOR_CONTROL_PROTOCOL_VERSION;
  kind: 'preflight_request';
  gatewayInstanceId: string;
  taskId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  task: ResearchTaskContract;
  signature: string;
}

export interface GatewayApprovedDispatchWorkItem {
  schemaVersion: 1;
  protocolVersion: typeof COLLECTOR_CONTROL_PROTOCOL_VERSION;
  kind: 'approved_dispatch';
  dispatch: GatewayTaskDispatchEnvelope;
}

export type GatewayWorkItem = GatewayPreflightRequestEnvelope | GatewayApprovedDispatchWorkItem;

export interface GatewayPreflightSubmission {
  schemaVersion: 1;
  taskId: string;
  plan: EvidencePlan;
}

export interface GatewayStageReceipt {
  schemaVersion: 1;
  taskId: string;
  stageId: string;
  status: 'accepted' | 'blocked';
  leaseId?: string;
  errorCode?: string;
  recordedAt: string;
}

export function unsignedGatewayEnvelope<T extends { signature: string }>(envelope: T): Omit<T, 'signature'> {
  const { signature: _signature, ...unsigned } = envelope;
  return unsigned;
}

export function evidencePlanDigestPayload(plan: EvidencePlan | ApprovedEvidencePlan) {
  return {
    schemaVersion: plan.schemaVersion,
    planId: plan.planId,
    taskId: plan.taskId,
    generatedAt: plan.generatedAt,
    stages: plan.stages
  };
}

export interface StrategyPermissionSnapshot {
  platform: SupportedPlatform;
  strategy: StrategyProvenance;
  requiredOrigins: readonly string[];
  granted: boolean;
  domExecution: 'task_document_only';
  responseObservation: 'disabled' | 'task_document_only';
}

export interface CollectorControlSnapshot {
  schemaVersion: 1;
  protocolVersion: typeof COLLECTOR_CONTROL_PROTOCOL_VERSION;
  pairing: GatewayPairingSummary | null;
  gatewayRuntime: GatewayRuntimeStatus;
  strategies: readonly StrategyPermissionSnapshot[];
  activeLeases: readonly StageLease[];
  capturedAt: string;
}

export interface GatewayRuntimeStatus {
  state: 'unpaired' | 'idle' | 'polling' | 'error';
  lastPollAt: string | null;
  lastErrorCode: string | null;
}

export interface BrowserProfileRecord extends BrowserProfileBinding {
  schemaVersion: 1;
  browser: 'playwright_chromium';
  createdAt: string;
  lastLaunchedAt: string | null;
}

export interface BrowserProfileRuntimeSummary {
  profile: BrowserProfileRecord;
  running: boolean;
  extensionLoaded: boolean;
  extensionPaired: boolean;
}

export type StageLeaseStatus =
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'permission_revoked'
  | 'task_context_changed'
  | 'window_closed';

export interface StageLease {
  schemaVersion: typeof STAGE_LEASE_SCHEMA_VERSION;
  leaseId: string;
  runtimeSessionId: string;
  gatewayInstanceId: string;
  taskId: string;
  planId: string;
  stageId: string;
  platform: SupportedPlatform;
  evidenceObjective: EvidenceObjective;
  strategyId: string;
  strategyVersion: string;
  windowId: number;
  tabId: number;
  documentId?: string;
  navigationUrlDigest: string;
  issuedAt: string;
  expiresAt: string;
  status: StageLeaseStatus;
}

export function normaliseLoopbackGatewayOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const isIpv4Loopback = url.hostname === '127.0.0.1';
    const isIpv6Loopback = url.hostname === '[::1]';
    if (url.protocol !== 'http:' || (!isIpv4Loopback && !isIpv6Loopback)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (!url.port || Number(url.port) < 1024 || Number(url.port) > 65535) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function targetAppliesToPlatform(target: CollectionTaskTarget, platform: SupportedPlatform): boolean {
  return target.type !== 'account_target' || target.platform === platform;
}

function isValidBudgetLimits(value: CollectionBudgetLimits | null | undefined): value is CollectionBudgetLimits {
  if (!value || !Number.isFinite(value.maxDurationMs) || value.maxDurationMs <= 0) return false;
  const countLimits = [
    value.maxRecords,
    value.maxPages,
    value.maxScrolls,
    value.maxReadOnlyActions,
    value.maxDetails,
    value.maxCommentItems,
    value.maxOriginalMediaBytes
  ];
  return countLimits.every((limit) => Number.isSafeInteger(limit) && limit >= 0);
}

function strategyReleaseTrack(strategy: StaticPlatformStrategy | null): CapabilityPreflight['releaseTrack'] {
  if (!strategy || strategy.maturity === 'suspended') return 'unsupported';
  if (strategy.maturity === 'live_anonymous_verified' || strategy.maturity === 'live_authenticated_verified') {
    return 'formal';
  }
  return 'experimental';
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function preflightStatus(input: {
  strategy: StaticPlatformStrategy | null;
  budgetValid: boolean;
  missingConsent: readonly ConsentAction[];
  missingHostPermissions: readonly string[];
  objectiveApproved: boolean;
  profileBinding: BrowserProfileBinding | null;
}): CapabilityPreflight['status'] {
  if (!input.budgetValid) return 'budget_invalid';
  if (!input.strategy) return 'capability_unavailable';
  if (input.strategy.maturity === 'suspended') return 'strategy_suspended';
  if (!input.objectiveApproved || input.missingConsent.length > 0) return 'consent_required';
  if (!input.profileBinding) return 'user_action_required';
  if (input.missingHostPermissions.length > 0) return 'permission_required';
  if (input.strategy.maturity === 'draft' || input.strategy.maturity === 'build_ready') {
    return 'live_validation_required';
  }
  if (input.strategy.preconditions.authentication === 'required') return 'authentication_required';
  return 'ready';
}

export async function buildEvidencePlan(
  task: ResearchTaskContract,
  containsHostPermissions: (origins: readonly string[]) => Promise<boolean>,
  now = new Date()
): Promise<EvidencePlan> {
  const checkedAt = now.toISOString();
  const stages: EvidencePlanStage[] = [];
  let stageSequence = 0;

  for (let targetIndex = 0; targetIndex < task.targets.length; targetIndex += 1) {
    const target = task.targets[targetIndex];
    for (const platform of unique(task.platforms)) {
      if (!targetAppliesToPlatform(target, platform)) continue;
      for (const evidenceObjective of unique(task.evidenceObjectives)) {
        stageSequence += 1;
        const strategy = strategiesFor(platform, evidenceObjective)[0] ?? null;
        const budget = task.budget.perPlatform[platform] ?? null;
        const budgetValid = isValidBudgetLimits(budget) && isValidBudgetLimits(task.budget.total);
        const requiredHostPermissions = strategy?.browser.optionalHostPermissions ?? [];
        const hasHostPermissions = requiredHostPermissions.length === 0
          ? true
          : await containsHostPermissions(requiredHostPermissions);
        const missingHostPermissions = hasHostPermissions ? [] : [...requiredHostPermissions];
        const requiredConsent = strategy?.preconditions.requiredConsent ?? [];
        const missingConsent = requiredConsent.filter(
          (action) => !task.consent.approvedActions.includes(action)
        );
        const objectiveApproved = task.consent.approvedObjectives.includes(evidenceObjective);
        const strategyRecord = strategy ? strategyProvenance(strategy) : null;
        const profileBinding = task.profileBindings[platform] ?? null;
        const status = preflightStatus({
          strategy,
          budgetValid,
          missingConsent,
          missingHostPermissions,
          objectiveApproved,
          profileBinding
        });
        const requiredUserActions: CapabilityPreflight['requiredUserActions'][number][] = [];
        if (!objectiveApproved || missingConsent.length > 0) requiredUserActions.push('approve_task_plan');
        if (missingHostPermissions.length > 0) requiredUserActions.push('grant_host_permission');
        if (!profileBinding) requiredUserActions.push('select_collection_profile');
        if (strategy?.preconditions.authentication === 'required') {
          requiredUserActions.push('authenticate_in_collection_window');
        }

        const knownGaps = strategy
          ? [
              ...(strategy.maturity === 'draft' || strategy.maturity === 'build_ready'
                ? ['No user-controlled live-platform validation record is admitted.']
                : []),
              ...(strategy.output.partialByDefault ? ['The declared output is partial by default.'] : []),
              ...(strategy.approvedResponseRouteIds.length === 0
                ? ['No production response-observation route is approved.']
                : []),
              ...(!profileBinding ? ['No Collection Browser Profile is bound for this platform.'] : [])
            ]
          : ['No static strategy is registered for this platform and evidence objective.'];

        const preflight: CapabilityPreflight = {
          platform,
          targetType: target.type,
          evidenceObjective,
          status,
          releaseTrack: strategyReleaseTrack(strategy),
          strategy: strategyRecord,
          lastVerifiedAt: strategy?.validation.liveRecord?.verifiedAt ?? null,
          profileBinding,
          requiredHostPermissions,
          missingHostPermissions,
          requiredConsent,
          missingConsent,
          objectiveApproved,
          budgetStatus: budgetValid ? 'accepted' : 'invalid',
          requiredUserActions: unique(requiredUserActions),
          estimatedReadOnlyActions: budget?.maxReadOnlyActions ?? 0,
          knownGaps,
          externalDiscoveryOnly: false,
          checkedAt
        };

        stages.push({
          stageId: `${task.taskId}.stage.${stageSequence}`,
          targetIndex,
          target,
          targetType: target.type,
          platform,
          evidenceObjective,
          strategy: strategyRecord,
          preflight,
          budget
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    planId: `${task.taskId}.plan.v1`,
    taskId: task.taskId,
    generatedAt: checkedAt,
    stages,
    approval: { status: 'pending' }
  };
}
