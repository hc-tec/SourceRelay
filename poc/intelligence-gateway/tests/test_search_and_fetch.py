from dataclasses import replace

import httpx
import pytest

from app.config import Settings
from app.errors import SourceUnavailableError
from app.main import create_app
from app.models import (
    ArticleResult,
    FetchResponse,
    ResultStatus,
    SearchItem,
    SearchResponse,
)


def _settings(tmp_path):
    return replace(
        Settings.from_env(),
        database_path=tmp_path / "gateway.db",
        runtime_dir=tmp_path / "runtime",
    )


def _search_response(request, urls):
    items = [
        SearchItem(
            source=request.source,
            query=request.query,
            rank=index,
            title=f"Result {index}",
            url=url,
            collector="fake-search",
        )
        for index, url in enumerate(urls, start=1)
    ]
    return SearchResponse(
        ok=True,
        status=ResultStatus.SUCCESS,
        source=request.source,
        query=request.query,
        duration_ms=5,
        item_count=len(items),
        items=items,
    )


@pytest.mark.asyncio
async def test_search_and_fetch_returns_partial_detail_results_without_persistence(
    tmp_path,
) -> None:
    app = create_app(_settings(tmp_path))

    async def search(request):
        return _search_response(
            request,
            ["https://example.com/one", "https://example.com/two"],
        )

    async def fetch(request):
        if str(request.url).endswith("/two"):
            raise SourceUnavailableError("Second article was unavailable.")
        return FetchResponse(
            ok=True,
            status=ResultStatus.SUCCESS,
            duration_ms=12,
            article=ArticleResult(
                url=str(request.url),
                final_url=str(request.url),
                title="Readable article",
                text="A" * 300,
            ),
        )

    app.state.registry.search = search
    app.state.registry.fetch = fetch
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/tasks/search-and-fetch",
            json={
                "platform": "web",
                "query": "public intelligence",
                "search_limit": 5,
                "detail_limit": 2,
            },
        )
        stats = await client.get("/library/stats")

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert body["status"] == "success"
    assert body["search"]["executed_capability_id"] == "web.keyword_search.searxng.v1"
    assert body["attempted_detail_count"] == 2
    assert body["successful_detail_count"] == 1
    assert body["failed_detail_count"] == 1
    assert body["partial"] is True
    assert body["items"][0]["article"]["title"] == "Readable article"
    assert body["items"][1]["status"] == "source_unavailable"
    assert stats.json()["document_count"] == 0
    assert stats.json()["search_run_count"] == 0


@pytest.mark.asyncio
async def test_search_and_fetch_rejects_private_result_url_per_item(tmp_path) -> None:
    app = create_app(_settings(tmp_path))

    async def search(request):
        return _search_response(request, ["http://127.0.0.1/private"])

    app.state.registry.search = search
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/tasks/search-and-fetch",
            json={
                "platform": "web",
                "query": "private target",
                "detail_limit": 1,
            },
        )

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is False
    assert body["status"] == "no_results"
    assert body["attempted_detail_count"] == 1
    assert body["failed_detail_count"] == 1
    assert body["items"][0]["status"] == "error"
    assert "non-public" in body["items"][0]["error"]


@pytest.mark.asyncio
async def test_search_and_fetch_reports_when_search_items_have_no_urls(tmp_path) -> None:
    app = create_app(_settings(tmp_path))

    async def search(request):
        return _search_response(request, [""])

    app.state.registry.search = search
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/tasks/search-and-fetch",
            json={
                "platform": "web",
                "query": "missing URLs",
                "detail_limit": 2,
            },
        )

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is False
    assert body["status"] == "no_results"
    assert body["attempted_detail_count"] == 0
    assert body["items"] == []
    assert any("0 unique HTTP(S)" in warning for warning in body["warnings"])


@pytest.mark.asyncio
async def test_search_and_fetch_limits_detail_fanout(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/tasks/search-and-fetch",
            json={
                "platform": "web",
                "query": "too many",
                "detail_limit": 6,
            },
        )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_detail_fetch_is_directly_executable_as_a_capability(tmp_path) -> None:
    app = create_app(_settings(tmp_path))

    async def fetch(request):
        return FetchResponse(
            ok=True,
            status=ResultStatus.SUCCESS,
            duration_ms=9,
            article=ArticleResult(
                url=str(request.url),
                final_url=str(request.url),
                title="Direct detail",
                text="D" * 300,
            ),
        )

    app.state.registry.fetch = fetch
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/tasks/execute",
            json={
                "platform": "web",
                "action": "detail_fetch",
                "input": {"url": "https://example.com/article"},
                "options": {"persistence": "none"},
            },
        )

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert body["executed_capability_id"] == "web.detail_fetch.trafilatura.v1"
    assert body["result"]["article"]["title"] == "Direct detail"


@pytest.mark.asyncio
async def test_detail_fetch_capability_verify_handles_article_warnings(tmp_path) -> None:
    app = create_app(_settings(tmp_path))

    async def fetch(request):
        return FetchResponse(
            ok=True,
            status=ResultStatus.SUCCESS,
            duration_ms=9,
            article=ArticleResult(
                url=str(request.url),
                final_url=str(request.url),
                title="Verified detail",
                text="V" * 300,
                warnings=["public HTML only"],
            ),
        )

    app.state.registry.fetch = fetch
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/capabilities/web.detail_fetch.trafilatura.v1/verify"
        )

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True
    assert body["executed_capability_id"] == "web.detail_fetch.trafilatura.v1"
    assert "public HTML only" in body["warnings"]
