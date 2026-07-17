import type {
  AcquisitionMechanism,
  ConsentAction,
  EvidenceObjective,
  LiveValidationReference,
  StrategyMaturity,
  StrategyProvenance,
  SupportedPlatform
} from './collection-contracts';

export {
  ACQUISITION_MECHANISMS,
  EVIDENCE_OBJECTIVES,
  STRATEGY_MATURITIES
} from './collection-contracts';
export type {
  AcquisitionMechanism,
  EvidenceObjective,
  StrategyMaturity,
  StrategyProvenance
} from './collection-contracts';

export type StrategySurface =
  | 'native_search'
  | 'account_listing'
  | 'content_detail'
  | 'comment_thread';

export type StrategyEntryKind = 'native_search_url' | 'canonical_url' | 'profile_url';

export type StrategyOutputKind = 'search_card' | 'content_detail' | 'comment' | 'collection_state';

export interface StaticPlatformStrategy {
  strategyId: string;
  version: string;
  platform: SupportedPlatform;
  evidenceObjectives: readonly EvidenceObjective[];
  acquisition: readonly AcquisitionMechanism[];
  maturity: StrategyMaturity;
  surface: StrategySurface;
  nativeEntry: {
    kind: StrategyEntryKind;
  };
  preconditions: {
    authentication: 'not_required' | 'may_be_required' | 'required';
    requiredConsent: readonly ConsentAction[];
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
  browser: {
    optionalHostPermissions: readonly string[];
    domContentMatches: readonly string[];
    responseBridgeMatches: readonly string[];
  };
  approvedResponseRouteIds: readonly string[];
  validation: {
    mode: 'local_live_platform_only';
    liveRecord: LiveValidationReference | null;
  };
}

function nativeSearchDomStrategy(platform: SupportedPlatform): StaticPlatformStrategy {
  const browserByPlatform: Record<SupportedPlatform, StaticPlatformStrategy['browser']> = {
    bilibili: {
      optionalHostPermissions: [
        'https://search.bilibili.com/*',
        'https://www.bilibili.com/*'
      ],
      domContentMatches: [
        'https://search.bilibili.com/*',
        'https://www.bilibili.com/*'
      ],
      responseBridgeMatches: ['https://search.bilibili.com/all*']
    },
    zhihu: {
      optionalHostPermissions: [
        'https://www.zhihu.com/*',
        'https://zhuanlan.zhihu.com/*'
      ],
      domContentMatches: [
        'https://www.zhihu.com/*',
        'https://zhuanlan.zhihu.com/*'
      ],
      responseBridgeMatches: ['https://www.zhihu.com/search*']
    },
    weibo: {
      optionalHostPermissions: [
        'https://s.weibo.com/*',
        'https://weibo.com/*',
        'https://m.weibo.cn/*'
      ],
      domContentMatches: [
        'https://s.weibo.com/*',
        'https://weibo.com/*',
        'https://m.weibo.cn/*'
      ],
      responseBridgeMatches: ['https://s.weibo.com/weibo*']
    },
    xiaohongshu: {
      optionalHostPermissions: ['https://www.xiaohongshu.com/*'],
      domContentMatches: ['https://www.xiaohongshu.com/*'],
      responseBridgeMatches: ['https://www.xiaohongshu.com/search_result_ai*']
    }
  };

  return {
    strategyId: `${platform}.search.breadth.dom.v1`,
    version: '1.0.0',
    platform,
    evidenceObjectives: ['breadth_search'],
    surface: 'native_search',
    acquisition: ['native_navigation', 'visible_dom'],
    nativeEntry: { kind: 'native_search_url' },
    preconditions: {
      // A native URL can be opened without automating authentication.  The
      // page may still require the user to log in, which is a terminal task
      // status for a future planner rather than a reason to read credentials.
      authentication: 'may_be_required',
      requiredConsent: ['native_navigation', 'visible_dom']
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
    browser: browserByPlatform[platform],
    // The response-observation engine is intentionally not a platform
    // capability until a precise route has separately passed live admission.
    approvedResponseRouteIds: [],
    validation: {
      mode: 'local_live_platform_only',
      liveRecord: null
    },
    maturity: 'build_ready'
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
    (strategy) => strategy.platform === platform && strategy.evidenceObjectives.includes(evidenceObjective)
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
    platform: strategy.platform,
    evidenceObjectives: strategy.evidenceObjectives,
    acquisition: strategy.acquisition,
    maturity: strategy.maturity,
    liveValidation: strategy.validation.liveRecord
  };
}
