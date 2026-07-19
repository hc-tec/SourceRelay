export const SUPPORTED_PLATFORMS = [
  'bilibili',
  'zhihu',
  'weibo',
  'xiaohongshu'
] as const;

export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

export function isSupportedPlatform(value: unknown): value is SupportedPlatform {
  return typeof value === 'string' && (SUPPORTED_PLATFORMS as readonly string[]).includes(value);
}

export const TASK_TARGET_TYPES = [
  'keyword_query',
  'account_target',
  'known_url'
] as const;

export type TaskTargetType = (typeof TASK_TARGET_TYPES)[number];

export type CollectionTaskTarget =
  | {
      type: 'keyword_query';
      query: string;
    }
  | {
      type: 'account_target';
      platform: SupportedPlatform;
      canonicalProfileUrl: string;
      stableAccountId?: string;
    }
  | {
      type: 'known_url';
      url: string;
    };

export type BrowserProfileKind = 'collection' | 'validation';

export interface BrowserProfileBinding {
  profileId: string;
  kind: BrowserProfileKind;
  platform: SupportedPlatform;
  account: {
    category: 'anonymous' | 'user_managed';
    label: string;
    expectedVisibleIdentity?: string;
  };
}

export const RESEARCH_PROFILES = [
  'scout',
  'evidence',
  'deep_dive',
  'discussion',
  'account_archive'
] as const;

export type ResearchProfile = (typeof RESEARCH_PROFILES)[number];

export const EVIDENCE_OBJECTIVES = [
  'breadth_search',
  'detail_read',
  'transcript_read',
  'discussion_sample',
  'account_context',
  'account_archive',
  'trend_snapshot'
] as const;

export type EvidenceObjective = (typeof EVIDENCE_OBJECTIVES)[number];

// Evidence objectives express what the user wants. Acquisition mechanisms
// express how an admitted static strategy may obtain it. They are deliberately
// separate so a research request never grants a generic platform capability.
export const ACQUISITION_MECHANISMS = [
  'native_navigation',
  'visible_dom',
  'bounded_interaction',
  'approved_response',
  'detail_navigation',
  'comment_navigation'
] as const;

export type AcquisitionMechanism = (typeof ACQUISITION_MECHANISMS)[number];

export const STRATEGY_MATURITIES = [
  'draft',
  'build_ready',
  'live_anonymous_verified',
  'live_authenticated_verified',
  'suspended'
] as const;

export type StrategyMaturity = (typeof STRATEGY_MATURITIES)[number];

// These outcomes are intentionally source-specific. A multi-platform task can
// complete while retaining a login gate, layout drift, or partial result for
// one source instead of silently rewriting it as "no information".
export const COLLECTION_TERMINAL_STATUSES = [
  'completed',
  'partial',
  'no_results',
  'external_discovery_only',
  'authentication_required',
  'user_action_required',
  'verification_required',
  'option_unavailable',
  'layout_changed',
  'rate_limited',
  'route_unapproved',
  'source_unavailable',
  'capability_unavailable',
  'budget_exhausted_partial',
  'cancelled_partial',
  'strategy_suspended',
  'failed'
] as const;

export type CollectionTerminalStatus = (typeof COLLECTION_TERMINAL_STATUSES)[number];

export interface CollectionBudgetLimits {
  maxDurationMs: number;
  maxRecords: number;
  maxPages: number;
  maxScrolls: number;
  maxReadOnlyActions: number;
  maxDetails: number;
  maxCommentItems: number;
  maxOriginalMediaBytes: number;
}

export interface CollectionBudget {
  total: CollectionBudgetLimits;
  // Every enabled platform keeps an independent ceiling. Unused capacity is
  // never silently reassigned to another platform.
  perPlatform: Partial<Record<SupportedPlatform, CollectionBudgetLimits>>;
  unusedBudgetTransfer: 'explicit_approval_required';
}

export const CONSENT_ACTIONS = [
  ...ACQUISITION_MECHANISMS,
  'download_original_media',
  'long_term_account_archive'
] as const;

export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

export interface TaskConsent {
  approvedBy: 'user';
  approvedAt: string;
  approvedActions: readonly ConsentAction[];
  approvedObjectives: readonly EvidenceObjective[];
  escalationPolicy: 'explicit_approval_required';
}

export interface ResearchTaskLineage {
  parentTaskId: string;
  sourceEvidenceBatchId: string;
  selectionPolicy: 'explicit_user_selected_ranks';
  selectedItems: readonly {
    sourceRank: number;
    canonicalUrl: string;
  }[];
}

export interface LiveValidationReference {
  category: 'anonymous' | 'authenticated';
  recordId: string;
  verifiedAt: string;
  environment: 'local_user_controlled_validation_profile';
}

export interface StrategyProvenance {
  strategyId: string;
  version: string;
  platform: SupportedPlatform;
  evidenceObjectives: readonly EvidenceObjective[];
  acquisition: readonly AcquisitionMechanism[];
  maturity: StrategyMaturity;
  liveValidation: LiveValidationReference | null;
}

export const CAPABILITY_PREFLIGHT_STATUSES = [
  'ready',
  'live_validation_required',
  'permission_required',
  'consent_required',
  'budget_invalid',
  'authentication_required',
  'user_action_required',
  'option_unavailable',
  'capability_unavailable',
  'strategy_suspended'
] as const;

export type CapabilityPreflightStatus = (typeof CAPABILITY_PREFLIGHT_STATUSES)[number];

export interface CapabilityPreflight {
  platform: SupportedPlatform;
  targetType: TaskTargetType;
  evidenceObjective: EvidenceObjective;
  status: CapabilityPreflightStatus;
  releaseTrack: 'formal' | 'experimental' | 'unsupported';
  strategy: StrategyProvenance | null;
  lastVerifiedAt: string | null;
  profileBinding: BrowserProfileBinding | null;
  requiredHostPermissions: readonly string[];
  missingHostPermissions: readonly string[];
  requiredConsent: readonly ConsentAction[];
  missingConsent: readonly ConsentAction[];
  objectiveApproved: boolean;
  budgetStatus: 'accepted' | 'invalid' | 'requires_approval';
  requiredUserActions: readonly (
    | 'approve_task_plan'
    | 'grant_host_permission'
    | 'select_collection_profile'
    | 'authenticate_in_collection_window'
    | 'confirm_plan_change'
  )[];
  estimatedReadOnlyActions: number;
  knownGaps: readonly string[];
  externalDiscoveryOnly: boolean;
  checkedAt: string;
}

export interface ResearchTaskContract {
  schemaVersion: 1;
  taskId: string;
  researchQuestion: string;
  decisionContext: string;
  profile: ResearchProfile;
  lineage: ResearchTaskLineage | null;
  targets: readonly CollectionTaskTarget[];
  platforms: readonly SupportedPlatform[];
  profileBindings: Partial<Record<SupportedPlatform, BrowserProfileBinding>>;
  evidenceObjectives: readonly EvidenceObjective[];
  budget: CollectionBudget;
  consent: TaskConsent;
}
