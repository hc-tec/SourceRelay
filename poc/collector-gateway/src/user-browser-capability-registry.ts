import {
  canonicalBilibiliAccountProfileUrl,
  canonicalBilibiliPassiveVideoWorkUrl,
  canonicalBilibiliVideoWorkUrl,
  canonicalXiaohongshuPublicProfileUrl,
  normaliseBilibiliNativeSearchRoute,
  USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
  XIAOHONGSHU_PUBLIC_NOTES_SEARCH_MAX_DETAILS,
  type XiaohongshuProfileScrollCount
} from '@intelligence/collector-contracts';
import {
  enqueueBilibiliAccountInventoryUserSelectedTabWork,
  enqueueBilibiliAccountInventoryWork,
  enqueueBilibiliAccountProfileWork,
  enqueueBilibiliCollectionSeriesDetailWork,
  enqueueBilibiliCollectionSeriesOverviewWork,
  enqueueBilibiliDanmakuWork,
  enqueueBilibiliDiscussionUserSelectedTabWork,
  enqueueBilibiliDynamicWork,
  enqueueBilibiliNativeSearchBatchWork,
  enqueueBilibiliNativeSearchWork,
  enqueueBilibiliVideoDetailWork,
  enqueueXiaohongshuAccountPublicNotesWork,
  enqueueXiaohongshuNotePublicCommentsWork,
  enqueueXiaohongshuNotePublicDetailWork,
  enqueueXiaohongshuPublicNotesSearchWork,
  enqueueXiaohongshuReplyWork,
  type ExtensionWorkRouteContext
} from './extension-work-routes.js';
import type { CollectorOperationSummary } from './collector-operation-reader.js';
import type {
  UserBrowserAccountInventoryCollectorServiceRequest,
  UserBrowserAccountProfileCollectorServiceRequest,
  UserBrowserCollectionSeriesDetailCollectorServiceRequest,
  UserBrowserCollectionSeriesOverviewCollectorServiceRequest,
  UserBrowserCollectorServiceRequest,
  UserBrowserDanmakuCollectorServiceRequest,
  UserBrowserVideoDiscussionCollectorServiceRequest,
  UserBrowserDynamicCollectorServiceRequest,
  UserBrowserNativeSearchBatchCollectorServiceRequest,
  UserBrowserNativeSearchCollectorServiceRequest,
  UserBrowserVideoDetailCollectorServiceRequest,
  UserBrowserXiaohongshuAccountPublicNotesCollectorServiceRequest,
  UserBrowserXiaohongshuNotePublicCommentsCollectorServiceRequest,
  UserBrowserXiaohongshuNotePublicDetailCollectorServiceRequest,
  UserBrowserXiaohongshuPublicNotesSearchCollectorServiceRequest,
  UserBrowserXiaohongshuReplyCollectorServiceRequest,
  ZhihuOfficialGlobalSearchCollectorServiceRequest,
  ZhihuOfficialHotListCollectorServiceRequest,
  ZhihuOfficialSearchCollectorServiceRequest
} from './user-browser-collector-service-contract.js';
import {
  ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY,
  ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY,
  ZHIHU_OFFICIAL_SEARCH_CAPABILITY
} from './zhihu-official-contract.js';
import type { ZhihuOfficialApiProvider } from './zhihu-official-api-provider.js';

export type UserBrowserExecutableCapability = UserBrowserCollectorServiceRequest['capability'];
type RequestFor<C extends UserBrowserExecutableCapability> = Extract<UserBrowserCollectorServiceRequest, { capability: C }>;
type Platform = UserBrowserCollectorServiceRequest['platform'];
type ExecutionTarget = UserBrowserCollectorServiceRequest['executionTarget'];

interface ValidRequestEnvelope {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  clientRequestId: string;
  browserBindingId?: string;
  platform: Platform;
  capability: string;
  executionTarget: ExecutionTarget;
  input: Record<string, unknown>;
}

export type UserBrowserCapabilityBudgetPolicy =
  | 'fixed_queue_budget'
  | 'input_bounded_queue_budget'
  | 'fixed_observation_budget'
  | 'official_api_fixed_count';

export type CollectorExecutionProvider = 'browser_extension' | 'official_api';

export interface UserBrowserCapabilityDispatchContext extends ExtensionWorkRouteContext {
  zhihuOfficialApiProvider: ZhihuOfficialApiProvider;
}

