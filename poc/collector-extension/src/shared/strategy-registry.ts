import type { SupportedPlatform } from './protocol';

// These are evidence objectives selected by a research task.  They are
// deliberately separate from the mechanisms an individual static strategy is
// permitted to use.  A user can ask for an account archive without granting a
// generic "crawl this platform" capability, for example.
export const EVIDENCE_OBJECTIVES = [
  'breadth_search',
  'detail_read',
  'discussion_sample',
  'account_context',
  'account_archive',
  'trend_snapshot'
] as const;

export type EvidenceObjective = (typeof EVIDENCE_OBJECTIVES)[number];

export const ACQUISITION_MECHANISMS = [
  'native_navigation',
  'visible_dom',
  'bounded_interaction',
  'approved_response',
  'detail_navigation',
  'comment_navigation'
] as const;

export type AcquisitionMechanism = (typeof ACQUISITION_MECHANISMS)[number];

export type StrategyMaturity =
  | 'draft'
  | 'fixture_verified'
  | 'live_anonymous_verified'
  | 'live_authenticated_verified'
  | 'suspended';

export type StrategySurface =
  | 'native_search'
  | 'account_listing'
  | 'content_detail'
  | 'comment_thread';

export type StrategyEntryKind = 'native_search_url' | 'canonical_url' | 'profile_url';

export type StrategyUserConsent =
  | 'allow_read_only_dom_interaction'
  | 'allow_response_observation'
  | 'allow_sanitised_source_projection';

export type StrategyOutputKind = 'search_card' | 'content_detail' | 'comment' | 'collection_state';

export type LiveValidationStatus =
  | 'not_admitted'
  | 'anonymous_verified'
  | 'authenticated_verified'
  | 'suspended';

export interface StrategyProvenance {
  strategyId: string;
  version: string;
  evidenceObjective: EvidenceObjective;
  acquisition: readonly AcquisitionMechanism[];
  maturity: StrategyMaturity;
}

export interface StaticPlatformStrategy extends StrategyProvenance {
  platform: SupportedPlatform;
  surface: StrategySurface;
  nativeEntry: {
    kind: StrategyEntryKind;
  };
  preconditions: {
    authentication: 'not_required' | 'may_be_required' | 'required';
    userConsent: readonly StrategyUserConsent[];
  };
  bounds: {
    maxRecords: number;
    maxReadOnlyActions: number;
    firstRenderedPageOnly: boolean;
    allowsDetailNavigation: boolean;
    allowsCommentNavigation: boolean;
    allowsReadOnlyInteraction: boolean;
  };
  output: {
    kind: StrategyOutputKind;
    partialByDefault: boolean;
  };
  approvedResponseRouteIds: readonly string[];
  validation: {
    fixtureIds: readonly string[];
    liveValidation: LiveValidationStatus;
  };
}

function nativeSearchDomStrategy(platform: SupportedPlatform): StaticPlatformStrategy {
  return {
    strategyId: `${platform}.search.breadth.dom.v1`,
    version: '1',
    platform,
    evidenceObjective: 'breadth_search',
    surface: 'native_search',
    acquisition: ['native_navigation', 'visible_dom'],
    nativeEntry: { kind: 'native_search_url' },
    preconditions: {
      // A native URL can be opened without automating authentication.  The
      // page may still require the user to log in, which is a terminal task
      // status for a future planner rather than a reason to read credentials.
      authentication: 'may_be_required',
      userConsent: []
    },
    bounds: {
      maxRecords: 20,
      maxReadOnlyActions: 0,
      firstRenderedPageOnly: true,
      allowsDetailNavigation: false,
      allowsCommentNavigation: false,
      allowsReadOnlyInteraction: false
    },
    output: {
      kind: 'search_card',
      partialByDefault: true
    },
    // The response-observation engine is intentionally not a platform
    // capability until a precise route has separately passed live admission.
    approvedResponseRouteIds: [],
    validation: {
      fixtureIds: ['native-search-loopback.v1'],
      liveValidation: 'not_admitted'
    },
    maturity: 'fixture_verified'
  };
}

// This is a compiled, repository-local registry.  It is not a mechanism for
// downloading plugins, evaluating remote code, or granting a strategy browser
// privileges.  The Collector Core owns all privileged APIs.
export const STATIC_PLATFORM_STRATEGIES: readonly StaticPlatformStrategy[] = [
  nativeSearchDomStrategy('bilibili'),
  nativeSearchDomStrategy('zhihu'),
  nativeSearchDomStrategy('weibo'),
  nativeSearchDomStrategy('xiaohongshu')
];

export function strategiesFor(
  platform: SupportedPlatform,
  evidenceObjective: EvidenceObjective
): readonly StaticPlatformStrategy[] {
  return STATIC_PLATFORM_STRATEGIES.filter(
    (strategy) => strategy.platform === platform && strategy.evidenceObjective === evidenceObjective
  );
}

export function resolveNativeSearchStrategy(platform: SupportedPlatform): StaticPlatformStrategy {
  const strategy = strategiesFor(platform, 'breadth_search').find(
    (candidate) => candidate.surface === 'native_search'
  );
  if (!strategy) {
    throw new Error(`No static native-search strategy is registered for ${platform}.`);
  }
  return strategy;
}

export function strategyProvenance(strategy: StaticPlatformStrategy): StrategyProvenance {
  return {
    strategyId: strategy.strategyId,
    version: strategy.version,
    evidenceObjective: strategy.evidenceObjective,
    acquisition: strategy.acquisition,
    maturity: strategy.maturity
  };
}
