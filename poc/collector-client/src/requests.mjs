/**
 * Capability-specific request builders for the registered direct-provider API.
 *
 * These functions are deliberately narrower than the generic `collect`
 * method. They construct only registered /v2 request shapes and validate the
 * cheap, deterministic parts locally; the Gateway remains the final authority
 * for binding state, budgets and admission.
 */

import { CollectorClientError } from './errors.mjs';
import { CORE_SERVICE_SCHEMA_VERSION, UUID_PATTERN } from './constants.mjs';
import { randomUUID } from 'node:crypto';

const BILIBILI_SEARCH_QUERY_MAX_LENGTH = 160;
const XIAOHONGSHU_SEARCH_QUERY_MAX_LENGTH = 80;
const XIAOHONGSHU_MAX_DETAILS = 20;
const XIAOHONGSHU_PROFILE_MAX_SCROLLS = 20;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

function invalid(field) {
  throw new CollectorClientError(
    'collector_client_request_builder_invalid',
    400,
    field === undefined ? undefined : { field }
  );
}
function bindingId(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid('browserBindingId');
  return value;
}

function clientRequestIdValue(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid('clientRequestId');
  return value;
}

/** Create a fresh request identity. Persist and reuse it only for the same canonical submission. */
export function createClientRequestId() {
  return randomUUID();
}

function base({ clientRequestId, browserBindingId, platform, capability, executionTarget, input }) {
  return {
    schemaVersion: CORE_SERVICE_SCHEMA_VERSION,
    clientRequestId: clientRequestIdValue(clientRequestId),
    browserBindingId: bindingId(browserBindingId),
    platform,
    capability,
    executionTarget,
    input
  };
}

function officialBase({ clientRequestId, platform, capability, input }) {
  return {
    schemaVersion: CORE_SERVICE_SCHEMA_VERSION,
    clientRequestId: clientRequestIdValue(clientRequestId),
    platform,
    capability,
    executionTarget: 'official_api',
    input
  };
}

function exactOptions(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const allowed = new Set([...required, ...optional]);
  if (!required.every((key) => Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !allowed.has(key))) invalid();
  return value;
}

function officialQuery(value) {
  if (typeof value !== 'string') invalid('query');
  const query = value.replace(/\s+/g, ' ').trim();
  if (!query || query.length > 100 || CONTROL_PATTERN.test(query)) invalid('query');
  return query;
}

function officialInteger(value, defaultValue, maximum, field) {
  if (value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) invalid(field);
  return value;
}

function officialSite(value) {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 253 ||
      !/^[A-Za-z0-9.-]+$/.test(value)) invalid('site');
  const site = value.toLowerCase();
  if (site.startsWith('.') || site.endsWith('.') || site.includes('..')) invalid('site');
  const url = parsedUrl(`https://${site}`, 'site');
  if (url.hostname !== site || url.port || site === 'zhihu.com' || site.endsWith('.zhihu.com')) invalid('site');
  return site;
}

function officialTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid('publishedAfter');
  return new Date(value).toISOString();
}

function parsedUrl(value, field) {
  if (typeof value !== 'string' || value !== value.trim() || CONTROL_PATTERN.test(value)) invalid(field);
  try {
    return new URL(value);
  } catch {
    invalid(field);
  }
}

function bilibiliVideoUrl(value, field = 'canonicalVideoUrl') {
  const url = parsedUrl(value, field);
  const match = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
  if (url.protocol !== 'https:' || url.hostname !== 'www.bilibili.com' || !match ||
      url.username || url.password || url.search || url.hash) invalid(field);
  return `https://www.bilibili.com/video/${match[1]}`;
}

function bilibiliProfileUrl(value, field = 'canonicalProfileUrl') {
  const url = parsedUrl(value, field);
  const match = url.pathname.match(/^\/(\d{1,20})\/?$/);
  if (url.protocol !== 'https:' || url.hostname !== 'space.bilibili.com' || !match ||
      url.username || url.password || url.search || url.hash) invalid(field);
  return `https://space.bilibili.com/${match[1]}`;
}

function bilibiliSearchQuery(value) {
  if (typeof value !== 'string') invalid('query');
  const query = value.replace(/\s+/g, ' ').trim();
  if (!query || query.length > BILIBILI_SEARCH_QUERY_MAX_LENGTH || CONTROL_PATTERN.test(query)) invalid('query');
  return query;
}

function xiaohongshuProfileUrl(value) {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 4096 || CONTROL_PATTERN.test(value)) {
    invalid('profileUrl');
  }
  const url = parsedUrl(value, 'profileUrl');
  if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com' || url.port ||
      url.username || url.password || url.hash || !/^\/user\/profile\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    invalid('profileUrl');
  }
  // Preserve the exact signed URL. Re-serialising xsec parameters can make a
  // short-lived platform link invalid.
  return value;
}