export interface UserBrowserCapabilityRegistryEntry<C extends UserBrowserExecutableCapability> {
  capability: C;
  /** OpenAPI component containing the exact direct request envelope. */
  requestSchemaName: string;
  /** Existing entries default to browser_extension; official providers must declare themselves. */
  executionProvider?: CollectorExecutionProvider;
  /** Validates the common envelope and normalises the capability input. */
  validate: (envelope: ValidRequestEnvelope) => RequestFor<C>;
  /** Declares the only execution targets admitted by this capability. */
  executionTargets: readonly ExecutionTarget[];
  /** Queue-side budget policy; no caller supplied budget is accepted. */
  budgetPolicy: UserBrowserCapabilityBudgetPolicy;
  dispatch: (
    context: UserBrowserCapabilityDispatchContext,
    request: RequestFor<C>,
    operationId: string
  ) => Promise<CollectorOperationSummary>;
}

type UserBrowserCapabilityRegistry = {
  [C in UserBrowserExecutableCapability]: UserBrowserCapabilityRegistryEntry<C>;
};

const INVALID_REQUEST = 'user_browser_collector_service_request_invalid';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid(): never {
  throw new Error(INVALID_REQUEST);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function envelope(value: unknown): ValidRequestEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const candidate = value as Record<string, unknown>;
  const allowed = new Set([
    'schemaVersion', 'clientRequestId', 'browserBindingId', 'platform', 'capability', 'executionTarget', 'input'
  ]);
  if (Object.keys(candidate).some((key) => !allowed.has(key)) ||
    candidate.schemaVersion !== USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION ||
    typeof candidate.clientRequestId !== 'string' || !UUID_PATTERN.test(candidate.clientRequestId) ||
    (candidate.browserBindingId !== undefined &&
      (typeof candidate.browserBindingId !== 'string' || !UUID_PATTERN.test(candidate.browserBindingId))) ||
    (candidate.platform !== 'bilibili' && candidate.platform !== 'xiaohongshu' &&
      candidate.platform !== 'zhihu' && candidate.platform !== 'web') ||
    typeof candidate.capability !== 'string' ||
    !isExecutionTarget(candidate.executionTarget) ||
    !candidate.input || typeof candidate.input !== 'object' || Array.isArray(candidate.input)) return invalid();
  return {
    schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
    clientRequestId: candidate.clientRequestId,
    ...(candidate.browserBindingId === undefined ? {} : { browserBindingId: candidate.browserBindingId }),
    platform: candidate.platform,
    capability: candidate.capability,
    executionTarget: candidate.executionTarget,
    input: candidate.input as Record<string, unknown>
  };
}

function isExecutionTarget(value: unknown): value is ExecutionTarget {
  return value === 'collector_work_tab' || value === 'user_selected_tab' ||
    value === 'existing_public_explore_tab' || value === 'existing_public_profile_tab' ||
    value === 'ephemeral_public_profile_url' || value === 'discover_public_profile_from_note' ||
    value === 'existing_public_search_tab' || value === 'existing_public_note_overlay' ||
    value === 'official_api';
}

function requirePlatform(value: ValidRequestEnvelope, platform: Platform): void {
  if (value.platform !== platform) invalid();
}

function requireTarget<T extends ExecutionTarget>(value: ValidRequestEnvelope, target: T): void {
  if (value.executionTarget !== target) invalid();
}

function parseBilibiliVideoDetail(value: ValidRequestEnvelope): UserBrowserVideoDetailCollectorServiceRequest {
  requirePlatform(value, 'bilibili');
  requireTarget(value, 'collector_work_tab');
  if (value.capability !== 'bilibili.video_detail' || !exactKeys(value.input, ['canonicalVideoUrl']) ||
    typeof value.input.canonicalVideoUrl !== 'string') return invalid();
  const canonicalVideoUrl = canonicalBilibiliVideoWorkUrl(value.input.canonicalVideoUrl);
  if (!canonicalVideoUrl) return invalid();
  return { ...base(value, 'bilibili'), capability: 'bilibili.video_detail', executionTarget: 'collector_work_tab', input: { canonicalVideoUrl } };
}

function parseBilibiliNativeSearch(value: ValidRequestEnvelope): UserBrowserNativeSearchCollectorServiceRequest {
  requirePlatform(value, 'bilibili');
  requireTarget(value, 'collector_work_tab');
  if (value.capability !== 'bilibili.native_search' || !exactKeys(value.input, ['query']) || typeof value.input.query !== 'string') return invalid();
  const route = normaliseBilibiliNativeSearchRoute({ query: value.input.query, resultType: 'comprehensive', sort: 'relevance', page: 1 });
  if (!route) return invalid();
  return { ...base(value, 'bilibili'), capability: 'bilibili.native_search', executionTarget: 'collector_work_tab', input: { query: route.query } };
}

