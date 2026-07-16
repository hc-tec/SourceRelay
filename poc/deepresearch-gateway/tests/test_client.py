from __future__ import annotations

import httpx
import pytest

from deepresearch_gateway.client import GatewayClient


@pytest.mark.asyncio
async def test_search_always_uses_gateway_and_none_persistence() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "task_id": "task-1",
                "ok": True,
                "status": "success",
                "requested_platform": "zhihu",
                "requested_action": "keyword_search",
                "executed_capability_id": "zhihu.keyword_search.browserwing.v1",
                "attempted_capabilities": ["zhihu.keyword_search.browserwing.v1"],
                "degraded": False,
                "result": {"items": [{"url": "https://www.zhihu.com/question/1"}]},
                "warnings": [],
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://gateway.test") as http_client:
        client = GatewayClient("http://gateway.test", client=http_client)
        result = await client.search(query="个人知识库", platform="zhihu", limit=5, site="zhihu.com")

    assert result.ok is True
    assert result.status == "success"
    body = requests[0].read().decode("utf-8")
    assert requests[0].url.path == "/tasks/execute"
    assert '"persistence":"none"' in body
    assert '"platform":"zhihu"' in body
    assert '"site":"zhihu.com"' in body
    assert "tavily" not in body.casefold()
    assert result.to_dict()["executed_capability_id"] == "zhihu.keyword_search.browserwing.v1"


@pytest.mark.asyncio
async def test_http_error_preserves_gateway_status_and_capability_chain() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            503,
            json={
                "ok": False,
                "status": "source_unavailable",
                "error": "SearXNG unavailable",
                "attempted_capabilities": ["web.keyword_search.searxng.v1"],
                "executed_capability_id": "web.keyword_search.searxng.v1",
                "degraded": False,
                "warnings": ["No external provider was called by the adapter."],
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://gateway.test") as http_client:
        client = GatewayClient("http://gateway.test", client=http_client)
        result = await client.search(query="测试")

    assert result.ok is False
    assert result.status == "source_unavailable"
    assert result.http_status == 503
    assert result.to_dict()["attempted_capabilities"] == ["web.keyword_search.searxng.v1"]
    assert result.to_dict()["warnings"]


@pytest.mark.asyncio
async def test_transport_failure_is_not_reported_as_no_results() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("gateway down")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://gateway.test") as http_client:
        client = GatewayClient("http://gateway.test", client=http_client)
        result = await client.search(query="测试")

    assert result.ok is False
    assert result.status == "source_unavailable"
    assert result.transport_error is not None
    assert result.to_dict()["status"] != "no_results"


@pytest.mark.asyncio
async def test_combined_search_hotlist_and_detail_share_gateway_only_transport() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/capabilities":
            return httpx.Response(200, json={"count": 0, "capabilities": []})
        return httpx.Response(200, json={"ok": True, "status": "success", "warnings": [], "result": {}})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://gateway.test") as http_client:
        client = GatewayClient("http://gateway.test", client=http_client)
        await client.search_and_fetch(query="主题", platform="web")
        await client.hotlist(platform="bilibili", feed_id="bilibili-hot-video")
        await client.fetch_detail(
            platform="bilibili",
            action="video_detail",
            input={"url": "https://www.bilibili.com/video/BV1XTNR69Etx"},
        )

    assert [request.url.path for request in requests] == [
        "/tasks/search-and-fetch",
        "/tasks/execute",
        "/tasks/execute",
    ]
    for request in requests[1:]:
        assert '"persistence":"none"' in request.read().decode("utf-8")
    assert '"persistence":"none"' in requests[0].read().decode("utf-8")
