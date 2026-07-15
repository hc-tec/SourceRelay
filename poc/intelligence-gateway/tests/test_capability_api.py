from dataclasses import replace

import httpx
import pytest

from app.config import Settings
from app.errors import SourceUnavailableError
from app.main import create_app
from app.models import ResultStatus, SearchItem, SearchResponse


def _response(source, query: str) -> SearchResponse:
    return SearchResponse(
        ok=True,
        status=ResultStatus.SUCCESS,
        source=source,
        query=query,
        duration_ms=5,
        item_count=1,
        items=[
            SearchItem(
                source=source,
                query=query,
                rank=1,
                title="结果",
                url="https://example.com/result",
                collector="fake",
            )
        ],
    )


@pytest.mark.asyncio
async def test_capabilities_and_task_plan_are_discoverable(tmp_path) -> None:
    app = create_app(
        replace(
            Settings.from_env(),
            database_path=tmp_path / "gateway.db",
            runtime_dir=tmp_path / "runtime",
        )
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        capabilities = await client.get("/capabilities")
        plan = await client.post(
            "/tasks/plan",
            json={
                "platform": "zhihu",
                "action": "keyword_search",
                "input": {"query": "低空经济"},
            },
        )
        article_check = await client.post(
            "/capabilities/web.article_extract.trafilatura.v1/check"
        )

    assert capabilities.status_code == 200
    assert capabilities.json()["count"] == 4
    assert plan.json()["degraded"] is True
    assert plan.json()["effective_input"]["site"] == "zhihu.com"
    assert article_check.json()["ready"] is True


@pytest.mark.asyncio
async def test_generic_task_executes_direct_capability(tmp_path) -> None:
    app = create_app(replace(Settings.from_env(), database_path=tmp_path / "gateway.db"))

    async def fake_search(request):
        return _response(request.source, request.query)

    app.state.registry.search = fake_search
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/tasks/execute",
            json={
                "platform": "web",
                "action": "keyword_search",
                "input": {"query": "测试", "limit": 5},
                "options": {"persistence": "none"},
            },
        )

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert body["executed_capability_id"] == "web.keyword_search.searxng.v1"
    assert body["degraded"] is False
    assert body["result"]["item_count"] == 1


@pytest.mark.asyncio
async def test_failed_platform_adapter_falls_back_to_external_discovery(tmp_path) -> None:
    app = create_app(replace(Settings.from_env(), database_path=tmp_path / "gateway.db"))

    async def fake_search(request):
        if request.source.value == "xiaohongshu":
            raise SourceUnavailableError("Browser adapter unavailable")
        assert request.source.value == "web"
        assert request.site == "xiaohongshu.com"
        return _response(request.source, request.query)

    app.state.registry.search = fake_search
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/tasks/execute",
            json={
                "platform": "xiaohongshu",
                "action": "keyword_search",
                "input": {"query": "测试"},
                "options": {"persistence": "none", "allow_fallback": True},
            },
        )

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert body["degraded"] is True
    assert body["executed_capability_id"] == "web.keyword_search.searxng.v1"
    assert body["attempted_capabilities"] == [
        "xiaohongshu.keyword_search.browserwing.v1",
        "web.keyword_search.searxng.v1",
    ]
    assert any("source_unavailable" in warning for warning in body["warnings"])


@pytest.mark.asyncio
async def test_task_input_validation_is_structured(tmp_path) -> None:
    app = create_app(replace(Settings.from_env(), database_path=tmp_path / "gateway.db"))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/tasks/execute",
            json={"platform": "web", "action": "keyword_search", "input": {}},
        )
    assert response.status_code == 422
    assert response.json()["status"] == "error"
