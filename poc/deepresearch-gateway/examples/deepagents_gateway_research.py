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
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time
from typing import Any

from deepagents import create_deep_agent
from langchain_openai import ChatOpenAI

from deepresearch_gateway import (
    AdapterSettings,
    ArtifactReader,
    GatewayClient,
    GatewayToolSet,
    audit_trace,
    render_markdown,
)


MAX_CONCURRENT_GATEWAY_CALLS = 3
TRACE_SCHEMA_VERSION = 2


def _as_mapping(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _mapping_list(value: object) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, Mapping)]


def _string_list(value: object) -> list[str]:
    if isinstance(value, (str, bytes)):
        return [str(value)]
    if not isinstance(value, (list, tuple, set)):
        return []
    return [str(item) for item in value if str(item).strip()]


def _unique_strings(values: list[object]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = str(value or "").strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def _artifact_reference(*candidates: object) -> dict[str, Any] | None:
    for candidate in candidates:
        if isinstance(candidate, Mapping):
            return dict(candidate)
    return None


def _first_text(*values: object) -> str:
    for value in values:
        normalized = str(value or "").strip()
        if normalized:
            return normalized
    return ""


def _trace_evidence_item(
    item: Mapping[str, Any],
    *,
    stage: str,
    envelope: Mapping[str, Any],
    artifact: Mapping[str, Any] | None = None,
    fallback: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Project a Gateway result shape into bounded audit evidence."""

    fallback = fallback or {}
    item_artifact = _artifact_reference(item.get("artifact"), fallback.get("artifact"), artifact)
    rank_value = item.get("rank")
    if not isinstance(rank_value, int) or isinstance(rank_value, bool):
        rank_value = fallback.get("rank")
    rank = rank_value if isinstance(rank_value, int) and not isinstance(rank_value, bool) else None
    warnings = _unique_strings(
        [
            *_string_list(item.get("warnings")),
            *_string_list(fallback.get("warnings")),
        ]
    )
    return {
        "stage": stage,
        "rank": rank,
        "title": _first_text(
            item.get("title"),
            item.get("question_title"),
            item.get("text_preview"),
            fallback.get("title"),
            fallback.get("question_title"),
            fallback.get("text_preview"),
        ),
        "url": _first_text(
            item.get("final_url"),
            item.get("url"),
            item.get("answer_url"),
            fallback.get("final_url"),
            fallback.get("url"),
            fallback.get("answer_url"),
        ),
        "source": _first_text(
            item.get("source"),
            fallback.get("source"),
            envelope.get("source"),
            envelope.get("platform"),
        ),
        "promoted": bool(item.get("promoted") or fallback.get("promoted")),
        "partial": bool(item.get("partial") or fallback.get("partial")),
        "raw_ref": _first_text(item.get("raw_ref"), fallback.get("raw_ref")),
        "artifact": item_artifact,
        "warnings": warnings,
        "ok": item.get("ok") if isinstance(item.get("ok"), bool) else envelope.get("ok"),
        "status": _first_text(item.get("status"), envelope.get("status")),
        "executed_capability_id": _first_text(
            item.get("executed_capability_id"),
            envelope.get("executed_capability_id"),
        )
        or None,
        "attempted_capabilities": _unique_strings(
            [
                *_string_list(item.get("attempted_capabilities")),
                *_string_list(envelope.get("attempted_capabilities")),
            ]
        ),
        "degraded": bool(item.get("degraded") or envelope.get("degraded")),
    }


def _trace_search_metadata(search_payload: Mapping[str, Any]) -> dict[str, Any] | None:
    if not search_payload:
        return None
    search_result = _as_mapping(search_payload.get("result"))
    return {
        "ok": search_payload.get("ok"),
        "status": search_payload.get("status"),
        "executed_capability_id": search_payload.get("executed_capability_id"),
        "attempted_capabilities": search_payload.get("attempted_capabilities", []),
        "degraded": search_payload.get("degraded", False),
        "partial": search_payload.get("partial", False),
        "warnings": search_payload.get("warnings", []),
        "scope": search_payload.get("scope", {}),
        "artifact": _artifact_reference(search_result.get("artifact")),
        "error": search_payload.get("error"),
    }


def _trace_projection(name: str, result: Mapping[str, Any]) -> dict[str, Any]:
    """Create trace v2 evidence projections without persisting source content."""

    result_payload = _as_mapping(result.get("result"))
    search_payload = _as_mapping(result.get("search"))
    search_result = _as_mapping(search_payload.get("result"))
    result_artifact = _artifact_reference(
        result_payload.get("artifact"),
        result.get("artifact"),
    )
    result_items = _mapping_list(result_payload.get("items"))
    search_result_items = _mapping_list(search_result.get("items"))
    evidence_items: list[dict[str, Any]] = []
    detail_items: list[dict[str, Any]] = []

    if name == "gateway_search_and_fetch":
        search_artifact = _artifact_reference(search_result.get("artifact"))
        for search_item in search_result_items:
            evidence_items.append(
                _trace_evidence_item(
                    search_item,
                    stage="search_discovery",
                    envelope=search_payload,
                    artifact=search_artifact,
                )
            )
        for detail in _mapping_list(result.get("items")):
            article = _as_mapping(detail.get("article"))
            search_item = _as_mapping(detail.get("search_item"))
            primary = article or detail
            projected = _trace_evidence_item(
                primary,
                stage="detail_hydration",
                envelope=detail,
                artifact=_artifact_reference(detail.get("artifact"), result_artifact),
                fallback=search_item,
            )
            detail_items.append(projected)
            evidence_items.append(projected)
        return {
            "result_item_count": None,
            "result_items": [],
            "search": _trace_search_metadata(search_payload),
            "search_result_item_count": search_result.get("item_count"),
            "search_result_items": [dict(item) for item in search_result_items],
            "detail_item_count": len(detail_items),
            "detail_items": detail_items,
            "evidence_item_count": len(evidence_items),
            "evidence_items": evidence_items,
            "artifact": result_artifact,
        }

    stage = {
        "gateway_search": "search_discovery",
        "gateway_fetch_detail": "known_detail",
        "gateway_hotlist": "hotlist",
    }.get(name, "unknown")
    for item in result_items:
        evidence_items.append(
            _trace_evidence_item(
                item,
                stage=stage,
                envelope=result,
                artifact=result_artifact,
            )
        )
    for key in ("video", "article"):
        item = _as_mapping(result_payload.get(key))
        if item:
            evidence_items.append(
                _trace_evidence_item(
                    item,
                    stage="known_detail",
                    envelope=result,
                    artifact=result_artifact,
                )
            )
    for key in ("answers", "posts"):
        for item in _mapping_list(result_payload.get(key)):
            evidence_items.append(
                _trace_evidence_item(
                    item,
                    stage="known_detail",
                    envelope=result,
                    artifact=result_artifact,
                )
            )
    return {
        "result_item_count": result_payload.get("item_count"),
        "result_items": [dict(item) for item in result_items],
        "search": _trace_search_metadata(search_payload),
        "search_result_item_count": search_result.get("item_count"),
        "search_result_items": [dict(item) for item in search_result_items],
        "detail_item_count": len(detail_items),
        "detail_items": detail_items,
        "evidence_item_count": len(evidence_items),
        "evidence_items": evidence_items,
        "artifact": result_artifact,
    }


def _tool_wrappers(
    tools: GatewayToolSet,
    semaphore: asyncio.Semaphore,
    trace: list[dict[str, Any]] | None = None,
) -> list[Callable[..., Awaitable[dict[str, Any]]]]:
    """Create the only source tools visible to the lead and research agents."""

    async def call_gateway(
        name: str,
        arguments: Mapping[str, Any],
        operation: Callable[[], Awaitable[dict[str, Any]]],
    ) -> dict[str, Any]:
        started = time.perf_counter()
        started_at = datetime.now(timezone.utc).isoformat()
        try:
            async with semaphore:
                result = await operation()
        except Exception as exc:
            if trace is not None:
                trace.append(
                    {
                        "schema_version": TRACE_SCHEMA_VERSION,
                        "event_index": len(trace),
                        "tool": name,
                        "arguments": dict(arguments),
                        "started_at": started_at,
                        "duration_ms": round((time.perf_counter() - started) * 1000),
                        "ok": False,
                        "status": "tool_error",
                        "error": f"{exc.__class__.__name__}: {exc}",
                    }
                )
            raise
        if trace is not None:
            event = {
                "schema_version": TRACE_SCHEMA_VERSION,
                "event_index": len(trace),
                "tool": name,
                "arguments": dict(arguments),
                "started_at": started_at,
                "duration_ms": round((time.perf_counter() - started) * 1000),
                "ok": result.get("ok"),
                "status": result.get("status"),
                "http_status": result.get("http_status"),
                "requested_platform": result.get("requested_platform"),
                "requested_action": result.get("requested_action"),
                "executed_capability_id": result.get("executed_capability_id"),
                "attempted_capabilities": result.get("attempted_capabilities", []),
                "degraded": result.get("degraded", False),
                "partial": result.get("partial", False),
                "warnings": result.get("warnings", []),
                "scope": result.get("scope", {}),
                "transport_error": result.get("transport_error"),
                "error": result.get("error"),
            }
            event.update(_trace_projection(name, result))
            trace.append(event)
        return result

    async def gateway_capabilities(
        platform: str | None = None,
        action: str | None = None,
        status: str = "verified",
    ) -> dict[str, Any]:
        """List verified capabilities from Intelligence Gateway."""

        arguments = {"platform": platform, "action": action, "status": status}
        return await call_gateway(
            "gateway_capabilities",
            arguments,
            lambda: tools.capabilities(platform=platform, action=action, status=status),
        )

    async def gateway_search(
        query: str,
        platform: str = "web",
        limit: int = 10,
        site: str | None = None,
    ) -> dict[str, Any]:
        """Search a registered source through Intelligence Gateway."""

        arguments = {"query": query, "platform": platform, "limit": limit, "site": site}
        return await call_gateway(
            "gateway_search",
            arguments,
            lambda: tools.search(query=query, platform=platform, limit=limit, site=site),
        )

    async def gateway_search_and_fetch(
        query: str,
        platform: str = "web",
        search_limit: int = 10,
        detail_limit: int = 3,
        include_tables: bool = True,
    ) -> dict[str, Any]:
        """Search and hydrate a bounded set of public results via Gateway."""

        arguments = {
            "query": query,
            "platform": platform,
            "search_limit": search_limit,
            "detail_limit": detail_limit,
            "include_tables": include_tables,
        }
        return await call_gateway(
            "gateway_search_and_fetch",
            arguments,
            lambda: tools.search_and_fetch(
                query=query,
                platform=platform,
                search_limit=search_limit,
                detail_limit=detail_limit,
                include_tables=include_tables,
            ),
        )

    async def gateway_fetch_detail(
        platform: str,
        action: str,
        input: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Fetch a known public platform detail via a registered capability."""

        arguments = {"platform": platform, "action": action, "input": dict(input)}
        return await call_gateway(
            "gateway_fetch_detail",
            arguments,
            lambda: tools.fetch_detail(platform=platform, action=action, input=input),
        )

    async def gateway_read_artifact(
        path: str,
        offset: int = 0,
        max_chars: int = 20_000,
    ) -> dict[str, Any]:
        """Read a bounded UTF-8 excerpt from a Gateway raw artifact."""

        arguments = {"path": path, "offset": offset, "max_chars": max_chars}
        return await call_gateway(
            "gateway_read_artifact",
            arguments,
            lambda: tools.read_artifact(path=path, offset=offset, max_chars=max_chars),
        )

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


async def run(
    query: str,
    *,
    env_file: str | None = None,
    trace: list[dict[str, Any]] | None = None,
) -> Any:
    settings = AdapterSettings.from_env(env_file=env_file)
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_GATEWAY_CALLS)
    async with GatewayClient(settings.gateway_url, timeout=settings.request_timeout) as client:
        gateway_tools = GatewayToolSet(client, ArtifactReader(settings.artifact_root))
        agent = build_agent(settings, _tool_wrappers(gateway_tools, semaphore, trace))
        return await agent.ainvoke({"messages": [{"role": "user", "content": query}]})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a DeepAgents swarm over Intelligence Gateway sources.")
    parser.add_argument("query", help="Research question")
    parser.add_argument("--env-file", help="Optional UTF-8 dotenv path")
    parser.add_argument("--trace-file", help="Write machine-readable Gateway tool trace as UTF-8 JSON")
    parser.add_argument("--audit-file", help="Write deterministic Markdown Citation Audit from the trace")
    parser.add_argument(
        "--expected-platform",
        action="append",
        dest="expected_platforms",
        metavar="PLATFORM",
        help="Platform expected in the audit; repeat for multiple platforms.",
    )
    return parser


def _configure_utf8_stdout() -> None:
    """Keep Chinese model output printable from Windows PowerShell."""

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    except (AttributeError, OSError, ValueError):
        # Some embedded hosts expose a non-reconfigurable stream. Trace and
        # audit files are independently written with an explicit UTF-8 codec.
        pass


def main() -> None:
    _configure_utf8_stdout()
    parser = build_parser()
    args = parser.parse_args()
    if args.expected_platforms and not args.audit_file:
        parser.error("--expected-platform requires --audit-file")
    trace: list[dict[str, Any]] = []
    result = asyncio.run(run(args.query, env_file=args.env_file, trace=trace))
    if args.trace_file:
        trace_path = Path(args.trace_file).resolve()
        trace_path.parent.mkdir(parents=True, exist_ok=True)
        trace_path.write_text(json.dumps(trace, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Gateway trace written to {trace_path}")
    if args.audit_file:
        audit_path = Path(args.audit_file).resolve()
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        audit_path.write_text(
            render_markdown(
                audit_trace(trace, expected_platforms=args.expected_platforms)
            ),
            encoding="utf-8",
        )
        print(f"Gateway citation audit written to {audit_path}")
    messages = result.get("messages", []) if isinstance(result, dict) else []
    if messages:
        print(messages[-1].content)
    else:
        print(result)


if __name__ == "__main__":
    main()
