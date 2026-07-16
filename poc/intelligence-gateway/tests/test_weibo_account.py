from __future__ import annotations

import json
import asyncio
from dataclasses import replace

import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.connectors.weibo_account import BrowserWingWeiboAccountConnector
from app.errors import SourceUnavailableError
from app.main import create_app
from app.models import SourceName, WeiboAccountPostsRequest


CAPABILITY_ID = "weibo.account_posts.browserwing.v1"


def _settings(tmp_path) -> Settings:
    return replace(
        Settings.from_env(),
        database_path=tmp_path / "gateway.db",
        runtime_dir=tmp_path / "runtime",
    )


def _payload(*, forbidden: bool = False) -> dict:
    row = {
        "id": "5321343732027529",
        "mid": "5321343732027529",
        "bid": "R8Xfn8vs5",
        "created_at": "Thu Jul 16 16:31:14 +0800 2026",
        "text_html": "<a href='/n/test'>@测试</a> <b>公开正文</b>",
        "source": "微博视频号",
        "reposts_count": 204,
        "comments_count": 416,
        "attitudes_count": 1522,
        "pic_ids": [],
        "is_long_text": False,
        "page_info": {"object_type": "video", "page_title": "公开视频", "page_url": "", "play_count": 8},
        "user": {"id": "2803301701", "screen_name": "人民日报", "verified": True, "verified_reason": ""},
    }
    if forbidden:
        row["user"]["user_token"] = "must-not-be-written"
        row["page_info"]["stream_url"] = "https://signed.example/video"
    return {
        "schema_version": 1,
        "platform": "weibo",
        "operation": "account_posts",
        "account_id": "2803301701",
        "account_name": "人民日报",
        "source_url": "https://m.weibo.cn/u/2803301701",
        "query_scope": "anonymous-public-rendered-first-page",
        "page_state": "ok",
        "partial": True,
        "item_count": 1,
        "items": [row],
    }


def test_weibo_account_input_is_strictly_bounded() -> None:
    assert WeiboAccountPostsRequest(account_id="2803301701", limit=10).limit == 10
    for account_id in ("1234", "123456789012345678901", "28033abc01"):
        with pytest.raises(ValidationError):
            WeiboAccountPostsRequest(account_id=account_id)
    with pytest.raises(ValidationError):
        WeiboAccountPostsRequest(account_id="2803301701", limit=11)


@pytest.mark.asyncio
async def test_weibo_keeps_allowlisted_raw_json_and_lightweight_preview(tmp_path) -> None:
    connector = BrowserWingWeiboAccountConnector(_settings(tmp_path), lock=asyncio.Lock())

    async def adapter(_request):
        return _payload()

    connector._run_adapter = adapter
    response = await connector.fetch(
        WeiboAccountPostsRequest(account_id="2803301701"), capability_id=CAPABILITY_ID
    )
    assert response.ok is True
    assert response.account_name == "人民日报"
    assert response.posts[0].text_preview == "@测试 公开正文"
    assert "user_token" not in response.model_dump_json().casefold()
    raw_path = connector.settings.runtime_dir / str(response.artifact.raw_file)
    manifest_path = connector.settings.runtime_dir / response.artifact.manifest_file
    assert json.loads(raw_path.read_text(encoding="utf-8")) == _payload()
    manifest_text = manifest_path.read_text(encoding="utf-8")
    assert "chrome-user-data" not in manifest_text
    assert "user_token" not in manifest_text.casefold()
    assert json.loads(manifest_text)["cookies_exported"] is False


@pytest.mark.asyncio
async def test_weibo_rejects_adapter_payload_with_sensitive_or_signed_fields(tmp_path) -> None:
    connector = BrowserWingWeiboAccountConnector(_settings(tmp_path), lock=asyncio.Lock())

    async def adapter(_request):
        return _payload(forbidden=True)

    connector._run_adapter = adapter
    with pytest.raises(SourceUnavailableError):
        await connector.fetch(
            WeiboAccountPostsRequest(account_id="2803301701"), capability_id=CAPABILITY_ID
        )
    assert not list((connector.settings.runtime_dir / "artifacts").rglob("raw.json"))


def test_weibo_and_xiaohongshu_share_one_browser_lock(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    assert app.state.registry.weibo_account.lock is app.state.registry.connectors[
        SourceName.XIAOHONGSHU
    ].lock


@pytest.mark.asyncio
async def test_verified_weibo_task_keeps_database_unchanged(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    called = False

    async def adapter(_request):
        nonlocal called
        called = True
        return _payload()

    app.state.registry.weibo_account._run_adapter = adapter
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        before = (await client.get("/library/stats")).json()
        capabilities = await client.get("/capabilities")
        response = await client.post(
            "/tasks/execute",
            json={
                "platform": "weibo",
                "action": "account_posts",
                "input": {"account_id": "2803301701", "limit": 10},
                "options": {"persistence": "result_only"},
            },
        )
        after = (await client.get("/library/stats")).json()
    assert response.status_code == 200
    assert response.json()["executed_capability_id"] == CAPABILITY_ID
    assert response.json()["result"]["item_count"] == 1
    assert called is True
    assert before == after
    assert "user_token" not in capabilities.text.casefold()
