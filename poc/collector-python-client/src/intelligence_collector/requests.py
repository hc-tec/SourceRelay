"""Capability-specific request builders for the direct Collector API.

The Gateway is the final authority for every request.  These builders are a
small, language-native front door for upper applications: they only construct
one of the registered capability shapes and perform the same cheap input
checks locally before an HTTP request is attempted.

They deliberately do not accept URLs for the Xiaohongshu search/detail
surfaces, tab identifiers, selectors, scripts, or network controls.  A
short-lived Xiaohongshu profile URL is accepted only for the explicitly
registered ``ephemeral_public_profile_url`` target and is preserved byte for
byte because its signature can be invalidated by URL re-serialisation.
"""

from __future__ import annotations

import re
from typing import Any, Literal
from urllib.parse import SplitResult, urlsplit
from uuid import uuid4

from .constants import CORE_SERVICE_SCHEMA_VERSION
from .errors import CollectorClientError
from .validation import assert_uuid

BILIBILI_SEARCH_QUERY_MAX_LENGTH = 160
XIAOHONGSHU_SEARCH_QUERY_MAX_LENGTH = 80
XIAOHONGSHU_MAX_DETAILS = 20
XIAOHONGSHU_PROFILE_MAX_SCROLLS = 20

_BV_PATTERN = re.compile(r"^BV[0-9A-Za-z]{10}$")
_PROFILE_ID_PATTERN = re.compile(r"^\d{1,20}$")
_SERIES_ID_PATTERN = re.compile(r"^\d{1,20}$")
_XHS_PROFILE_PATH_PATTERN = re.compile(r"^/user/profile/[A-Za-z0-9_-]+/?$")
_CONTROL_PATTERN = re.compile(r"[\x00-\x1f\x7f]")

ExecutionTarget = Literal[
    "collector_work_tab",
    "user_selected_tab",
    "existing_public_explore_tab",
    "existing_public_profile_tab",
    "ephemeral_public_profile_url",
    "discover_public_profile_from_note",
    "existing_public_search_tab",
    "existing_public_note_overlay",
]
Request = dict[str, Any]


def _invalid(field: str | None = None) -> CollectorClientError:
    details = None if field is None else {"field": field}
    return CollectorClientError("collector_client_request_builder_invalid", 400, details)


def _binding_id(value: str) -> str:
    try:
        assert_uuid(value, "collector_client_request_builder_invalid")
    except CollectorClientError:
        raise
    return value


def _client_request_id(value: str) -> str:
    try:
        assert_uuid(value, "collector_client_request_builder_invalid")
    except CollectorClientError:
        raise
    return value


def create_client_request_id() -> str:
    """Create an identity that callers persist and reuse only for the same submission."""

    return str(uuid4())


def _text(value: str, field: str, *, maximum: int, trim: bool = False) -> str:
    if not isinstance(value, str) or not value or _CONTROL_PATTERN.search(value):
        raise _invalid(field)
    if trim and value != value.strip():
        raise _invalid(field)
    if len(value) > maximum:
        raise _invalid(field)
    return value


def _base(
    client_request_id: str,
    browser_binding_id: str,
    platform: Literal["bilibili", "xiaohongshu"],
    capability: str,
    execution_target: ExecutionTarget,
    input_value: dict[str, Any],
) -> Request:
    _binding_id(browser_binding_id)
    return {
        "schemaVersion": CORE_SERVICE_SCHEMA_VERSION,
        "clientRequestId": _client_request_id(client_request_id),
        "browserBindingId": browser_binding_id,
        "platform": platform,
        "capability": capability,
        "executionTarget": execution_target,
        "input": input_value,
    }


def _parsed_url(value: str, field: str) -> SplitResult:
    if not isinstance(value, str) or value != value.strip() or _CONTROL_PATTERN.search(value):
        raise _invalid(field)
    try:
        parsed = urlsplit(value)
        # Accessing hostname/port makes malformed bracketed hosts fail early.
        _ = parsed.hostname
        _ = parsed.port
    except (TypeError, ValueError):
        raise _invalid(field)
    return parsed


