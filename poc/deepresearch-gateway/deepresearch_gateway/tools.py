from __future__ import annotations

from typing import Any, Mapping

from .artifacts import ArtifactReader, ArtifactSecurityError
from .client import GatewayClient, GatewayToolResult


class GatewayToolSet:
    """Framework-neutral tools for a controlled research swarm.

    The methods are intentionally small async callables.  They can be wrapped
    by LangGraph/DeepAgents ``StructuredTool``, AgentScope Python tools,
    CrewAI tools or an MCP server without changing source-access semantics.
    """

    def __init__(self, client: GatewayClient, artifacts: ArtifactReader | None = None) -> None:
        self.client = client
        self.artifacts = artifacts

    async def capabilities(
        self,
        platform: str | None = None,
        action: str | None = None,
        status: str | None = "verified",
    ) -> dict[str, Any]:
        return (await self.client.capabilities(platform=platform, action=action, status=status)).to_dict()

    async def plan(
        self,
        platform: str,
        action: str,
        input: Mapping[str, Any] | None = None,
        allow_fallback: bool = True,
    ) -> dict[str, Any]:
        return (await self.client.plan(platform=platform, action=action, input=input, allow_fallback=allow_fallback)).to_dict()

    async def search(
        self,
        query: str,
        platform: str = "web",
        limit: int = 10,
        site: str | None = None,
    ) -> dict[str, Any]:
        return (await self.client.search(query=query, platform=platform, limit=limit, site=site)).to_dict()

    async def search_and_fetch(
        self,
        query: str,
        platform: str = "web",
        search_limit: int = 10,
        detail_limit: int = 3,
        include_tables: bool = True,
    ) -> dict[str, Any]:
        return (
            await self.client.search_and_fetch(
                query=query,
                platform=platform,
                search_limit=search_limit,
                detail_limit=detail_limit,
                include_tables=include_tables,
            )
        ).to_dict()

    async def hotlist(
        self,
        platform: str,
        feed_id: str,
        limit: int = 10,
        force_latest: bool = False,
    ) -> dict[str, Any]:
        return (await self.client.hotlist(platform=platform, feed_id=feed_id, limit=limit, force_latest=force_latest)).to_dict()

    async def fetch_detail(
        self,
        platform: str,
        action: str,
        input: Mapping[str, Any],
    ) -> dict[str, Any]:
        return (await self.client.fetch_detail(platform=platform, action=action, input=input)).to_dict()

    async def read_artifact(
        self,
        path: str,
        offset: int = 0,
        max_chars: int = 20_000,
    ) -> dict[str, Any]:
        if self.artifacts is None:
            return {
                "ok": False,
                "status": "misconfigured",
                "error": "Artifact reading is not configured for this runtime.",
                "warnings": [],
            }
        try:
            return self.artifacts.read(path, offset=offset, max_chars=max_chars)
        except (FileNotFoundError, ValueError) as exc:
            return {"ok": False, "status": "error", "error": str(exc), "warnings": []}
        except PermissionError:
            return {"ok": False, "status": "source_unavailable", "error": "Artifact cannot be read.", "warnings": []}
        except ArtifactSecurityError as exc:
            return {"ok": False, "status": "error", "error": str(exc), "warnings": []}

    @staticmethod
    def openai_tools() -> list[dict[str, Any]]:
        """Definitions accepted by OpenAI-compatible function-tool runtimes."""

        return [
            {
                "type": "function",
                "function": {
                    "name": "gateway_capabilities",
                    "description": "List verified Intelligence Gateway capabilities. Never call a direct search provider.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "platform": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                            "action": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                            "status": {"type": "string", "default": "verified"},
                        },
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "gateway_plan",
                    "description": "Ask the Intelligence Gateway which registered capability would execute a source action.",
                    "parameters": {
                        "type": "object",
                        "required": ["platform", "action"],
                        "properties": {
                            "platform": {"type": "string"},
                            "action": {"type": "string"},
                            "input": {"type": "object", "additionalProperties": True},
                            "allow_fallback": {"type": "boolean", "default": True},
                        },
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "gateway_search",
                    "description": "Search a registered platform through Intelligence Gateway; source status and capability chain are evidence.",
                    "parameters": {
                        "type": "object",
                        "required": ["query"],
                        "properties": {
                            "query": {"type": "string"},
                            "platform": {"type": "string", "default": "web"},
                            "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
                            "site": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                        },
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "gateway_search_and_fetch",
                    "description": "Search through Intelligence Gateway and hydrate a small number of public result pages; raw artifacts remain local.",
                    "parameters": {
                        "type": "object",
                        "required": ["query"],
                        "properties": {
                            "query": {"type": "string"},
                            "platform": {"type": "string", "default": "web"},
                            "search_limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
                            "detail_limit": {"type": "integer", "minimum": 1, "maximum": 5, "default": 3},
                            "include_tables": {"type": "boolean", "default": True},
                        },
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "gateway_hotlist",
                    "description": "Fetch a registered platform hotlist/feed through Intelligence Gateway.",
                    "parameters": {
                        "type": "object",
                        "required": ["platform", "feed_id"],
                        "properties": {
                            "platform": {"type": "string"},
                            "feed_id": {"type": "string"},
                            "limit": {"type": "integer", "minimum": 1, "maximum": 30, "default": 10},
                            "force_latest": {"type": "boolean", "default": False},
                        },
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "gateway_fetch_detail",
                    "description": "Fetch a known public platform detail through a registered Gateway capability; action is not a free-form web browser.",
                    "parameters": {
                        "type": "object",
                        "required": ["platform", "action", "input"],
                        "properties": {
                            "platform": {"type": "string"},
                            "action": {"type": "string", "enum": ["detail_fetch", "article_extract", "video_detail", "article_detail", "qa_detail", "post_detail", "forum_threads", "account_posts"]},
                            "input": {"type": "object", "additionalProperties": True},
                        },
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "gateway_read_artifact",
                    "description": "Read a bounded UTF-8 excerpt from a raw artifact path returned by the Gateway.",
                    "parameters": {
                        "type": "object",
                        "required": ["path"],
                        "properties": {
                            "path": {"type": "string"},
                            "offset": {"type": "integer", "minimum": 0, "default": 0},
                            "max_chars": {"type": "integer", "minimum": 1, "maximum": 100000, "default": 20000},
                        },
                        "additionalProperties": False,
                    },
                },
            },
        ]

    async def invoke(self, name: str, arguments: Mapping[str, Any] | None = None) -> dict[str, Any]:
        """Dispatch an OpenAI/MCP-style tool call by name."""

        args = dict(arguments or {})
        handlers = {
            "gateway_capabilities": self.capabilities,
            "gateway_plan": self.plan,
            "gateway_search": self.search,
            "gateway_search_and_fetch": self.search_and_fetch,
            "gateway_hotlist": self.hotlist,
            "gateway_fetch_detail": self.fetch_detail,
            "gateway_read_artifact": self.read_artifact,
        }
        handler = handlers.get(name)
        if handler is None:
            raise ValueError(f"Unknown Intelligence Gateway tool: {name}")
        return await handler(**args)
