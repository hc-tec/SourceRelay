import asyncio
from dataclasses import replace

import httpx
import pytest

from app.capabilities import CapabilityCatalog
from app.config import Settings
from app.drafts import BrowserWingDraftExplorer
from app.errors import GatewayError, SourceUnavailableError
from app.main import create_app
from app.models import (
    CapabilityAction,
    CapabilityManifest,
    CapabilityStatus,
    ResultStatus,
    TaskPlanRequest,
)


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


def _validated_detail_payload():
    url = "https://blog.csdn.net/example/article/details/1"
    return {
        "inspection": {
            "url": url,
            "title_candidates": [{"selector": "h1", "text": "示例文章"}],
            "content_candidates": [
                {"selector": "article", "text_length": 600, "score": 900}
            ],
            "authentication_markers": [],
        },
        "validation": {
            "passed": True,
            "issues": [],
            "final_url": url,
            "final_title": "示例文章",
            "text_length": 600,
            "authentication_gate_suspected": False,
        },
        "recipe": {
            "sample_url": url,
            "allowed_host": "blog.csdn.net",
            "title_selector": "h1",
            "content_selector": "article",
            "minimum_text_chars": 200,
            "maximum_text_chars": 200000,
        },
        "article": {
            "url": url,
            "title": "示例文章",
            "text": "正文" * 300,
            "text_length": 600,
        },
    }


@pytest.mark.asyncio
async def test_draft_explorer_restarts_a_stale_browser_connection() -> None:
    explorer = BrowserWingDraftExplorer(Settings.from_env(), asyncio.Lock())
    calls = []

    async def start_service():
        calls.append(("service",))

    page_info_attempts = 0

    async def command(*arguments, timeout=60):
        nonlocal page_info_attempts
        calls.append(arguments)
        if arguments == ("exec", "page-info"):
            page_info_attempts += 1
            if page_info_attempts == 1:
                raise SourceUnavailableError("stale browser connection")
        return {"success": True, "data": {}}

    explorer._start_service = start_service
    explorer._command = command
    await explorer._ensure_browser()

    assert calls == [
        ("service",),
        ("exec", "page-info"),
        ("browser", "stop", "default"),
        ("browser", "start", "default"),
    ]


@pytest.mark.asyncio
async def test_draft_explorer_retries_navigation_after_closed_connection() -> None:
    explorer = BrowserWingDraftExplorer(Settings.from_env(), asyncio.Lock())
    calls = []
    navigation_attempts = 0

    async def command(*arguments, timeout=60):
        nonlocal navigation_attempts
        calls.append(arguments)
        if arguments[:2] == ("exec", "navigate"):
            navigation_attempts += 1
            if navigation_attempts == 1:
                raise SourceUnavailableError(
                    "BrowserWing draft command failed.",
                    warnings=["browser connection is closed or invalid"],
                )
        return {"success": True, "data": {}}

    async def replace_browser():
        calls.append(("replace",))

    explorer._command = command
    explorer._replace_browser = replace_browser
    await explorer._navigate("https://example.com")

    assert calls == [
        ("exec", "navigate", "https://example.com"),
        ("replace",),
        ("exec", "navigate", "https://example.com"),
    ]


def test_detail_text_repairs_only_high_confidence_utf8_mojibake() -> None:
    original = "中共中央关于进一步全面深化改革的决定"
    mojibake = original.encode("utf-8").decode("latin-1")

    repaired, changed = BrowserWingDraftExplorer._repair_utf8_mojibake(mojibake)
    unchanged, unchanged_flag = BrowserWingDraftExplorer._repair_utf8_mojibake(
        original
    )

    assert repaired == original
    assert changed is True
    assert unchanged == original
    assert unchanged_flag is False


