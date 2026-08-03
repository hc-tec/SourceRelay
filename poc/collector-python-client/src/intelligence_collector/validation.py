from __future__ import annotations

import re
from copy import deepcopy
from urllib.parse import urlsplit
from typing import Any, Mapping

from .constants import (
    CORE_SERVICE_SCHEMA_VERSION,
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
DIGEST_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")
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
        "clientRequestId",
        "browserBindingId",
        "platform",
        "capability",
        "executionTarget",
        "input",
    }
    if set(value) != expected_keys:
        raise CollectorClientError("collector_client_collect_request_invalid", 400)
    if value["schemaVersion"] != CORE_SERVICE_SCHEMA_VERSION:
        raise CollectorClientError("collector_client_collect_request_invalid", 400)
    assert_uuid(value["clientRequestId"], "collector_client_collect_request_invalid")
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


def is_artifact_metadata(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    operation_id = value.get("operationId")
    byte_length = value.get("byteLength")
    terminal_status = value.get("terminalStatus")
    captured_at = value.get("capturedAt")
    return (
        value.get("schemaVersion") == 1
        and isinstance(value.get("artifactId"), str)
        and UUID_PATTERN.fullmatch(value["artifactId"]) is not None
        and (
            operation_id is None
            or (isinstance(operation_id, str) and UUID_PATTERN.fullmatch(operation_id) is not None)
        )
        and value.get("capability") in DIRECT_CAPABILITIES
        and value.get("mediaType") == "application/json"
        and value.get("representation") == "canonical_json_utf8"
        and _is_safe_integer(byte_length, minimum=0)
        and isinstance(value.get("sha256"), str)
        and DIGEST_PATTERN.fullmatch(value["sha256"]) is not None
        and (captured_at is None or isinstance(captured_at, str))
        and (
            terminal_status is None
            or (isinstance(terminal_status, str) and SAFE_ERROR_PATTERN.fullmatch(terminal_status) is not None)
        )
        and value.get("retentionClass") == "core_managed_local"
        and value.get("retainedUntil") is None
        and value.get("deletionState") == "retained"
        and value.get("available") is True
    )


def is_artifact_content_window(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    offset = value.get("offset")
    end_exclusive = value.get("endExclusive")
    byte_length = value.get("byteLength")
    maximum_bytes = value.get("maximumBytes")
    next_offset = value.get("nextOffset")
    text = value.get("text")
    return (
        value.get("schemaVersion") == 1
        and isinstance(value.get("artifactId"), str)
        and UUID_PATTERN.fullmatch(value["artifactId"]) is not None
        and value.get("capability") in DIRECT_CAPABILITIES
        and value.get("representation") == "canonical_json_utf8"
        and value.get("encoding") == "utf-8"
        and _is_safe_integer(offset, minimum=0)
        and _is_safe_integer(end_exclusive, minimum=offset)
        and _is_safe_integer(byte_length, minimum=end_exclusive)
        and _is_safe_integer(maximum_bytes, minimum=1, maximum=65_536)
        and (
            next_offset is None
            or (_is_safe_integer(next_offset, minimum=end_exclusive) and next_offset == end_exclusive)
        )
        and isinstance(value.get("truncated"), bool)
        and value["truncated"] == (next_offset is not None)
        and isinstance(value.get("sha256"), str)
        and DIGEST_PATTERN.fullmatch(value["sha256"]) is not None
        and isinstance(value.get("chunkSha256"), str)
        and DIGEST_PATTERN.fullmatch(value["chunkSha256"]) is not None
        and isinstance(text, str)
        and len(text.encode("utf-8")) <= maximum_bytes
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


def _is_safe_integer(value: Any, *, minimum: int, maximum: int = 9_007_199_254_740_991) -> bool:
    return not isinstance(value, bool) and isinstance(value, int) and minimum <= value <= maximum
