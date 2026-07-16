from dataclasses import replace

import httpx
import pytest

from app.config import Settings
from app.errors import GatewayError
from app.main import create_app
from app.models import CapabilityManifest, CapabilityStatus
from app.sogou_redirects import (
    MAX_REDIRECT_BODY_BYTES,
    SogouRedirectResolver,
)


SOGOU_LINK = "https://www.sogou.com/link?url=opaque-token"


async def _public_url_ok(_url: str) -> None:
    return None


def _resolver(handler, validator=_public_url_ok) -> SogouRedirectResolver:
    return SogouRedirectResolver(
        transport=httpx.MockTransport(handler),
        url_validator=validator,
    )


@pytest.mark.asyncio
async def test_resolves_static_javascript_redirect_without_fetching_target() -> None:
    checked_urls: list[str] = []
    requests: list[httpx.Request] = []

    async def validator(url: str) -> None:
        checked_urls.append(url)

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            headers={
                "content-type": "text/html; charset=utf-8",
                "set-cookie": "SUID=ephemeral; path=/",
            },
            text=(
                '<meta content="always" name="referrer"><script>'
                'window.location.replace("https://www.zhihu.com/question/648380958")'
                "</script>"
            ),
            request=request,
        )

    resolution = await _resolver(handler, validator).resolve(
        SOGOU_LINK, expected_site="zhihu.com"
    )

    assert resolution is not None
    assert resolution.target_url == "https://www.zhihu.com/question/648380958"
    assert resolution.method == "sogou_html_location"
    assert resolution.warning is None
    assert checked_urls == [SOGOU_LINK, resolution.target_url]
    assert [str(request.url) for request in requests] == [SOGOU_LINK]
    assert requests[0].headers.get("cookie") is None
    assert requests[0].headers.get("referer") is None


@pytest.mark.asyncio
async def test_only_exact_sogou_link_host_is_resolved() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        raise AssertionError("A non-exact Sogou host must not be requested.")

    resolution = await _resolver(handler).resolve(
        "https://evil.sogou.com/link?url=opaque-token"
    )

    assert resolution is None
    assert requests == []


@pytest.mark.asyncio
async def test_resolves_static_meta_refresh_and_http_location() -> None:
    meta_source = "https://www.sogou.com/link?url=meta-token"
    location_source = "https://www.sogou.com/link?url=location-token"

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == meta_source:
            return httpx.Response(
                200,
                headers={"content-type": "text/html"},
                text=(
                    "<html><head><meta http-equiv=\"refresh\" "
                    "content=\"0;URL='https://weibo.com/5631519148/OvzzxbObz'\">"
                    "</head></html>"
                ),
                request=request,
            )
        return httpx.Response(
            302,
            headers={"location": "https://www.bilibili.com/video/BV1D3h9zYE2G/"},
            request=request,
        )

    resolver = _resolver(handler)
    meta = await resolver.resolve(meta_source, expected_site="weibo.com")
    location = await resolver.resolve(location_source, expected_site="bilibili.com")

    assert meta is not None
    assert meta.target_url == "https://weibo.com/5631519148/OvzzxbObz"
    assert meta.method == "sogou_html_meta_refresh"
    assert location is not None
    assert location.target_url == "https://www.bilibili.com/video/BV1D3h9zYE2G/"
    assert location.method == "sogou_http_location"


@pytest.mark.asyncio
async def test_rejects_non_public_target_without_fetching_it() -> None:
    checked_urls: list[str] = []
    requests: list[str] = []

    async def validator(url: str) -> None:
        checked_urls.append(url)
        if "127.0.0.1" in url:
            raise GatewayError("non-public target", http_status=422)

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text='<script>window.location.replace("http://127.0.0.1/private")</script>',
            request=request,
        )

    resolution = await _resolver(handler, validator).resolve(SOGOU_LINK)

    assert resolution is not None
    assert resolution.target_url is None
    assert resolution.warning == "Sogou redirect candidate was excluded by the public URL safety policy."
    assert checked_urls == [SOGOU_LINK, "http://127.0.0.1/private"]
    assert requests == [SOGOU_LINK]


@pytest.mark.asyncio
async def test_rejects_target_outside_site_boundary_before_validating_target() -> None:
    checked_urls: list[str] = []

    async def validator(url: str) -> None:
        checked_urls.append(url)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text='<script>window.location.replace("https://evilzhihu.com/question/1")</script>',
            request=request,
        )

    resolution = await _resolver(handler, validator).resolve(
        SOGOU_LINK, expected_site="zhihu.com"
    )

    assert resolution is not None
    assert resolution.target_url is None
    assert "site:zhihu.com boundary" in str(resolution.warning)
    assert checked_urls == [SOGOU_LINK]


@pytest.mark.asyncio
async def test_rejects_oversized_wrapper_before_parsing() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={
                "content-type": "text/html",
                "content-length": str(MAX_REDIRECT_BODY_BYTES + 1),
            },
            content=b"",
            request=request,
        )

    resolution = await _resolver(handler).resolve(SOGOU_LINK)

    assert resolution is not None
    assert resolution.target_url is None
    assert "64 KiB safety limit" in str(resolution.warning)