@pytest.mark.asyncio
async def test_validation_uses_checked_redirect_host_and_form_fallback(
    monkeypatch,
) -> None:
    explorer = BrowserWingDraftExplorer(Settings.from_env(), asyncio.Lock())
    checked_urls = []

    async def public_url_ok(url):
        checked_urls.append(url)

    async def no_sleep(_seconds):
        return None

    async def inspect(_url):
        return {
            "url": "https://www.example.com/",
            "title": "Example Search",
            "inputs": [{"selector": "#query", "score": 18}],
            "submits": [
                {
                    "selector": "div[aria-label=voice]",
                    "text": "Search using voice",
                    "score": -30,
                }
            ],
            "authentication_markers": [],
        }

    async def command(*arguments, timeout=60):
        if arguments[:2] == ("exec", "page-info"):
            return {
                "data": {
                    "url": "https://www.example.com/search?q=test",
                    "title": "test - Search",
                }
            }
        assert arguments[:2] == ("exec", "eval")
        script = arguments[2]
        if "var el=document.querySelector" in script:
            assert 'var submit=""' in script
            return {"data": {"result": {"ok": True, "method": "form"}}}
        return {
            "data": {
                "result": {
                    "selected_selector": "h2",
                    "candidates": [],
                    "items": [
                        {
                            "rank": 1,
                            "title": "test result one",
                            "url": "https://one.example/result",
                            "text": "test result one",
                        },
                        {
                            "rank": 2,
                            "title": "test result two",
                            "url": "https://two.example/result",
                            "text": "test result two",
                        },
                    ],
                }
            }
        }

    monkeypatch.setattr("app.drafts.validate_public_url", public_url_ok)
    monkeypatch.setattr("app.drafts.asyncio.sleep", no_sleep)
    explorer._inspect_unlocked = inspect
    explorer._command = command
    payload = await explorer._search_unlocked(
        url="https://cn.example.com", query="test"
    )

    assert payload["validation"]["passed"] is True
    assert payload["validation"]["submit_method"] == "form"
    assert payload["recipe"]["start_url"] == "https://www.example.com/"
    assert payload["recipe"]["expected_host"] == "www.example.com"
    assert checked_urls == [
        "https://www.example.com/",
        "https://www.example.com/search?q=test",
    ]


@pytest.mark.asyncio
async def test_detail_validation_accepts_a_public_readable_container(
    monkeypatch,
) -> None:
    explorer = BrowserWingDraftExplorer(Settings.from_env(), asyncio.Lock())

    async def public_url_ok(_url):
        return None

    async def ensure_browser():
        return None

    async def inspect(_url):
        return _validated_detail_payload()["inspection"]

    async def extract(**_kwargs):
        return {
            "url": "https://blog.csdn.net/example/article/details/1",
            "title": "示例文章",
            "text": "正文" * 300,
            "text_length": 600,
            "content_selector_found": True,
            "title_selector_found": True,
            "authentication_markers": [],
        }

    monkeypatch.setattr("app.drafts.validate_public_url", public_url_ok)
    explorer._ensure_browser = ensure_browser
    explorer._inspect_detail_unlocked = inspect
    explorer._extract_detail_unlocked = extract

    payload = await explorer.validate_detail(
        "https://blog.csdn.net/example/article/details/1"
    )

    assert payload["validation"]["passed"] is True
    assert payload["recipe"]["allowed_host"] == "blog.csdn.net"
    assert payload["recipe"]["content_selector"] == "article"
    assert payload["article"]["text_length"] == 600


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("article", "expected_issue"),
    [
        (
            {
                "url": "https://blog.csdn.net/example/article/details/1",
                "title": "内容不足",
                "text": "短正文",
                "text_length": 3,
                "content_selector_found": True,
                "authentication_markers": [],
            },
            "shorter than 200",
        ),
        (
            {
                "url": "https://accounts.example.net/login",
                "title": "登录",
                "text": "",
                "text_length": 0,
                "content_selector_found": False,
                "authentication_markers": ["登录"],
            },
            "hostname boundary",
        ),
    ],
)
async def test_detail_validation_rejects_short_text_and_host_escape(
    monkeypatch, article, expected_issue
) -> None:
    explorer = BrowserWingDraftExplorer(Settings.from_env(), asyncio.Lock())

    async def public_url_ok(_url):
        return None

    async def ensure_browser():
        return None

    async def inspect(_url):
        payload = _validated_detail_payload()["inspection"]
        if article.get("authentication_markers"):
            payload = {**payload, "authentication_markers": ["登录"]}
        return payload

    async def extract(**_kwargs):
        return article

    monkeypatch.setattr("app.drafts.validate_public_url", public_url_ok)
    explorer._ensure_browser = ensure_browser
    explorer._inspect_detail_unlocked = inspect
    explorer._extract_detail_unlocked = extract

    payload = await explorer.validate_detail(
        "https://blog.csdn.net/example/article/details/1"
    )

    assert payload["validation"]["passed"] is False
    assert payload["recipe"] is None
    assert any(
        expected_issue in issue for issue in payload["validation"]["issues"]
    )
    if article.get("authentication_markers"):
        assert payload["validation"]["authentication_gate_suspected"] is True


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
async def test_keyword_search_draft_requires_sample_query(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/capability-drafts",
            json={
                "platform": "example",
                "action": "keyword_search",
                "start_url": "https://example.com/search",
            },
        )

    assert response.status_code == 422
    assert "sample_query is required" in str(response.json()["details"])


