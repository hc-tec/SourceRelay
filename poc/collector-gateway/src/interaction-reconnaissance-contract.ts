export type InteractionPhase =
  | 'navigation_baseline'
  | 'open_caption_menu'
  | 'select_caption_language'
  | 'scroll_to_comments'
  | 'select_latest_comments'
  | 'expand_first_thread'
  | 'expand_second_thread'
  | 'idle';

export type NetworkOwnership = 'platform_api' | 'platform_cdn' | 'third_party_or_unknown';

export interface InteractionNetworkObservation {
  phase: Exclude<InteractionPhase, 'idle'>;
  atMs: number;
  resourceType: 'xhr' | 'fetch' | 'texttrack';
  method: string;
  ownership: NetworkOwnership;
  origin: string;
  pathname: string;
  queryKeyNames: string[];
  httpStatus: number;
  mimeType: string;
  declaredResponseBodyBytes: number | null;
}

export interface ResponseSchemaPath {
  path: string;
  type: 'null' | 'boolean' | 'number' | 'string' | 'object' | 'array';
  arrayLength?: number;
}

export interface InteractionResponseBodyMapping {
  phase: Exclude<InteractionPhase, 'idle'>;
  origin: string;
  pathname: string;
  httpStatus: number;
  mimeType: string;
  bodyBytes: number | null;
  bodySha256: string | null;
  contentKind: 'json' | 'utf8_text' | 'binary' | 'too_large' | 'unavailable';
  schemaPaths: ResponseSchemaPath[];
  sensitiveFieldPathsOmitted: number;
}

export interface InteractionRouteSummary {
  resourceType: InteractionNetworkObservation['resourceType'];
  method: string;
  ownership: NetworkOwnership;
  origin: string;
  pathname: string;
  queryKeyNames: string[];
  count: number;
  statusCodes: number[];
  mimeTypes: string[];
  minimumDeclaredResponseBodyBytes: number | null;
  maximumDeclaredResponseBodyBytes: number | null;
}

export type InteractionActionName =
  | 'open_caption_menu'
  | 'select_caption_language'
  | 'scroll_to_comments'
  | 'select_latest_comments'
  | 'expand_first_thread'
  | 'expand_second_thread';

export type InteractionActionOutcome =
  | 'completed'
  | 'control_missing'
  | 'option_unavailable'
  | 'prerequisite_unmet'
  | 'postcondition_unmet'
  | 'failed';

export interface InteractionActionObservation {
  action: InteractionActionName;
  attempted: boolean;
  outcome: InteractionActionOutcome;
  errorCode: string | null;
  dom: Record<string, unknown>;
  network: InteractionRouteSummary[];
}

export interface BilibiliInteractionReconnaissanceInput {
  canonicalUrl: string;
  actionScope: 'subtitle' | 'discussion' | 'all';
  responseBodyMapping: 'disabled' | 'schema_only';
}

export interface InteractionObjectiveAssessment {
  scope: BilibiliInteractionReconnaissanceInput['actionScope'];
  status: 'satisfied' | 'partial' | 'not_satisfied';
  requiredActions: InteractionActionName[];
  completedActions: InteractionActionName[];
}

export interface BilibiliInteractionReconnaissanceRecord {
  schemaVersion: 1;
  recordId: string;
  runId: string;
  collectorVersion: string;
  profileId: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'video_detail';
  targetUrlDigest: string;
  actionScope: BilibiliInteractionReconnaissanceInput['actionScope'];
  objective: InteractionObjectiveAssessment;
  state: 'completed' | 'inconclusive' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  baseline: {
    captionControlVisible: boolean;
    commentsHostPresent: boolean;
    routeSummary: InteractionRouteSummary[];
  };
  actions: InteractionActionObservation[];
  responseBodyMappings: InteractionResponseBodyMapping[];
  counters: {
    networkObservations: number;
    networkObservationsDroppedByLimit: number;
    failedXhrFetchRequests: number;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    observationMode: 'authenticated_bounded_interaction_network_metadata';
    productionResponseRoutes: 'unchanged_empty';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    responseHeaders: 'mime_and_content_length_only';
    responseBody: 'not_read' | 'schema_only_explicit_research_allowlist';
    cookiesAndTokens: 'not_read';
    queryAndFragmentValues: 'discarded';
    actionTailMs: 3_000;
    maximumSemanticActions: 5;
    runDeadlineMs: 60_000;
    semanticActionDelivery: 'at_most_once';
    captchaAndRiskControl: 'stop_and_persist_lock';
    networkFailure: 'stop_without_action_retry';
    observedTargetPages: 'closed_after_reconnaissance';
    captionMenuReadyTimeoutMs: 2_500;
    admissionEligible: false;
  };
}