def _bilibili_video_url(value: str, field: str = "canonical_video_url") -> str:
    parsed = _parsed_url(value, field)
    match = re.fullmatch(r"/video/(BV[0-9A-Za-z]{10})/?", parsed.path)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "www.bilibili.com"
        or not match
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise _invalid(field)
    bvid = match.group(1)
    if not _BV_PATTERN.fullmatch(bvid):  # explicit contract assertion
        raise _invalid(field)
    return f"https://www.bilibili.com/video/{bvid}"


def _bilibili_profile_url(value: str, field: str = "canonical_profile_url") -> str:
    parsed = _parsed_url(value, field)
    match = re.fullmatch(r"/(\d{1,20})/?", parsed.path)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "space.bilibili.com"
        or not match
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise _invalid(field)
    profile_id = match.group(1)
    if not _PROFILE_ID_PATTERN.fullmatch(profile_id):
        raise _invalid(field)
    return f"https://space.bilibili.com/{profile_id}"


def _bilibili_search_query(value: str) -> str:
    if not isinstance(value, str):
        raise _invalid("query")
    query = re.sub(r"\s+", " ", value).strip()
    if not query or len(query) > BILIBILI_SEARCH_QUERY_MAX_LENGTH or _CONTROL_PATTERN.search(query):
        raise _invalid("query")
    return query


def _xhs_profile_url(value: str) -> str:
    if (
        not isinstance(value, str)
        or value != value.strip()
        or len(value) > 4096
        or _CONTROL_PATTERN.search(value)
    ):
        raise _invalid("profile_url")
    parsed = _parsed_url(value, "profile_url")
    if (
        parsed.scheme != "https"
        or parsed.hostname != "www.xiaohongshu.com"
        or parsed.port is not None
        or parsed.username
        or parsed.password
        or parsed.fragment
        or not _XHS_PROFILE_PATH_PATTERN.fullmatch(parsed.path)
    ):
        raise _invalid("profile_url")
    # Do not reconstruct the signed URL; the exact query/signature bytes are
    # only used by the short-lived work item and never become an artifact.
    return value


