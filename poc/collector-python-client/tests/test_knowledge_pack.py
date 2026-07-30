from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from intelligence_collector import (
    CollectionResult,
    KnowledgePackWriter,
    build_bilibili_account_knowledge_pack,
)


BINDING_ID = "11111111-1111-4111-8111-111111111111"
PROFILE_URL = "https://space.bilibili.com/7481602"
VIDEO_URL = "https://www.bilibili.com/video/BV1qZSLBYEpa"


def _collection(
    *, capability: str, operation_id: str, payload: dict[str, Any], state: str = "completed"
) -> CollectionResult:
    operation = {
        "schemaVersion": 1,
        "operationId": operation_id,
        "browserBindingId": BINDING_ID,
        "platform": "bilibili",
        "capability": capability,
        "executionTarget": "collector_work_tab",
        "state": state,
        "queuedAt": "2026-07-30T00:00:00.000Z",
        "claimedAt": "2026-07-30T00:00:01.000Z",
        "completedAt": "2026-07-30T00:00:02.000Z",
        "errorCode": None if state == "completed" else "source_unavailable",
        "terminalReason": "detail_ready" if state == "completed" else "source_unavailable",
        "artifact": {
            "artifactId": f"{operation_id[:8]}-3333-4333-8333-333333333333",
            "retrievalPath": f"/v1/collect/artifacts/{capability}/{operation_id[:8]}-3333-4333-8333-333333333333",
            "summary": {"capability": capability},
        },
    }
    return CollectionResult.from_mapping(
        {
            "operation": operation,
            "artifact": {
                "schemaVersion": 2,
                "capability": capability,
                "artifact": {"capturedAt": "2026-07-30T00:00:02.000Z", **payload},
            },
        }
    )


class FakeCollector:
    def __init__(self, results: list[CollectionResult]) -> None:
        self.results = iter(results)
        self.requests: list[dict[str, Any]] = []

    async def collect_and_wait_model(self, request: dict[str, Any]) -> CollectionResult:
        self.requests.append(request)
        return next(self.results)


def _results() -> list[CollectionResult]:
    return [
        _collection(
            capability="bilibili.account_profile",
            operation_id="22222222-2222-4222-8222-222222222222",
            payload={"snapshot": {"stableAccountId": "7481602", "displayName": "测试 UP 主"}},
        ),
        _collection(
            capability="bilibili.account_inventory",
            operation_id="33333333-3333-4333-8333-333333333333",
            payload={
                "page": {
                    "items": [
                        {
                            "bvid": "BV1qZSLBYEpa",
                            "canonicalVideoUrl": VIDEO_URL,
                            "title": "第一条视频",
                            "visibleText": "第一条视频",
                        }
                    ]
                }
            },
        ),
        _collection(
            capability="bilibili.video_detail",
            operation_id="44444444-4444-4444-8444-444444444444",
            payload={"detail": {"bvid": "BV1qZSLBYEpa", "title": "第一条视频详情"}},
        ),
    ]


def test_writer_rejects_traversal_and_writes_utf8(tmp_path: Path) -> None:
    writer = KnowledgePackWriter(tmp_path, task_id="pack-test")
    with pytest.raises(ValueError, match="relative_path"):
        writer.write_json("../outside.json", {})
    path = writer.write_json("sources/bilibili/测试.json", {"标题": "中文"})
    assert json.loads(path.read_text(encoding="utf-8"))["标题"] == "中文"


def test_bilibili_pack_keeps_raw_artifacts_and_provenance(tmp_path: Path) -> None:
    fake = FakeCollector(_results())
    pack = asyncio.run(
        build_bilibili_account_knowledge_pack(
            fake,
            browser_binding_id=BINDING_ID,
            canonical_profile_url=PROFILE_URL,
            output_directory=tmp_path,
            maximum_video_details=1,
            task_id="pack-bilibili",
        )
    )

    assert pack.state == "completed"
    assert [request["capability"] for request in fake.requests] == [
        "bilibili.account_profile",
        "bilibili.account_inventory",
        "bilibili.video_detail",
    ]
    manifest = json.loads((pack.root / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["counts"] == {
        "collectionOperations": 3,
        "successfulOperations": 3,
        "partialOperations": 0,
        "failedOperations": 0,
        "resources": 2,
        "mediaAssets": 0,
        "processingArtifacts": 0,
    }
    assert manifest["coverage"]["inventory"] == {
        "scope": "first_page_bounded",
        "capturedItems": 1,
        "reportedPublicVideoCount": None,
        "paginationCapability": "not_direct_ready",
        "completeness": "bounded_partial",
    }
    resource_lines = (pack.root / "sources/bilibili/resources.jsonl").read_text(encoding="utf-8").splitlines()
    resources = [json.loads(line) for line in resource_lines]
    assert {resource["resourceType"] for resource in resources} == {"account", "video"}
    assert next(resource for resource in resources if resource["resourceType"] == "video")["title"] == "第一条视频详情"
    provenance_lines = (pack.root / "evidence/provenance.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(provenance_lines) == 3
    assert json.loads(provenance_lines[-1])["capability"] == "bilibili.video_detail"
    assert (pack.root / "sources/bilibili/bilibili-video-detail/44444444-4444-4444-8444-444444444444.json").exists()


def test_bilibili_pack_stops_once_and_preserves_partial_state(tmp_path: Path) -> None:
    results = _results()
    failed = _collection(
        capability="bilibili.account_inventory",
        operation_id="55555555-5555-4555-8555-555555555555",
        payload={"page": None},
        state="failed",
    )
    fake = FakeCollector([results[0], failed])
    pack = asyncio.run(
        build_bilibili_account_knowledge_pack(
            fake,
            browser_binding_id=BINDING_ID,
            canonical_profile_url=PROFILE_URL,
            output_directory=tmp_path,
            task_id="pack-partial",
        )
    )

    assert pack.state == "partial"
    assert len(fake.requests) == 2
    assert pack.manifest["counts"]["successfulOperations"] == 1
    assert pack.manifest["counts"]["partialOperations"] == 0
    assert pack.manifest["counts"]["failedOperations"] == 1
    assert pack.manifest["failures"][0]["errorCode"] == "source_unavailable"
