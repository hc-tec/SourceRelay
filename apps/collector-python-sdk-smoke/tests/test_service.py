from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID

import pytest

from collector_sdk_smoke.service import CollectorApplication
from intelligence_collector import CollectorClientError


class FakeCollectorClient:
    def __init__(self, capabilities: list[dict[str, Any]]) -> None:
        self._capabilities = capabilities
        self.requests: list[dict[str, Any]] = []

    async def list_capabilities(self) -> list[dict[str, Any]]:
        return self._capabilities

    async def collect_and_wait(self, request: dict[str, Any]) -> dict[str, Any]:
        self.requests.append(request)
        return {"operation": {"state": "completed"}, "artifact": {"capability": request["capability"]}}


class TypedFakeCollectorClient(FakeCollectorClient):
    async def list_browser_bindings(self) -> list[dict[str, Any]]:
        return [{"state": "online", "browserBindingId": "11111111-1111-4111-8111-111111111111"}]

    async def collect_and_wait(self, request: dict[str, Any]) -> dict[str, Any]:
        self.requests.append(request)
        operation = {
            "schemaVersion": 1,
            "operationId": "22222222-2222-4222-8222-222222222222",
            "browserBindingId": request["browserBindingId"],
            "platform": request["platform"],
            "capability": request["capability"],
            "executionTarget": request["executionTarget"],
            "state": "completed",
            "queuedAt": "2026-07-30T00:00:00Z",
            "claimedAt": "2026-07-30T00:00:00Z",
            "completedAt": "2026-07-30T00:00:01Z",
            "errorCode": None,
            "terminalReason": None,
            "artifact": {
                "artifactId": "33333333-3333-4333-8333-333333333333",
                "retrievalPath": f"/v1/collect/artifacts/{request['capability']}/33333333-3333-4333-8333-333333333333",
                "summary": {},
            },
        }
        return {
            "operation": operation,
            "artifact": {
                "schemaVersion": 2,
                "capability": request["capability"],
                "artifact": {"summary": {}, "result": {"items": []}},
            },
        }


def test_application_rejects_non_dispatchable_capability_before_collect() -> None:
    client = FakeCollectorClient([
        {
            "capability": "bilibili.transcript",
            "dispatchState": "trusted_interaction_migration_required",
        }
    ])
    app = CollectorApplication(client)  # type: ignore[arg-type]

    with pytest.raises(CollectorClientError) as failure:
        asyncio.run(app.collect({"capability": "bilibili.transcript"}))

    assert failure.value.code == "collector_app_capability_not_dispatchable"
    assert client.requests == []


def test_application_passes_only_catalog_ready_request_to_sdk() -> None:
    client = FakeCollectorClient([
        {
            "capability": "bilibili.native_search",
            "dispatchState": "direct_ready",
        }
    ])
    app = CollectorApplication(client)  # type: ignore[arg-type]
    request = {
        "schemaVersion": 3,
        "clientRequestId": "11111111-1111-4111-8111-111111111111",
        "browserBindingId": "11111111-1111-4111-8111-111111111111",
        "platform": "bilibili",
        "capability": "bilibili.native_search",
        "executionTarget": "collector_work_tab",
        "input": {"query": "DeepSeek"},
    }

    result = asyncio.run(app.collect(request))

    assert result["operation"]["state"] == "completed"
    assert client.requests == [request]


def test_typed_bilibili_search_uses_online_binding_and_structured_result() -> None:
    client = TypedFakeCollectorClient([])
    app = CollectorApplication(client)  # type: ignore[arg-type]

    result = asyncio.run(app.bilibili_search("  Deep\nSeek  "))

    assert result.succeeded is True
    assert result.operation.capability == "bilibili.native_search"
    assert result.result == {"items": []}
    assert client.requests[0]["input"] == {"query": "Deep Seek"}
    assert client.requests[0]["browserBindingId"] == "11111111-1111-4111-8111-111111111111"
    assert UUID(client.requests[0]["clientRequestId"]).version == 4


def test_typed_xiaohongshu_search_uses_explicit_binding_and_bounded_enrichment() -> None:
    client = TypedFakeCollectorClient([])
    app = CollectorApplication(client)  # type: ignore[arg-type]
    binding_id = "44444444-4444-4444-8444-444444444444"

    result = asyncio.run(app.xiaohongshu_search(
        "public notes",
        browser_binding_id=binding_id,
        maximum_details=3,
        comments_maximum_scrolls=2,
        replies_maximum_threads=1,
    ))

    assert result.succeeded is True
    assert result.operation.capability == "xiaohongshu.search.public_notes.v1"
    assert result.result == {"items": []}
    request = client.requests[0]
    assert request["browserBindingId"] == binding_id
    assert UUID(request["clientRequestId"]).version == 4
    assert request["input"] == {
        "query": "public notes",
        "maximumDetails": 3,
        "comments": {
            "maximumScrolls": 2,
            "replies": {"maximumThreads": 1},
        },
    }
