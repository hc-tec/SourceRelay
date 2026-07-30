from __future__ import annotations

import re
from copy import deepcopy
from urllib.parse import urlsplit
from typing import Any, Mapping

from .constants import (
    DIRECT_CAPABILITIES,
    DIRECT_EXECUTION_TARGETS,
    NON_TERMINAL_STATES,
    TERMINAL_STATES,
)
from .errors import CollectorClientError


UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
TOKEN_PATTERN = re.compile(r"^cst_[A-Za-z0-9_-]{43}$")
SAFE_ERROR_PATTERN = re.compile(r"^[a-z0-9_.-]{1,120}$", re.IGNORECASE)
ARTIFACT_PATH_PATTERN = re.compile(
    r"^/v1/collect/artifacts/((?:bilibili\.(?:video_detail|native_search|native_search_batch|account_profile|account_inventory|dynamic|collection_series\.(?:overview|detail)|danmaku|discussion)|xiaohongshu\.(?:(?:search|account)\.public_notes|note\.public_(?:detail|comments|comment_replies))\.v1))/"
    r"([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$",
    re.IGNORECASE,
)


def validate_loopback_origin(value: str) -> str:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except (TypeError, ValueError) as exc:
        raise CollectorClientError("collector_client_origin_invalid", 400) from exc
    if (
        parsed.scheme != "http"
        or parsed.hostname != "127.0.0.1"
        or port is None
        or not 1 <= port <= 65535
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise CollectorClientError("collector_client_origin_invalid", 400)
    return f"http://127.0.0.1:{port}"


def validate_token(value: str) -> str:
    if not TOKEN_PATTERN.fullmatch(value):
        raise CollectorClientError("collector_client_token_invalid", 400)
    return value


def assert_uuid(value: str, code: str) -> None:
    if not isinstance(value, str) or UUID_PATTERN.fullmatch(value) is None:
        raise CollectorClientError(code, 400)


def validate_collect_request(value: Any) -> None:
    if not isinstance(value, Mapping):
        raise CollectorClientError("collector_client_collect_request_invalid", 400)
    expected_keys = {
        "schemaVersion",
        "browserBindingId",
        "platform",
        "capability",
        "executionTarget",
        "input",
    }
    if set(value) != expected_keys:
        raise CollectorClientError("collector_client_collect_request_invalid", 400)
    if value["schemaVersion"] != 2:
        raise CollectorClientError("collector_client_collect_request_invalid", 400)
    assert_uuid(value["browserBindingId"], "collector_client_collect_request_invalid")
    if value["platform"] not in {"bilibili", "xiaohongshu"}:
        raise CollectorClientError("collector_client_collect_request_invalid", 400)
    capability = value["capability"]
    if capability not in DIRECT_CAPABILITIES:
        raise CollectorClientError("collector_client_collect_request_invalid", 400)
    if value["platform"] == "bilibili" and not capability.startswith("bilibili."):
        raise CollectorClientError("collector_client_collect_request_invalid", 400)
    if value["platform"] == "xiaohongshu" and not capability.startswith("xiaohongshu."):
        raise CollectorClientError("collector_client_collect_request_invalid", 400)
    if value["executionTarget"] not in DIRECT_EXECUTION_TARGETS:
        raise CollectorClientError("collector_client_collect_request_invalid", 400)
    if not isinstance(value["input"], Mapping):
        raise CollectorClientError("collector_client_collect_request_invalid", 400)


def is_operation(value: Any) -> bool:
    return (
        isinstance(value, Mapping)
        and isinstance(value.get("operationId"), str)
        and UUID_PATTERN.fullmatch(value["operationId"]) is not None
        and value.get("capability") in DIRECT_CAPABILITIES
        and value.get("state") in NON_TERMINAL_STATES | TERMINAL_STATES
    )


def artifact_path_from_operation(operation: Any) -> str | None:
    if not is_operation(operation):
        return None
    artifact = operation.get("artifact")
    if not isinstance(artifact, Mapping):
        return None
    retrieval_path = artifact.get("retrievalPath")
    if not isinstance(retrieval_path, str):
        return None
    match = ARTIFACT_PATH_PATTERN.fullmatch(retrieval_path)
    if match is None or match.group(1) != operation["capability"]:
        return None
    return retrieval_path


def clone(value: Any) -> Any:
    return deepcopy(value)
