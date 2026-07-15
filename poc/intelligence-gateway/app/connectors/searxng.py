from __future__ import annotations

import time

import httpx

from ..config import Settings
from ..errors import SourceUnavailableError
from ..models import (
    ResultStatus,
    SearchItem,
    SearchRequest,
    SearchResponse,
    SourceHealth,
    SourceName,
)
from ..normalization import canonicalize_url, deduplicate_items
from .base import SearchConnector


class SearXNGConnector(SearchConnector):
    source = SourceName.WEB
    collector = "searxng"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _query(self, request: SearchRequest) -> str:
        return f"{request.query} site:{request.site}" if request.site else request.query

    def _normalize(self, request: SearchRequest, payload: dict) -> list[SearchItem]:
        items: list[SearchItem] = []
        for index, row in enumerate(payload.get("results") or [], start=1):
            url = canonicalize_url(str(row.get("url") or ""))
            if not url:
                continue
            engines = row.get("engines") or ([row.get("engine")] if row.get("engine") else [])
            category = row.get("category") or "web_result"
            if isinstance(category, list):
                category = category[0] if category else "web_result"
            items.append(
                SearchItem(
                    source=self.source,
                    query=request.query,
                    rank=index,
                    title=str(row.get("title") or "").strip(),
                    url=url,
                    published_text=str(row.get("publishedDate") or "").strip(),
                    snippet=str(row.get("content") or "").strip(),
                    metrics={"score": row.get("score"), "engines": engines},
                    content_type=str(category),
                    promoted=False,
                    collector=self.collector,
                    collector_version="",
                    partial=True,
                    raw_ref="",
                )
            )
        return deduplicate_items(items)[: request.limit]

    async def search(self, request: SearchRequest) -> SearchResponse:
        started = time.perf_counter()
        params = {
            "q": self._query(request),
            "format": "json",
            "language": request.language,
            "safesearch": "0",
        }
        try:
            async with httpx.AsyncClient(
                base_url=self.settings.searxng_base_url,
                timeout=httpx.Timeout(min(self.settings.request_timeout, 60)),
                trust_env=False,
            ) as client:
                response = await client.get("/search", params=params)
        except httpx.HTTPError as exc:
            raise SourceUnavailableError(f"SearXNG request failed: {exc.__class__.__name__}.") from exc
        if response.status_code != 200:
            raise SourceUnavailableError(f"SearXNG returned HTTP {response.status_code}.")
        try:
            payload = response.json()
        except ValueError as exc:
            raise SourceUnavailableError(
                "SearXNG did not return JSON. Ensure json is enabled in search.formats."
            ) from exc

        items = self._normalize(request, payload)
        duration_ms = round((time.perf_counter() - started) * 1000)
        warnings = [
            "SearXNG provides external discovery; result coverage depends on enabled upstream engines.",
            "Use the site field for domain-scoped discovery such as zhihu.com or news sites.",
        ]
        unavailable: list[str] = []
        for entry in payload.get("unresponsive_engines") or []:
            if isinstance(entry, (list, tuple)) and entry:
                engine = str(entry[0])
                reason = str(entry[1]) if len(entry) > 1 else "unavailable"
                unavailable.append(f"{engine}: {reason}")
            elif isinstance(entry, dict):
                engine = str(entry.get("engine") or entry.get("name") or "unknown")
                reason = str(entry.get("error") or entry.get("reason") or "unavailable")
                unavailable.append(f"{engine}: {reason}")
        if unavailable:
            warnings.append("Unresponsive upstream engines: " + "; ".join(unavailable[:5]))
        return SearchResponse(
            ok=bool(items),
            status=ResultStatus.SUCCESS if items else ResultStatus.NO_RESULTS,
            source=self.source,
            query=request.query,
            duration_ms=duration_ms,
            partial=True,
            item_count=len(items),
            items=items,
            warnings=warnings,
            error=None if items else "SearXNG returned no results.",
        )

    async def health(self) -> SourceHealth:
        details = {"base_url": self.settings.searxng_base_url, "json_format_required": True}
        try:
            async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
                response = await client.get(
                    f"{self.settings.searxng_base_url}/search",
                    params={"q": "healthcheck", "format": "json"},
                )
            ready = response.status_code == 200 and "application/json" in response.headers.get(
                "content-type", ""
            )
            return SourceHealth(
                source=self.source,
                status=ResultStatus.SUCCESS if ready else ResultStatus.SOURCE_UNAVAILABLE,
                ready=ready,
                collector=self.collector,
                details={**details, "http_status": response.status_code},
                warnings=[] if ready else ["SearXNG JSON search endpoint is not ready."],
            )
        except httpx.HTTPError as exc:
            return SourceHealth(
                source=self.source,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                ready=False,
                collector=self.collector,
                details=details,
                warnings=[f"SearXNG health check failed: {exc.__class__.__name__}."],
            )
