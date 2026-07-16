from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from ..artifacts import RawArtifactStore
from ..config import Settings
from ..errors import AuthenticationRequiredError, GatewayError, MisconfiguredError, SourceUnavailableError
from ..models import (
    ResultStatus,
    SourceHealth,
    VideoDetailPreview,
    VideoDetailRequest,
    VideoDetailResponse,
)


_VIDEO_PATH = re.compile(r"^/short-video/([A-Za-z0-9_-]{6,80})/?$")
_FORBIDDEN_KEYS = {"cookie", "cookies", "token", "stream_url", "play_url", "src", "url"}


def _contains_forbidden_key(value: Any) -> bool:
    if isinstance(value, dict):
        return any(
            str(key).casefold() in _FORBIDDEN_KEYS or _contains_forbidden_key(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(_contains_forbidden_key(item) for item in value)
    return False


class BrowserWingKuaishouVideoConnector:
    provider = "browserwing-kuaishou"
    collector = "browserwing"
    collector_version = "1.1.1-beta.1"
    platform = "kuaishou"
    maximum_payload_bytes = 5_000_000

    def __init__(self, settings: Settings, *, lock: asyncio.Lock) -> None:
        self.settings = settings
        self.lock = lock
        self.artifacts = RawArtifactStore(settings.runtime_dir)

    @property
    def _binary(self) -> Path:
        return self.settings.browserwing_root / "node_modules" / "browserwing" / "bin" / "browserwing.exe"

    @staticmethod
    def canonical_video_url(value: str) -> tuple[str, str]:
        try:
            parts = urlsplit(value)
        except ValueError as exc:
            raise GatewayError("Kuaishou video URL is invalid.", http_status=422) from exc
        match = _VIDEO_PATH.fullmatch(parts.path)
        if (
            parts.scheme != "https"
            or parts.hostname != "www.kuaishou.com"
            or parts.username
            or parts.password
            or parts.query
            or parts.fragment
            or not match
        ):
            raise GatewayError(
                "Only canonical public https://www.kuaishou.com/short-video/<id> URLs are allowed.",
                http_status=422,
            )
        video_id = match.group(1)
        return urlunsplit(("https", "www.kuaishou.com", f"/short-video/{video_id}", "", "")), video_id

    async def _run_adapter(self, video_id: str) -> dict[str, Any]:
        if not self.settings.browserwing_kuaishou_script.is_file():
            raise MisconfiguredError("BrowserWing Kuaishou adapter script is missing.")
        if not self._binary.is_file():
            raise MisconfiguredError("BrowserWing executable is missing.")

        staging = self.settings.runtime_dir / "raw" / "browserwing"
        staging.mkdir(parents=True, exist_ok=True)
        identifier = uuid.uuid4().hex
        output_path = staging / f"kuaishou-video-{identifier}.json"
        diagnostic_path = staging / f"kuaishou-video-{identifier}.log"
        command = [
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
            str(self.settings.browserwing_kuaishou_script), "-VideoId", video_id,
            "-OutputPath", str(output_path),
        ]
        try:
            with diagnostic_path.open("wb") as diagnostic_stream:
                process = await asyncio.create_subprocess_exec(
                    *command,
                    cwd=str(self.settings.browserwing_root),
                    stdout=diagnostic_stream,
                    stderr=asyncio.subprocess.STDOUT,
                )
                try:
                    await asyncio.wait_for(process.wait(), timeout=self.settings.request_timeout)
                except TimeoutError as exc:
                    if process.returncode is None:
                        cleanup = await asyncio.create_subprocess_exec(
                            "taskkill.exe", "/PID", str(process.pid), "/T", "/F",
                            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                        )
                        await cleanup.wait()
                        await process.wait()
                    raise SourceUnavailableError("BrowserWing Kuaishou adapter timed out.") from exc

            diagnostic = diagnostic_path.read_text(encoding="utf-8-sig", errors="replace")
            if process.returncode != 0:
                if "authentication_required" in diagnostic.casefold():
                    raise AuthenticationRequiredError(
                        "Kuaishou requires manual authentication in the isolated BrowserWing profile."
                    )
                raise SourceUnavailableError("BrowserWing Kuaishou adapter failed.")
            if not output_path.is_file():
                raise SourceUnavailableError("BrowserWing completed without writing Kuaishou video JSON output.")
            try:
                return json.loads(output_path.read_text(encoding="utf-8-sig"))
            except (OSError, json.JSONDecodeError) as exc:
                raise SourceUnavailableError("BrowserWing Kuaishou JSON output could not be parsed.") from exc
        finally:
            output_path.unlink(missing_ok=True)
            diagnostic_path.unlink(missing_ok=True)

    @staticmethod
    def _preview(value: object, maximum: int = 5_000) -> str:
        return " ".join(str(value or "").split())[:maximum]

    async def fetch(
        self, request: VideoDetailRequest, *, capability_id: str
    ) -> VideoDetailResponse:
        source_url, video_id = self.canonical_video_url(str(request.url))
        started = time.perf_counter()
        fetched_at = datetime.now(timezone.utc)
        run_id = str(uuid.uuid4())
        try:
            async with self.lock:
                payload = await self._run_adapter(video_id)
        except GatewayError as exc:
            artifact = self.artifacts.write(
                provider=self.provider,
                fetched_at=fetched_at,
                raw_bytes=None,
                media_type="application/json",
                manifest={
                    "run_id": run_id,
                    "platform": self.platform,
                    "action": "video_detail",
                    "provider": self.provider,
                    "provider_version": self.collector_version,
                    "capability_id": capability_id,
                    "source_url": source_url,
                    "video_id": video_id,
                    "status": exc.status.value,
                    "profile_used": True,
                    "authentication_required": exc.status == ResultStatus.AUTHENTICATION_REQUIRED,
                    "cookies_exported": False,
                    "media_url_exported": False,
                    "media_download_requested": False,
                    "read_only": True,
                    "error_type": exc.__class__.__name__,
                },
            )
            exc.context.setdefault("artifact", artifact.model_dump(mode="json"))
            raise

        if not isinstance(payload, dict) or payload.get("video_id") != video_id:
            raise SourceUnavailableError("Kuaishou adapter returned a different video than requested.")
        if _contains_forbidden_key(payload):
            raise SourceUnavailableError("Kuaishou adapter violated the metadata-only artifact contract.")
        title = self._preview(payload.get("title"), maximum=500)
        if payload.get("page_state") != "ok" or not title or payload.get("media_url_exported") is not False:
            raise SourceUnavailableError("Kuaishou metadata did not match the approved public video contract.")

        safe_payload = {
            "schema_version": 1,
            "platform": self.platform,
            "operation": "video_detail",
            "video_id": video_id,
            "title": title,
            "description": self._preview(payload.get("description")),
            "author_name": self._preview(payload.get("author_name"), maximum=300),
            "published_text": self._preview(payload.get("published_text"), maximum=200),
            "likes_text": self._preview(payload.get("likes_text"), maximum=100),
            "source_url": source_url,
            "query_scope": "anonymous-public-rendered-video-page",
            "page_state": "ok",
            "partial": True,
            "media_url_exported": False,
            "media_download_requested": False,
        }
        raw_bytes = json.dumps(safe_payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        artifact = self.artifacts.write(
            provider=self.provider,
            fetched_at=fetched_at,
            raw_bytes=raw_bytes,
            media_type="application/json",
            manifest={
                "run_id": run_id,
                "platform": self.platform,
                "action": "video_detail",
                "provider": self.provider,
                "provider_version": self.collector_version,
                "capability_id": capability_id,
                "source_url": source_url,
                "video_id": video_id,
                "status": ResultStatus.SUCCESS.value,
                "profile_used": True,
                "authentication_required": False,
                "cookies_exported": False,
                "media_url_exported": False,
                "media_download_requested": False,
                "read_only": True,
            },
        )
        return VideoDetailResponse(
            ok=True,
            status=ResultStatus.SUCCESS,
            platform=self.platform,
            provider=self.provider,
            provider_version=self.collector_version,
            fetched_at=fetched_at,
            duration_ms=round((time.perf_counter() - started) * 1000),
            video=VideoDetailPreview(external_id=video_id, title=title, url=source_url),
            artifact=artifact,
            warnings=[
                "Only public rendered metadata was read; no video bytes were downloaded.",
                "The video element's delivery URL was deliberately not exported.",
                "Browser credentials and storage were not exported; the shared Profile operation is read-only and serialized.",
            ],
        )

    async def health(self) -> SourceHealth:
        details = {
            "adapter_script_exists": self.settings.browserwing_kuaishou_script.is_file(),
            "browserwing_binary_exists": self._binary.is_file(),
            "shared_profile_lock": True,
            "authentication": "not_required_for_verified_public_samples",
            "media_download": False,
        }
        ready = details["adapter_script_exists"] and details["browserwing_binary_exists"]
        return SourceHealth(
            source=self.platform,
            status=ResultStatus.SUCCESS if ready else ResultStatus.MISCONFIGURED,
            ready=ready,
            collector=self.collector,
            details=details,
            warnings=["Health checks local files; fixed public videos provide live verification."],
        )
