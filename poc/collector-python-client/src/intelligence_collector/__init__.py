from .client import CollectorClient
from .constants import CORE_RELEASE_VERSION, DIRECT_CAPABILITY_NAMES
from .errors import CollectorClientError
from .models import Artifact, ArtifactReference, CollectionResult, Operation
from .requests import (
    bilibili_account_inventory,
    bilibili_account_profile,
    bilibili_collection_series_detail,
    bilibili_collection_series_overview,
    bilibili_danmaku,
    bilibili_discussion,
    bilibili_dynamic,
    bilibili_native_search,
    bilibili_native_search_batch,
    bilibili_video_detail,
    xiaohongshu_account_public_notes,
    xiaohongshu_note_public_comment_replies,
    xiaohongshu_note_public_comments,
    xiaohongshu_note_public_detail,
    xiaohongshu_public_notes_search,
)
from .validation import artifact_path_from_operation


def list_direct_capabilities() -> list[str]:
    """Return a detached copy of the SDK's direct capability allowlist."""

    return list(DIRECT_CAPABILITY_NAMES)


__all__ = [
    "CollectorClient",
    "CORE_RELEASE_VERSION",
    "CollectorClientError",
    "Operation",
    "ArtifactReference",
    "Artifact",
    "CollectionResult",
    "artifact_path_from_operation",
    "list_direct_capabilities",
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
