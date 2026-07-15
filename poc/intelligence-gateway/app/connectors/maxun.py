from __future__ import annotations

import hashlib
import time
from urllib.parse import quote

import httpx

from ..config import Settings
from ..errors import GatewayError, MisconfiguredError, SourceUnavailableError
from ..models import (
    ResultStatus,
    SearchItem,
    SearchRequest,
    SearchResponse,
    SourceHealth,
    SourceName,
    utc_now,
)
from ..normalization import canonicalize_url, deduplicate_items, is_bilibili_video_url
from ..storage import GatewayStore
from .base import SearchConnector


class MaxunBilibiliConnector(SearchConnector):
    source = SourceName.BILIBILI
    collector = "maxun"
    collector_version = "0.0.43"

    def __init__(self, settings: Settings, store: GatewayStore) -> None:
        self.settings = settings
        self.store = store

    def _api_key(self) -> str:
        try:
            value = self.settings.maxun_api_key_file.read_text(encoding="utf-8-sig").strip()
        except OSError as exc:
            raise MisconfiguredError("Maxun API key file is unavailable.") from exc
        if not value:
            raise MisconfiguredError("Maxun API key file is empty.")
        return value

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.settings.maxun_base_url,
            headers={"x-api-key": self._api_key()},
            timeout=httpx.Timeout(self.settings.request_timeout),
            trust_env=False,
        )

    @staticmethod
    def _target_url(query: str) -> str:
        return f"https://search.bilibili.com/all?keyword={quote(query, safe='')}"

    @staticmethod
    def _binding_key(query: str) -> str:
        return hashlib.sha256(query.strip().casefold().encode("utf-8")).hexdigest()

    async def _list_robots(self, client: httpx.AsyncClient) -> list[dict]:
        response = await client.get("/api/robots")
        if response.status_code != 200:
            raise SourceUnavailableError(f"Maxun GET /api/robots returned HTTP {response.status_code}.")
        payload = response.json()
        if payload.get("messageCode") != "success":
            raise SourceUnavailableError("Maxun robot listing did not return success.")
        return payload.get("robots", {}).get("items", [])

    async def _resolve_robot(self, client: httpx.AsyncClient, request: SearchRequest) -> dict:
        robots = await self._list_robots(client)
        template = next(
            (robot for robot in robots if robot.get("name") == self.settings.maxun_template_robot),
            None,
        )
        if template is None:
            raise MisconfiguredError(
                f'Maxun template robot "{self.settings.maxun_template_robot}" was not found.'
            )

        if request.query.casefold() == "deepseek":
            return template

        target_url = self._target_url(request.query)
        binding_key = self._binding_key(request.query)
        binding = self.store.get_binding(self.source.value, binding_key)
        if binding:
            bound = next((robot for robot in robots if robot.get("id") == binding["remote_id"]), None)
            if bound:
                return bound

        for robot in robots:
            parameters = robot.get("inputParameters") or []
            default_url = parameters[0].get("defaultValue") if parameters else None
            if default_url == target_url:
                self.store.set_binding(
                    self.source.value,
                    binding_key,
                    robot["id"],
                    robot.get("name", ""),
                    {"query": request.query, "target_url": target_url},
                )
                return robot

        duplicate = await client.post(
            f"/api/robots/{template['id']}/duplicate",
            json={"targetUrl": target_url},
        )
        if duplicate.status_code != 201:
            raise SourceUnavailableError(
                f"Maxun failed to duplicate the Bilibili template: HTTP {duplicate.status_code}."
            )
        robot = duplicate.json().get("robot")
        if not robot or not robot.get("id"):
            raise SourceUnavailableError("Maxun duplicate response did not include a Robot ID.")
        self.store.set_binding(
            self.source.value,
            binding_key,
            robot["id"],
            robot.get("name", ""),
            {"query": request.query, "target_url": target_url},
        )
        return robot

    @staticmethod
    def _list_rows(payload: dict) -> list[dict]:
        groups = payload.get("run", {}).get("data", {}).get("listData", {})
        for value in groups.values():
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
        return []

    def _normalize_rows(self, request: SearchRequest, payload: dict) -> list[SearchItem]:
        run_id = str(payload.get("run", {}).get("runId") or "")
        items: list[SearchItem] = []
        for index, row in enumerate(self._list_rows(payload), start=1):
            raw_url = str(row.get("Label 1") or "").strip()
            canonical_url = canonicalize_url(raw_url)
            promoted = not is_bilibili_video_url(canonical_url)
            if promoted and not request.include_promoted:
                continue
            author_url = canonicalize_url(str(row.get("Label 4") or ""))
            if not author_url.startswith("https://space.bilibili.com/"):
                author_url = ""
            warnings = ["Bilibili promoted or tracking row; canonical video URL omitted."] if promoted else []
            items.append(
                SearchItem(
                    source=self.source,
                    query=request.query,
                    rank=index,
                    title=str(row.get("Label 2") or "").strip(),
                    url="" if promoted else canonical_url,
                    author=str(row.get("Label 5") or "").strip(),
                    author_url=author_url,
                    published_text=str(row.get("Label 6") or "").strip(),
                    snippet="",
                    metrics={},
                    content_type="video",
                    promoted=promoted,
                    collector=self.collector,
                    collector_version=self.collector_version,
                    partial=True,
                    raw_ref=f"maxun-run:{run_id}" if run_id else "",
                    warnings=warnings,
                )
            )
        return deduplicate_items(items)[: request.limit]

    async def search(self, request: SearchRequest) -> SearchResponse:
        started = time.perf_counter()
        try:
            async with self._client() as client:
                robot = await self._resolve_robot(client, request)
                response = await client.post(f"/api/robots/{robot['id']}/runs", json={})
        except httpx.HTTPError as exc:
            raise SourceUnavailableError(f"Maxun request failed: {exc.__class__.__name__}.") from exc

        if response.status_code != 200:
            raise SourceUnavailableError(f"Maxun Robot run returned HTTP {response.status_code}.")
        payload = response.json()
        if payload.get("messageCode") != "success" or payload.get("run", {}).get("status") != "success":
            raise SourceUnavailableError("Maxun Robot run did not finish successfully.")

        items = self._normalize_rows(request, payload)
        duration_ms = round((time.perf_counter() - started) * 1000)
        promoted_count = sum(item.promoted for item in items)
        warnings = [
            "First rendered Bilibili result set only; pagination is not enabled.",
            "Maxun field labels are normalized from Label 1..6 by the gateway.",
        ]
        if promoted_count:
            warnings.append(f"{promoted_count} promoted/tracking rows were retained and marked promoted=true.")
        return SearchResponse(
            ok=bool(items),
            status=ResultStatus.SUCCESS if items else ResultStatus.NO_RESULTS,
            source=self.source,
            query=request.query,
            fetched_at=utc_now(),
            duration_ms=duration_ms,
            partial=True,
            item_count=len(items),
            items=items,
            warnings=warnings,
            error=None if items else "Maxun returned no normalized Bilibili items.",
        )

    async def health(self) -> SourceHealth:
        details = {
            "base_url": self.settings.maxun_base_url,
            "api_key_file_exists": self.settings.maxun_api_key_file.is_file(),
            "template_robot": self.settings.maxun_template_robot,
        }
        try:
            async with self._client() as client:
                robots = await self._list_robots(client)
            template_found = any(
                robot.get("name") == self.settings.maxun_template_robot for robot in robots
            )
            details.update({"robot_count": len(robots), "template_found": template_found})
            return SourceHealth(
                source=self.source,
                status=ResultStatus.SUCCESS if template_found else ResultStatus.MISCONFIGURED,
                ready=template_found,
                collector=self.collector,
                details=details,
                warnings=[] if template_found else ["Configured Maxun template Robot was not found."],
            )
        except GatewayError as exc:
            return SourceHealth(
                source=self.source,
                status=exc.status,
                ready=False,
                collector=self.collector,
                details=details,
                warnings=[str(exc)],
            )
        except (OSError, httpx.HTTPError) as exc:
            return SourceHealth(
                source=self.source,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                ready=False,
                collector=self.collector,
                details=details,
                warnings=[f"Maxun health check failed: {exc.__class__.__name__}."],
            )