const REQUIRED_ACTIONS_BY_SCOPE: Record<
  BilibiliInteractionReconnaissanceInput['actionScope'],
  readonly InteractionActionName[]
> = {
  subtitle: ['open_caption_menu', 'select_caption_language'],
  discussion: ['scroll_to_comments', 'select_latest_comments', 'expand_first_thread'],
  all: [
    'open_caption_menu',
    'select_caption_language',
    'scroll_to_comments',
    'select_latest_comments',
    'expand_first_thread'
  ]
};

export function captionMenuReadyFromLabels(labels: readonly string[]): boolean {
  return labels.some((label) =>
    /^(?:关闭|字幕设置|字幕大小(?: .*)?|字幕颜色(?: .*)?|(?:中文|汉语)(?:[（(].{1,30}[）)])?|(?:中文|汉语).*(?:自动生成|AI).*)$/.test(label)
  );
}

export function interactionOutcomeWasAttempted(outcome: InteractionActionOutcome): boolean {
  return outcome !== 'control_missing' && outcome !== 'option_unavailable' && outcome !== 'prerequisite_unmet';
}

export function interactionObjectiveAssessment(
  scope: BilibiliInteractionReconnaissanceInput['actionScope'],
  actions: readonly Pick<InteractionActionObservation, 'action' | 'outcome'>[]
): InteractionObjectiveAssessment {
  const requiredActions = [...REQUIRED_ACTIONS_BY_SCOPE[scope]];
  const completedActions = requiredActions.filter((required) =>
    actions.some((action) => action.action === required && action.outcome === 'completed')
  );
  return {
    scope,
    status: completedActions.length === requiredActions.length
      ? 'satisfied'
      : completedActions.length > 0
        ? 'partial'
        : 'not_satisfied',
    requiredActions,
    completedActions
  };
}

export function canonicalBilibiliVideoUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.hostname === 'www.bilibili.com' && url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
    if (url.protocol !== 'https:' || !match || url.username || url.password || url.search || url.hash) return null;
    return `https://www.bilibili.com/video/${match[1]}`;
  } catch {
    return null;
  }
}

export function bilibiliInteractionReconnaissanceInput(value: unknown): BilibiliInteractionReconnaissanceInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('interaction_reconnaissance_input_invalid');
  }
  const candidate = value as Partial<BilibiliInteractionReconnaissanceInput>;
  if (Object.keys(candidate).some((key) =>
    key !== 'canonicalUrl' && key !== 'actionScope' && key !== 'responseBodyMapping'
  )) {
    throw new Error('interaction_reconnaissance_input_invalid');
  }
  const canonicalUrl = typeof candidate.canonicalUrl === 'string'
    ? canonicalBilibiliVideoUrl(candidate.canonicalUrl)
    : null;
  if (!canonicalUrl) throw new Error('interaction_reconnaissance_url_invalid');
  const actionScope = candidate.actionScope ?? 'all';
  if (actionScope !== 'subtitle' && actionScope !== 'discussion' && actionScope !== 'all') {
    throw new Error('interaction_reconnaissance_scope_invalid');
  }
  const responseBodyMapping = candidate.responseBodyMapping ?? 'disabled';
  if (responseBodyMapping !== 'disabled' && responseBodyMapping !== 'schema_only') {
    throw new Error('interaction_reconnaissance_response_mapping_invalid');
  }
  return { canonicalUrl, actionScope, responseBodyMapping };
}