function parseBilibiliNativeSearchBatch(value: ValidRequestEnvelope): UserBrowserNativeSearchBatchCollectorServiceRequest {
  requirePlatform(value, 'bilibili');
  requireTarget(value, 'collector_work_tab');
  if (value.capability !== 'bilibili.native_search_batch' || !exactKeys(value.input, ['query']) || typeof value.input.query !== 'string') return invalid();
  const route = normaliseBilibiliNativeSearchRoute({ query: value.input.query, resultType: 'comprehensive', sort: 'relevance', page: 1 });
  if (!route) return invalid();
  return { ...base(value, 'bilibili'), capability: 'bilibili.native_search_batch', executionTarget: 'collector_work_tab', input: { query: route.query } };
}

function parseBilibiliAccountProfile(value: ValidRequestEnvelope): UserBrowserAccountProfileCollectorServiceRequest {
  requirePlatform(value, 'bilibili');
  requireTarget(value, 'collector_work_tab');
  if (value.capability !== 'bilibili.account_profile' || !exactKeys(value.input, ['canonicalProfileUrl']) || typeof value.input.canonicalProfileUrl !== 'string') return invalid();
  const canonicalProfileUrl = canonicalBilibiliAccountProfileUrl(value.input.canonicalProfileUrl, 'strict_input');
  if (!canonicalProfileUrl) return invalid();
  return { ...base(value, 'bilibili'), capability: 'bilibili.account_profile', executionTarget: 'collector_work_tab', input: { canonicalProfileUrl } };
}

function parseBilibiliAccountInventory(value: ValidRequestEnvelope): UserBrowserAccountInventoryCollectorServiceRequest {
  requirePlatform(value, 'bilibili');
  if ((value.executionTarget !== 'collector_work_tab' && value.executionTarget !== 'user_selected_tab') ||
    value.capability !== 'bilibili.account_inventory' || !exactKeys(value.input, ['canonicalProfileUrl']) || typeof value.input.canonicalProfileUrl !== 'string') return invalid();
  const canonicalProfileUrl = canonicalBilibiliAccountProfileUrl(value.input.canonicalProfileUrl, 'strict_input');
  if (!canonicalProfileUrl) return invalid();
  return { ...base(value, 'bilibili'), capability: 'bilibili.account_inventory', executionTarget: value.executionTarget, input: { canonicalProfileUrl } };
}

function parseBilibiliProfileCapability(value: ValidRequestEnvelope, capability: 'bilibili.dynamic' | 'bilibili.collection_series.overview'): UserBrowserDynamicCollectorServiceRequest | UserBrowserCollectionSeriesOverviewCollectorServiceRequest {
  requirePlatform(value, 'bilibili');
  requireTarget(value, 'collector_work_tab');
  if (value.capability !== capability || !exactKeys(value.input, ['canonicalProfileUrl']) || typeof value.input.canonicalProfileUrl !== 'string') return invalid();
  const canonicalProfileUrl = canonicalBilibiliAccountProfileUrl(value.input.canonicalProfileUrl, 'strict_input');
  if (!canonicalProfileUrl) return invalid();
  return { ...base(value, 'bilibili'), capability, executionTarget: 'collector_work_tab', input: { canonicalProfileUrl } } as UserBrowserDynamicCollectorServiceRequest | UserBrowserCollectionSeriesOverviewCollectorServiceRequest;
}

function parseBilibiliSeriesDetail(value: ValidRequestEnvelope): UserBrowserCollectionSeriesDetailCollectorServiceRequest {
  requirePlatform(value, 'bilibili');
  requireTarget(value, 'collector_work_tab');
  if (value.capability !== 'bilibili.collection_series.detail' || !exactKeys(value.input, ['canonicalProfileUrl', 'stableSeriesId', 'listType']) ||
    typeof value.input.canonicalProfileUrl !== 'string' || typeof value.input.stableSeriesId !== 'string' ||
    (value.input.listType !== 'series' && value.input.listType !== 'season')) return invalid();
  const canonicalProfileUrl = canonicalBilibiliAccountProfileUrl(value.input.canonicalProfileUrl, 'strict_input');
  if (!canonicalProfileUrl || !/^\d{1,20}$/.test(value.input.stableSeriesId) || value.input.stableSeriesId === '0') return invalid();
  return { ...base(value, 'bilibili'), capability: 'bilibili.collection_series.detail', executionTarget: 'collector_work_tab', input: { canonicalProfileUrl, stableSeriesId: value.input.stableSeriesId, listType: value.input.listType } };
}

function parseBilibiliVideoPassive(value: ValidRequestEnvelope, capability: 'bilibili.danmaku' | 'bilibili.discussion'): UserBrowserDanmakuCollectorServiceRequest | UserBrowserVideoDiscussionCollectorServiceRequest {
  requirePlatform(value, 'bilibili');
  const target = 'collector_work_tab' as const;
  requireTarget(value, target);
  if (value.capability !== capability || !exactKeys(value.input, ['canonicalVideoUrl']) || typeof value.input.canonicalVideoUrl !== 'string') return invalid();
  const canonicalVideoUrl = canonicalBilibiliPassiveVideoWorkUrl(value.input.canonicalVideoUrl);
  if (!canonicalVideoUrl) return invalid();
  return { ...base(value, 'bilibili'), capability, executionTarget: target, input: { canonicalVideoUrl } } as UserBrowserDanmakuCollectorServiceRequest | UserBrowserVideoDiscussionCollectorServiceRequest;
}

