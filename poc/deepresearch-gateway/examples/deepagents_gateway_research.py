"""Run a small DeepAgents research swarm with Gateway-only source tools.

The model is configured from the workspace ``.env``.  No search provider SDK
is imported here: every source lookup goes through ``GatewayToolSet``.

Install the optional runtime first::

    python -m pip install -e ".[deepagents]"

Then run, while Intelligence Gateway is listening on the configured URL::

    python examples/deepagents_gateway_research.py "低空经济在中文平台的近期讨论"
"""

from __future__ import annotations

import argparse
import asyncio
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from deepagents import create_deep_agent
from langchain_openai import ChatOpenAI

from deepresearch_gateway import AdapterSettings, ArtifactReader, GatewayClient, GatewayToolSet


MAX_CONCURRENT_GATEWAY_CALLS = 3


def _tool_wrappers(
    tools: GatewayToolSet,
    semaphore: asyncio.Semaphore,
) -> list[Callable[..., Awaitable[dict[str, Any]]]]:
    """Create the only source tools visible to the lead and research agents."""

    async def gateway_capabilities(
        platform: str | None = None,
        action: str | None = None,
        status: str = "verified",
    ) -> dict[str, Any]:
        """List verified capabilities from Intelligence Gateway."""

        async with semaphore:
            return await tools.capabilities(platform=platform, action=action, status=status)

    async def gateway_search(
        query: str,
        platform: str = "web",
        limit: int = 10,
        site: str | None = None,
    ) -> dict[str, Any]:
        """Search a registered source through Intelligence Gateway."""

        async with semaphore:
            return await tools.search(query=query, platform=platform, limit=limit, site=site)

    async def gateway_search_and_fetch(
        query: str,
        platform: str = "web",
        search_limit: int = 10,
        detail_limit: int = 3,
        include_tables: bool = True,
    ) -> dict[str, Any]:
        """Search and hydrate a bounded set of public results via Gateway."""

        async with semaphore:
            return await tools.search_and_fetch(
                query=query,
                platform=platform,
                search_limit=search_limit,
                detail_limit=detail_limit,
                include_tables=include_tables,
            )

    async def gateway_fetch_detail(
        platform: str,
        action: str,
        input: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Fetch a known public platform detail via a registered capability."""

        async with semaphore:
            return await tools.fetch_detail(platform=platform, action=action, input=input)

    async def gateway_read_artifact(
        path: str,
        offset: int = 0,
        max_chars: int = 20_000,
    ) -> dict[str, Any]:
        """Read a bounded UTF-8 excerpt from a Gateway raw artifact."""

        async with semaphore:
            return await tools.read_artifact(path=path, offset=offset, max_chars=max_chars)

    return [
        gateway_capabilities,
        gateway_search,
        gateway_search_and_fetch,
        gateway_fetch_detail,
        gateway_read_artifact,
    ]


def build_agent(settings: AdapterSettings, tools: list[Callable[..., Awaitable[dict[str, Any]]]]) -> Any:
    """Build a lead agent with one focused research sub-agent role."""

    if not settings.llm.api_key:
        raise RuntimeError("DEEPSEEK_API_KEY is missing from .env or the process environment.")

    model = ChatOpenAI(
        model=settings.llm.model,
        api_key=settings.llm.api_key,
        base_url=settings.llm.base_url or None,
        temperature=0,
    )
    source_rules = """
You are a Chinese public-information research lead.

Hard source boundary:
- Use only the provided gateway_* tools for discovery and source reading.
- Never call or invent Tavily, Serper, Brave, Bing, Jina, browser, crawler, or
  arbitrary URL tools.
- Treat source_unavailable, authentication_required, no_results, misconfigured,
  partial, and degraded as distinct evidence states; never rewrite them as an
  empty successful search.
- Keep every important finding tied to a canonical URL, source, executed
  capability ID, and raw_ref/artifact path when one is returned.
- Do not ask the user for Cookie/Profile contents and do not read .env files with
  the artifact tool.
"""
    researcher = {
        "name": "gateway-researcher",
        "description": "Research one narrowly scoped aspect using only Intelligence Gateway tools.",
        "system_prompt": source_rules
        + "\nRun a small number of focused searches, preserve source statuses, and return evidence rather than unsupported conclusions.",
        "tools": tools,
    }
    lead_prompt = source_rules + """

Research workflow:
1. Clarify the question internally and split it into at most three independent aspects.
2. Delegate at most three focused aspects to gateway-researcher, no more than one
   topic per delegation. The runtime wrapper caps Gateway calls at three concurrent
   calls across the run.
3. Prefer platform-specific Gateway capabilities when available; use web discovery
   as an explicitly marked fallback, never as proof of full platform coverage.
4. Before writing a conclusion, audit each important claim for URL, source,
   capability ID, and status. State missing or degraded evidence explicitly.
5. Produce a concise Chinese report with an evidence table and a limitations section.
"""
    return create_deep_agent(
        model=model,
        tools=tools,
        system_prompt=lead_prompt,
        subagents=[researcher],
    )


async def run(query: str, *, env_file: str | None = None) -> Any:
    settings = AdapterSettings.from_env(env_file=env_file)
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_GATEWAY_CALLS)
    async with GatewayClient(settings.gateway_url, timeout=settings.request_timeout) as client:
        gateway_tools = GatewayToolSet(client, ArtifactReader(settings.artifact_root))
        agent = build_agent(settings, _tool_wrappers(gateway_tools, semaphore))
        return await agent.ainvoke({"messages": [{"role": "user", "content": query}]})


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a DeepAgents swarm over Intelligence Gateway sources.")
    parser.add_argument("query", help="Research question")
    parser.add_argument("--env-file", help="Optional UTF-8 dotenv path")
    args = parser.parse_args()
    result = asyncio.run(run(args.query, env_file=args.env_file))
    messages = result.get("messages", []) if isinstance(result, dict) else []
    if messages:
        print(messages[-1].content)
    else:
        print(result)


if __name__ == "__main__":
    main()
