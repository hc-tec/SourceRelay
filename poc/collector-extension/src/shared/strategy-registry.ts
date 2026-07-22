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
  | 'account_profile'
  | 'account_listing'
  | 'content_detail'
  | 'transcript'
  | 'comment_thread';

export type StrategyEntryKind = 'native_search_url' | 'canonical_url' | 'profile_url';

export type StrategyOutputKind =
  | 'search_card'
  | 'account_profile'
  | 'content_detail'
  | 'transcript_document'
  | 'comment'
  | 'collection_state';

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
  const isBilibili = platform === 'bilibili';
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
    // The compiled Bilibili runtime is v2. Historic v1 anonymous evidence
    // remains provenance only; it must not be inherited by the expanded
    // type/sort/page route contract.
    strategyId: isBilibili ? 'bilibili.search.breadth.dom.v2' : `${platform}.search.breadth.dom.v1`,
    version: isBilibili ? '0.2.0' : '1.0.0',
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

/**
 * One exact, visible first-screen detail projection. Subtitles, comments,
 * recommendations, playback, and response capture remain separate
 * capabilities even when this detail strategy is ready to be live-validated.
 */
function bilibiliVideoDetailDomStrategy(): StaticPlatformStrategy {
  return {
    strategyId: 'bilibili.video.detail.dom.v2',
    version: '0.4.0',
    platform: 'bilibili',
    evidenceObjectives: ['detail_read'],
    acquisition: ['detail_navigation', 'visible_dom'],
    maturity: 'build_ready',
    surface: 'content_detail',
    nativeEntry: { kind: 'canonical_url' },
    preconditions: {
      authentication: 'may_be_required',
      requiredConsent: ['detail_navigation', 'visible_dom']
    },
    bounds: {
      maxRecords: 1,
      maxReadOnlyActions: 0,
      firstRenderedPageOnly: true,
      allowsDetailNavigation: true,
      allowsCommentNavigation: false,
      allowsReadOnlyInteraction: false
    },
    output: {
      kind: 'content_detail',
      partialByDefault: true
    },
    browser: {
      optionalHostPermissions: ['https://www.bilibili.com/*'],
      domContentMatches: ['https://www.bilibili.com/video/*'],
      responseBridgeMatches: []
    },
    approvedResponseRouteIds: [],
    validation: {
      mode: 'local_live_platform_only',
      liveRecord: null
    }
  };
}

function bilibiliVideoTranscriptTrustedResponseStrategy(): StaticPlatformStrategy {
  return {
    strategyId: 'bilibili.video.transcript.trusted-response.v2',
    version: '0.1.0',
    platform: 'bilibili',
    evidenceObjectives: ['transcript_read'],
    acquisition: ['detail_navigation', 'visible_dom', 'bounded_interaction', 'approved_response'],
    // The fixed Host/MV3 path is compiled and locally verified, but its two
    // response routes remain research-validation-only until a new managed
    // Profile run is admitted. Historic v1 validation must not be inherited.
    maturity: 'build_ready',
    surface: 'transcript',
    nativeEntry: { kind: 'canonical_url' },
    preconditions: {
      authentication: 'required',
      requiredConsent: ['detail_navigation', 'visible_dom', 'bounded_interaction', 'approved_response']
    },
    bounds: {
      maxRecords: 1,
      maxReadOnlyActions: 3,
      firstRenderedPageOnly: true,
      allowsDetailNavigation: true,
      allowsCommentNavigation: false,
      allowsReadOnlyInteraction: true
    },
    output: {
      kind: 'transcript_document',
      partialByDefault: true
    },
    browser: {
      optionalHostPermissions: ['https://www.bilibili.com/*'],
      domContentMatches: ['https://www.bilibili.com/video/*'],
      // Runtime route IDs are fixed inside the Extension. Keeping this empty
      // prevents the strategy from becoming production response observation
      // before a separate managed-profile admission decision.
      responseBridgeMatches: []
    },
    approvedResponseRouteIds: [],
    validation: {
      mode: 'local_live_platform_only',
      liveRecord: null
    }
  };
}

