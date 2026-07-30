export const DEFAULT_GATEWAY_ORIGIN = 'http://127.0.0.1:43127';
/** Compatibility anchor for the published JS SDK release. */
export const CORE_RELEASE_VERSION = '0.7.17';
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
export const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
export const DEFAULT_POLL_INITIAL_DELAY_MS = 500;
export const DEFAULT_POLL_MAX_DELAY_MS = 2_000;
export const MAX_JSON_BYTES = 16 * 1024 * 1024;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const TOKEN_PATTERN = /^cst_[A-Za-z0-9_-]{43}$/;
export const SAFE_ERROR_PATTERN = /^[a-z0-9_.-]{1,120}$/i;
export const TERMINAL_STATES = new Set(['completed', 'partial', 'stopped', 'failed']);

export const DIRECT_CAPABILITY_NAMES = Object.freeze([
  'bilibili.video_detail',
  'bilibili.native_search',
  'bilibili.native_search_batch',
  'bilibili.account_profile',
  'bilibili.account_inventory',
  'bilibili.dynamic',
  'bilibili.collection_series.overview',
  'bilibili.collection_series.detail',
  'bilibili.danmaku',
  'bilibili.discussion',
  'xiaohongshu.search.public_notes.v1',
  'xiaohongshu.account.public_notes.v1',
  'xiaohongshu.note.public_detail.v1',
  'xiaohongshu.note.public_comments.v1',
  'xiaohongshu.note.public_comment_replies.v1'
]);
export const DIRECT_CAPABILITIES = new Set(DIRECT_CAPABILITY_NAMES);
export const DIRECT_EXECUTION_TARGETS = new Set([
  'collector_work_tab',
  'user_selected_tab',
  'existing_public_explore_tab',
  'existing_public_profile_tab',
  'ephemeral_public_profile_url',
  'discover_public_profile_from_note',
  'existing_public_search_tab',
  'existing_public_note_overlay'
]);