def _small_budget(value: int, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value not in (1, 2, 3):
        raise _invalid(field)
    return value


def _maximum_details(value: int | None) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= XIAOHONGSHU_MAX_DETAILS:
        raise _invalid("maximum_details")
    return value


def bilibili_video_detail(*, client_request_id: str, browser_binding_id: str, canonical_video_url: str) -> Request:
    return _base(
        client_request_id,
        browser_binding_id,
        "bilibili",
        "bilibili.video_detail",
        "collector_work_tab",
        {"canonicalVideoUrl": _bilibili_video_url(canonical_video_url)},
    )


def bilibili_native_search(*, client_request_id: str, browser_binding_id: str, query: str) -> Request:
    return _base(
        client_request_id,
        browser_binding_id,
        "bilibili",
        "bilibili.native_search",
        "collector_work_tab",
        {"query": _bilibili_search_query(query)},
    )


def bilibili_native_search_batch(*, client_request_id: str, browser_binding_id: str, query: str) -> Request:
    return _base(
        client_request_id,
        browser_binding_id,
        "bilibili",
        "bilibili.native_search_batch",
        "collector_work_tab",
        {"query": _bilibili_search_query(query)},
    )


def bilibili_account_profile(
    *, client_request_id: str, browser_binding_id: str, canonical_profile_url: str
) -> Request:
    return _base(
        client_request_id,
        browser_binding_id,
        "bilibili",
        "bilibili.account_profile",
        "collector_work_tab",
        {"canonicalProfileUrl": _bilibili_profile_url(canonical_profile_url)},
    )


def bilibili_account_inventory(
    *,
    client_request_id: str,
    browser_binding_id: str,
    canonical_profile_url: str,
    execution_target: Literal["collector_work_tab", "user_selected_tab"] = "collector_work_tab",
) -> Request:
    if execution_target not in {"collector_work_tab", "user_selected_tab"}:
        raise _invalid("execution_target")
    return _base(
        client_request_id,
        browser_binding_id,
        "bilibili",
        "bilibili.account_inventory",
        execution_target,
        {"canonicalProfileUrl": _bilibili_profile_url(canonical_profile_url)},
    )


def bilibili_dynamic(*, client_request_id: str, browser_binding_id: str, canonical_profile_url: str) -> Request:
    return _base(
        client_request_id,
        browser_binding_id,
        "bilibili",
        "bilibili.dynamic",
        "collector_work_tab",
        {"canonicalProfileUrl": _bilibili_profile_url(canonical_profile_url)},
    )


def bilibili_collection_series_overview(
    *, client_request_id: str, browser_binding_id: str, canonical_profile_url: str
) -> Request:
    return _base(
        client_request_id,
        browser_binding_id,
        "bilibili",
        "bilibili.collection_series.overview",
        "collector_work_tab",
        {"canonicalProfileUrl": _bilibili_profile_url(canonical_profile_url)},
    )


def bilibili_collection_series_detail(
    *,
    client_request_id: str,
    browser_binding_id: str,
    canonical_profile_url: str,
    stable_series_id: str,
    list_type: Literal["series", "season"],
) -> Request:
    if (
        not isinstance(stable_series_id, str)
        or not _SERIES_ID_PATTERN.fullmatch(stable_series_id)
        or stable_series_id == "0"
        or list_type not in {"series", "season"}
    ):
        raise _invalid("stable_series_id" if list_type in {"series", "season"} else "list_type")
    return _base(
        client_request_id,
        browser_binding_id,
        "bilibili",
        "bilibili.collection_series.detail",
        "collector_work_tab",
        {
            "canonicalProfileUrl": _bilibili_profile_url(canonical_profile_url),
            "stableSeriesId": stable_series_id,
            "listType": list_type,
        },
    )


def bilibili_danmaku(*, client_request_id: str, browser_binding_id: str, canonical_video_url: str) -> Request:
    return _base(
        client_request_id,
        browser_binding_id,
        "bilibili",
        "bilibili.danmaku",
        "collector_work_tab",
        {"canonicalVideoUrl": _bilibili_video_url(canonical_video_url)},
    )


def bilibili_discussion(*, client_request_id: str, browser_binding_id: str, canonical_video_url: str) -> Request:
    return _base(
        client_request_id,
        browser_binding_id,
        "bilibili",
        "bilibili.discussion",
        "collector_work_tab",
        {"canonicalVideoUrl": _bilibili_video_url(canonical_video_url)},
    )


def xiaohongshu_public_notes_search(
    *,
    client_request_id: str,
    browser_binding_id: str,
    query: str,
    maximum_details: int | None = None,
    comments_maximum_scrolls: Literal[1, 2, 3] | None = None,
    replies_maximum_threads: Literal[1, 2, 3] | None = None,
) -> Request:
    query_value = _text(
        query,
        "query",
        maximum=XIAOHONGSHU_SEARCH_QUERY_MAX_LENGTH,
        trim=True,
    )
    details = _maximum_details(maximum_details)
    if comments_maximum_scrolls is None and replies_maximum_threads is not None:
        raise _invalid("replies_maximum_threads")
    if comments_maximum_scrolls is not None:
        scrolls = _small_budget(comments_maximum_scrolls, "comments_maximum_scrolls")
        if details is None or details <= 0:
            raise _invalid("maximum_details")
        comments: dict[str, Any] = {"maximumScrolls": scrolls}
        if replies_maximum_threads is not None:
            comments["replies"] = {
                "maximumThreads": _small_budget(replies_maximum_threads, "replies_maximum_threads")
            }
    else:
        comments = None
    input_value: dict[str, Any] = {"query": query_value}
    if details is not None:
        input_value["maximumDetails"] = details
    if comments is not None:
        input_value["comments"] = comments
    return _base(
        client_request_id,
        browser_binding_id,
        "xiaohongshu",
        "xiaohongshu.search.public_notes.v1",
        "existing_public_explore_tab",
        input_value,
    )


def xiaohongshu_account_public_notes(
    *,
    client_request_id: str,
    browser_binding_id: str,
    maximum_scrolls: int,
    execution_target: Literal[
        "existing_public_profile_tab",
        "ephemeral_public_profile_url",
        "discover_public_profile_from_note",
    ] = "existing_public_profile_tab",
    profile_url: str | None = None,
) -> Request:
    if execution_target not in {
        "existing_public_profile_tab",
        "ephemeral_public_profile_url",
        "discover_public_profile_from_note",
    }:
        raise _invalid("execution_target")
    if isinstance(maximum_scrolls, bool) or not isinstance(maximum_scrolls, int):
        raise _invalid("maximum_scrolls")
    maximum_allowed = XIAOHONGSHU_PROFILE_MAX_SCROLLS if execution_target != "existing_public_profile_tab" else 3
    if not 1 <= maximum_scrolls <= maximum_allowed:
        raise _invalid("maximum_scrolls")
    if execution_target == "ephemeral_public_profile_url":
        if profile_url is None:
            raise _invalid("profile_url")
        profile_value = _xhs_profile_url(profile_url)
    elif profile_url is not None:
        raise _invalid("profile_url")
    else:
        profile_value = None
    input_value: dict[str, Any] = {"maximumScrolls": maximum_scrolls}
    if profile_value is not None:
        input_value["profileUrl"] = profile_value
    return _base(
        client_request_id,
        browser_binding_id,
        "xiaohongshu",
        "xiaohongshu.account.public_notes.v1",
        execution_target,
        input_value,
    )


def xiaohongshu_note_public_detail(
    *,
    client_request_id: str,
    browser_binding_id: str,
    result_rank: int,
    execution_target: Literal["existing_public_search_tab", "existing_public_profile_tab"] = "existing_public_search_tab",
) -> Request:
    if isinstance(result_rank, bool) or not isinstance(result_rank, int) or not 1 <= result_rank <= 20:
        raise _invalid("result_rank")
    if execution_target not in {"existing_public_search_tab", "existing_public_profile_tab"}:
        raise _invalid("execution_target")
    return _base(
        client_request_id,
        browser_binding_id,
        "xiaohongshu",
        "xiaohongshu.note.public_detail.v1",
        execution_target,
        {"resultRank": result_rank},
    )


def xiaohongshu_note_public_comments(
    *, client_request_id: str, browser_binding_id: str, maximum_scrolls: Literal[1, 2, 3]
) -> Request:
    return _base(
        client_request_id,
        browser_binding_id,
        "xiaohongshu",
        "xiaohongshu.note.public_comments.v1",
        "existing_public_note_overlay",
        {"maximumScrolls": _small_budget(maximum_scrolls, "maximum_scrolls")},
    )


def xiaohongshu_note_public_comment_replies(
    *, client_request_id: str, browser_binding_id: str, maximum_threads: Literal[1, 2, 3]
) -> Request:
    return _base(
        client_request_id,
        browser_binding_id,
        "xiaohongshu",
        "xiaohongshu.note.public_comment_replies.v1",
        "existing_public_note_overlay",
        {"maximumThreads": _small_budget(maximum_threads, "maximum_threads")},
    )


__all__ = [
    "Request",
    "create_client_request_id",
    "bilibili_video_detail",
    "bilibili_native_search",
    "bilibili_native_search_batch",
    "bilibili_account_profile",
    "bilibili_account_inventory",
    "bilibili_dynamic",
    "bilibili_collection_series_overview",
    "bilibili_collection_series_detail",
    "bilibili_danmaku",
    "bilibili_discussion",
    "xiaohongshu_public_notes_search",
    "xiaohongshu_account_public_notes",
    "xiaohongshu_note_public_detail",
    "xiaohongshu_note_public_comments",
    "xiaohongshu_note_public_comment_replies",
]
