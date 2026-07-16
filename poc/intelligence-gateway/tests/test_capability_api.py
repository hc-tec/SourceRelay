from dataclasses import replace

import httpx
import pytest

from app.config import Settings
from app.errors import SourceUnavailableError
from app.main import create_app
from app.models import (
    CapabilityManifest,
    CapabilityStatus,
    ResultStatus,
    SearchItem,
    SearchResponse,
)


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


def _install_bing_recipe(app) -> CapabilityManifest:
    base = app.state.capabilities.get("web.keyword_search.searxng.v1")
    bing = CapabilityManifest.model_validate(
        {
            **base.model_dump(mode="json"),
            "capability_id": "bing.keyword_search.browserwing_recipe.v1",
            "platform": "bing",
            "status": CapabilityStatus.VERIFIED,
            "executor": "browserwing_recipe",
            "adapter": "GeneratedBrowserWingRecipe",
            "source": None,
            "authentication": {"required": False, "mode": "none"},
            "fallback_ids": ["web.keyword_search.searxng.v1"],
            "fallback_site": None,
            "recipe": {
                "start_url": "https://www.bing.com/",
                "input_selector": "#sb_form_q",
                "submit_selector": "",
                "result_item_selector": "h2",
                "expected_host": "www.bing.com",
            },
        }
    )
    app.state.capabilities.save_runtime_manifest(bing)
    return bing


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
    assert capabilities.json()["count"] == 20
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
async def test_searxng_no_results_falls_back_to_site_scoped_bing_recipe(
    tmp_path,
) -> None:
    settings = replace(
        Settings.from_env(),
        database_path=tmp_path / "gateway.db",
        runtime_dir=tmp_path / "runtime",
    )
    app = create_app(settings)
    bing = _install_bing_recipe(app)

    async def no_searxng_results(request):
        assert request.site == "zhihu.com"
        return SearchResponse(
            ok=False,
            status=ResultStatus.NO_RESULTS,
            source=request.source,
            query=request.query,
            duration_ms=4,
            partial=True,
            item_count=0,
            error="All upstream engines were unavailable.",
        )

    async def bing_recipe(_recipe, query, limit=20):
        assert query == "site:zhihu.com 个人知识库"
        return {
            "validation": {"passed": True, "issues": []},
            "items": [
                {
                    "title": "如何搭建个人知识库 - 知乎",
                    "url": "https://www.zhihu.com/question/1",
                    "text": "个人知识库实践",
                }
            ][:limit],
        }

    app.state.registry.search = no_searxng_results
    app.state.draft_explorer.execute_recipe = bing_recipe
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/tasks/execute",
            json={
                "platform": "zhihu",
                "action": "keyword_search",
                "input": {"query": "个人知识库", "limit": 5},
                "options": {
                    "persistence": "none",
                    "allow_fallback": True,
                    "fallback_on_no_results": True,
                },
            },
        )

    body = response.json()
    assert response.status_code == 200
    assert body["executed_capability_id"] == bing.capability_id
    assert body["attempted_capabilities"] == [
        "web.keyword_search.searxng.v1",
        bing.capability_id,
    ]
    assert body["degraded"] is True
    assert body["result"]["query"] == "个人知识库"
    assert body["result"]["items"][0]["query"] == "个人知识库"
    assert any("site:zhihu.com" in item for item in body["result"]["warnings"])


@pytest.mark.asyncio
async def test_all_search_failures_report_the_attempted_capability_chain(
    tmp_path,
) -> None:
    settings = replace(
        Settings.from_env(),
        database_path=tmp_path / "gateway.db",
        runtime_dir=tmp_path / "runtime",
    )
    app = create_app(settings)
    bing = _install_bing_recipe(app)

    async def no_searxng_results(request):
        return SearchResponse(
            ok=False,
            status=ResultStatus.NO_RESULTS,
            source=request.source,
            query=request.query,
            duration_ms=4,
            partial=True,
            item_count=0,
            error="No upstream results.",
        )

    async def unavailable_bing(_recipe, _query, limit=20):
        raise SourceUnavailableError("Bing browser recipe unavailable.")

    app.state.registry.search = no_searxng_results
    app.state.draft_explorer.execute_recipe = unavailable_bing
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/tasks/execute",
            json={
                "platform": "web",
                "action": "keyword_search",
                "input": {"query": "测试", "limit": 5},
                "options": {
                    "persistence": "none",
                    "allow_fallback": True,
                    "fallback_on_no_results": True,
                },
            },
        )

    body = response.json()
    assert response.status_code == 503
    assert body["attempted_capabilities"] == [
        "web.keyword_search.searxng.v1",
        bing.capability_id,
    ]
    assert body["executed_capability_id"] == bing.capability_id
    assert body["degraded"] is True


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