function parseXiaohongshuSearch(value: ValidRequestEnvelope): UserBrowserXiaohongshuPublicNotesSearchCollectorServiceRequest {
  requirePlatform(value, 'xiaohongshu');
  requireTarget(value, 'existing_public_explore_tab');
  if (value.capability !== 'xiaohongshu.search.public_notes.v1' || !validXiaohongshuSearchInput(value.input) ||
    value.input.query !== value.input.query.trim() || value.input.query.length < 1 || value.input.query.length > 80 || /[\u0000-\u001f\u007f]/.test(value.input.query)) return invalid();
  const maximumDetails = Object.hasOwn(value.input, 'maximumDetails') ? Number(value.input.maximumDetails) : undefined;
  return { ...base(value, 'xiaohongshu'), capability: 'xiaohongshu.search.public_notes.v1', executionTarget: 'existing_public_explore_tab', input: { query: value.input.query, ...(maximumDetails === undefined ? {} : { maximumDetails }), ...(value.input.comments === undefined ? {} : { comments: value.input.comments }) } };
}

function parseXiaohongshuAccount(value: ValidRequestEnvelope): UserBrowserXiaohongshuAccountPublicNotesCollectorServiceRequest {
  requirePlatform(value, 'xiaohongshu');
  if (value.capability !== 'xiaohongshu.account.public_notes.v1') return invalid();
  const existing = value.executionTarget === 'existing_public_profile_tab' && exactKeys(value.input, ['maximumScrolls']);
  const discovered = value.executionTarget === 'discover_public_profile_from_note' && exactKeys(value.input, ['maximumScrolls']);
  const canonicalProfileUrl = typeof value.input.profileUrl === 'string' ? canonicalXiaohongshuPublicProfileUrl(value.input.profileUrl) : null;
  const ephemeral = value.executionTarget === 'ephemeral_public_profile_url' && exactKeys(value.input, ['maximumScrolls', 'profileUrl']) && canonicalProfileUrl !== null;
  const maximumScrolls = typeof value.input.maximumScrolls === 'number' ? value.input.maximumScrolls : null;
  if ((!existing && !ephemeral && !discovered) || maximumScrolls === null || !Number.isSafeInteger(maximumScrolls) || maximumScrolls < 1 || maximumScrolls > (ephemeral || discovered ? 20 : 3)) return invalid();
  const boundedMaximumScrolls = maximumScrolls as XiaohongshuProfileScrollCount;
  return { ...base(value, 'xiaohongshu'), capability: 'xiaohongshu.account.public_notes.v1', executionTarget: ephemeral ? 'ephemeral_public_profile_url' : discovered ? 'discover_public_profile_from_note' : 'existing_public_profile_tab', input: ephemeral ? { maximumScrolls: boundedMaximumScrolls, profileUrl: canonicalProfileUrl! } : { maximumScrolls: boundedMaximumScrolls } };
}

function parseXiaohongshuDetail(value: ValidRequestEnvelope): UserBrowserXiaohongshuNotePublicDetailCollectorServiceRequest {
  requirePlatform(value, 'xiaohongshu');
  if (value.capability !== 'xiaohongshu.note.public_detail.v1' || (value.executionTarget !== 'existing_public_search_tab' && value.executionTarget !== 'existing_public_profile_tab') ||
    !exactKeys(value.input, ['resultRank']) || !Number.isSafeInteger(value.input.resultRank) || Number(value.input.resultRank) < 1 || Number(value.input.resultRank) > 20) return invalid();
  return { ...base(value, 'xiaohongshu'), capability: 'xiaohongshu.note.public_detail.v1', executionTarget: value.executionTarget, input: { resultRank: Number(value.input.resultRank) } };
}

function parseXiaohongshuComments(value: ValidRequestEnvelope): UserBrowserXiaohongshuNotePublicCommentsCollectorServiceRequest {
  requirePlatform(value, 'xiaohongshu');
  requireTarget(value, 'existing_public_note_overlay');
  if (value.capability !== 'xiaohongshu.note.public_comments.v1' || !exactKeys(value.input, ['maximumScrolls']) || !oneToThree(value.input.maximumScrolls)) return invalid();
  return { ...base(value, 'xiaohongshu'), capability: 'xiaohongshu.note.public_comments.v1', executionTarget: 'existing_public_note_overlay', input: { maximumScrolls: value.input.maximumScrolls } };
}