function smallBudget(value, field) {
  if (!Number.isSafeInteger(value) || ![1, 2, 3].includes(value)) invalid(field);
  return value;
}

function maximumDetails(value) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0 || value > XIAOHONGSHU_MAX_DETAILS) invalid('maximumDetails');
  return value;
}

export function bilibiliVideoDetail({ clientRequestId, browserBindingId, canonicalVideoUrl }) {
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.video_detail',
    executionTarget: 'collector_work_tab',
    input: { canonicalVideoUrl: bilibiliVideoUrl(canonicalVideoUrl) }
  });
}

export function bilibiliNativeSearch({ clientRequestId, browserBindingId, query }) {
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.native_search',
    executionTarget: 'collector_work_tab',
    input: { query: bilibiliSearchQuery(query) }
  });
}

export function bilibiliNativeSearchBatch({ clientRequestId, browserBindingId, query }) {
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.native_search_batch',
    executionTarget: 'collector_work_tab',
    input: { query: bilibiliSearchQuery(query) }
  });
}

export function bilibiliAccountProfile({ clientRequestId, browserBindingId, canonicalProfileUrl }) {
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.account_profile',
    executionTarget: 'collector_work_tab',
    input: { canonicalProfileUrl: bilibiliProfileUrl(canonicalProfileUrl) }
  });
}

export function bilibiliAccountInventory({
  clientRequestId,
  browserBindingId,
  canonicalProfileUrl,
  executionTarget = 'collector_work_tab'
}) {
  if (executionTarget !== 'collector_work_tab' && executionTarget !== 'user_selected_tab') invalid('executionTarget');
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.account_inventory',
    executionTarget,
    input: { canonicalProfileUrl: bilibiliProfileUrl(canonicalProfileUrl) }
  });
}

export function bilibiliDynamic({ clientRequestId, browserBindingId, canonicalProfileUrl }) {
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.dynamic',
    executionTarget: 'collector_work_tab',
    input: { canonicalProfileUrl: bilibiliProfileUrl(canonicalProfileUrl) }
  });
}

export function bilibiliCollectionSeriesOverview({ clientRequestId, browserBindingId, canonicalProfileUrl }) {
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.collection_series.overview',
    executionTarget: 'collector_work_tab',
    input: { canonicalProfileUrl: bilibiliProfileUrl(canonicalProfileUrl) }
  });
}

export function bilibiliCollectionSeriesDetail({
  clientRequestId,
  browserBindingId,
  canonicalProfileUrl,
  stableSeriesId,
  listType
}) {
  if (typeof stableSeriesId !== 'string' || !/^\d{1,20}$/.test(stableSeriesId) || stableSeriesId === '0') invalid('stableSeriesId');
  if (listType !== 'series' && listType !== 'season') invalid('listType');
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.collection_series.detail',
    executionTarget: 'collector_work_tab',
    input: {
      canonicalProfileUrl: bilibiliProfileUrl(canonicalProfileUrl),
      stableSeriesId,
      listType
    }
  });
}

export function bilibiliDanmaku({ clientRequestId, browserBindingId, canonicalVideoUrl }) {
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.danmaku',
    executionTarget: 'collector_work_tab',
    input: { canonicalVideoUrl: bilibiliVideoUrl(canonicalVideoUrl) }
  });
}

export function bilibiliDiscussion({ clientRequestId, browserBindingId, canonicalVideoUrl }) {
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.discussion',
    executionTarget: 'collector_work_tab',
    input: { canonicalVideoUrl: bilibiliVideoUrl(canonicalVideoUrl) }
  });
}

export function xiaohongshuPublicNotesSearch({
  clientRequestId,
  browserBindingId,
  query,
  maximumDetails: requestedMaximumDetails,
  commentsMaximumScrolls,
  repliesMaximumThreads
}) {
  if (typeof query !== 'string' || query !== query.trim() || !query ||
      query.length > XIAOHONGSHU_SEARCH_QUERY_MAX_LENGTH || CONTROL_PATTERN.test(query)) invalid('query');
  const details = maximumDetails(requestedMaximumDetails);
  if (commentsMaximumScrolls === undefined && repliesMaximumThreads !== undefined) invalid('repliesMaximumThreads');
  let comments;
  if (commentsMaximumScrolls !== undefined) {
    if (details === undefined || details <= 0) invalid('maximumDetails');
    comments = { maximumScrolls: smallBudget(commentsMaximumScrolls, 'commentsMaximumScrolls') };
    if (repliesMaximumThreads !== undefined) {
      comments.replies = { maximumThreads: smallBudget(repliesMaximumThreads, 'repliesMaximumThreads') };
    }
  }
  const input = { query };
  if (details !== undefined) input.maximumDetails = details;
  if (comments !== undefined) input.comments = comments;
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.search.public_notes.v1',
    executionTarget: 'existing_public_explore_tab',
    input
  });
}

