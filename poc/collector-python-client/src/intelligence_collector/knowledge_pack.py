"""Local, raw-first knowledge-pack orchestration for the Bilibili MVP.

This module deliberately sits above the Collector client. It does not inspect
pages, control tabs, download cookies, or call platform endpoints. It only
combines already-registered SDK capabilities and writes their detached
artifacts into a UTF-8, inspectable local directory.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Protocol
from uuid import uuid4

from .errors import CollectorClientError
from .models import CollectionResult
from .requests import (
    bilibili_account_inventory,
    bilibili_account_profile,
    bilibili_video_detail,
)


class KnowledgePackClient(Protocol):
    async def collect_and_wait_model(self, request: Mapping[str, Any]) -> CollectionResult:
        """Run one already-registered request without exposing browser details."""


@dataclass(frozen=True, slots=True)
class KnowledgePack:
    """Completed or partial local knowledge-pack handle."""

    root: Path
    manifest: dict[str, Any]

    @property
    def pack_id(self) -> str:
        return str(self.manifest["packId"])

    @property
    def state(self) -> str:
        return str(self.manifest["state"])


class KnowledgePackWriter:
    """Atomic JSON/JSONL writer for one local pack.

    The writer never accepts an absolute member path or ``..`` traversal. Every
    mutation persists the manifest, so a process interruption leaves a useful
    partial pack instead of an all-or-nothing in-memory result.
    """

    _TASK_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")

    def __init__(
        self,
        output_directory: str | Path,
        *,
        task_id: str | None = None,
        task_type: str = "bilibili.account.knowledge_pack",
    ) -> None:
        if not isinstance(task_type, str) or not task_type or len(task_type) > 120:
            raise ValueError("knowledge_pack_task_type_invalid")
        pack_id = task_id or f"pack-{uuid4()}"
        if not self._TASK_ID.fullmatch(pack_id):
            raise ValueError("knowledge_pack_task_id_invalid")
        self.root = Path(output_directory).expanduser().resolve() / pack_id
        self.root.mkdir(parents=True, exist_ok=True)
        for directory in (
            "sources/bilibili",
            "media/images",
            "media/videos",
            "media/audio",
            "derived/transcript",
            "derived/ocr",
            "derived/keyframes",
            "derived/summaries",
            "derived/entities",
            "evidence",
        ):
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        now = _now()
        self._manifest: dict[str, Any] = {
            "schemaVersion": 1,
            "packId": pack_id,
            "taskType": task_type,
            "platforms": ["bilibili"],
            "createdAt": now,
            "updatedAt": now,
            "state": "running",
            "capabilities": [],
            "coverage": {},
            "counts": {
                "collectionOperations": 0,
                "successfulOperations": 0,
                "partialOperations": 0,
                "failedOperations": 0,
                "resources": 0,
                "mediaAssets": 0,
                "processingArtifacts": 0,
            },
            "failures": [],
        }
        self._persist_manifest()

    @property
    def manifest(self) -> dict[str, Any]:
        return _clone(self._manifest)

    def write_json(self, relative_path: str, value: Any) -> Path:
        path = self._safe_path(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write(path, value)
        return path

    def append_jsonl(self, relative_path: str, value: Mapping[str, Any]) -> Path:
        path = self._safe_path(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
            stream.write("\n")
        return path

    def record_collection(self, result: CollectionResult) -> Path | None:
        """Persist one SDK result and append its provenance entry."""

        operation = result.operation
        capability = operation.capability
        self._manifest["counts"]["collectionOperations"] += 1
        if capability not in self._manifest["capabilities"]:
            self._manifest["capabilities"].append(capability)
        if operation.state == "completed":
            self._manifest["counts"]["successfulOperations"] += 1
        elif operation.state == "partial":
            self._manifest["counts"]["partialOperations"] += 1
        else:
            self._manifest["counts"]["failedOperations"] += 1
            self._manifest["failures"].append(
                {
                    "operationId": operation.operation_id,
                    "capability": capability,
                    "state": operation.state,
                    "errorCode": operation.error_code,
                    "terminalReason": operation.terminal_reason,
                }
            )
        artifact_path: Path | None = None
        if result.artifact is not None:
            artifact_id = result.artifact.artifact_id or operation.operation_id
            platform_directory = "bilibili" if capability.startswith("bilibili.") else "other"
            safe_capability = re.sub(r"[._]+", "-", capability)
            relative = f"sources/{platform_directory}/{safe_capability}/{artifact_id}.json"
            artifact_path = self.write_json(relative, result.artifact.to_dict())
            provenance = {
                "schemaVersion": 1,
                "operationId": operation.operation_id,
                "artifactId": result.artifact.artifact_id,
                "capability": capability,
                "platform": operation.platform,
                "executionTarget": operation.execution_target,
                "state": operation.state,
                "capturedAt": result.artifact.payload.get("capturedAt"),
                "artifactPath": str(artifact_path.relative_to(self.root)).replace("\\", "/"),
            }
            self.append_jsonl("evidence/provenance.jsonl", provenance)
        self._persist_manifest()
        return artifact_path

    def record_resource(self, resource: Mapping[str, Any]) -> None:
        platform = resource.get("platform")
        if not isinstance(platform, str) or not platform:
            raise ValueError("knowledge_pack_resource_platform_invalid")
        self.append_jsonl(f"sources/{platform}/resources.jsonl", resource)
        self._manifest["counts"]["resources"] += 1
        self._persist_manifest()

    def record_failure(self, code: str, *, capability: str | None = None) -> None:
        self._manifest["failures"].append(
            {"code": code, **({"capability": capability} if capability else {})}
        )
        self._persist_manifest()

    def set_source(self, source: Mapping[str, Any]) -> None:
        self._manifest["source"] = _clone(dict(source))
        self._persist_manifest()

    def set_coverage(self, coverage: Mapping[str, Any]) -> None:
        self._manifest["coverage"] = _clone(dict(coverage))
        self._persist_manifest()

    def finish(self, state: str) -> KnowledgePack:
        if state not in {"completed", "partial", "failed"}:
            raise ValueError("knowledge_pack_state_invalid")
        self._manifest["state"] = state
        self._persist_manifest()
        return KnowledgePack(self.root, self.manifest)

    def _safe_path(self, relative_path: str) -> Path:
        if not isinstance(relative_path, str) or not relative_path or Path(relative_path).is_absolute():
            raise ValueError("knowledge_pack_relative_path_invalid")
        candidate = (self.root / relative_path).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as error:
            raise ValueError("knowledge_pack_relative_path_invalid") from error
        return candidate

    def _persist_manifest(self) -> None:
        self._manifest["updatedAt"] = _now()
        _atomic_write(self.root / "manifest.json", self._manifest)


async def build_bilibili_account_knowledge_pack(
    client: KnowledgePackClient,
    *,
    browser_binding_id: str,
    canonical_profile_url: str,
    output_directory: str | Path,
    maximum_video_details: int = 1,
    task_id: str | None = None,
) -> KnowledgePack:
    """Build a bounded Bilibili profile/inventory/detail knowledge pack.

    The function submits each capability at most once. It stops after the
    first unsuccessful operation rather than guessing whether a platform
    action is safe to replay. A caller can start a new task explicitly after
    reviewing the partial pack and its failure ledger.
    """

    if (
        isinstance(maximum_video_details, bool)
        or not isinstance(maximum_video_details, int)
        or not 1 <= maximum_video_details <= 40
    ):
        raise ValueError("knowledge_pack_maximum_video_details_invalid")
    writer = KnowledgePackWriter(output_directory, task_id=task_id)
    writer.set_source({"canonicalProfileUrl": canonical_profile_url})
    requests = [
        bilibili_account_profile(
            browser_binding_id=browser_binding_id,
            canonical_profile_url=canonical_profile_url,
        ),
        bilibili_account_inventory(
            browser_binding_id=browser_binding_id,
            canonical_profile_url=canonical_profile_url,
        ),
    ]
    results: list[CollectionResult] = []
    for request in requests:
        result = await client.collect_and_wait_model(request)
        results.append(result)
        writer.record_collection(result)
        if result.artifact is not None and result.operation.capability == "bilibili.account_profile":
            writer.record_resource(_bilibili_account_resource(result, canonical_profile_url))
        if result.operation.state != "completed":
            return writer.finish("partial" if writer.manifest["counts"]["successfulOperations"] else "failed")

    inventory = results[-1]
    video_items = _inventory_items(inventory)
    writer.set_coverage(
        {
            "inventory": {
                "scope": "first_page_bounded",
                "capturedItems": len(video_items),
                "reportedPublicVideoCount": _reported_inventory_total(results[0]),
                "paginationCapability": "not_direct_ready",
                "completeness": "bounded_partial",
            },
            "videoDetails": {
                "requested": min(maximum_video_details, len(video_items)),
                "scope": "bounded_inventory_prefix",
                "completeness": "bounded_partial",
            },
        }
    )
    for item in video_items[:maximum_video_details]:
        url = item.get("canonicalVideoUrl")
        if not isinstance(url, str):
            continue
        result = await client.collect_and_wait_model(
            bilibili_video_detail(
                browser_binding_id=browser_binding_id,
                canonical_video_url=url,
            )
        )
        writer.record_collection(result)
        if result.artifact is not None:
            writer.record_resource(_bilibili_video_resource(result, item))
        if result.operation.state != "completed":
            return writer.finish("partial")
    return writer.finish("completed")


def _inventory_items(result: CollectionResult) -> list[dict[str, Any]]:
    if result.artifact is None:
        return []
    payload = result.artifact.payload
    page = payload.get("page")
    if not isinstance(page, Mapping):
        return []
    items = page.get("items")
    if not isinstance(items, list):
        return []
    return [dict(item) for item in items if isinstance(item, Mapping)]


def _bilibili_video_resource(
    result: CollectionResult, inventory_item: Mapping[str, Any]
) -> dict[str, Any]:
    payload = result.artifact.payload if result.artifact else {}
    detail = payload.get("detail") if isinstance(payload.get("detail"), Mapping) else None
    title = inventory_item.get("title")
    if detail and isinstance(detail.get("title"), str):
        title = detail["title"]
    return {
        "schemaVersion": 1,
        "resourceId": f"bilibili-video-{inventory_item.get('bvid', result.operation.operation_id)}",
        "platform": "bilibili",
        "resourceType": "video",
        "title": title if isinstance(title, str) else None,
        "bvid": inventory_item.get("bvid"),
        "canonicalVideoUrl": inventory_item.get("canonicalVideoUrl"),
        "artifactRef": {
            "operationId": result.operation.operation_id,
            "artifactId": result.artifact.artifact_id if result.artifact else None,
        },
        "rawProjection": detail if detail is not None else payload,
    }


def _bilibili_account_resource(
    result: CollectionResult, canonical_profile_url: str
) -> dict[str, Any]:
    payload = result.artifact.payload if result.artifact else {}
    snapshot = payload.get("snapshot") if isinstance(payload.get("snapshot"), Mapping) else {}
    stable_account_id = snapshot.get("stableAccountId")
    account_key = stable_account_id if isinstance(stable_account_id, str) else result.operation.operation_id
    return {
        "schemaVersion": 1,
        "resourceId": f"bilibili-account-{account_key}",
        "platform": "bilibili",
        "resourceType": "account",
        "title": snapshot.get("displayName") if isinstance(snapshot.get("displayName"), str) else None,
        "canonicalProfileUrl": canonical_profile_url,
        "artifactRef": {
            "operationId": result.operation.operation_id,
            "artifactId": result.artifact.artifact_id if result.artifact else None,
        },
        "rawProjection": snapshot,
    }


def _reported_inventory_total(result: CollectionResult) -> int | None:
    if result.artifact is None:
        return None
    payload = result.artifact.payload
    snapshot = payload.get("snapshot")
    if not isinstance(snapshot, Mapping):
        return None
    fields = snapshot.get("publicFields")
    if not isinstance(fields, list):
        return None
    for field in fields:
        if not isinstance(field, Mapping) or field.get("label") != "投稿":
            continue
        value = field.get("value")
        if not isinstance(value, str):
            continue
        digits = re.sub(r"[^0-9]", "", value)
        if digits:
            return int(digits)
    return None


def _atomic_write(path: Path, value: Any) -> None:
    temporary = path.with_name(f".{path.name}.{uuid4()}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    temporary.replace(path)


def _clone(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


__all__ = [
    "KnowledgePack",
    "KnowledgePackClient",
    "KnowledgePackWriter",
    "build_bilibili_account_knowledge_pack",
]
