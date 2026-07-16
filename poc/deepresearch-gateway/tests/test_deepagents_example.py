from pathlib import Path
import importlib.util
import sys
import types

import pytest


EXAMPLE = Path(__file__).parents[1] / "examples" / "deepagents_gateway_research.py"


def _load_example_without_optional_runtime(monkeypatch: pytest.MonkeyPatch):
    fake_deepagents = types.ModuleType("deepagents")
    fake_deepagents.create_deep_agent = lambda *args, **kwargs: object()
    fake_langchain_openai = types.ModuleType("langchain_openai")
    fake_langchain_openai.ChatOpenAI = object
    monkeypatch.setitem(sys.modules, "deepagents", fake_deepagents)
    monkeypatch.setitem(sys.modules, "langchain_openai", fake_langchain_openai)
    module_name = "deepagents_gateway_research_trace_fixture"
    spec = importlib.util.spec_from_file_location(module_name, EXAMPLE)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_deepagents_example_is_gateway_only() -> None:
    source = EXAMPLE.read_text(encoding="utf-8")

    compile(source, str(EXAMPLE), "exec")
    assert "create_deep_agent" in source
    assert "GatewayToolSet" in source
    assert "ChatOpenAI" in source
    assert "gateway_search" in source
    assert "TAVILY_API_KEY" not in source
    assert "tavily_search" not in source
    assert "serper_search" not in source


def test_trace_projection_keeps_search_detail_and_known_detail_provenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    example = _load_example_without_optional_runtime(monkeypatch)
    artifact = {
        "raw_file": "artifacts/example.json",
        "manifest_file": "artifacts/example.manifest.json",
    }

    search = example._trace_projection(
        "gateway_search",
        {
            "ok": True,
            "status": "success",
            "executed_capability_id": "bilibili.keyword_search.maxun.v1",
            "attempted_capabilities": ["bilibili.keyword_search.maxun.v1"],
            "result": {
                "item_count": 1,
                "artifact": artifact,
                "items": [
                    {
                        "rank": 1,
                        "title": "B站公开视频",
                        "url": "https://www.bilibili.com/video/BV1trace",
                        "source": "bilibili",
                        "raw_ref": "maxun-run:trace",
                    }
                ],
            },
        },
    )
    assert search["evidence_item_count"] == 1
    assert search["evidence_items"][0]["stage"] == "search_discovery"
    assert search["evidence_items"][0]["artifact"] == artifact

    hydrated = example._trace_projection(
        "gateway_search_and_fetch",
        {
            "ok": True,
            "status": "success",
            "search": {
                "ok": True,
                "status": "success",
                "executed_capability_id": "sogou.keyword_search.browserwing_recipe.v1",
                "attempted_capabilities": ["sogou.keyword_search.browserwing_recipe.v1"],
                "result": {
                    "item_count": 1,
                    "items": [
                        {
                            "rank": 1,
                            "title": "知乎问题",
                            "url": "https://www.zhihu.com/question/123",
                            "source": "web",
                            "raw_ref": "browserwing-run:search",
                        }
                    ],
                },
            },
            "items": [
                {
                    "rank": 1,
                    "url": "https://www.zhihu.com/question/123",
                    "ok": True,
                    "status": "success",
                    "executed_capability_id": "web.detail_fetch.trafilatura.v1",
                    "attempted_capabilities": ["web.detail_fetch.trafilatura.v1"],
                    "search_item": {
                        "rank": 1,
                        "title": "知乎问题",
                        "url": "https://www.zhihu.com/question/123",
                        "source": "web",
                        "raw_ref": "browserwing-run:search",
                    },
                    "article": {
                        "url": "https://www.zhihu.com/question/123",
                        "final_url": "https://www.zhihu.com/question/123/answer/456",
                        "title": "知乎详情",
                    },
                }
            ],
        },
    )
    assert hydrated["search_result_item_count"] == 1
    assert hydrated["detail_item_count"] == 1
    assert [item["stage"] for item in hydrated["evidence_items"]] == [
        "search_discovery",
        "detail_hydration",
    ]
    assert hydrated["evidence_items"][1]["url"].endswith("/answer/456")
    assert hydrated["evidence_items"][1]["raw_ref"] == "browserwing-run:search"
    assert hydrated["evidence_items"][1]["executed_capability_id"] == (
        "web.detail_fetch.trafilatura.v1"
    )

    known_detail = example._trace_projection(
        "gateway_fetch_detail",
        {
            "ok": True,
            "status": "success",
            "executed_capability_id": "bilibili.video_detail.yt-dlp.v1",
            "result": {
                "artifact": artifact,
                "video": {
                    "title": "B站视频详情",
                    "url": "https://www.bilibili.com/video/BV1detail",
                },
            },
        },
    )
    assert known_detail["evidence_items"][0]["stage"] == "known_detail"
    assert known_detail["evidence_items"][0]["artifact"] == artifact


def test_parser_accepts_repeated_expected_platforms_without_running_a_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    example = _load_example_without_optional_runtime(monkeypatch)

    args = example.build_parser().parse_args(
        [
            "测试主题",
            "--audit-file",
            "audit.md",
            "--expected-platform",
            "zhihu",
            "--expected-platform",
            "bilibili",
        ]
    )

    assert args.expected_platforms == ["zhihu", "bilibili"]


def test_deepagents_graph_constructs_without_network() -> None:
    pytest.importorskip("deepagents")

    import asyncio

    from deepresearch_gateway import (
        ArtifactReader,
        GatewayClient,
        GatewayToolSet,
        LLMSettings,
        AdapterSettings,
    )
    from examples.deepagents_gateway_research import _tool_wrappers, build_agent

    settings = AdapterSettings(
        gateway_url="http://127.0.0.1:8765",
        request_timeout=180,
        artifact_root=Path.cwd(),
        llm=LLMSettings(
            provider="deepseek",
            model="deepseek-chat",
            api_key="placeholder",
            base_url="https://api.deepseek.com",
        ),
    )
    gateway = GatewayToolSet(
        GatewayClient(settings.gateway_url),
        ArtifactReader(settings.artifact_root),
    )

    graph = build_agent(settings, _tool_wrappers(gateway, asyncio.Semaphore(3)))
    assert graph is not None