@pytest.mark.asyncio
async def test_detail_draft_promotes_and_executes_without_sample_query(
    tmp_path, monkeypatch
) -> None:
    async def public_url_ok(_url):
        return None

    monkeypatch.setattr("app.main.validate_public_url", public_url_ok)
    app = create_app(_settings(tmp_path))
    detail_selector = {"value": "article"}

    async def validate_detail(_url):
        payload = _validated_detail_payload()
        payload["recipe"]["content_selector"] = detail_selector["value"]
        return payload

    async def execute_detail_recipe(_recipe, _url):
        return _validated_detail_payload()

    app.state.draft_explorer.validate_detail = validate_detail
    app.state.draft_explorer.execute_detail_recipe = execute_detail_recipe
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/capability-drafts",
            json={
                "platform": "csdn",
                "action": "detail_fetch",
                "start_url": "https://blog.csdn.net/example/article/details/1",
                "description": "Public rendered detail",
            },
        )
        draft_id = created.json()["draft_id"]
        validated = await client.post(f"/capability-drafts/{draft_id}/validate")
        promoted = await client.post(f"/capability-drafts/{draft_id}/promote")
        executed = await client.post(
            f"/capabilities/{promoted.json()['capability_id']}/verify"
        )
        checked = await client.post(
            f"/capabilities/{promoted.json()['capability_id']}/check"
        )
        detail_selector["value"] = "div.article-body"
        await client.post(f"/capability-drafts/{draft_id}/validate")
        repromoted = await client.post(f"/capability-drafts/{draft_id}/promote")
        idempotent_promote = await client.post(
            f"/capability-drafts/{draft_id}/promote"
        )

    assert created.status_code == 201
    assert created.json()["sample_query"] is None
    assert validated.json()["passed"] is True
    assert promoted.status_code == 200
    assert promoted.json()["action"] == "detail_fetch"
    assert promoted.json()["executor"] == "browserwing_detail_recipe"
    assert promoted.json()["output_schema"] == "fetch_response.v1"
    assert promoted.json()["scope"]["host_scoped"] is True
    assert "pagination" not in promoted.json()["scope"]
    assert executed.status_code == 200
    assert executed.json()["executed_capability_id"] == (
        "csdn.detail_fetch.browserwing_recipe.v1"
    )
    assert executed.json()["result"]["article"]["collector"] == (
        "browserwing_detail_recipe"
    )
    assert checked.json()["details"]["recipe_fields_complete"] is True
    assert repromoted.json()["version"] == "1.0.1"
    assert repromoted.json()["recipe"]["content_selector"] == "div.article-body"
    assert idempotent_promote.json()["version"] == "1.0.1"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("authentication_gate", "expected_http", "expected_status", "issue"),
    [
        (
            False,
            503,
            "source_unavailable",
            "The generated detail content selector was not found.",
        ),
        (
            True,
            424,
            "authentication_required",
            "Authentication or verification markers blocked public detail text.",
        ),
    ],
)
async def test_generated_detail_executor_reports_recipe_failure_semantics(
    tmp_path,
    monkeypatch,
    authentication_gate,
    expected_http,
    expected_status,
    issue,
) -> None:
    async def public_url_ok(_url):
        return None

    monkeypatch.setattr("app.main.validate_public_url", public_url_ok)
    app = create_app(_settings(tmp_path))

    async def validate_detail(_url):
        return _validated_detail_payload()

    async def stale_detail_recipe(_recipe, _url):
        payload = _validated_detail_payload()
        payload["validation"] = {
            "passed": False,
            "issues": [issue],
            "authentication_gate_suspected": authentication_gate,
        }
        return payload

    app.state.draft_explorer.validate_detail = validate_detail
    app.state.draft_explorer.execute_detail_recipe = stale_detail_recipe
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/capability-drafts",
            json={
                "platform": "csdn",
                "action": "detail_fetch",
                "start_url": "https://blog.csdn.net/example/article/details/1",
            },
        )
        draft_id = created.json()["draft_id"]
        await client.post(f"/capability-drafts/{draft_id}/validate")
        await client.post(f"/capability-drafts/{draft_id}/promote")
        executed = await client.post(
            "/capabilities/csdn.detail_fetch.browserwing_recipe.v1/verify"
        )

    assert executed.status_code == expected_http
    assert executed.json()["status"] == expected_status
    assert issue in executed.json()["warnings"]


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
async def test_detail_draft_with_incomplete_recipe_cannot_be_promoted(
    tmp_path, monkeypatch
) -> None:
    async def public_url_ok(_url):
        return None

    monkeypatch.setattr("app.main.validate_public_url", public_url_ok)
    app = create_app(_settings(tmp_path))

    async def validate_detail(_url):
        payload = _validated_detail_payload()
        payload["recipe"] = {
            key: value
            for key, value in payload["recipe"].items()
            if key not in {"allowed_host", "content_selector"}
        }
        return payload

    app.state.draft_explorer.validate_detail = validate_detail
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/capability-drafts",
            json={
                "platform": "csdn",
                "action": "detail_fetch",
                "start_url": "https://blog.csdn.net/example/article/details/1",
            },
        )
        draft_id = created.json()["draft_id"]
        validated = await client.post(f"/capability-drafts/{draft_id}/validate")
        promoted = await client.post(f"/capability-drafts/{draft_id}/promote")

    assert validated.json()["passed"] is True
    assert promoted.status_code == 422
    assert promoted.json()["missing_fields"] == [
        "allowed_host",
        "content_selector",
    ]


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


