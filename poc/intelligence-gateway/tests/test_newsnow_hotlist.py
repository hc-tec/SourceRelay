from __future__ import annotations

import json
from dataclasses import replace

import httpx
import pytest

from app.config import Settings
from app.connectors.newsnow import NewsNowHotlistConnector
from app.errors import SourceUnavailableError
from app.main import create_app
from app.models import (
    ArtifactReference,
    CapabilityStatus,
    HotlistPreviewItem,
    HotlistRequest,
    HotlistResponse,
    ResultStatus,
)


def _settings(tmp_path):
    return replace(
        Settings.from_env(),
        database_path=tmp_path / "gateway.db",
        runtime_dir=tmp_path / "runtime",
        newsnow_base_url="http://newsnow.test",
    )


@pytest.mark.asyncio
async def test_newsnow_keeps_exact_raw_json_and_minimal_manifest(tmp_path) -> None:
    raw = json.dumps(
        {
            "status": "success",
            "id": "bilibili-hot-video",
            "updatedTime": 1234567890,
            "items": [
                {
                    "id": "BV1",
                    "title": "公开视频",
                    "url": "https://www.bilibili.com/video/BV1?spm_id_from=333",
                    "extra": {
                        "info": "UP主 · 10w观看",
                        "hover": "平台特有字段只留在原始文件",
                    },
                },
                {
                    "id": "BV2",
                    "title": "第二条",
                    "url": "https://www.bilibili.com/video/BV2?from=hot&amp;share=1",
                },
            ],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/s"
        assert request.url.params["id"] == "bilibili-hot-video"
        assert "latest" not in request.url.params
        return httpx.Response(
            200,
            content=raw,
            headers={"content-type": "application/json; charset=utf-8"},
        )

    settings = _settings(tmp_path)
    connector = NewsNowHotlistConnector(
        settings,
        transport=httpx.MockTransport(handler),
    )
    response = await connector.fetch(
        HotlistRequest(
            platform="bilibili",
            feed_id="bilibili-hot-video",
            limit=1,
        ),
        capability_id="bilibili.hotlist_fetch.newsnow-hot-video.v1",
    )

    assert response.ok is True
    assert response.status == ResultStatus.SUCCESS
    assert response.item_count == 1
    assert response.items[0].external_id == "BV1"
    assert response.items[0].url == "https://www.bilibili.com/video/BV1"
    assert response.provider_status == "success"
    assert response.from_cache is False

    raw_path = settings.runtime_dir / str(response.artifact.raw_file)
    manifest_path = settings.runtime_dir / response.artifact.manifest_file
    assert raw_path.read_bytes() == raw
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["platform"] == "bilibili"
    assert manifest["action"] == "hotlist_fetch"
    assert manifest["feed_id"] == "bilibili-hot-video"
    assert manifest["capability_id"] == "bilibili.hotlist_fetch.newsnow-hot-video.v1"
    assert manifest["raw_file"] == response.artifact.raw_file
    assert manifest["sha256"] == response.artifact.sha256
    assert "items" not in manifest
    assert "extra" not in manifest

    second_pass = await connector.fetch(
        HotlistRequest(
            platform="bilibili",
            feed_id="bilibili-hot-video",
            limit=2,
        ),
        capability_id="bilibili.hotlist_fetch.newsnow-hot-video.v1",
    )
    assert second_pass.items[1].url == (
        "https://www.bilibili.com/video/BV2?from=hot&share=1"
    )


@pytest.mark.asyncio
async def test_newsnow_preserves_cache_and_latest_evidence(tmp_path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["latest"] == "true"
        return httpx.Response(
            200,
            json={
                "status": "cache",
                "id": "weibo",
                "updatedTime": 9876543210,
                "items": [
                    {
                        "id": "topic-1",
                        "title": "热搜",
                        "url": "https://s.weibo.com/weibo?q=%E7%83%AD%E6%90%9C",
                    }
                ],
            },
        )

    connector = NewsNowHotlistConnector(
        _settings(tmp_path),
        transport=httpx.MockTransport(handler),
    )
    response = await connector.fetch(
        HotlistRequest(
            platform="weibo",
            feed_id="weibo",
            force_latest=True,
        ),
        capability_id="weibo.hotlist_fetch.newsnow.v1",
    )

    assert response.provider_status == "cache"
    assert response.from_cache is True
    assert response.upstream_updated_at == 9876543210
    assert any("latest=true" in warning for warning in response.warnings)
    assert any("cached data" in warning for warning in response.warnings)


@pytest.mark.asyncio
async def test_newsnow_http_failure_writes_raw_failure_artifact(tmp_path) -> None:
    raw = b"upstream unavailable"

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, content=raw, headers={"content-type": "text/plain"})

    settings = _settings(tmp_path)
    connector = NewsNowHotlistConnector(
        settings,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(SourceUnavailableError) as caught:
        await connector.fetch(
            HotlistRequest(platform="zhihu", feed_id="zhihu"),
            capability_id="zhihu.hotlist_fetch.newsnow.v1",
        )

    artifact = caught.value.context["artifact"]
    assert (settings.runtime_dir / artifact["raw_file"]).read_bytes() == raw
    manifest = json.loads(
        (settings.runtime_dir / artifact["manifest_file"]).read_text(encoding="utf-8")
    )
    assert manifest["status"] == "source_unavailable"
    assert manifest["http_status"] == 503
    assert manifest["error_type"] == "upstream_http_error"


@pytest.mark.asyncio
async def test_newsnow_rejects_cross_platform_feed_before_network(tmp_path) -> None:
    called = False

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={})

    connector = NewsNowHotlistConnector(
        _settings(tmp_path),
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(SourceUnavailableError) as caught:
        await connector.fetch(
            HotlistRequest(platform="weibo", feed_id="zhihu"),
            capability_id="weibo.hotlist_fetch.newsnow.v1",
        )

    assert called is False
    assert "not approved" in str(caught.value)


@pytest.mark.asyncio
async def test_newsnow_health_uses_version_endpoint_without_writing_artifact(tmp_path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/latest"
        return httpx.Response(200, json={"v": "0.0.41"})

    settings = _settings(tmp_path)
    connector = NewsNowHotlistConnector(
        settings,
        transport=httpx.MockTransport(handler),
    )
    health = await connector.health()

    assert health.ready is True
    assert health.details["version"] == "0.0.41"
    assert not (settings.runtime_dir / "artifacts").exists()


@pytest.mark.asyncio
async def test_verified_hotlist_task_returns_preview_without_database_persistence(
    tmp_path,
) -> None:
    settings = _settings(tmp_path)
    app = create_app(settings)
    capability_id = "bilibili.hotlist_fetch.newsnow-hot-video.v1"
    assert app.state.capabilities.get(capability_id).status == CapabilityStatus.VERIFIED

    async def fake_hotlist(request, *, capability_id: str):
        assert request.feed_id == "bilibili-hot-video"
        return HotlistResponse(
            ok=True,
            status=ResultStatus.SUCCESS,
            platform="bilibili",
            feed_id=request.feed_id,
            provider="newsnow",
            provider_status="success",
            duration_ms=5,
            item_count=1,
            items=[
                HotlistPreviewItem(
                    rank=1,
                    external_id="BV1",
                    title="公开视频",
                    url="https://www.bilibili.com/video/BV1",
                )
            ],
            artifact=ArtifactReference(
                manifest_file="artifacts/newsnow/test/manifest.json",
                raw_file="artifacts/newsnow/test/raw.json",
                media_type="application/json",
                byte_count=100,
                sha256="0" * 64,
            ),
        )

    app.state.registry.hotlist = fake_hotlist
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        before = await client.get("/library/stats")
        response = await client.post(
            "/tasks/execute",
            json={
                "platform": "bilibili",
                "action": "hotlist_fetch",
                "input": {"feed_id": "bilibili-hot-video", "limit": 5},
                "options": {"persistence": "result_only"},
            },
        )
        after = await client.get("/library/stats")

    body = response.json()
    assert response.status_code == 200
    assert body["executed_capability_id"] == capability_id
    assert body["result"]["artifact"]["raw_file"].endswith("raw.json")
    assert body["result"]["items"][0]["external_id"] == "BV1"
    assert before.json() == after.json()
    assert any("not written to the intelligence database" in warning for warning in body["warnings"])
