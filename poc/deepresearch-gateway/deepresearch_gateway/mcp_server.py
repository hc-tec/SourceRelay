from __future__ import annotations

import os
from typing import Any

from .artifacts import ArtifactReader
from .client import GatewayClient
from .config import AdapterSettings
from .tools import GatewayToolSet


def create_mcp_server(*, env_file: str | None = None) -> Any:
    """Create an optional MCP server without making MCP a base dependency."""

    try:
        from mcp.server.fastmcp import FastMCP
    except ImportError as exc:  # pragma: no cover - exercised in optional install
        raise RuntimeError("Install deepresearch-gateway-adapter[mcp] to run the MCP bridge.") from exc

    settings = AdapterSettings.from_env(env_file or os.getenv("DEEPRESEARCH_ENV_FILE"))
    client = GatewayClient(settings.gateway_url, timeout=settings.request_timeout)
    tools = GatewayToolSet(client, ArtifactReader(settings.artifact_root))
    server = FastMCP("intelligence-gateway")

    @server.tool()
    async def gateway_capabilities(platform: str | None = None, action: str | None = None, status: str = "verified") -> dict[str, Any]:
        return await tools.capabilities(platform=platform, action=action, status=status)

    @server.tool()
    async def gateway_plan(platform: str, action: str, input: dict[str, Any] | None = None, allow_fallback: bool = True) -> dict[str, Any]:
        return await tools.plan(platform=platform, action=action, input=input, allow_fallback=allow_fallback)

    @server.tool()
    async def gateway_search(query: str, platform: str = "web", limit: int = 10, site: str | None = None) -> dict[str, Any]:
        return await tools.search(query=query, platform=platform, limit=limit, site=site)

    @server.tool()
    async def gateway_search_and_fetch(query: str, platform: str = "web", search_limit: int = 10, detail_limit: int = 3, include_tables: bool = True) -> dict[str, Any]:
        return await tools.search_and_fetch(query=query, platform=platform, search_limit=search_limit, detail_limit=detail_limit, include_tables=include_tables)

    @server.tool()
    async def gateway_hotlist(platform: str, feed_id: str, limit: int = 10, force_latest: bool = False) -> dict[str, Any]:
        return await tools.hotlist(platform=platform, feed_id=feed_id, limit=limit, force_latest=force_latest)

    @server.tool()
    async def gateway_fetch_detail(platform: str, action: str, input: dict[str, Any]) -> dict[str, Any]:
        return await tools.fetch_detail(platform=platform, action=action, input=input)

    @server.tool()
    async def gateway_read_artifact(path: str, offset: int = 0, max_chars: int = 20_000) -> dict[str, Any]:
        return await tools.read_artifact(path=path, offset=offset, max_chars=max_chars)

    return server


def main() -> None:
    create_mcp_server().run(transport="stdio")


if __name__ == "__main__":  # pragma: no cover
    main()
