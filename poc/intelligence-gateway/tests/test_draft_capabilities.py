from dataclasses import replace

import httpx
import pytest

from app.capabilities import CapabilityCatalog
from app.config import Settings
from app.main import create_app
from app.models import CapabilityManifest, SearchResponse


def _settings(tmp_path):
    return replace(
        Settings.from_env(),
        database_path=tmp_path / "gateway.db",
        runtime_dir=tmp_path / "runtime",
    )


def _validated_payload():
    return {
        "inspection": {
            "url": "https://www.baidu.com/",
            "inputs": [{"selector": "#kw"}],
            "submits": [{"selector": "#su"}],
            "authentication_markers": [],
        },
        "validation": {
            "passed": True,
            "issues": [],
            "final_url": "https://www.baidu.com/s?wd=test",
            "final_title": "test_百度搜索",
            "item_count": 2,
            "submit_method": "click",
            "authentication_gate_suspected": False,
        },
        "recipe": {
            "start_url": "https://www.baidu.com/",
            "input_selector": "#kw",
            "submit_selector": "#su",
            "result_item_selector": "div.result",
            "expected_host": "www.baidu.com",
        },
        "items": [
            {
                "rank": 1,
                "title": "第一个结果",
                "url": "https://example.com/one",
                "text": "摘要一",
            },
            {
                "rank": 2,
                "title": "第二个结果",
                "url": "https://example.com/two",
                "text": "摘要二",
            },
        ],
    }


@pytest.mark.asyncio
async def test_draft_validate_promote_plan_and_execute(tmp_path, monkeypatch) -> None:
    async def public_url_ok(_url):
        return None

    monkeypatch.setattr("app.main.validate_public_url", public_url_ok)
    app = create_app(_settings(tmp_path))

    async def inspect(_url):
        payload = _validated_payload()
        payload["validation"] = None
        return payload

    async def validate(_url, _query):
        return _validated_payload()

    async def execute_recipe(_recipe, query, limit=20):
        payload = _validated_payload()
        payload["items"] = payload["items"][:limit]
        return payload

    app.state.draft_explorer.inspect = inspect
    app.state.draft_explorer.validate = validate
    app.state.draft_explorer.execute_recipe = execute_recipe

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/capability-drafts",
            json={
                "platform": "baidu",
                "action": "keyword_search",
                "start_url": "https://www.baidu.com",
                "sample_query": "个人知识库",
                "description": "Public Baidu keyword search draft",
            },
        )
        draft_id = created.json()["draft_id"]
        inspected = await client.post(f"/capability-drafts/{draft_id}/inspect")
        validated = await client.post(f"/capability-drafts/{draft_id}/validate")
        promoted = await client.post(f"/capability-drafts/{draft_id}/promote")
        planned = await client.post(
            "/tasks/plan",
            json={
                "platform": "baidu",
                "action": "keyword_search",
                "input": {"query": "自动化情报", "limit": 2},
            },
        )
        executed = await client.post(
            "/tasks/execute",
            json={
                "platform": "baidu",
                "action": "keyword_search",
                "input": {"query": "自动化情报", "limit": 2},
                "options": {"persistence": "none", "allow_fallback": False},
            },
        )

    assert created.status_code == 201
    assert inspected.json()["status"] == "inspected"
    assert validated.json()["passed"] is True
    assert promoted.status_code == 200
    assert promoted.json()["executor"] == "browserwing_recipe"
    assert planned.json()["selected_capability"]["capability_id"] == (
        "baidu.keyword_search.browserwing_recipe.v1"
    )
    assert executed.status_code == 200
    assert executed.json()["result"]["item_count"] == 2
    assert executed.json()["result"]["items"][0]["collector"] == "browserwing_recipe"


@pytest.mark.asyncio
async def test_unvalidated_draft_cannot_be_promoted(tmp_path, monkeypatch) -> None:
    async def public_url_ok(_url):
        return None

    monkeypatch.setattr("app.main.validate_public_url", public_url_ok)
    app = create_app(_settings(tmp_path))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/capability-drafts",
            json={
                "platform": "example",
                "start_url": "https://example.com",
                "sample_query": "test",
            },
        )
        response = await client.post(
            f"/capability-drafts/{created.json()['draft_id']}/promote"
        )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_private_draft_start_url_is_rejected(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/capability-drafts",
            json={
                "platform": "local",
                "start_url": "http://127.0.0.1:8080",
                "sample_query": "test",
            },
        )
    assert response.status_code == 422
    assert "non-public" in response.json()["error"]


def test_runtime_manifest_reload(tmp_path) -> None:
    runtime = tmp_path / "capabilities"
    catalog = CapabilityCatalog(runtime_directory=runtime)
    base = catalog.get("web.keyword_search.searxng.v1")
    generated = CapabilityManifest.model_validate(
        {
            **base.model_dump(mode="json"),
            "capability_id": "example.keyword_search.browserwing_recipe.v1",
            "platform": "example",
            "executor": "browserwing_recipe",
            "adapter": "GeneratedBrowserWingRecipe",
            "source": None,
            "recipe": {
                "start_url": "https://example.com",
                "input_selector": "#search",
                "result_item_selector": ".result",
                "expected_host": "example.com",
            },
        }
    )
    catalog.save_runtime_manifest(generated)
    assert catalog.get(generated.capability_id).recipe == generated.recipe
    reloaded = CapabilityCatalog(runtime_directory=runtime)
    assert reloaded.get(generated.capability_id).executor == "browserwing_recipe"