def _install_sogou_recipe(app) -> CapabilityManifest:
    base = app.state.capabilities.get("web.keyword_search.searxng.v1")
    manifest = CapabilityManifest.model_validate(
        {
            **base.model_dump(mode="json"),
            "capability_id": "sogou.keyword_search.browserwing_recipe.v1",
            "platform": "sogou",
            "status": CapabilityStatus.VERIFIED,
            "executor": "browserwing_recipe",
            "adapter": "GeneratedBrowserWingRecipe",
            "source": None,
            "authentication": {"required": False, "mode": "none"},
            "fallback_ids": [],
            "fallback_site": None,
            "recipe": {
                "start_url": "https://www.sogou.com/",
                "input_selector": "#query",
                "submit_selector": "",
                "result_item_selector": "div.vrwrap",
                "expected_host": "www.sogou.com",
            },
        }
    )
    app.state.capabilities.save_runtime_manifest(manifest)
    return manifest


@pytest.mark.asyncio
async def test_sogou_recipe_returns_only_safe_canonical_site_urls(tmp_path) -> None:
    settings = replace(
        Settings.from_env(),
        database_path=tmp_path / "gateway.db",
        runtime_dir=tmp_path / "runtime",
    )
    app = create_app(settings)
    manifest = _install_sogou_recipe(app)
    good_link = "https://www.sogou.com/link?url=good"
    wrong_site_link = "https://www.sogou.com/link?url=wrong-site"

    async def recipe(_recipe, query: str, limit: int = 20):
        assert query == "site:zhihu.com 低空经济"
        return {
            "validation": {"passed": True, "issues": []},
            "items": [
                {
                    "title": "知乎自然结果",
                    "url": good_link,
                    "text": "低空经济 知乎",
                },
                {
                    "title": "错误站点",
                    "url": wrong_site_link,
                    "text": "低空经济",
                },
                {
                    "title": "相关搜索",
                    "url": "https://www.sogou.com/web?query=%E4%BD%8E%E7%A9%BA%E7%BB%8F%E6%B5%8E",
                    "text": "大家还在搜",
                },
            ][:limit],
        }

    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == good_link:
            target = "https://www.zhihu.com/question/648380958"
        elif str(request.url) == wrong_site_link:
            target = "https://example.com/not-zhihu"
        else:
            raise AssertionError(f"Unexpected wrapper request: {request.url}")
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text=f'<script>window.location.replace("{target}")</script>',
            request=request,
        )

    app.state.draft_explorer.execute_recipe = recipe
    app.state.sogou_redirect_resolver = _resolver(handler)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/tasks/execute",
            json={
                "platform": "sogou",
                "action": "keyword_search",
                "input": {"query": "低空经济", "site": "zhihu.com", "limit": 3},
                "options": {"allow_fallback": False, "persistence": "none"},
            },
        )

    body = response.json()
    assert response.status_code == 200
    assert body["executed_capability_id"] == manifest.capability_id
    assert body["result"]["item_count"] == 1
    item = body["result"]["items"][0]
    assert item["url"] == "https://www.zhihu.com/question/648380958"
    assert item["metrics"] == {
        "discovery_url": good_link,
        "url_resolution_method": "sogou_html_location",
        "target_fetched": False,
    }
    assert all("sogou.com" not in row["url"] for row in body["result"]["items"])
    assert any("2 Sogou candidates were excluded" in warning for warning in body["result"]["warnings"])
    assert any("outside the requested site:zhihu.com" in warning for warning in body["result"]["warnings"])


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("requested_limit", "expected_extraction_limit"),
    [(1, 2), (2, 2), (5, 5)],
)
async def test_browser_recipe_keeps_two_result_validation_floor_but_honors_api_limit(
    tmp_path,
    requested_limit: int,
    expected_extraction_limit: int,
) -> None:
    settings = replace(
        Settings.from_env(),
        database_path=tmp_path / "gateway.db",
        runtime_dir=tmp_path / "runtime",
    )
    app = create_app(settings)
    _install_sogou_recipe(app)
    observed_limits: list[int] = []

    async def recipe(_recipe, query: str, limit: int = 20):
        observed_limits.append(limit)
        assert query == "site:zhihu.com 低空经济"
        return {
            "validation": {"passed": True, "issues": []},
            "items": [
                {
                    "title": f"知乎公开结果 {index}",
                    "url": f"https://www.zhihu.com/question/{1000 + index}",
                    "text": "低空经济",
                }
                for index in range(1, 6)
            ][:limit],
        }

    app.state.draft_explorer.execute_recipe = recipe
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/tasks/execute",
            json={
                "platform": "sogou",
                "action": "keyword_search",
                "input": {
                    "query": "低空经济",
                    "site": "zhihu.com",
                    "limit": requested_limit,
                },
                "options": {"allow_fallback": False, "persistence": "none"},
            },
        )

    body = response.json()
    assert response.status_code == 200
    assert observed_limits == [expected_extraction_limit]
    assert body["result"]["item_count"] == requested_limit
    assert len(body["result"]["items"]) == requested_limit