/**
 * A public account home is distinct from its upload inventory. The strategy
 * is deliberately DOM-only: historic research Network metadata is not a
 * production input and cannot silently enlarge this archive.
 */
function bilibiliAccountProfileDomStrategy(): StaticPlatformStrategy {
  return {
    strategyId: 'bilibili.account.profile.dom.v2',
    version: '0.1.0',
    platform: 'bilibili',
    evidenceObjectives: ['account_context'],
    acquisition: ['native_navigation', 'visible_dom'],
    maturity: 'build_ready',
    surface: 'account_profile',
    nativeEntry: { kind: 'profile_url' },
    preconditions: {
      authentication: 'may_be_required',
      requiredConsent: ['native_navigation', 'visible_dom']
    },
    bounds: {
      maxRecords: 1,
      maxReadOnlyActions: 0,
      firstRenderedPageOnly: true,
      allowsDetailNavigation: false,
      allowsCommentNavigation: false,
      allowsReadOnlyInteraction: false
    },
    output: {
      kind: 'account_profile',
      // A profile snapshot does not imply that inventory, relationships,
      // posts, or comments were collected.
      partialByDefault: true
    },
    browser: {
      optionalHostPermissions: ['https://space.bilibili.com/*'],
      domContentMatches: ['https://space.bilibili.com/*'],
      responseBridgeMatches: []
    },
    approvedResponseRouteIds: [],
    validation: {
      mode: 'local_live_platform_only',
      liveRecord: null
    }
  };
}

/**
 * The inventory entry intentionally means only the first rendered upload
 * page. Pagination has a separate action budget and evidence contract, so it
 * cannot be enabled just because this zero-interaction entry is available.
 */
function bilibiliAccountVideoInventoryDomStrategy(): StaticPlatformStrategy {
  return {
    strategyId: 'bilibili.account.video-inventory.dom.v1',
    version: '0.1.0',
    platform: 'bilibili',
    evidenceObjectives: ['account_archive'],
    acquisition: ['native_navigation', 'visible_dom'],
    maturity: 'build_ready',
    surface: 'account_listing',
    nativeEntry: { kind: 'profile_url' },
    preconditions: {
      authentication: 'may_be_required',
      requiredConsent: ['native_navigation', 'visible_dom']
    },
    bounds: {
      maxRecords: 40,
      maxReadOnlyActions: 0,
      firstRenderedPageOnly: true,
      allowsDetailNavigation: false,
      allowsCommentNavigation: false,
      allowsReadOnlyInteraction: false
    },
    output: {
      kind: 'collection_state',
      partialByDefault: true
    },
    browser: {
      optionalHostPermissions: ['https://space.bilibili.com/*'],
      domContentMatches: ['https://space.bilibili.com/*'],
      responseBridgeMatches: []
    },
    approvedResponseRouteIds: [],
    validation: {
      mode: 'local_live_platform_only',
      liveRecord: null
    }
  };
}

// This is a compiled, repository-local registry.  It is not a mechanism for
// downloading plugins, evaluating remote code, or granting a strategy browser
// privileges.  The Collector Core owns all privileged APIs.
export const STATIC_PLATFORM_STRATEGIES: readonly StaticPlatformStrategy[] = [
  nativeSearchDomStrategy('bilibili'),
  bilibiliAccountProfileDomStrategy(),
  bilibiliAccountVideoInventoryDomStrategy(),
  bilibiliVideoDetailDomStrategy(),
  bilibiliVideoTranscriptTrustedResponseStrategy(),
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

export function resolveDetailStrategy(platform: SupportedPlatform): StaticPlatformStrategy {
  const strategy = strategiesFor(platform, 'detail_read').find(
    (candidate) => candidate.surface === 'content_detail'
  );
  if (!strategy) throw new Error(`No static detail strategy is registered for ${platform}.`);
  return strategy;
}

export function resolveTranscriptStrategy(platform: SupportedPlatform): StaticPlatformStrategy {
  const strategy = strategiesFor(platform, 'transcript_read').find(
    (candidate) => candidate.surface === 'transcript'
  );
  if (!strategy) throw new Error(`No static transcript strategy is registered for ${platform}.`);
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