function parseXiaohongshuReplies(value: ValidRequestEnvelope): UserBrowserXiaohongshuReplyCollectorServiceRequest {
  requirePlatform(value, 'xiaohongshu');
  requireTarget(value, 'existing_public_note_overlay');
  if (value.capability !== 'xiaohongshu.note.public_comment_replies.v1' || !exactKeys(value.input, ['maximumThreads']) || !oneToThree(value.input.maximumThreads)) return invalid();
  return { ...base(value, 'xiaohongshu'), capability: 'xiaohongshu.note.public_comment_replies.v1', executionTarget: 'existing_public_note_overlay', input: { maximumThreads: value.input.maximumThreads } };
}

function parseZhihuOfficialSearch(value: ValidRequestEnvelope): ZhihuOfficialSearchCollectorServiceRequest {
  requireOfficialEnvelope(value, 'zhihu', ZHIHU_OFFICIAL_SEARCH_CAPABILITY);
  if (!optionalExactKeys(value.input, ['query'], ['count']) || typeof value.input.query !== 'string') invalid();
  const query = officialQuery(value.input.query);
  const count = boundedInteger(value.input.count, 10, 1, 10);
  return {
    ...officialBase(value, 'zhihu'),
    capability: ZHIHU_OFFICIAL_SEARCH_CAPABILITY,
    executionTarget: 'official_api',
    input: { query, count }
  };
}

function parseZhihuOfficialHotList(value: ValidRequestEnvelope): ZhihuOfficialHotListCollectorServiceRequest {
  requireOfficialEnvelope(value, 'zhihu', ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY);
  if (!optionalExactKeys(value.input, [], ['limit'])) invalid();
  const limit = boundedInteger(value.input.limit, 30, 1, 30);
  return {
    ...officialBase(value, 'zhihu'),
    capability: ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY,
    executionTarget: 'official_api',
    input: { limit }
  };
}

function parseZhihuOfficialGlobalSearch(
  value: ValidRequestEnvelope
): ZhihuOfficialGlobalSearchCollectorServiceRequest {
  requireOfficialEnvelope(value, 'web', ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY);
  if (!optionalExactKeys(value.input, ['query'], [
    'count', 'searchDatabase', 'site', 'publishedAfter'
  ]) || typeof value.input.query !== 'string') invalid();
  const query = officialQuery(value.input.query);
  const count = boundedInteger(value.input.count, 10, 1, 20);
  const searchDatabase = value.input.searchDatabase ?? 'all';
  if (searchDatabase !== 'all' && searchDatabase !== 'realtime' && searchDatabase !== 'static') invalid();
  const site = value.input.site === undefined ? undefined : officialSite(value.input.site);
  const publishedAfter = value.input.publishedAfter === undefined
    ? undefined
    : officialTimestamp(value.input.publishedAfter);
  return {
    ...officialBase(value, 'web'),
    capability: ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY,
    executionTarget: 'official_api',
    input: {
      query,
      count,
      searchDatabase,
      ...(site ? { site } : {}),
      ...(publishedAfter ? { publishedAfter } : {})
    }
  };
}

function requireOfficialEnvelope(
  value: ValidRequestEnvelope,
  platform: 'zhihu' | 'web',
  capability: string
): void {
  requirePlatform(value, platform);
  requireTarget(value, 'official_api');
  if (value.browserBindingId !== undefined || value.capability !== capability) invalid();
}

function officialQuery(value: string): string {
  const query = value.replace(/\s+/g, ' ').trim();
  if (query.length < 1 || query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) invalid();
  return query;
}

function officialSite(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 253 ||
    !/^[a-z0-9.-]+$/i.test(value)) invalid();
  const site = value.toLowerCase();
  if (site.startsWith('.') || site.endsWith('.') || site.includes('..')) invalid();
  let url: URL;
  try {
    url = new URL(`https://${site}`);
  } catch {
    return invalid();
  }
  if (url.hostname !== site || url.port || site === 'zhihu.com' || site.endsWith('.zhihu.com')) invalid();
  return site;
}

function officialTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid();
  return new Date(value).toISOString();
}

function boundedInteger(value: unknown, defaultValue: number, minimum: number, maximum: number): number {
  if (value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid();
  return Number(value);
}

function optionalExactKeys(
  input: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[]
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(input, key)) &&
    Object.keys(input).every((key) => allowed.has(key));
}

function oneToThree(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}

