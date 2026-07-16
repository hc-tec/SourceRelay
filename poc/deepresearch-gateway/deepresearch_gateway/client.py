from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

import httpx


_KNOWN_STATUSES = {
    "success",
    "no_results",
    "authentication_required",
    "source_unavailable",
    "misconfigured",
    "error",
}


@dataclass(frozen=True, slots=True)
class GatewayToolResult:
    """A structured tool result that never turns source failure into emptiness."""

    ok: bool
    status: str
    payload: dict[str, Any]
    http_status: int
    transport_error: str | None = None

    @property
    def partial(self) -> bool:
        return bool(self.payload.get("partial", False))

    @property
    def warnings(self) -> list[str]:
        value = self.payload.get("warnings", [])
        return [str(item) for item in value] if isinstance(value, list) else [str(value)]

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable object suitable for an Agent tool call."""

        # Keep the Gateway body intact.  The small envelope makes transport
        # failures distinguishable from a legitimate ``no_results`` response.
        return {
            "ok": self.ok,
            "status": self.status,
            "http_status": self.http_status,
            "transport_error": self.transport_error,
            **self.payload,
        }


class GatewayClient:
    """Async HTTP client for the Intelligence Gateway only.

    No search-provider SDK, browser, cookie or model credential is accepted by
    this class.  Its one network peer is the configured Gateway URL.
    """

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8765",
        *,
        timeout: float = 180,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        normalized = base_url.rstrip("/")
        if not normalized.startswith(("http://", "https://")):
            raise ValueError("Gateway base_url must be an HTTP(S) URL")
        self.base_url = normalized
        self.timeout = timeout
        self._client = client
        self._owns_client = client is None

    async def __aenter__(self) -> "GatewayClient":
        await self.start()
        return self

    async def __aexit__(self, _type: Any, _value: Any, _traceback: Any) -> None:
        await self.close()

    async def start(self) -> None:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout)

    async def close(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    async def _request(self, method: str, path: str, body: Mapping[str, Any] | None = None) -> GatewayToolResult:
        await self.start()
        assert self._client is not None
        try:
            response = await self._client.request(method, path, json=body)
        except httpx.HTTPError as exc:
            return GatewayToolResult(
                ok=False,
                status="source_unavailable",
                payload={
                    "error": "Intelligence Gateway could not be reached.",
                    "warnings": ["The research runtime did not call a direct search provider."],
                },
                http_status=503,
                transport_error=f"{exc.__class__.__name__}: {exc}",
            )
        try:
            payload = response.json()
        except ValueError:
            payload = {
                "ok": False,
                "status": "source_unavailable" if response.status_code >= 500 else "error",
                "error": "Intelligence Gateway returned a non-JSON response.",
                "warnings": [],
                "body_preview": response.text[:500],
            }
        if not isinstance(payload, dict):
            payload = {
                "ok": False,
                "status": "error",
                "error": "Intelligence Gateway returned an invalid JSON object.",
                "warnings": [],
            }
        raw_status = str(payload.get("status") or ("success" if response.is_success else "error"))
        status = raw_status if raw_status in _KNOWN_STATUSES else raw_status
        ok = bool(payload.get("ok", response.is_success)) and response.is_success
        return GatewayToolResult(
            ok=ok,
            status=status,
            payload=payload,
            http_status=response.status_code,
        )

    async def capabilities(
        self,
        *,
        platform: str | None = None,
        action: str | None = None,
        status: str | None = None,
    ) -> GatewayToolResult:
        params = {key: value for key, value in {"platform": platform, "action": action, "status": status}.items() if value}
        await self.start()
        assert self._client is not None
        try:
            response = await self._client.get("/capabilities", params=params)
        except httpx.HTTPError as exc:
            return GatewayToolResult(
                ok=False,
                status="source_unavailable",
                payload={"error": "Intelligence Gateway could not be reached.", "warnings": []},
                http_status=503,
                transport_error=f"{exc.__class__.__name__}: {exc}",
            )
        try:
            payload = response.json()
        except ValueError:
            payload = {"ok": False, "status": "error", "error": "Invalid Gateway response."}
        if not isinstance(payload, dict):
            payload = {"ok": False, "status": "error", "error": "Invalid Gateway response."}
        return GatewayToolResult(
            ok=response.is_success,
            status="success" if response.is_success else str(payload.get("status", "error")),
            payload=payload,
            http_status=response.status_code,
        )

    async def plan(
        self,
        *,
        platform: str,
        action: str,
        input: Mapping[str, Any] | None = None,
        allow_fallback: bool = True,
    ) -> GatewayToolResult:
        return await self._request(
            "POST",
            "/tasks/plan",
            {
                "platform": platform,
                "action": action,
                "input": dict(input or {}),
                "allow_fallback": allow_fallback,
            },
        )

    async def execute(
        self,
        *,
        platform: str,
        action: str,
        input: Mapping[str, Any] | None = None,
        allow_fallback: bool = True,
        fallback_on_no_results: bool = True,
        persistence: str = "none",
    ) -> GatewayToolResult:
        if persistence not in {"none", "result_only"}:
            raise ValueError("persistence must be 'none' or 'result_only'")
        return await self._request(
            "POST",
            "/tasks/execute",
            {
                "platform": platform,
                "action": action,
                "input": dict(input or {}),
                "options": {
                    "allow_fallback": allow_fallback,
                    "fallback_on_no_results": fallback_on_no_results,
                    "persistence": persistence,
                },
            },
        )

    async def search(
        self,
        *,
        query: str,
        platform: str = "web",
        limit: int = 10,
        site: str | None = None,
        allow_fallback: bool = True,
    ) -> GatewayToolResult:
        if not query.strip():
            raise ValueError("query must not be empty")
        search_input: dict[str, Any] = {"query": query, "limit": limit}
        if site:
            search_input["site"] = site
        return await self.execute(
            platform=platform,
            action="keyword_search",
            input=search_input,
            allow_fallback=allow_fallback,
            persistence="none",
        )

    async def search_and_fetch(
        self,
        *,
        query: str,
        platform: str = "web",
        search_limit: int = 10,
        detail_limit: int = 3,
        include_tables: bool = True,
        allow_fallback: bool = True,
    ) -> GatewayToolResult:
        if not query.strip():
            raise ValueError("query must not be empty")
        return await self._request(
            "POST",
            "/tasks/search-and-fetch",
            {
                "platform": platform,
                "query": query,
                "search_limit": search_limit,
                "detail_limit": detail_limit,
                "include_tables": include_tables,
                "options": {
                    "allow_fallback": allow_fallback,
                    "fallback_on_no_results": True,
                    "persistence": "none",
                },
            },
        )

    async def hotlist(
        self,
        *,
        platform: str,
        feed_id: str,
        limit: int = 10,
        force_latest: bool = False,
    ) -> GatewayToolResult:
        return await self.execute(
            platform=platform,
            action="hotlist_fetch",
            input={"feed_id": feed_id, "limit": limit, "force_latest": force_latest},
            persistence="none",
        )

    async def fetch_detail(
        self,
        *,
        platform: str,
        action: str,
        input: Mapping[str, Any],
        allow_fallback: bool = True,
    ) -> GatewayToolResult:
        if action not in {
            "detail_fetch",
            "article_extract",
            "video_detail",
            "article_detail",
            "qa_detail",
            "post_detail",
            "forum_threads",
            "account_posts",
        }:
            raise ValueError("action is not an allowed detail/read capability")
        return await self.execute(
            platform=platform,
            action=action,
            input=input,
            allow_fallback=allow_fallback,
            persistence="none",
        )
