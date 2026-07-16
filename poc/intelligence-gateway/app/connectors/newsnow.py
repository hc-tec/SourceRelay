from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from html import unescape
from typing import Any

import httpx

from ..artifacts import RawArtifactStore
from ..config import Settings
from ..errors import SourceUnavailableError
from ..models import (
    ArtifactReference,
    HotlistPreviewItem,
    HotlistRequest,
    HotlistResponse,
    ResultStatus,
    SourceHealth,
)
from ..normalization import canonicalize_url


NEWSNOW_FEEDS_BY_PLATFORM: dict[str, tuple[str, ...]] = {
    "bilibili": (
        "bilibili-hot-search",
        "bilibili-hot-video",
        "bilibili-ranking",
    ),
    "weibo": ("weibo",),
    "zhihu": ("zhihu",),
    "douyin": ("douyin",),
    "kuaishou": ("kuaishou",),
    "tieba": ("tieba",),
    "36kr": ("36kr",),
    "thepaper": ("thepaper",),
}


class NewsNowHotlistConnector:
    provider = "newsnow"
    collector = "newsnow"
    maximum_payload_bytes = 5_000_000

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self.transport = transport
        self.artifacts = RawArtifactStore(settings.runtime_dir)

    @staticmethod
    def allowed_feeds(platform: str) -> tuple[str, ...]:
        return NEWSNOW_FEEDS_BY_PLATFORM.get(platform, ())

    def _validate_request(self, request: HotlistRequest) -> None:
        allowed = self.allowed_feeds(request.platform)
        if not allowed:
            raise SourceUnavailableError(
                f"NewsNow has no approved feed mapping for platform {request.platform}."
            )
        if request.feed_id not in allowed:
            raise SourceUnavailableError(
                f"Feed {request.feed_id} is not approved for platform {request.platform}.",
                warnings=[f"Allowed feed IDs: {', '.join(allowed)}"],
            )

    def _write_artifact(
        self,
        *,
        run_id: str,
        request: HotlistRequest,
        capability_id: str,
        source_url: str,
        status: ResultStatus,
        raw_bytes: bytes | None,
        media_type: str,
        fetched_at: datetime,
        http_status: int | None = None,
        provider_status: str | None = None,
        upstream_updated_at: int | str | None = None,
        error_type: str | None = None,
    ) -> ArtifactReference:
        return self.artifacts.write(
            provider=self.provider,
            fetched_at=fetched_at,
            raw_bytes=raw_bytes,
            media_type=media_type,
            manifest={
                "run_id": run_id,
                "platform": request.platform,
                "action": "hotlist_fetch",
                "feed_id": request.feed_id,
                "provider": self.provider,
                "capability_id": capability_id,
                "source_url": source_url,
                "status": status.value,
                "provider_status": provider_status,
                "from_cache": provider_status == "cache",
                "upstream_updated_at": upstream_updated_at,
                "http_status": http_status,
                "force_latest_requested": request.force_latest,
                "error_type": error_type,
            },
        )

    @staticmethod
    def _artifact_context(artifact: ArtifactReference) -> dict[str, Any]:
        return {"artifact": artifact.model_dump(mode="json")}

    @staticmethod
    def _preview_items(payload_items: list[Any], limit: int) -> list[HotlistPreviewItem]:
        items: list[HotlistPreviewItem] = []
        for row in payload_items:
            if not isinstance(row, dict):
                continue
            title = str(row.get("title") or "").strip()
            url = canonicalize_url(unescape(str(row.get("url") or "")))
            if not title or not url:
                continue
            items.append(
                HotlistPreviewItem(
                    rank=len(items) + 1,
                    external_id=str(row.get("id") or "").strip(),
                    title=title,
                    url=url,
                )
            )
            if len(items) >= limit:
                break
        return items

    async def fetch(
        self,
        request: HotlistRequest,
        *,
        capability_id: str,
    ) -> HotlistResponse:
        self._validate_request(request)
        started = time.perf_counter()
        run_id = str(uuid.uuid4())
        params: dict[str, str] = {"id": request.feed_id}
        if request.force_latest:
            params["latest"] = "true"

        source_url = f"{self.settings.newsnow_base_url}/api/s?id={request.feed_id}"
        if request.force_latest:
            source_url += "&latest=true"
        fetched_at = datetime.now(timezone.utc)
        raw_bytes: bytes | None = None
        media_type = "application/octet-stream"
        http_status: int | None = None

        try:
            async with httpx.AsyncClient(
                base_url=self.settings.newsnow_base_url,
                timeout=httpx.Timeout(min(self.settings.request_timeout, 60)),
                trust_env=False,
                follow_redirects=False,
                transport=self.transport,
            ) as client:
                async with client.stream("GET", "/api/s", params=params) as response:
                    http_status = response.status_code
                    source_url = str(response.request.url)
                    media_type = response.headers.get("content-type", "application/octet-stream")
                    chunks: list[bytes] = []
                    byte_count = 0
                    async for chunk in response.aiter_bytes():
                        byte_count += len(chunk)
                        if byte_count > self.maximum_payload_bytes:
                            raise SourceUnavailableError(
                                "NewsNow response exceeded the raw artifact size limit."
                            )
                        chunks.append(chunk)
                    raw_bytes = b"".join(chunks)
        except SourceUnavailableError as exc:
            artifact = self._write_artifact(
                run_id=run_id,
                request=request,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=raw_bytes,
                media_type=media_type,
                fetched_at=fetched_at,
                http_status=http_status,
                error_type=exc.__class__.__name__,
            )
            raise SourceUnavailableError(
                str(exc),
                warnings=[*exc.warnings, "A local failure artifact manifest was written."],
                context=self._artifact_context(artifact),
            ) from exc
        except httpx.HTTPError as exc:
            artifact = self._write_artifact(
                run_id=run_id,
                request=request,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=None,
                media_type=media_type,
                fetched_at=fetched_at,
                error_type=exc.__class__.__name__,
            )
            raise SourceUnavailableError(
                f"NewsNow request failed: {exc.__class__.__name__}.",
                warnings=["A local failure artifact manifest was written."],
                context=self._artifact_context(artifact),
            ) from exc

        if http_status != 200:
            artifact = self._write_artifact(
                run_id=run_id,
                request=request,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=raw_bytes,
                media_type=media_type,
                fetched_at=fetched_at,
                http_status=http_status,
                error_type="upstream_http_error",
            )
            raise SourceUnavailableError(
                f"NewsNow returned HTTP {http_status}.",
                warnings=["The upstream response body was retained as a local raw artifact."],
                context=self._artifact_context(artifact),
            )

        try:
            payload = json.loads((raw_bytes or b"").decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            artifact = self._write_artifact(
                run_id=run_id,
                request=request,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=raw_bytes,
                media_type=media_type,
                fetched_at=fetched_at,
                http_status=http_status,
                error_type=exc.__class__.__name__,
            )
            raise SourceUnavailableError(
                "NewsNow did not return valid UTF-8 JSON.",
                warnings=["The unparsed response was retained as a local raw artifact."],
                context=self._artifact_context(artifact),
            ) from exc

        provider_status = payload.get("status") if isinstance(payload, dict) else None
        response_feed_id = payload.get("id") if isinstance(payload, dict) else None
        payload_items = payload.get("items") if isinstance(payload, dict) else None
        upstream_updated_at = payload.get("updatedTime") if isinstance(payload, dict) else None
        schema_valid = (
            provider_status in {"success", "cache"}
            and response_feed_id == request.feed_id
            and isinstance(payload_items, list)
        )
        if not schema_valid:
            artifact = self._write_artifact(
                run_id=run_id,
                request=request,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=raw_bytes,
                media_type=media_type,
                fetched_at=fetched_at,
                http_status=http_status,
                provider_status=str(provider_status) if provider_status is not None else None,
                upstream_updated_at=upstream_updated_at,
                error_type="schema_mismatch",
            )
            raise SourceUnavailableError(
                "NewsNow response did not match the approved single-feed contract.",
                warnings=["The unmatched JSON was retained as a local raw artifact."],
                context=self._artifact_context(artifact),
            )

        preview_items = self._preview_items(payload_items, request.limit)
        if payload_items and not preview_items:
            artifact = self._write_artifact(
                run_id=run_id,
                request=request,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=raw_bytes,
                media_type=media_type,
                fetched_at=fetched_at,
                http_status=http_status,
                provider_status=provider_status,
                upstream_updated_at=upstream_updated_at,
                error_type="preview_contract_mismatch",
            )
            raise SourceUnavailableError(
                "NewsNow returned items but none had a usable title and public URL.",
                warnings=["The complete provider JSON remains available in the raw artifact."],
                context=self._artifact_context(artifact),
            )

        result_status = ResultStatus.SUCCESS if preview_items else ResultStatus.NO_RESULTS
        artifact = self._write_artifact(
            run_id=run_id,
            request=request,
            capability_id=capability_id,
            source_url=source_url,
            status=result_status,
            raw_bytes=raw_bytes,
            media_type=media_type,
            fetched_at=fetched_at,
            http_status=http_status,
            provider_status=provider_status,
            upstream_updated_at=upstream_updated_at,
        )
        warnings = [
            "The complete NewsNow JSON was retained locally; preview fields are not a content database.",
            "NewsNow hotlists are current or cached feeds, not arbitrary keyword search results.",
        ]
        if provider_status == "cache":
            warnings.append("NewsNow returned cached data; inspect upstream_updated_at before analysis.")
        if request.force_latest:
            warnings.append(
                "force_latest requested NewsNow latest=true, but source intervals and server state may still permit cached data."
            )
        if len(preview_items) < len(payload_items):
            warnings.append(
                f"Returned {len(preview_items)} preview item(s) from {len(payload_items)} raw provider item(s)."
            )
        return HotlistResponse(
            ok=bool(preview_items),
            status=result_status,
            platform=request.platform,
            feed_id=request.feed_id,
            provider=self.provider,
            provider_status=provider_status,
            from_cache=provider_status == "cache",
            upstream_updated_at=upstream_updated_at,
            fetched_at=fetched_at,
            duration_ms=round((time.perf_counter() - started) * 1000),
            item_count=len(preview_items),
            items=preview_items,
            artifact=artifact,
            warnings=warnings,
            error=None if preview_items else "NewsNow returned an empty feed.",
        )

    async def health(self) -> SourceHealth:
        details: dict[str, Any] = {"base_url": self.settings.newsnow_base_url}
        try:
            async with httpx.AsyncClient(
                base_url=self.settings.newsnow_base_url,
                timeout=httpx.Timeout(10),
                trust_env=False,
                follow_redirects=False,
                transport=self.transport,
            ) as client:
                response = await client.get("/api/latest")
            payload = response.json() if response.status_code == 200 else {}
            ready = response.status_code == 200 and isinstance(payload, dict) and bool(payload.get("v"))
            return SourceHealth(
                source=self.provider,
                status=ResultStatus.SUCCESS if ready else ResultStatus.SOURCE_UNAVAILABLE,
                ready=ready,
                collector=self.collector,
                details={
                    **details,
                    "http_status": response.status_code,
                    "version": payload.get("v") if isinstance(payload, dict) else None,
                },
                warnings=[] if ready else ["NewsNow /api/latest is not ready."],
            )
        except (httpx.HTTPError, ValueError) as exc:
            return SourceHealth(
                source=self.provider,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                ready=False,
                collector=self.collector,
                details=details,
                warnings=[f"NewsNow health check failed: {exc.__class__.__name__}."],
            )
