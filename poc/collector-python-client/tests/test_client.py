from __future__ import annotations

import asyncio
import json
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
CLIENT_REQUEST_ID = "44444444-4444-4444-8444-444444444444"
TOKEN = "cst_" + "A" * 43
DIGEST = "sha256:" + "a" * 64


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
            return httpx.Response(201, json={
                "schemaVersion": 3,
                "clientRequestId": CLIENT_REQUEST_ID,
                "idempotentReplay": False,
                "result": operation("queued"),
            })
        if request.url.path == f"/v2/collect/operations/{OPERATION_ID}":
            return httpx.Response(200, json={"schemaVersion": 3, "result": operation(next(states))})
        if request.url.path == f"/v1/collect/artifacts/xiaohongshu.search.public_notes.v1/{ARTIFACT_ID}":
            return httpx.Response(200, json={
                "schemaVersion": 3,
                "capability": "xiaohongshu.search.public_notes.v1",
                "artifact": {"result": {"items": [{"title": "公开卡片"}]}},
            })
        raise AssertionError(f"unexpected_url:{request.url}")

    client, http_client = await with_client(handler)
    try:
        result = await client.collect_and_wait({
            "schemaVersion": 3,
            "clientRequestId": CLIENT_REQUEST_ID,
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
    submission = next(request for request in calls if request.url.path == "/v2/collect")
    assert json.loads(submission.content)["clientRequestId"] == CLIENT_REQUEST_ID


def test_direct_allowlist_is_detached_and_complete() -> None:
    names = list_direct_capabilities()
    assert len(names) == 18
    names.pop()
    assert len(list_direct_capabilities()) == 18


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
            "service": {"schemaVersion": 3, "openApiVersion": "3.0.0-experimental"},
            "protocols": {},
            "boundaries": {},
            "compatibility": {
                "schemaVersion": 1,
                "digestAlgorithm": "sha256-canonical-json-v1",
                "openApiSchemaDigest": DIGEST,
                "capabilityCatalogDigest": DIGEST,
                "features": ["collect.client_request_id.v1"],
            },
        })

    client, http_client = await with_client(handler)
    try:
        manifest = await client.read_release()
    finally:
        await http_client.aclose()

    assert manifest["product"] == "collector-core"
    assert manifest["service"]["schemaVersion"] == 3


@pytest.mark.asyncio
async def test_read_release_rejects_gateway_outside_sdk_compatibility_anchor() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"product": "collector-core", "releaseVersion": "0.7.16"})

    client, http_client = await with_client(handler)
    try:
        with pytest.raises(CollectorClientError) as failure:
            await client.read_release()
    finally:
        await http_client.aclose()
    assert failure.value.code == "collector_client_release_manifest_invalid"


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
                "schemaVersion": 3,
                "clientRequestId": CLIENT_REQUEST_ID,
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
            return httpx.Response(200, json={"schemaVersion": 3, "result": operation("claimed", False)})
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


@pytest.mark.asyncio
async def test_capability_catalog_and_bounded_artifact_resources_use_v3_routes() -> None:
    seen: list[httpx.Request] = []
    metadata = {
        "schemaVersion": 1,
        "artifactId": ARTIFACT_ID,
        "operationId": OPERATION_ID,
        "capability": "xiaohongshu.search.public_notes.v1",
        "mediaType": "application/json",
        "representation": "canonical_json_utf8",
        "byteLength": 2,
        "sha256": DIGEST,
        "capturedAt": "2026-08-03T00:00:00.000Z",
        "terminalStatus": "completed",
        "retentionClass": "core_managed_local",
        "retainedUntil": None,
        "deletionState": "retained",
        "available": True,
    }
    window = {
        "schemaVersion": 1,
        "artifactId": ARTIFACT_ID,
        "capability": "xiaohongshu.search.public_notes.v1",
        "representation": "canonical_json_utf8",
        "encoding": "utf-8",
        "offset": 0,
        "endExclusive": 2,
        "byteLength": 2,
        "maximumBytes": 16_384,
        "nextOffset": None,
        "truncated": False,
        "sha256": DIGEST,
        "chunkSha256": DIGEST,
        "text": "{}",
    }

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/v2/capabilities":
            return httpx.Response(200, json={
                "schemaVersion": 3,
                "catalogDigest": DIGEST,
                "capabilities": [],
                "directContracts": [],
            })
        if request.url.path == f"/v2/collect/artifacts/{ARTIFACT_ID}":
            return httpx.Response(200, json={"schemaVersion": 3, "metadata": metadata})
        if request.url.path == f"/v2/collect/artifacts/{ARTIFACT_ID}/content":
            assert dict(request.url.params) == {"offset": "0", "maxBytes": "16384"}
            return httpx.Response(200, json={"schemaVersion": 3, "window": window})
        raise AssertionError(f"unexpected_url:{request.url}")

    client, http_client = await with_client(handler)
    try:
        catalog = await client.read_capability_catalog()
        capabilities = await client.list_capabilities()
        actual_metadata = await client.read_artifact_metadata(ARTIFACT_ID)
        actual_window = await client.read_artifact_content_window(ARTIFACT_ID)
    finally:
        await http_client.aclose()

    assert catalog["catalogDigest"] == DIGEST
    assert capabilities == []
    assert actual_metadata == metadata
    assert actual_window == window
    assert sum(request.url.path == "/v2/capabilities" for request in seen) == 2


@pytest.mark.asyncio
async def test_capability_catalog_preserves_official_provider_runtime_readiness() -> None:
    capability = {
        "schemaVersion": 1,
        "capability": "zhihu.search.public_content.v1",
        "platform": "zhihu",
        "dispatchState": "direct_ready",
        "runtimeState": "credential_required",
        "credentialLocation": "gateway_only",
    }

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v2/capabilities":
            return httpx.Response(
                200,
                json={
                    "schemaVersion": 3,
                    "catalogDigest": DIGEST,
                    "capabilities": [capability],
                    "directContracts": [],
                },
            )
        raise AssertionError(f"unexpected_url:{request.url}")

    client, http_client = await with_client(handler)
    try:
        catalog = await client.read_capability_catalog()
    finally:
        await http_client.aclose()

    assert catalog["catalogDigest"] == DIGEST
    assert catalog["capabilities"] == [capability]
    assert catalog["capabilities"][0]["runtimeState"] == "credential_required"
    assert catalog["capabilities"][0]["credentialLocation"] == "gateway_only"
