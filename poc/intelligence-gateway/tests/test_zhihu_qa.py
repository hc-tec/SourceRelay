from __future__ import annotations

import asyncio
import json
from dataclasses import replace

import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.connectors.zhihu_qa import BrowserWingZhihuQaConnector
from app.errors import SourceUnavailableError
from app.main import create_app
from app.models import SourceName, ZhihuQaDetailRequest


CAPABILITY_ID = "zhihu.qa_detail.browserwing.v1"


def _settings(tmp_path) -> Settings:
    return replace(
        Settings.from_env(),
        database_path=tmp_path / "gateway.db",
        runtime_dir=tmp_path / "runtime",
    )


def _payload(*, forbidden: bool = False) -> dict:
    answer = {
        "answer_id": "3226634772",
        "answer_url": "https://www.zhihu.com/question/623780358/answer/3226634772",
        "author_name": "人工智能",
        "author_url": "https://www.zhihu.com/people/example?zd_token=secret",
        "author_headline": "公开作者简介",
        "text": "人工智能是一种利用机器模拟人类感知、认知、推理、决策等过程的技术。",
        "text_length": 35,
        "published_text": "发布于 2023-11-09 13:59",
        "text_truncated": True,
    }
    if forbidden:
        answer["zd_token"] = "must-not-be-written"
    return {
        "schema_version": 1,
        "platform": "zhihu",
        "operation": "qa_detail",
        "question_id": "623780358",
        "question_title": "AI人工智能是什么？",
        "question_text": "人工智能的定义和概念",
        "topics": ["人工智能", "人工智能算法"],
        "source_url": "https://www.zhihu.com/question/623780358",
        "query_scope": "anonymous-public-rendered-question-first-answers",
        "page_state": "ok",
        "partial": True,
        "item_count": 1,
        "answers": [answer],
    }


def test_zhihu_question_input_is_strictly_bounded() -> None:
    assert ZhihuQaDetailRequest(question_id="623780358", limit=5).limit == 5
    for question_id in ("", "question-623780358", "1" * 21):
        with pytest.raises(ValidationError):
            ZhihuQaDetailRequest(question_id=question_id)
    with pytest.raises(ValidationError):
        ZhihuQaDetailRequest(question_id="623780358", limit=6)


@pytest.mark.asyncio
async def test_zhihu_qa_keeps_public_allowlist_and_strips_entity_query_tokens(tmp_path) -> None:
    connector = BrowserWingZhihuQaConnector(_settings(tmp_path), lock=asyncio.Lock())

    async def adapter(_request):
        return _payload()

    connector._run_adapter = adapter
    response = await connector.fetch(
        ZhihuQaDetailRequest(question_id="623780358"), capability_id=CAPABILITY_ID
    )
    assert response.ok is True
    assert response.question_title == "AI人工智能是什么？"
    assert response.answers[0].answer_url.endswith("/answer/3226634772")
    assert response.answers[0].author_url == "https://www.zhihu.com/people/example"
    assert "zd_token" not in response.model_dump_json().casefold()
    raw_path = connector.settings.runtime_dir / str(response.artifact.raw_file)
    manifest_path = connector.settings.runtime_dir / response.artifact.manifest_file
    raw = raw_path.read_text(encoding="utf-8")
    assert "zd_token" not in raw.casefold()
    assert "cookie" not in raw.casefold()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["cookies_exported"] is False
    assert manifest["read_only"] is True


@pytest.mark.asyncio
async def test_zhihu_qa_rejects_sensitive_upstream_payload(tmp_path) -> None:
    connector = BrowserWingZhihuQaConnector(_settings(tmp_path), lock=asyncio.Lock())

    async def adapter(_request):
        return _payload(forbidden=True)

    connector._run_adapter = adapter
    with pytest.raises(SourceUnavailableError):
        await connector.fetch(
            ZhihuQaDetailRequest(question_id="623780358"), capability_id=CAPABILITY_ID
        )
    assert not list((connector.settings.runtime_dir / "artifacts").rglob("raw.json"))


def test_zhihu_qa_shares_browser_profile_lock(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    assert app.state.registry.zhihu_qa.lock is app.state.registry.connectors[SourceName.XIAOHONGSHU].lock


@pytest.mark.asyncio
async def test_verified_zhihu_qa_task_keeps_database_unchanged(tmp_path) -> None:
    app = create_app(_settings(tmp_path))

    async def adapter(_request):
        return _payload()

    app.state.registry.zhihu_qa._run_adapter = adapter
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        before = (await client.get("/library/stats")).json()
        capabilities = await client.get("/capabilities")
        response = await client.post(
            "/tasks/execute",
            json={
                "platform": "zhihu",
                "action": "qa_detail",
                "input": {"question_id": "623780358", "limit": 5},
                "options": {"persistence": "result_only"},
            },
        )
        after = (await client.get("/library/stats")).json()
    assert response.status_code == 200
    assert response.json()["executed_capability_id"] == CAPABILITY_ID
    assert response.json()["result"]["item_count"] == 1
    assert before == after
    assert "zd_token" not in capabilities.text.casefold()