export function xiaohongshuAccountPublicNotes({
  clientRequestId,
  browserBindingId,
  maximumScrolls,
  executionTarget = 'existing_public_profile_tab',
  profileUrl
}) {
  if (!['existing_public_profile_tab', 'ephemeral_public_profile_url', 'discover_public_profile_from_note'].includes(executionTarget)) {
    invalid('executionTarget');
  }
  const maximum = executionTarget === 'existing_public_profile_tab' ? 3 : XIAOHONGSHU_PROFILE_MAX_SCROLLS;
  if (!Number.isSafeInteger(maximumScrolls) || maximumScrolls < 1 || maximumScrolls > maximum) invalid('maximumScrolls');
  let canonicalProfileUrl;
  if (executionTarget === 'ephemeral_public_profile_url') {
    if (profileUrl === undefined) invalid('profileUrl');
    canonicalProfileUrl = xiaohongshuProfileUrl(profileUrl);
  } else if (profileUrl !== undefined) {
    invalid('profileUrl');
  }
  const input = { maximumScrolls };
  if (canonicalProfileUrl !== undefined) input.profileUrl = canonicalProfileUrl;
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.account.public_notes.v1',
    executionTarget,
    input
  });
}

export function xiaohongshuNotePublicDetail({
  clientRequestId,
  browserBindingId,
  resultRank,
  executionTarget = 'existing_public_search_tab'
}) {
  if (!Number.isSafeInteger(resultRank) || resultRank < 1 || resultRank > 20) invalid('resultRank');
  if (executionTarget !== 'existing_public_search_tab' && executionTarget !== 'existing_public_profile_tab') invalid('executionTarget');
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_detail.v1',
    executionTarget,
    input: { resultRank }
  });
}

export function xiaohongshuNotePublicComments({ clientRequestId, browserBindingId, maximumScrolls }) {
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_comments.v1',
    executionTarget: 'existing_public_note_overlay',
    input: { maximumScrolls: smallBudget(maximumScrolls, 'maximumScrolls') }
  });
}

export function xiaohongshuNotePublicCommentReplies({ clientRequestId, browserBindingId, maximumThreads }) {
  return base({
    clientRequestId,
    browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_comment_replies.v1',
    executionTarget: 'existing_public_note_overlay',
    input: { maximumThreads: smallBudget(maximumThreads, 'maximumThreads') }
  });
}

/** Search public Zhihu content through the Gateway-owned official provider. */
export function zhihuOfficialSearch(options) {
  const value = exactOptions(options, ['clientRequestId', 'query'], ['count']);
  return officialBase({
    clientRequestId: value.clientRequestId,
    platform: 'zhihu',
    capability: 'zhihu.search.public_content.v1',
    input: {
      query: officialQuery(value.query),
      count: officialInteger(value.count, 10, 10, 'count')
    }
  });
}

/** Read the bounded official Zhihu hot list without a browser binding. */
export function zhihuOfficialHotList(options) {
  const value = exactOptions(options, ['clientRequestId'], ['limit']);
  return officialBase({
    clientRequestId: value.clientRequestId,
    platform: 'zhihu',
    capability: 'zhihu.hot_list.public_content.v1',
    input: { limit: officialInteger(value.limit, 30, 30, 'limit') }
  });
}

/** Search the web through Zhihu's official provider with fixed, bounded filters. */
export function zhihuOfficialGlobalSearch(options) {
  const value = exactOptions(
    options,
    ['clientRequestId', 'query'],
    ['count', 'searchDatabase', 'site', 'publishedAfter']
  );
  const searchDatabase = value.searchDatabase ?? 'all';
  if (!['all', 'realtime', 'static'].includes(searchDatabase)) invalid('searchDatabase');
  const input = {
    query: officialQuery(value.query),
    count: officialInteger(value.count, 10, 20, 'count'),
    searchDatabase
  };
  if (value.site !== undefined) input.site = officialSite(value.site);
  if (value.publishedAfter !== undefined) input.publishedAfter = officialTimestamp(value.publishedAfter);
  return officialBase({
    clientRequestId: value.clientRequestId,
    platform: 'web',
    capability: 'web.search.global.zhihu_provider.v1',
    input
  });
}
