/**
 * Capability-specific request builders for the direct user-owned-browser API.
 *
 * These functions are deliberately narrower than the generic `collect`
 * method. They construct only registered /v2 request shapes and validate the
 * cheap, deterministic parts locally; the Gateway remains the final authority
 * for binding state, budgets and admission.
 */

import { CollectorClientError } from './errors.mjs';
import { UUID_PATTERN } from './constants.mjs';

const SCHEMA_VERSION = 2;
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

function base({ browserBindingId, platform, capability, executionTarget, input }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    browserBindingId: bindingId(browserBindingId),
    platform,
    capability,
    executionTarget,
    input
  };
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

export function bilibiliVideoDetail({ browserBindingId, canonicalVideoUrl }) {
  return base({
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.video_detail',
    executionTarget: 'collector_work_tab',
    input: { canonicalVideoUrl: bilibiliVideoUrl(canonicalVideoUrl) }
  });
}

export function bilibiliNativeSearch({ browserBindingId, query }) {
  return base({
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.native_search',
    executionTarget: 'collector_work_tab',
    input: { query: bilibiliSearchQuery(query) }
  });
}

export function bilibiliNativeSearchBatch({ browserBindingId, query }) {
  return base({
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.native_search_batch',
    executionTarget: 'collector_work_tab',
    input: { query: bilibiliSearchQuery(query) }
  });
}

export function bilibiliAccountProfile({ browserBindingId, canonicalProfileUrl }) {
  return base({
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.account_profile',
    executionTarget: 'collector_work_tab',
    input: { canonicalProfileUrl: bilibiliProfileUrl(canonicalProfileUrl) }
  });
}

export function bilibiliAccountInventory({
  browserBindingId,
  canonicalProfileUrl,
  executionTarget = 'collector_work_tab'
}) {
  if (executionTarget !== 'collector_work_tab' && executionTarget !== 'user_selected_tab') invalid('executionTarget');
  return base({
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.account_inventory',
    executionTarget,
    input: { canonicalProfileUrl: bilibiliProfileUrl(canonicalProfileUrl) }
  });
}

export function bilibiliDynamic({ browserBindingId, canonicalProfileUrl }) {
  return base({
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.dynamic',
    executionTarget: 'collector_work_tab',
    input: { canonicalProfileUrl: bilibiliProfileUrl(canonicalProfileUrl) }
  });
}

export function bilibiliCollectionSeriesOverview({ browserBindingId, canonicalProfileUrl }) {
  return base({
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.collection_series.overview',
    executionTarget: 'collector_work_tab',
    input: { canonicalProfileUrl: bilibiliProfileUrl(canonicalProfileUrl) }
  });
}

export function bilibiliCollectionSeriesDetail({
  browserBindingId,
  canonicalProfileUrl,
  stableSeriesId,
  listType
}) {
  if (typeof stableSeriesId !== 'string' || !/^\d{1,20}$/.test(stableSeriesId) || stableSeriesId === '0') invalid('stableSeriesId');
  if (listType !== 'series' && listType !== 'season') invalid('listType');
  return base({
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

export function bilibiliDanmaku({ browserBindingId, canonicalVideoUrl }) {
  return base({
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.danmaku',
    executionTarget: 'collector_work_tab',
    input: { canonicalVideoUrl: bilibiliVideoUrl(canonicalVideoUrl) }
  });
}

export function bilibiliDiscussion({ browserBindingId, canonicalVideoUrl }) {
  return base({
    browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.discussion',
    executionTarget: 'collector_work_tab',
    input: { canonicalVideoUrl: bilibiliVideoUrl(canonicalVideoUrl) }
  });
}

export function xiaohongshuPublicNotesSearch({
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
    browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.search.public_notes.v1',
    executionTarget: 'existing_public_explore_tab',
    input
  });
}

export function xiaohongshuAccountPublicNotes({
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
    browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.account.public_notes.v1',
    executionTarget,
    input
  });
}

export function xiaohongshuNotePublicDetail({
  browserBindingId,
  resultRank,
  executionTarget = 'existing_public_search_tab'
}) {
  if (!Number.isSafeInteger(resultRank) || resultRank < 1 || resultRank > 20) invalid('resultRank');
  if (executionTarget !== 'existing_public_search_tab' && executionTarget !== 'existing_public_profile_tab') invalid('executionTarget');
  return base({
    browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_detail.v1',
    executionTarget,
    input: { resultRank }
  });
}

export function xiaohongshuNotePublicComments({ browserBindingId, maximumScrolls }) {
  return base({
    browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_comments.v1',
    executionTarget: 'existing_public_note_overlay',
    input: { maximumScrolls: smallBudget(maximumScrolls, 'maximumScrolls') }
  });
}

export function xiaohongshuNotePublicCommentReplies({ browserBindingId, maximumThreads }) {
  return base({
    browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_comment_replies.v1',
    executionTarget: 'existing_public_note_overlay',
    input: { maximumThreads: smallBudget(maximumThreads, 'maximumThreads') }
  });
}