@pytest.mark.asyncio
async def test_detail_recipe_rejects_url_outside_allowed_host(monkeypatch) -> None:
    explorer = BrowserWingDraftExplorer(Settings.from_env(), asyncio.Lock())

    async def public_url_ok(_url):
        return None

    monkeypatch.setattr("app.drafts.validate_public_url", public_url_ok)
    recipe = _validated_detail_payload()["recipe"]

    with pytest.raises(GatewayError) as captured:
        await explorer.execute_detail_recipe(
            recipe, "https://example.net/article/2"
        )

    assert getattr(captured.value, "http_status", None) == 422
    assert "hostname boundary" in str(captured.value)


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


def test_runtime_verification_blocks_stale_recipe_and_recovers(tmp_path) -> None:
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
            "fallback_ids": ["web.keyword_search.searxng.v1"],
            "fallback_site": "example.com",
            "recipe": {
                "start_url": "https://example.com",
                "input_selector": "#search",
                "result_item_selector": ".result",
                "expected_host": "example.com",
            },
        }
    )
    catalog.save_runtime_manifest(generated)

    for expected_failures in (1, 2):
        updated = catalog.record_verification(
            generated.capability_id,
            succeeded=False,
            result_status=ResultStatus.SOURCE_UNAVAILABLE,
            error="selector drift",
        )
        assert updated.status == CapabilityStatus.DEGRADED
        assert updated.reliability.consecutive_failures == expected_failures

    blocked = catalog.record_verification(
        generated.capability_id,
        succeeded=False,
        result_status=ResultStatus.SOURCE_UNAVAILABLE,
        error="selector drift",
    )
    assert blocked.status == CapabilityStatus.BLOCKED
    assert blocked.reliability.consecutive_failures == 3
    assert blocked.reliability.blocked_at is not None

    fallback_plan = catalog.plan(
        TaskPlanRequest(
            platform="example",
            action=CapabilityAction.KEYWORD_SEARCH,
            input={"query": "test"},
        )
    )
    assert fallback_plan.selected_capability.capability_id == (
        "web.keyword_search.searxng.v1"
    )
    assert fallback_plan.effective_input["site"] == "example.com"
    assert fallback_plan.degraded is True

    restored = catalog.record_verification(
        generated.capability_id,
        succeeded=True,
        result_status=ResultStatus.SUCCESS,
    )
    assert restored.status == CapabilityStatus.VERIFIED
    assert restored.reliability.consecutive_failures == 0
    assert restored.reliability.blocked_at is None
    assert restored.reliability.last_success_at is not None


