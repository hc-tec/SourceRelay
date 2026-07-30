from __future__ import annotations

import asyncio
from typing import Any

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
    request = {"capability": "bilibili.native_search", "input": {"query": "DeepSeek"}}

    result = asyncio.run(app.collect(request))

    assert result["operation"]["state"] == "completed"
    assert client.requests == [request]
