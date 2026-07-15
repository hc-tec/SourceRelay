from dataclasses import replace

import httpx
import pytest

from app.config import Settings
from app.main import create_app
from app.models import ResultStatus, SearchItem, SearchResponse, SourceName


def _search_response() -> SearchResponse:
    return SearchResponse(
        ok=True,
        status=ResultStatus.SUCCESS,
        source=SourceName.WEB,
        query="测试",
        duration_ms=5,
        item_count=1,
        items=[
            SearchItem(
                source=SourceName.WEB,
                query="测试",
                rank=1,
                title="测试文档",
                url="https://example.com/document",
                collector="fake",
            )
        ],
    )


@pytest.mark.asyncio
async def test_successful_search_is_persisted_and_queryable(tmp_path) -> None:
    app = create_app(replace(Settings.from_env(), database_path=tmp_path / "gateway.db"))

    async def fake_search(_request):
        return _search_response()

    app.state.registry.search = fake_search
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.post("/search", json={"source": "web", "query": "测试"})
        second = await client.post("/search", json={"source": "web", "query": "测试"})
        stats = await client.get("/library/stats")
        documents = await client.get("/documents", params={"source": "web", "q": "测试"})
        changes = await client.get("/changes", params={"change_type": "new"})
        clusters = await client.get("/clusters", params={"min_documents": 1})

        assert first.status_code == 200
        assert first.json()["persistence"]["new_count"] == 1
        assert first.json()["run_id"]
        assert second.json()["persistence"]["seen_count"] == 1
        assert stats.json()["document_count"] == 1
        assert stats.json()["observation_count"] == 2
        assert documents.json()["count"] == 1
        document_id = documents.json()["documents"][0]["document_id"]
        observations = await client.get(f"/documents/{document_id}/observations")
        assert observations.json()["count"] == 2
        assert changes.json()["count"] == 1
        assert clusters.json()["count"] == 1
        fingerprint = clusters.json()["clusters"][0]["cross_source_fingerprint"]
        cluster = await client.get(f"/clusters/{fingerprint}")
        assert cluster.json()["document_count"] == 1


@pytest.mark.asyncio
async def test_missing_library_records_return_404(tmp_path) -> None:
    app = create_app(replace(Settings.from_env(), database_path=tmp_path / "gateway.db"))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        document = await client.get("/documents/missing")
        run = await client.get("/runs/missing")
        cluster = await client.get("/clusters/missing")
    assert document.status_code == 404
    assert run.status_code == 404
    assert cluster.status_code == 404