function validXiaohongshuSearchInput(
  input: Record<string, unknown>
): input is Record<string, unknown> & { query: string; maximumDetails?: number; comments?: { maximumScrolls: 1 | 2 | 3; replies?: { maximumThreads: 1 | 2 | 3 } } } {
  const keys = Object.keys(input);
  if (!keys.every((key) => key === 'query' || key === 'maximumDetails' || key === 'comments') || typeof input.query !== 'string') return false;
  if (Object.hasOwn(input, 'maximumDetails') && (!Number.isSafeInteger(input.maximumDetails) || Number(input.maximumDetails) < 0 || Number(input.maximumDetails) > XIAOHONGSHU_PUBLIC_NOTES_SEARCH_MAX_DETAILS)) return false;
  if (!Object.hasOwn(input, 'comments')) return true;
  if (typeof input.maximumDetails !== 'number' || input.maximumDetails <= 0 || !input.comments || typeof input.comments !== 'object' || Array.isArray(input.comments)) return false;
  const comments = input.comments as Record<string, unknown>;
  const commentKeys = Object.keys(comments);
  if ((commentKeys.length !== 1 && commentKeys.length !== 2) || !Object.hasOwn(comments, 'maximumScrolls') || !oneToThree(comments.maximumScrolls)) return false;
  if (!Object.hasOwn(comments, 'replies')) return commentKeys.length === 1;
  if (commentKeys.length !== 2 || !comments.replies || typeof comments.replies !== 'object' || Array.isArray(comments.replies)) return false;
  const replies = comments.replies as Record<string, unknown>;
  return exactKeys(replies, ['maximumThreads']) && oneToThree(replies.maximumThreads);
}

function base<P extends Platform>(value: ValidRequestEnvelope, platform: P): {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  clientRequestId: string;
  browserBindingId: string;
  platform: P;
} {
  if (!value.browserBindingId) invalid();
  return {
    schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
    clientRequestId: value.clientRequestId,
    browserBindingId: value.browserBindingId,
    platform
  };
}

function officialBase<P extends 'zhihu' | 'web'>(value: ValidRequestEnvelope, platform: P): {
  schemaVersion: typeof USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION;
  clientRequestId: string;
  platform: P;
} {
  return {
    schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
    clientRequestId: value.clientRequestId,
    platform
  };
}

