from __future__ import annotations

DEFAULT_GATEWAY_ORIGIN = "http://127.0.0.1:43127"
DEFAULT_REQUEST_TIMEOUT_SECONDS = 20.0
DEFAULT_WAIT_TIMEOUT_SECONDS = 120.0
DEFAULT_POLL_INITIAL_DELAY_SECONDS = 0.5
DEFAULT_POLL_MAX_DELAY_SECONDS = 2.0
MAX_JSON_BYTES = 16 * 1024 * 1024

DIRECT_CAPABILITY_NAMES = (
    "bilibili.video_detail",
    "bilibili.native_search",
    "bilibili.native_search_batch",
    "bilibili.account_profile",
    "bilibili.account_inventory",
    "bilibili.dynamic",
    "bilibili.collection_series.overview",
    "bilibili.collection_series.detail",
    "bilibili.danmaku",
    "bilibili.discussion",
    "xiaohongshu.search.public_notes.v1",
    "xiaohongshu.account.public_notes.v1",
    "xiaohongshu.note.public_detail.v1",
    "xiaohongshu.note.public_comments.v1",
    "xiaohongshu.note.public_comment_replies.v1",
)
DIRECT_CAPABILITIES = frozenset(DIRECT_CAPABILITY_NAMES)

DIRECT_EXECUTION_TARGETS = frozenset(
    {
        "collector_work_tab",
        "user_selected_tab",
        "existing_public_explore_tab",
        "existing_public_profile_tab",
        "ephemeral_public_profile_url",
        "discover_public_profile_from_note",
        "existing_public_search_tab",
        "existing_public_note_overlay",
    }
)

TERMINAL_STATES = frozenset({"completed", "partial", "stopped", "failed"})
NON_TERMINAL_STATES = frozenset({"queued", "claimed"})
