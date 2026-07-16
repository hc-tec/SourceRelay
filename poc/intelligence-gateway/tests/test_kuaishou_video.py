from __future__ import annotations

import asyncio
import json
from dataclasses import replace

import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.connectors.kuaishou_video import BrowserWingKuaishouVideoConnector
from app.errors import GatewayError, SourceUnavailableError
from app.main import create_app
from app.models import SourceName, VideoDetailRequest


CAPABILITY_ID = "kuaishou.video_detail.browserwing.v1"
URL = "https://www.kuaishou.com/short-video/3xqekv4y58mn686"


def _settings(tmp_path) -> Settings:
    return replace(
        Settings.from_env(),
        database_path=tmp_path / "gateway.db",
        runtime_dir=tmp_path / "runtime",
    )


def _payload(*, forbidden: bool = False) -> dict:
    payload = {
        "schema_version": 1,
        "platform": "kuaishou",
        "operation": "video_detail",
        "video_id": "3xqekv4y58mn686",
        "title": "起床！ #喜爱度激励计划",
        "description": "公开视频描述",
        "author_name": "仓樱拍子",
        "published_text": "9月前",
        "likes_text": "15.3万",
        "source_url": URL,
        "query_scope": "anonymous-public-rendered-video-page",
        "page_state": "ok",
        "partial": True,
        "video_element_present": True,
        "media_url_exported": False,
    }
    if forbidden:
        payload["src"] = "https://signed.example/video"
    return payload


def test_kuaishou_video_url_contract_is_strict() -> None:
    canonical, video_id = BrowserWingKuaishouVideoConnector.canonical_video_url(URL)
    assert canonical == URL
    assert video_id == "3xqekv4y58mn686"
    for value in (
        "http://www.kuaishou.com/short-video/3xqekv4y58mn686",
        "https://www.kuaishou.com/short-video/3xqekv4y58mn686?token=secret",
        "https://kuaishou.com/short-video/3xqekv4y58mn686",
        "https://www.kuaishou.com/short-video/short",
    ):
        with pytest.raises(GatewayError):
            BrowserWingKuaishouVideoConnector.canonical_video_url(value)


@pytest.mark.asyncio
async def test_kuaishou_keeps_public_metadata_only_raw_artifact(tmp_path) -> None:
    connector = BrowserWingKuaishouVideoConnector(_settings(tmp_path), lock=asyncio.Lock())

    async def adapter(_video_id):
        return _payload()

    connector._run_adapter = adapter
    response = await connector.fetch(
        VideoDetailRequest(url=URL), capability_id=CAPABILITY_ID
    )
    assert response.ok is True
    assert response.video.title == "起床！ #喜爱度激励计划"
    assert "src" not in response.model_dump_json().casefold()
    raw_path = connector.settings.runtime_dir / str(response.artifact.raw_file)
    raw = raw_path.read_text(encoding="utf-8")
    assert "src" not in raw.casefold()
    assert "signed.example" not in raw
    manifest = json.loads(
        (connector.settings.runtime_dir / response.artifact.manifest_file).read_text(encoding="utf-8")
    )
    assert manifest["media_url_exported"] is False
    assert manifest["media_download_requested"] is False


@pytest.mark.asyncio
async def test_kuaishou_rejects_upstream_media_url_field(tmp_path) -> None:
    connector = BrowserWingKuaishouVideoConnector(_settings(tmp_path), lock=asyncio.Lock())

    async def adapter(_video_id):
        return _payload(forbidden=True)

    connector._run_adapter = adapter
    with pytest.raises(SourceUnavailableError):
        await connector.fetch(VideoDetailRequest(url=URL), capability_id=CAPABILITY_ID)
    assert not list((connector.settings.runtime_dir / "artifacts").rglob("raw.json"))


def test_kuaishou_shares_browser_profile_lock(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    assert app.state.registry.kuaishou_video.lock is app.state.registry.connectors[SourceName.XIAOHONGSHU].lock


@pytest.mark.asyncio
async def test_verified_kuaishou_task_keeps_database_unchanged(tmp_path) -> None:
    app = create_app(_settings(tmp_path))

    async def adapter(_video_id):
        return _payload()

    app.state.registry.kuaishou_video._run_adapter = adapter
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        before = (await client.get("/library/stats")).json()
        response = await client.post(
            "/tasks/execute",
            json={
                "platform": "kuaishou",
                "action": "video_detail",
                "input": {"url": URL},
                "options": {"persistence": "result_only"},
            },
        )
        after = (await client.get("/library/stats")).json()
    assert response.status_code == 200
    assert response.json()["executed_capability_id"] == CAPABILITY_ID
    assert response.json()["result"]["video"]["title"] == "起床！ #喜爱度激励计划"
    assert before == after
