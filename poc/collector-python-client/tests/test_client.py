from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest

from intelligence_collector import (
    CollectorClient,
    CollectorClientError,
    artifact_path_from_operation,
    list_direct_capabilities,
)


ORIGIN = "http://127.0.0.1:43127"
BINDING_ID = "11111111-1111-4111-8111-111111111111"
OPERATION_ID = "22222222-2222-4222-8222-222222222222"
ARTIFACT_ID = "33333333-3333-4333-8333-333333333333"
TOKEN = "cst_" + "A" * 43


def operation(state: str, artifact: bool = True) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "operationId": OPERATION_ID,
        "browserBindingId": BINDING_ID,
        "platform": "xiaohongshu",
        "capability": "xiaohongshu.search.public_notes.v1",
        "executionTarget": "existing_public_explore_tab",
        "state": state,
        "queuedAt": "2026-07-30T00:00:00.000Z",
        "claimedAt": None if state == "queued" else "2026-07-30T00:00:01.000Z",
        "completedAt": None if state in {"queued", "claimed"} else "2026-07-30T00:00:02.000Z",
        "errorCode": None,
        "terminalReason": None,
        "artifact": {
            "artifactId": ARTIFACT_ID,
            "retrievalPath": f"/v1/collect/artifacts/xiaohongshu.search.public_notes.v1/{ARTIFACT_ID}",
            "summary": {"itemCount": 1},
        } if artifact else None,
    }


async def with_client(
    handler: Callable[[httpx.Request], Awaitable[httpx.Response]],
) -> tuple[CollectorClient, httpx.AsyncClient]:
    http_client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url=ORIGIN,
    )
    return CollectorClient(token=TOKEN, http_client=http_client, sleep=asyncio.sleep), http_client


@pytest.mark.asyncio
async def test_collect_and_wait_submits_once_polls_and_reads_artifact() -> None:
    calls: list[httpx.Request] = []
    states = iter(("claimed", "completed"))

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path == "/v2/collect":
            return httpx.Response(201, json={"schemaVersion": 2, "result": operation("queued")})
        if request.url.path == f"/v2/collect/operations/{OPERATION_ID}":
            return httpx.Response(200, json={"schemaVersion": 2, "result": operation(next(states))})
        if request.url.path == f"/v1/collect/artifacts/xiaohongshu.search.public_notes.v1/{ARTIFACT_ID}":
            return httpx.Response(200, json={
                "schemaVersion": 2,
                "capability": "xiaohongshu.search.public_notes.v1",
                "artifact": {"result": {"items": [{"title": "公开卡片"}]}},
            })
        raise AssertionError(f"unexpected_url:{request.url}")

    client, http_client = await with_client(handler)
    try:
        result = await client.collect_and_wait({
            "schemaVersion": 2,
            "browserBindingId": BINDING_ID,
            "platform": "xiaohongshu",
            "capability": "xiaohongshu.search.public_notes.v1",
            "executionTarget": "existing_public_explore_tab",
            "input": {"query": "人工智能"},
        })
    finally:
        await http_client.aclose()

    assert result["operation"]["state"] == "completed"
    assert result["artifact"]["artifact"]["result"]["items"][0]["title"] == "公开卡片"
    assert sum(request.url.path == "/v2/collect" for request in calls) == 1
    assert sum(request.url.path.startswith("/v2/collect/operations/") for request in calls) == 2


def test_direct_allowlist_is_detached_and_complete() -> None:
    names = list_direct_capabilities()
    assert len(names) == 15
    names.pop()
    assert len(list_direct_capabilities()) == 15


def test_artifact_path_must_match_operation_capability() -> None:
    value = operation("completed")
    value["artifact"]["retrievalPath"] = f"/v1/collect/artifacts/bilibili.video_detail/{ARTIFACT_ID}"
    assert artifact_path_from_operation(value) is None


@pytest.mark.asyncio
async def test_read_release_returns_core_compatibility_manifest() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v2/release"
        return httpx.Response(200, json={
            "schemaVersion": 1,
            "releaseVersion": "0.7.17",
            "product": "collector-core",
            "channel": "source-compatible",
            "service": {"schemaVersion": 2, "openApiVersion": "2.0.0-experimental"},
            "protocols": {},
            "boundaries": {},
        })

    client, http_client = await with_client(handler)
    try:
        manifest = await client.read_release()
    finally:
        await http_client.aclose()

    assert manifest["product"] == "collector-core"
    assert manifest["service"]["schemaVersion"] == 2


@pytest.mark.asyncio
async def test_collect_rejects_extra_control_fields_before_http() -> None:
    called = False

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(500, json={"error": "must_not_call"})

    client, http_client = await with_client(handler)
    try:
        with pytest.raises(CollectorClientError) as failure:
            await client.collect({
                "schemaVersion": 2,
                "browserBindingId": BINDING_ID,
                "platform": "xiaohongshu",
                "capability": "xiaohongshu.search.public_notes.v1",
                "executionTarget": "existing_public_explore_tab",
                "input": {"query": "x"},
                "selector": "#anything",
            })
    finally:
        await http_client.aclose()

    assert failure.value.code == "collector_client_collect_request_invalid"
    assert called is False


@pytest.mark.asyncio
async def test_wait_timeout_does_not_submit_another_operation() -> None:
    operation_reads = 0
    collect_posts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal operation_reads, collect_posts
        if request.url.path == "/v2/collect":
            collect_posts += 1
        if request.url.path == f"/v2/collect/operations/{OPERATION_ID}":
            operation_reads += 1
            return httpx.Response(200, json={"schemaVersion": 2, "result": operation("claimed", False)})
        raise AssertionError(f"unexpected_url:{request.url}")

    client, http_client = await with_client(handler)
    try:
        with pytest.raises(CollectorClientError) as failure:
            await client.wait_operation(
                OPERATION_ID,
                timeout=0.1,
                initial_delay=0.1,
                max_delay=0.1,
            )
    finally:
        await http_client.aclose()

    assert failure.value.code == "collector_client_wait_timeout"
    assert operation_reads == 1
    assert collect_posts == 0