@pytest.mark.asyncio
async def test_verify_endpoint_can_recover_a_blocked_generated_recipe(
    tmp_path, monkeypatch
) -> None:
    async def public_url_ok(_url):
        return None

    monkeypatch.setattr("app.main.validate_public_url", public_url_ok)
    app = create_app(_settings(tmp_path))

    async def validate(_url, _query):
        return _validated_payload()

    app.state.draft_explorer.validate = validate
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/capability-drafts",
            json={
                "platform": "baidu",
                "start_url": "https://www.baidu.com",
                "sample_query": "个人知识库",
            },
        )
        draft_id = created.json()["draft_id"]
        await client.post(f"/capability-drafts/{draft_id}/validate")
        promoted = await client.post(f"/capability-drafts/{draft_id}/promote")
        capability_id = promoted.json()["capability_id"]

        async def stale_recipe(_recipe, _query, limit=20):
            raise SourceUnavailableError("selector drift")

        app.state.draft_explorer.execute_recipe = stale_recipe
        failures = [
            await client.post(f"/capabilities/{capability_id}/verify")
            for _ in range(3)
        ]
        reliability = await client.get(
            f"/capabilities/{capability_id}/reliability"
        )
        fallback_plan = await client.post(
            "/tasks/plan",
            json={
                "platform": "baidu",
                "action": "keyword_search",
                "input": {"query": "测试"},
            },
        )

        async def repaired_recipe(_recipe, _query, limit=20):
            payload = _validated_payload()
            payload["items"] = payload["items"][:limit]
            return payload

        app.state.draft_explorer.execute_recipe = repaired_recipe
        recovered = await client.post(f"/capabilities/{capability_id}/verify")
        direct_plan = await client.post(
            "/tasks/plan",
            json={
                "platform": "baidu",
                "action": "keyword_search",
                "input": {"query": "测试"},
            },
        )

    assert [response.status_code for response in failures] == [503, 503, 503]
    assert failures[-1].json()["capability_status"] == "blocked"
    assert failures[-1].json()["reliability"]["consecutive_failures"] == 3
    assert reliability.json()["planner_eligible"] is False
    assert reliability.json()["runtime_mutable"] is True
    assert fallback_plan.json()["selected_capability"]["capability_id"] == (
        "web.keyword_search.searxng.v1"
    )
    assert fallback_plan.json()["effective_input"]["site"] == "www.baidu.com"
    assert recovered.status_code == 200
    assert recovered.json()["degraded"] is False
    assert direct_plan.json()["selected_capability"]["capability_id"] == capability_id
