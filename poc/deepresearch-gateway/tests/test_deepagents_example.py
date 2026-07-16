from pathlib import Path

import pytest


EXAMPLE = Path(__file__).parents[1] / "examples" / "deepagents_gateway_research.py"


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