export const USER_BROWSER_CAPABILITY_REGISTRY: UserBrowserCapabilityRegistry = {
  'bilibili.video_detail': {
    capability: 'bilibili.video_detail',
    requestSchemaName: 'UserBrowserVideoDetailCollectRequest',
    validate: parseBilibiliVideoDetail,
    executionTargets: ['collector_work_tab'],
    budgetPolicy: 'fixed_queue_budget',
    dispatch: (context, request, operationId) =>
      enqueueBilibiliVideoDetailWork(context, request.browserBindingId, request.input.canonicalVideoUrl, operationId)
  },
  'bilibili.native_search': {
    capability: 'bilibili.native_search',
    requestSchemaName: 'UserBrowserNativeSearchCollectRequest',
    validate: parseBilibiliNativeSearch,
    executionTargets: ['collector_work_tab'],
    budgetPolicy: 'fixed_queue_budget',
    dispatch: (context, request, operationId) =>
      enqueueBilibiliNativeSearchWork(context, request.browserBindingId, request.input.query, operationId)
  },
  'bilibili.native_search_batch': {
    capability: 'bilibili.native_search_batch',
    requestSchemaName: 'UserBrowserNativeSearchBatchCollectRequest',
    validate: parseBilibiliNativeSearchBatch,
    executionTargets: ['collector_work_tab'],
    budgetPolicy: 'fixed_queue_budget',
    dispatch: (context, request, operationId) =>
      enqueueBilibiliNativeSearchBatchWork(context, request.browserBindingId, request.input.query, operationId)
  },
  'bilibili.account_profile': {
    capability: 'bilibili.account_profile',
    requestSchemaName: 'UserBrowserAccountProfileCollectRequest',
    validate: parseBilibiliAccountProfile,
    executionTargets: ['collector_work_tab'],
    budgetPolicy: 'fixed_queue_budget',
    dispatch: (context, request, operationId) =>
      enqueueBilibiliAccountProfileWork(context, request.browserBindingId, request.input.canonicalProfileUrl, operationId)
  },
  'bilibili.account_inventory': {
    capability: 'bilibili.account_inventory',
    requestSchemaName: 'UserBrowserAccountInventoryCollectRequest',
    validate: parseBilibiliAccountInventory,
    executionTargets: ['collector_work_tab', 'user_selected_tab'],
    budgetPolicy: 'fixed_observation_budget',
    dispatch: (context, request, operationId) => request.executionTarget === 'user_selected_tab'
      ? enqueueBilibiliAccountInventoryUserSelectedTabWork(
        context,
        request.browserBindingId,
        request.input.canonicalProfileUrl,
        operationId
      )
      : enqueueBilibiliAccountInventoryWork(
        context,
        request.browserBindingId,
        request.input.canonicalProfileUrl,
        operationId
      )
  },
  'bilibili.dynamic': {
    capability: 'bilibili.dynamic',
    requestSchemaName: 'UserBrowserDynamicCollectRequest',
    validate: (value) => parseBilibiliProfileCapability(
      value,
      'bilibili.dynamic'
    ) as UserBrowserDynamicCollectorServiceRequest,
    executionTargets: ['collector_work_tab'],
    budgetPolicy: 'fixed_queue_budget',
    dispatch: (context, request, operationId) =>
      enqueueBilibiliDynamicWork(context, request.browserBindingId, request.input.canonicalProfileUrl, operationId)
  },
  'bilibili.collection_series.overview': {
    capability: 'bilibili.collection_series.overview',
    requestSchemaName: 'UserBrowserCollectionSeriesOverviewCollectRequest',
    validate: (value) => parseBilibiliProfileCapability(
      value,
      'bilibili.collection_series.overview'
    ) as UserBrowserCollectionSeriesOverviewCollectorServiceRequest,
    executionTargets: ['collector_work_tab'],
    budgetPolicy: 'fixed_queue_budget',
    dispatch: (context, request, operationId) => enqueueBilibiliCollectionSeriesOverviewWork(
      context,
      request.browserBindingId,
      request.input.canonicalProfileUrl,
      operationId
    )
  },
  'bilibili.collection_series.detail': {
    capability: 'bilibili.collection_series.detail',
    requestSchemaName: 'UserBrowserCollectionSeriesDetailCollectRequest',
    validate: parseBilibiliSeriesDetail,
    executionTargets: ['collector_work_tab'],
    budgetPolicy: 'fixed_queue_budget',
    dispatch: (context, request, operationId) => enqueueBilibiliCollectionSeriesDetailWork(
      context,
      request.browserBindingId,
      request.input.canonicalProfileUrl,
      request.input.stableSeriesId,
      request.input.listType,
      operationId
    )
  },
  'bilibili.danmaku': {
    capability: 'bilibili.danmaku',
    requestSchemaName: 'UserBrowserDanmakuCollectRequest',
    validate: (value) => parseBilibiliVideoPassive(
      value,
      'bilibili.danmaku'
    ) as UserBrowserDanmakuCollectorServiceRequest,
    executionTargets: ['collector_work_tab'],
    budgetPolicy: 'fixed_queue_budget',
    dispatch: (context, request, operationId) =>
      enqueueBilibiliDanmakuWork(context, request.browserBindingId, request.input.canonicalVideoUrl, operationId)
  },
  'bilibili.discussion': {
    capability: 'bilibili.discussion',
    requestSchemaName: 'UserBrowserVideoDiscussionCollectRequest',
    validate: (value) => parseBilibiliVideoPassive(
      value,
      'bilibili.discussion'
    ) as UserBrowserVideoDiscussionCollectorServiceRequest,
    executionTargets: ['collector_work_tab'],
    budgetPolicy: 'fixed_queue_budget',
    dispatch: (context, request, operationId) => enqueueBilibiliDiscussionUserSelectedTabWork(
      context,
      request.browserBindingId,
      request.input.canonicalVideoUrl,
      operationId
    )
  },
  'xiaohongshu.search.public_notes.v1': {
    capability: 'xiaohongshu.search.public_notes.v1',
    requestSchemaName: 'UserBrowserXiaohongshuPublicNotesSearchCollectRequest',
    validate: parseXiaohongshuSearch,
    executionTargets: ['existing_public_explore_tab'],
    budgetPolicy: 'input_bounded_queue_budget',
    dispatch: (context, request, operationId) => enqueueXiaohongshuPublicNotesSearchWork(
      context,
      request.browserBindingId,
      request.input.query,
      request.input.maximumDetails,
      request.input.comments,
      operationId
    )
  },
  'xiaohongshu.account.public_notes.v1': {
    capability: 'xiaohongshu.account.public_notes.v1',
    requestSchemaName: 'UserBrowserXiaohongshuAccountPublicNotesCollectRequest',
    validate: parseXiaohongshuAccount,
    executionTargets: [
      'existing_public_profile_tab',
      'ephemeral_public_profile_url',
      'discover_public_profile_from_note'
    ],
    budgetPolicy: 'input_bounded_queue_budget',
    dispatch: (context, request, operationId) => enqueueXiaohongshuAccountPublicNotesWork(
      context,
      request.browserBindingId,
      request.input.maximumScrolls,
      request.executionTarget === 'ephemeral_public_profile_url' ? request.input.profileUrl : undefined,
      request.executionTarget === 'discover_public_profile_from_note',
      operationId
    )
  },
  'xiaohongshu.note.public_detail.v1': {
    capability: 'xiaohongshu.note.public_detail.v1',
    requestSchemaName: 'UserBrowserXiaohongshuNotePublicDetailCollectRequest',
    validate: parseXiaohongshuDetail,
    executionTargets: ['existing_public_search_tab', 'existing_public_profile_tab'],
    budgetPolicy: 'fixed_queue_budget',
    dispatch: (context, request, operationId) => enqueueXiaohongshuNotePublicDetailWork(
      context,
      request.browserBindingId,
      request.input.resultRank,
      request.executionTarget,
      operationId
    )
  },
  'xiaohongshu.note.public_comments.v1': {
    capability: 'xiaohongshu.note.public_comments.v1',
    requestSchemaName: 'UserBrowserXiaohongshuNotePublicCommentsCollectRequest',
    validate: parseXiaohongshuComments,
    executionTargets: ['existing_public_note_overlay'],
    budgetPolicy: 'input_bounded_queue_budget',
    dispatch: (context, request, operationId) => enqueueXiaohongshuNotePublicCommentsWork(
      context,
      request.browserBindingId,
      request.input.maximumScrolls,
      operationId
    )
  },
  'xiaohongshu.note.public_comment_replies.v1': {
    capability: 'xiaohongshu.note.public_comment_replies.v1',
    requestSchemaName: 'UserBrowserXiaohongshuReplyCollectRequest',
    validate: parseXiaohongshuReplies,
    executionTargets: ['existing_public_note_overlay'],
    budgetPolicy: 'input_bounded_queue_budget',
    dispatch: (context, request, operationId) => enqueueXiaohongshuReplyWork(
      context,
      request.browserBindingId,
      request.input.maximumThreads,
      operationId
    )
  },
  'zhihu.search.public_content.v1': {
    capability: ZHIHU_OFFICIAL_SEARCH_CAPABILITY,
    requestSchemaName: 'ZhihuOfficialSearchCollectRequest',
    executionProvider: 'official_api',
    validate: parseZhihuOfficialSearch,
    executionTargets: ['official_api'],
    budgetPolicy: 'official_api_fixed_count',
    dispatch: (context, request, operationId) =>
      context.zhihuOfficialApiProvider.collect(request, operationId)
  },
  'zhihu.hot_list.public_content.v1': {
    capability: ZHIHU_OFFICIAL_HOT_LIST_CAPABILITY,
    requestSchemaName: 'ZhihuOfficialHotListCollectRequest',
    executionProvider: 'official_api',
    validate: parseZhihuOfficialHotList,
    executionTargets: ['official_api'],
    budgetPolicy: 'official_api_fixed_count',
    dispatch: (context, request, operationId) =>
      context.zhihuOfficialApiProvider.collect(request, operationId)
  },
  'web.search.global.zhihu_provider.v1': {
    capability: ZHIHU_OFFICIAL_GLOBAL_SEARCH_CAPABILITY,
    requestSchemaName: 'ZhihuOfficialGlobalSearchCollectRequest',
    executionProvider: 'official_api',
    validate: parseZhihuOfficialGlobalSearch,
    executionTargets: ['official_api'],
    budgetPolicy: 'official_api_fixed_count',
    dispatch: (context, request, operationId) =>
      context.zhihuOfficialApiProvider.collect(request, operationId)
  }
};

