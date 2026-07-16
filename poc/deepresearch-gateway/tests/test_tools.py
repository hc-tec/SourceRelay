from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from deepresearch_gateway.artifacts import ArtifactReader, ArtifactSecurityError
from deepresearch_gateway.client import GatewayClient
from deepresearch_gateway.tools import GatewayToolSet


def test_artifact_reader_rejects_escape_and_returns_bounded_utf8(tmp_path: Path) -> None:
    raw = tmp_path / "artifacts" / "newsnow" / "raw.json"
    raw.parent.mkdir(parents=True)
    raw.write_text(json.dumps({"标题": "中文样本", "items": [1, 2, 3]}, ensure_ascii=False), encoding="utf-8")
    reader = ArtifactReader(tmp_path / "artifacts")

    result = reader.read("newsnow/raw.json", max_chars=100)
    assert result["ok"] is True
    assert "中文样本" in result["content"]
    assert result["json"]["items"] == [1, 2, 3]

    with pytest.raises(ArtifactSecurityError):
        reader.read("../raw.json")


@pytest.mark.asyncio
async def test_tool_set_invokes_only_named_gateway_tools(tmp_path: Path) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/capabilities":
            return httpx.Response(200, json={"count": 1, "capabilities": [{"capability_id": "web.keyword_search.searxng.v1"}]})
        return httpx.Response(200, json={"ok": True, "status": "success", "warnings": [], "result": {"items": []}})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://gateway.test") as http_client:
        tools = GatewayToolSet(GatewayClient("http://gateway.test", client=http_client), ArtifactReader(tmp_path))
        capabilities = await tools.invoke("gateway_capabilities")

    assert capabilities["ok"] is True
    assert capabilities["capabilities"][0]["capability_id"] == "web.keyword_search.searxng.v1"


def test_openai_tool_definitions_do_not_expose_direct_search_providers() -> None:
    definitions = GatewayToolSet.openai_tools()
    serialized = json.dumps(definitions, ensure_ascii=False).casefold()

    assert {item["function"]["name"] for item in definitions} == {
        "gateway_capabilities",
        "gateway_plan",
        "gateway_search",
        "gateway_search_and_fetch",
        "gateway_hotlist",
        "gateway_fetch_detail",
        "gateway_read_artifact",
    }
    for provider in ("tavily", "serper", "brave", "bing", "jina"):
        assert provider not in serialized
