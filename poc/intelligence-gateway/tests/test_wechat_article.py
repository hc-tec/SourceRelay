from __future__ import annotations

import json
from dataclasses import replace

import httpx
import pytest

from app.config import Settings
from app.connectors.wechat_article import WechatPublicArticleConnector
from app.errors import GatewayError, SourceUnavailableError
from app.main import create_app
from app.models import ResultStatus, WechatArticleDetailRequest


ARTICLE_URL = "https://mp.weixin.qq.com/s/ExampleArticle123"


def _settings(tmp_path, *, proxy: str = "") -> Settings:
    return replace(
        Settings.from_env(),
        database_path=tmp_path / "gateway.db",
        runtime_dir=tmp_path / "runtime",
        wechat_article_proxy=proxy,
    )


def _article_html() -> bytes:
    return """<!doctype html>
<html><head>
<meta property="og:title" content="公开文章标题">
</head><body>
<strong id="js_name">示例公众号</strong>
<div id="js_content"><p>这是公开文章正文，用来验证微信文章专用解析器。</p><p>正文需要足够长，且完整 HTML 只保存在本地原始 artifact 中。</p></div>
<script>var ct = "1753230634";</script>
</body></html>""".encode("utf-8")


def _transport(content: bytes, *, content_type: str = "text/html; charset=utf-8"):
    async def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == ARTICLE_URL
        assert request.headers.get("cookie") is None
        return httpx.Response(200, content=content, headers={"content-type": content_type})

    return httpx.MockTransport(handler)


def test_wechat_article_url_contract_is_strict() -> None:
    canonical, external_id = WechatPublicArticleConnector.canonical_article_url(ARTICLE_URL)
    assert canonical == ARTICLE_URL
    assert external_id == "ExampleArticle123"

    rejected = [
        "http://mp.weixin.qq.com/s/ExampleArticle123",
        "https://weixin.qq.com/s/ExampleArticle123",
        "https://mp.weixin.qq.com/s?__biz=secret",
        "https://mp.weixin.qq.com/s/ExampleArticle123?token=secret",
        "https://user:secret@mp.weixin.qq.com/s/ExampleArticle123",
        "https://mp.weixin.qq.com.evil.test/s/ExampleArticle123",
    ]
    for url in rejected:
        with pytest.raises(GatewayError):
            WechatPublicArticleConnector.canonical_article_url(url)


@pytest.mark.asyncio
async def test_wechat_article_keeps_exact_html_and_lightweight_preview(tmp_path) -> None:
    raw = _article_html()
    settings = _settings(tmp_path, proxy="http://proxy.test:7890")
    connector = WechatPublicArticleConnector(settings, transport=_transport(raw))
    response = await connector.fetch(
        WechatArticleDetailRequest(url=ARTICLE_URL),
        capability_id="wechat_official.article_detail.public-html.v1",
    )

    assert response.status == ResultStatus.SUCCESS
    assert response.article.title == "公开文章标题"
    assert response.article.account_name == "示例公众号"
    assert "公开文章正文" in response.article.text_preview
    assert response.article.published_at.isoformat() == "2025-07-23T00:30:34+00:00"
    raw_path = settings.runtime_dir / str(response.artifact.raw_file)
    manifest_path = settings.runtime_dir / response.artifact.manifest_file
    assert raw_path.read_bytes() == raw
    manifest_text = manifest_path.read_text(encoding="utf-8")
    manifest = json.loads(manifest_text)
    assert manifest["action"] == "article_detail"
    assert manifest["proxy_used"] is True
    assert manifest["authentication_used"] is False
    assert manifest["cookies_used"] is False
    assert manifest["redirects_followed"] is False
    assert "proxy.test" not in manifest_text


@pytest.mark.asyncio
async def test_deleted_article_is_explicit_no_results_with_raw_html(tmp_path) -> None:
    raw = "<html><body>该内容已被发布者删除</body></html>".encode("utf-8")
    settings = _settings(tmp_path)
    connector = WechatPublicArticleConnector(settings, transport=_transport(raw))
    response = await connector.fetch(
        WechatArticleDetailRequest(url=ARTICLE_URL),
        capability_id="wechat_official.article_detail.public-html.v1",
    )

    assert response.ok is False
    assert response.status == ResultStatus.NO_RESULTS
    assert response.article is None
    manifest = json.loads(
        (settings.runtime_dir / response.artifact.manifest_file).read_text(encoding="utf-8")
    )
    assert manifest["deleted"] is True
    assert manifest["error_type"] == "article_unavailable"
    assert (settings.runtime_dir / str(response.artifact.raw_file)).read_bytes() == raw


@pytest.mark.asyncio
async def test_shell_or_verification_page_is_not_article_success(tmp_path) -> None:
    raw = "<html><body><h1>环境异常，请完成安全验证</h1></body></html>".encode("utf-8")
    settings = _settings(tmp_path)
    connector = WechatPublicArticleConnector(settings, transport=_transport(raw))
    with pytest.raises(SourceUnavailableError) as caught:
        await connector.fetch(
            WechatArticleDetailRequest(url=ARTICLE_URL),
            capability_id="wechat_official.article_detail.public-html.v1",
        )
    artifact = caught.value.context["artifact"]
    manifest = json.loads(
        (settings.runtime_dir / artifact["manifest_file"]).read_text(encoding="utf-8")
    )
    assert manifest["error_type"] == "article_contract_mismatch"
    assert artifact["raw_file"].endswith("raw.html")


@pytest.mark.asyncio
async def test_article_task_keeps_database_unchanged(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = create_app(settings)
    app.state.registry.wechat_article.transport = _transport(_article_html())
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        before = (await client.get("/library/stats")).json()
        response = await client.post(
            "/tasks/execute",
            json={
                "platform": "wechat_official",
                "action": "article_detail",
                "input": {"url": ARTICLE_URL},
                "options": {"persistence": "result_only"},
            },
        )
        after = (await client.get("/library/stats")).json()

    assert response.status_code == 200
    body = response.json()
    assert body["executed_capability_id"] == "wechat_official.article_detail.public-html.v1"
    assert body["result"]["article"]["title"] == "公开文章标题"
    assert body["result"]["artifact"]["raw_file"].endswith("raw.html")
    assert before == after
    assert any("not written" in warning for warning in body["warnings"])