export function listUserBrowserExecutableCapabilities(): UserBrowserExecutableCapability[] {
  return Object.keys(USER_BROWSER_CAPABILITY_REGISTRY) as UserBrowserExecutableCapability[];
}

export function isUserBrowserExecutableCapability(value: string): value is UserBrowserExecutableCapability {
  return Object.prototype.hasOwnProperty.call(USER_BROWSER_CAPABILITY_REGISTRY, value);
}

export function parseUserBrowserCollectorServiceRequest(value: unknown): UserBrowserCollectorServiceRequest {
  const parsed = envelope(value);
  if (!isUserBrowserExecutableCapability(parsed.capability)) return invalid();
  const entry = USER_BROWSER_CAPABILITY_REGISTRY[parsed.capability] as UserBrowserCapabilityRegistryEntry<UserBrowserExecutableCapability>;
  return entry.validate(parsed) as UserBrowserCollectorServiceRequest;
}

export async function dispatchUserBrowserCapability(
  context: UserBrowserCapabilityDispatchContext,
  request: UserBrowserCollectorServiceRequest,
  operationId: string
): Promise<CollectorOperationSummary> {
  const entry = USER_BROWSER_CAPABILITY_REGISTRY[request.capability] as UserBrowserCapabilityRegistryEntry<UserBrowserExecutableCapability> | undefined;
  if (!entry) throw new Error('user_browser_capability_dispatch_unavailable');
  return await entry.dispatch(context, request as never, operationId);
}
