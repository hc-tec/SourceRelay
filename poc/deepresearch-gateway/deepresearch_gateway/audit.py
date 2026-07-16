"""Deterministic, offline evidence auditing for Gateway tool traces.

The final language-model answer is narrative rather than a source of truth.
This module consumes the structured trace emitted by
deepagents_gateway_research.py and derives platform coverage, citation
eligibility, provenance, and gaps without making network calls.

Two questions deliberately remain separate:

* coverage_status says what kind of Gateway collection was actually observed:
  native platform search, a fallback, external discovery, or a known detail /
  feed read.
* claim_status says whether the trace contains a direct, non-promoted,
  platform-canonical URL that can be cited.

Consequently a direct Zhihu URL returned by site:zhihu.com can be citable while
still being external_discovery_only coverage. It must never be reported as
verified native Zhihu keyword search.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping
from urllib.parse import urlsplit


_PLATFORM_HOSTS: dict[str, tuple[str, ...]] = {
    "bilibili": ("bilibili.com",),
    "xiaohongshu": ("xiaohongshu.com",),
    "zhihu": ("zhihu.com",),
    "weibo": ("weibo.com",),
    "douyin": ("douyin.com",),
    "kuaishou": ("kuaishou.com",),
    "tieba": ("tieba.baidu.com",),
    "wechat_official": ("mp.weixin.qq.com",),
    "36kr": ("36kr.com",),
    "thepaper": ("thepaper.cn",),
}

# These hosts are wrappers/search pages even when a platform host happens to
# contain the name. They must be checked before _PLATFORM_HOSTS:
# link.zhihu.com is not a canonical Zhihu content URL.
_REDIRECT_OR_SEARCH_HOSTS = (
    "sogou.com",
    "bing.com",
    "baidu.com",
    "google.com",
    "duckduckgo.com",
    "link.zhihu.com",
    "link.weibo.com",
    "link.bilibili.com",
    "link.xiaohongshu.com",
    "link.douyin.com",
    "link.kuaishou.com",
)

_EVIDENCE_TOOLS = {
    "gateway_search",
    "gateway_search_and_fetch",
    "gateway_fetch_detail",
    "gateway_hotlist",
}

_STATUS_GAPS = {
    "no_results": "NO_RESULTS",
    "authentication_required": "AUTHENTICATION_REQUIRED",
    "source_unavailable": "SOURCE_UNAVAILABLE",
    "misconfigured": "MISCONFIGURED",
    "error": "ERROR",
    "tool_error": "TOOL_ERROR",
}


def _normalize_platform(value: object) -> str:
    return str(value or "").strip().casefold().replace("-", "_")


def _as_mapping(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _mappings(value: object) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, Mapping)]


def _strings(value: object) -> list[str]:
    if isinstance(value, (str, bytes)):
        return [str(value)]
    if not isinstance(value, (list, tuple, set)):
        return []
    return [str(item) for item in value]


def _unique(values: Iterable[object]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = str(value or "").strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def _hostname(url: object) -> str:
    try:
        return (urlsplit(str(url or "")).hostname or "").casefold().rstrip(".")
    except ValueError:
        return ""


def _url_parts(url: object):
    try:
        return urlsplit(str(url or "").strip())
    except ValueError:
        return urlsplit("")


def _host_matches(host: str, domains: Iterable[str]) -> bool:
    return any(host == domain or host.endswith(f".{domain}") for domain in domains)


def _platform_from_site(site: object) -> str:
    host = _hostname(f"https://{str(site or '').strip().strip('/')}")
    for platform, domains in _PLATFORM_HOSTS.items():
        if _host_matches(host, domains):
            return platform
    return "web"


def _arguments(event: Mapping[str, Any]) -> Mapping[str, Any]:
    return _as_mapping(event.get("arguments"))


def _target_platform(event: Mapping[str, Any]) -> str:
    args = _arguments(event)
    requested = _normalize_platform(args.get("platform"))
    if requested and requested != "web":
        return requested
    site = args.get("site")
    if site:
        return _platform_from_site(site)
    return "web"


def _event_index(event: Mapping[str, Any], fallback: int) -> int:
    value = event.get("event_index")
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return fallback


def _event_tool(event: Mapping[str, Any]) -> str:
    return str(event.get("tool") or "").strip()


def _nested_search(event: Mapping[str, Any]) -> Mapping[str, Any]:
    return _as_mapping(event.get("search"))


def _event_statuses(event: Mapping[str, Any]) -> list[str]:
    nested = _nested_search(event)
    return _unique([event.get("status"), nested.get("status")])


def _event_executed_capabilities(event: Mapping[str, Any]) -> list[str]:
    nested = _nested_search(event)
    return _unique(
        [event.get("executed_capability_id"), nested.get("executed_capability_id")]
    )


def _event_attempted_capabilities(event: Mapping[str, Any]) -> list[str]:
    nested = _nested_search(event)
    return _unique(
        [
            *_strings(event.get("attempted_capabilities")),
            *_strings(nested.get("attempted_capabilities")),
        ]
    )


def _event_warnings(event: Mapping[str, Any]) -> list[str]:
    nested = _nested_search(event)
    return _unique([*_strings(event.get("warnings")), *_strings(nested.get("warnings"))])


def _event_errors(event: Mapping[str, Any]) -> list[str]:
    nested = _nested_search(event)
    return _unique([event.get("error"), nested.get("error")])


def _event_is_degraded(event: Mapping[str, Any]) -> bool:
    nested = _nested_search(event)
    return bool(event.get("degraded")) or bool(nested.get("degraded"))


def _event_is_partial(event: Mapping[str, Any]) -> bool:
    nested = _nested_search(event)
    return bool(event.get("partial")) or bool(nested.get("partial"))


def _normalize_stage(value: object, tool: str) -> str:
    normalized = str(value or "").strip().casefold().replace("-", "_")
    aliases = {
        "search": "search_discovery",
        "search_result": "search_discovery",
        "search_discovery": "search_discovery",
        "detail": "detail_hydration",
        "detail_fetch": "detail_hydration",
        "detail_hydration": "detail_hydration",
        "known_detail": "known_detail",
        "hotlist": "hotlist",
    }
    if normalized in aliases:
        return aliases[normalized]
    if tool == "gateway_search":
        return "search_discovery"
    if tool == "gateway_search_and_fetch":
        return "detail_hydration"
    if tool == "gateway_fetch_detail":
        return "known_detail"
    if tool == "gateway_hotlist":
        return "hotlist"
    return "unknown"


def _stage_provenance(event: Mapping[str, Any], stage: str) -> Mapping[str, Any]:
    """Return the Gateway envelope that owns this evidence stage."""

    nested = _nested_search(event)
    if stage == "search_discovery" and nested:
        return nested
    return event


@dataclass(frozen=True, slots=True)
class Citation:
    """One successful evidence item with trace-derived provenance."""

    event_index: int
    tool: str
    evidence_stage: str
    rank: int | None
    title: str
    url: str
    source: str
    promoted: bool
    kind: str
    executed_capability_id: str | None = None
    attempted_capabilities: tuple[str, ...] = ()
    degraded: bool = False
    partial: bool = False
    raw_ref: str = ""
    artifact: Mapping[str, Any] | None = None
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class PlatformAudit:
    """A deterministic audit for one requested or observed platform."""

    platform: str
    event_count: int
    statuses: tuple[str, ...]
    claim_status: str
    coverage_status: str
    collection_modes: tuple[str, ...]
    executed_capabilities: tuple[str, ...]
    attempted_capabilities: tuple[str, ...]
    degraded: bool
    partial: bool
    coverage_degraded: bool
    coverage_partial: bool
    canonical_citations: tuple[Citation, ...]
    noncanonical_citations: tuple[Citation, ...]
    warnings: tuple[str, ...]
    errors: tuple[str, ...]
    gaps: tuple[str, ...]

    @property
    def canonical_citation_count(self) -> int:
        return len(self.canonical_citations)

    @property
    def noncanonical_citation_count(self) -> int:
        return len(self.noncanonical_citations)


@dataclass(frozen=True, slots=True)
class AuditReport:
    platforms: tuple[PlatformAudit, ...]
    ignored_event_count: int = 0


@dataclass(frozen=True, slots=True)
class _EvidenceRecord:
    """Internal normalized trace record; it is not public API."""

    event_index: int
    tool: str
    stage: str
    item: Mapping[str, Any]
    event: Mapping[str, Any]

    @property
    def provenance(self) -> Mapping[str, Any]:
        return _stage_provenance(self.event, self.stage)

    @property
    def status(self) -> str:
        value = self.item.get("status")
        if value is None:
            value = self.provenance.get("status")
        return str(value or "").strip()

    @property
    def ok(self) -> bool | None:
        value = self.item.get("ok")
        if isinstance(value, bool):
            return value
        value = self.provenance.get("ok")
        return value if isinstance(value, bool) else None

    @property
    def executed_capability_id(self) -> str | None:
        value = self.item.get("executed_capability_id")
        if not value:
            value = self.provenance.get("executed_capability_id")
        normalized = str(value or "").strip()
        return normalized or None

    @property
    def attempted_capabilities(self) -> tuple[str, ...]:
        return tuple(
            _unique(
                [
                    *_strings(self.item.get("attempted_capabilities")),
                    *_strings(self.provenance.get("attempted_capabilities")),
                ]
            )
        )

    @property
    def degraded(self) -> bool:
        return bool(self.item.get("degraded")) or bool(self.provenance.get("degraded"))

    @property
    def partial(self) -> bool:
        return bool(self.item.get("partial")) or bool(self.provenance.get("partial"))

    @property
    def warnings(self) -> tuple[str, ...]:
        return tuple(
            _unique(
                [
                    *_strings(self.provenance.get("warnings")),
                    *_strings(self.item.get("warnings")),
                ]
            )
        )

    @property
    def artifact(self) -> Mapping[str, Any] | None:
        candidate = self.item.get("artifact")
        if isinstance(candidate, Mapping):
            return candidate
        candidate = self.provenance.get("artifact")
        if isinstance(candidate, Mapping):
            return candidate
        candidate = self.event.get("artifact")
        return candidate if isinstance(candidate, Mapping) else None

    @property
    def raw_ref(self) -> str:
        return str(self.item.get("raw_ref") or "").strip()

    @property
    def url(self) -> str:
        for key in ("url", "answer_url", "final_url"):
            value = str(self.item.get(key) or "").strip()
            if value:
                return value
        return ""

    @property
    def title(self) -> str:
        for key in ("title", "question_title", "text_preview", "description"):
            value = str(self.item.get(key) or "").strip()
            if value:
                return value
        return ""

    @property
    def source(self) -> str:
        value = self.item.get("source")
        if value:
            return str(value).strip()
        value = self.provenance.get("source") or self.provenance.get("platform")
        if value:
            return str(value).strip()
        return _target_platform(self.event)

    @property
    def rank(self) -> int | None:
        value = self.item.get("rank")
        return value if isinstance(value, int) and not isinstance(value, bool) else None

    @property
    def promoted(self) -> bool:
        return bool(self.item.get("promoted"))

    @property
    def successful(self) -> bool:
        return self.status == "success" and self.ok is not False


def _legacy_stage(tool: str) -> str:
    return _normalize_stage(None, tool)


def _flatten_legacy_detail(item: Mapping[str, Any]) -> Mapping[str, Any]:
    """Flatten a DetailFetchItem while retaining its per-detail provenance."""

    article = _as_mapping(item.get("article"))
    search_item = _as_mapping(item.get("search_item"))
    if not article and not search_item:
        return item
    flattened = dict(item)
    if article:
        final_url = str(article.get("final_url") or article.get("url") or "").strip()
        if final_url:
            flattened["url"] = final_url
        title = str(article.get("title") or "").strip()
        if title:
            flattened["title"] = title
        flattened["warnings"] = _unique(
            [*_strings(item.get("warnings")), *_strings(article.get("warnings"))]
        )
    if search_item:
        for key in ("raw_ref", "source", "rank", "promoted", "partial"):
            if key not in flattened or not flattened.get(key):
                flattened[key] = search_item.get(key)
        if not flattened.get("title"):
            flattened["title"] = search_item.get("title")
    return flattened


def _records_for_event(event_index: int, event: Mapping[str, Any]) -> list[_EvidenceRecord]:
    """Read trace v2 projections and legacy v1 fields without discarding stages."""

    tool = _event_tool(event)
    projected = event.get("evidence_items")
    if isinstance(projected, list):
        return [
            _EvidenceRecord(
                event_index=event_index,
                tool=tool,
                stage=_normalize_stage(item.get("stage"), tool),
                item=item,
                event=event,
            )
            for item in _mappings(projected)
        ]

    records: list[_EvidenceRecord] = []
    for item in _mappings(event.get("result_items")):
        normalized_item = (
            _flatten_legacy_detail(item)
            if tool == "gateway_search_and_fetch"
            else item
        )
        records.append(
            _EvidenceRecord(
                event_index=event_index,
                tool=tool,
                stage=_legacy_stage(tool),
                item=normalized_item,
                event=event,
            )
        )
    # Legacy search-and-fetch traces can contain hydrated result items and
    # nested search candidates. These are different evidence stages, never an
    # either/or selection.
    for item in _mappings(event.get("search_result_items")):
        records.append(
            _EvidenceRecord(
                event_index=event_index,
                tool=tool,
                stage="search_discovery",
                item=item,
                event=event,
            )
        )
    for item in _mappings(event.get("detail_items")):
        records.append(
            _EvidenceRecord(
                event_index=event_index,
                tool=tool,
                stage="detail_hydration",
                item=item,
                event=event,
            )
        )
    return records


def _citation_kind(platform: str, item: _EvidenceRecord) -> str:
    if item.promoted:
        return "promoted"
    url = item.url
    if not url:
        return "missing_url"
    parts = _url_parts(url)
    host = (parts.hostname or "").casefold().rstrip(".")
    if parts.scheme.casefold() not in {"http", "https"} or not host:
        return "invalid_url"
    if _host_matches(host, _REDIRECT_OR_SEARCH_HOSTS):
        return "search_redirect"
    # A canonical content citation needs more than a platform bare homepage.
    if parts.path in {"", "/"}:
        return "platform_home" if platform in _PLATFORM_HOSTS else "home_url"
    if platform == "web":
        return "canonical"
    domains = _PLATFORM_HOSTS.get(platform)
    if domains and _host_matches(host, domains):
        return "canonical"
    return "external_url"


def _operation(event: Mapping[str, Any]) -> str:
    tool = _event_tool(event)
    args = _arguments(event)
    if tool in {"gateway_search", "gateway_search_and_fetch"}:
        return "keyword_search"
    if tool == "gateway_hotlist":
        return "hotlist_fetch"
    return str(args.get("action") or event.get("requested_action") or "").strip()


def _collection_mode(
    event: Mapping[str, Any],
    target: str,
    *,
    stage: str,
    executed_capability_id: str | None,
) -> str:
    args = _arguments(event)
    requested = _normalize_platform(args.get("platform"))
    site_platform = _platform_from_site(args.get("site")) if args.get("site") else ""
    operation = _operation(event)

    if stage == "hotlist" or operation == "hotlist_fetch":
        return "hotlist"
    if stage in {"detail_hydration", "known_detail"} or (
        operation and operation != "keyword_search"
    ):
        return "detail"
    if requested == "web" and site_platform == target and target != "web":
        return "external_discovery"
    if requested == target and target != "web":
        capability = str(executed_capability_id or "")
        return "native" if capability.startswith(f"{target}.") else "gateway_fallback"
    return "web"


def _successful_operations(
    event: Mapping[str, Any],
    target: str,
) -> list[tuple[str, Mapping[str, Any]]]:
    """Get successful operations without letting nested detail failure mask search."""

    tool = _event_tool(event)
    operations: list[tuple[str, Mapping[str, Any]]] = []
    nested = _nested_search(event)
    if tool == "gateway_search_and_fetch" and str(nested.get("status") or "") == "success":
        operations.append(
            (
                _collection_mode(
                    event,
                    target,
                    stage="search_discovery",
                    executed_capability_id=(
                        str(nested.get("executed_capability_id") or "").strip() or None
                    ),
                ),
                nested,
            )
        )
    if str(event.get("status") or "") == "success":
        operations.append(
            (
                _collection_mode(
                    event,
                    target,
                    stage=_legacy_stage(tool),
                    executed_capability_id=(
                        str(event.get("executed_capability_id") or "").strip() or None
                    ),
                ),
                event,
            )
        )
    return operations


def _successful_collection_modes(
    event: Mapping[str, Any],
    target: str,
) -> list[str]:
    return _unique(
        mode for mode, _envelope in _successful_operations(event, target)
    )


def _coverage_modes(coverage_status: str) -> set[str]:
    return {
        "native_success": {"native", "hotlist"},
        "gateway_fallback_success": {"gateway_fallback"},
        "external_discovery_only": {"external_discovery"},
        "detail_only": {"detail"},
        "web_search_success": {"web"},
    }.get(coverage_status, set())


def _coverage_flags(
    events: Iterable[Mapping[str, Any]],
    target: str,
    coverage_status: str,
) -> tuple[bool, bool]:
    """Return flags for the successful operation that established coverage.

    Platform-level degraded and partial remain intentionally broad: they
    summarize every observed event. These flags are narrower so an older
    degraded site discovery cannot make a later native Bilibili search look
    degraded.
    """

    winning_modes = _coverage_modes(coverage_status)
    matching_envelopes = [
        envelope
        for event in events
        for mode, envelope in _successful_operations(event, target)
        if mode in winning_modes
    ]
    return (
        any(bool(envelope.get("degraded")) for envelope in matching_envelopes),
        any(bool(envelope.get("partial")) for envelope in matching_envelopes),
    )


def _coverage_status(
    *,
    event_count: int,
    statuses: list[str],
    modes: list[str],
) -> str:
    if not event_count:
        return "not_attempted"
    if "native" in modes or "hotlist" in modes:
        return "native_success"
    if "gateway_fallback" in modes:
        return "gateway_fallback_success"
    if "external_discovery" in modes:
        return "external_discovery_only"
    if "detail" in modes:
        return "detail_only"
    if "web" in modes:
        return "web_search_success"
    for status in (
        "authentication_required",
        "source_unavailable",
        "misconfigured",
        "no_results",
        "error",
        "tool_error",
    ):
        if status in statuses:
            return status
    return "error"


def _claim_status(
    *,
    event_count: int,
    statuses: list[str],
    canonical_count: int,
) -> str:
    if not event_count:
        return "not_attempted"
    if canonical_count:
        return "citable"
    if "success" in statuses:
        return "uncitable"
    for status in (
        "authentication_required",
        "source_unavailable",
        "misconfigured",
        "no_results",
        "error",
        "tool_error",
    ):
        if status in statuses:
            return status
    return "uncitable"


def _count_mismatch_messages(event_index: int, event: Mapping[str, Any]) -> list[str]:
    """Detect explicit count/list divergence without inventing undocumented counts."""

    pairs = (
        ("result_item_count", "result_items"),
        ("search_result_item_count", "search_result_items"),
        ("detail_item_count", "detail_items"),
        ("evidence_item_count", "evidence_items"),
    )
    messages: list[str] = []
    for count_key, items_key in pairs:
        expected = event.get(count_key)
        items = event.get(items_key)
        if isinstance(expected, int) and not isinstance(expected, bool) and isinstance(items, list):
            if expected != len(items):
                messages.append(
                    f"event {event_index}: {count_key}={expected} but {items_key} has {len(items)} item(s)."
                )
    return messages


def _status_gap(status: str) -> str | None:
    return _STATUS_GAPS.get(status.strip().casefold())


def _artifact_label(artifact: Mapping[str, Any] | None) -> str:
    if not artifact:
        return ""
    for key in ("manifest_file", "raw_file"):
        value = str(artifact.get(key) or "").strip()
        if value:
            return value
    return "Gateway artifact"


def _markdown_cell(value: object) -> str:
    return str(value or "").replace("|", "\\|").replace("\n", " ").strip()


def _markdown_label(value: str) -> str:
    return value.replace("[", "\\[").replace("]", "\\]").replace("\n", " ").strip()


def audit_trace(
    trace: Iterable[Mapping[str, Any]],
    *,
    expected_platforms: Iterable[str] | None = None,
) -> AuditReport:
    """Turn a Gateway tool trace into deterministic platform evidence.

    The function is intentionally pure: it does not load artifacts, resolve
    redirects, inspect model text, or contact the Gateway. A trace v2
    evidence_items projection is preferred, while legacy result_items and
    search_result_items remain readable.
    """

    grouped: dict[str, list[tuple[int, Mapping[str, Any]]]] = {}
    ignored = 0
    for fallback_index, raw_event in enumerate(trace):
        if not isinstance(raw_event, Mapping) or _event_tool(raw_event) not in _EVIDENCE_TOOLS:
            ignored += 1
            continue
        platform = _target_platform(raw_event)
        grouped.setdefault(platform, []).append((_event_index(raw_event, fallback_index), raw_event))

    for platform in expected_platforms or ():
        normalized = _normalize_platform(platform)
        if normalized:
            grouped.setdefault(normalized, [])

    audits: list[PlatformAudit] = []
    for platform in sorted(grouped):
        indexed_events = grouped[platform]
        events = [event for _index, event in indexed_events]
        statuses = _unique(status for event in events for status in _event_statuses(event))
        modes = _unique(
            mode
            for event in events
            for mode in _successful_collection_modes(event, platform)
        )
        executed = _unique(
            capability
            for event in events
            for capability in _event_executed_capabilities(event)
        )
        attempted = _unique(
            capability
            for event in events
            for capability in _event_attempted_capabilities(event)
        )
        degraded = any(_event_is_degraded(event) for event in events)
        partial = any(_event_is_partial(event) for event in events)
        warnings = _unique(warning for event in events for warning in _event_warnings(event))
        errors = _unique(error for event in events for error in _event_errors(event))
        gaps: list[str] = []

        if not events:
            gaps.append("NOT_ATTEMPTED")
        if degraded:
            gaps.append("DEGRADED_CAPABILITY_CHAIN")
        if partial:
            gaps.append("PARTIAL_RESULT")
        for status in statuses:
            status_gap = _status_gap(status)
            if status_gap:
                gaps.append(status_gap)

        citations: list[Citation] = []
        for event_index, event in indexed_events:
            mismatch_messages = _count_mismatch_messages(event_index, event)
            if mismatch_messages:
                gaps.append("ITEM_COUNT_MISMATCH")
                warnings.extend(mismatch_messages)

            for record in _records_for_event(event_index, event):
                if record.degraded:
                    degraded = True
                    gaps.append("DEGRADED_CAPABILITY_CHAIN")
                if record.partial:
                    partial = True
                    gaps.append("PARTIAL_RESULT")
                warnings.extend(record.warnings)

                status_gap = _status_gap(record.status)
                if status_gap:
                    gaps.append(status_gap)
                if not record.successful:
                    if record.stage == "detail_hydration":
                        gaps.append("DETAIL_HYDRATION_FAILED")
                    continue

                if not record.executed_capability_id:
                    gaps.append("MISSING_EXECUTED_CAPABILITY_ID")
                kind = _citation_kind(platform, record)
                citation = Citation(
                    event_index=record.event_index,
                    tool=record.tool,
                    evidence_stage=record.stage,
                    rank=record.rank,
                    title=record.title,
                    url=record.url,
                    source=record.source,
                    promoted=record.promoted,
                    kind=kind,
                    executed_capability_id=record.executed_capability_id,
                    attempted_capabilities=record.attempted_capabilities,
                    degraded=record.degraded,
                    partial=record.partial,
                    raw_ref=record.raw_ref,
                    artifact=record.artifact,
                    warnings=record.warnings,
                )
                citations.append(citation)

                if kind == "search_redirect":
                    gaps.append("SEARCH_REDIRECT")
                elif kind == "promoted":
                    gaps.append("PROMOTED_RESULT")
                elif kind == "missing_url":
                    gaps.append("MISSING_URL")
                elif kind == "invalid_url":
                    gaps.append("INVALID_URL")
                elif kind in {"platform_home", "home_url"}:
                    gaps.append("PLATFORM_HOME")
                elif kind == "external_url":
                    gaps.append("NON_PLATFORM_URL")
                if not record.raw_ref and not record.artifact:
                    gaps.append("MISSING_RAW_EVIDENCE")

        canonical = tuple(citation for citation in citations if citation.kind == "canonical")
        noncanonical = tuple(citation for citation in citations if citation.kind != "canonical")
        coverage = _coverage_status(
            event_count=len(events),
            statuses=statuses,
            modes=modes,
        )
        coverage_degraded, coverage_partial = _coverage_flags(
            events,
            platform,
            coverage,
        )
        claim = _claim_status(
            event_count=len(events),
            statuses=statuses,
            canonical_count=len(canonical),
        )

        if platform in _PLATFORM_HOSTS and coverage != "native_success" and events:
            gaps.append("NATIVE_KEYWORD_SEARCH_NOT_OBSERVED")
        if coverage == "external_discovery_only":
            gaps.append("EXTERNAL_DISCOVERY_ONLY")
        elif coverage == "gateway_fallback_success":
            gaps.append("GATEWAY_FALLBACK_SUCCESS")
        elif coverage == "detail_only":
            gaps.append("DETAIL_ONLY")
        if events and not canonical:
            gaps.append("NO_CANONICAL_CITATION")

        audits.append(
            PlatformAudit(
                platform=platform,
                event_count=len(events),
                statuses=tuple(statuses),
                claim_status=claim,
                coverage_status=coverage,
                collection_modes=tuple(modes),
                executed_capabilities=tuple(executed),
                attempted_capabilities=tuple(attempted),
                degraded=degraded,
                partial=partial,
                coverage_degraded=coverage_degraded,
                coverage_partial=coverage_partial,
                canonical_citations=canonical,
                noncanonical_citations=noncanonical,
                warnings=tuple(_unique(warnings)),
                errors=tuple(errors),
                gaps=tuple(_unique(gaps)),
            )
        )
    return AuditReport(platforms=tuple(audits), ignored_event_count=ignored)


def render_markdown(report: AuditReport) -> str:
    """Render a concise Markdown view of the deterministic audit."""

    lines = [
        "# Gateway Citation Audit",
        "",
        "This audit is derived only from the Gateway tool trace. It does not trust",
        "model-written capability names, result counts, statuses, or URLs.",
        "",
        "| Platform | Coverage | Citation status | Collection mode | Gateway status | Executed capability | Coverage degraded / partial | Any observed degraded / partial | Canonical citations | Gaps |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for audit in report.platforms:
        lines.append(
            "| "
            + " | ".join(
                [
                    _markdown_cell(audit.platform or "web"),
                    _markdown_cell(audit.coverage_status),
                    _markdown_cell(audit.claim_status),
                    _markdown_cell(", ".join(audit.collection_modes) or "none"),
                    _markdown_cell(", ".join(audit.statuses) or "not_attempted"),
                    _markdown_cell(", ".join(audit.executed_capabilities) or "none"),
                    f"{str(audit.coverage_degraded).lower()} / {str(audit.coverage_partial).lower()}",
                    f"{str(audit.degraded).lower()} / {str(audit.partial).lower()}",
                    str(audit.canonical_citation_count),
                    _markdown_cell(", ".join(audit.gaps) or "none"),
                ]
            )
            + " |"
        )

    if not report.platforms:
        lines.extend(["", "No content-evidence Gateway events were observed."])
    for audit in report.platforms:
        lines.extend(["", f"## {audit.platform}"])
        if audit.canonical_citations:
            lines.extend(["", "Canonical citations:", ""])
            for citation in audit.canonical_citations:
                label = _markdown_label(citation.title or citation.url)
                provenance = [
                    f"event {citation.event_index}",
                    f"{citation.tool}/{citation.evidence_stage}",
                ]
                if citation.executed_capability_id:
                    provenance.append(citation.executed_capability_id)
                if citation.raw_ref:
                    provenance.append(f"raw_ref={citation.raw_ref}")
                artifact = _artifact_label(citation.artifact)
                if artifact:
                    provenance.append(f"artifact={artifact}")
                lines.append(f"- [{label}]({citation.url}) — {'; '.join(provenance)}")
        if audit.noncanonical_citations:
            lines.extend(["", "Excluded from canonical citation count:", ""])
            for citation in audit.noncanonical_citations:
                label = _markdown_label(citation.title or citation.url or "missing URL")
                location = f" ({citation.url})" if citation.url else ""
                lines.append(
                    f"- {citation.kind}: {label}{location} "
                    f"— event {citation.event_index}; "
                    f"{citation.tool}/{citation.evidence_stage}"
                )
        if audit.gaps:
            lines.extend(["", "Machine-readable gaps:", ""])
            for gap in audit.gaps:
                lines.append(f"- {gap}")
        if audit.warnings:
            lines.extend(["", "Warnings:", ""])
            for warning in audit.warnings:
                lines.append(f"- {warning}")
        if audit.errors:
            lines.extend(["", "Errors:", ""])
            for error in audit.errors:
                lines.append(f"- {error}")
    if report.ignored_event_count:
        lines.extend(["", f"Ignored non-content trace events: {report.ignored_event_count}."])
    return "\n".join(lines) + "\n"
