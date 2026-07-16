from __future__ import annotations

import asyncio
import json
import re
import sys
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from ..artifacts import RawArtifactStore
from ..config import Settings
from ..errors import AuthenticationRequiredError, GatewayError, SourceUnavailableError
from ..models import (
    ArtifactReference,
    ResultStatus,
    SourceHealth,
    VideoDetailPreview,
    VideoDetailRequest,
    VideoDetailResponse,
)
from ..normalization import canonicalize_url


_BILIBILI_VIDEO_PATH = re.compile(r"^/video/(?:BV[0-9A-Za-z]+|av[0-9]+)/?$", re.IGNORECASE)
_RESTRICTED_AVAILABILITY = {"needs_auth", "premium_only", "subscriber_only"}


@dataclass(slots=True)
class CommandResult:
    returncode: int
    stdout: bytes
    stderr: bytes


Runner = Callable[[list[str], float], Awaitable[CommandResult]]


async def run_command(arguments: list[str], timeout: float) -> CommandResult:
    process = await asyncio.create_subprocess_exec(
        *arguments,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except TimeoutError:
        process.kill()
        await process.communicate()
        raise
    return CommandResult(
        returncode=process.returncode or 0,
        stdout=stdout,
        stderr=stderr,
    )


class YtDlpBilibiliVideoConnector:
    provider = "yt-dlp"
    collector = "yt-dlp"
    platform = "bilibili"
    maximum_payload_bytes = 10_000_000

    def __init__(
        self,
        settings: Settings,
        *,
        runner: Runner = run_command,
    ) -> None:
        self.settings = settings
        self.runner = runner
        self.artifacts = RawArtifactStore(settings.runtime_dir)

    @staticmethod
    def provider_version() -> str:
        try:
            return version("yt-dlp")
        except PackageNotFoundError:
            return ""

    @staticmethod
    def canonical_video_url(value: str) -> str:
        canonical = canonicalize_url(value)
        try:
            parts = urlsplit(canonical)
        except ValueError as exc:
            raise GatewayError("Bilibili video URL is invalid.", http_status=422) from exc
        if (
            parts.scheme != "https"
            or parts.hostname != "www.bilibili.com"
            or parts.username
            or parts.password
            or not _BILIBILI_VIDEO_PATH.fullmatch(parts.path)
        ):
            raise GatewayError(
                "Only canonical public https://www.bilibili.com/video/BV... URLs are allowed.",
                http_status=422,
            )
        query = parse_qsl(parts.query, keep_blank_values=True)
        if any(key != "p" or not value.isdigit() for key, value in query):
            raise GatewayError(
                "Bilibili video URL query may contain only a numeric p parameter.",
                http_status=422,
            )
        path = parts.path.rstrip("/")
        return urlunsplit(("https", "www.bilibili.com", path, urlencode(query), ""))

    def _arguments(self, source_url: str) -> list[str]:
        arguments = [
            sys.executable,
            "-m",
            "yt_dlp",
            "--ignore-config",
            "--no-config-locations",
            "--no-playlist",
            "--skip-download",
            "--dump-single-json",
            "--no-warnings",
            "--no-progress",
            "--socket-timeout",
            "30",
            "--retries",
            "1",
            "--extractor-retries",
            "1",
        ]
        if self.settings.ytdlp_proxy:
            arguments.extend(["--proxy", self.settings.ytdlp_proxy])
        arguments.append(source_url)
        return arguments

    def _write_artifact(
        self,
        *,
        run_id: str,
        capability_id: str,
        source_url: str,
        status: ResultStatus,
        raw_bytes: bytes | None,
        fetched_at: datetime,
        returncode: int | None = None,
        error_type: str | None = None,
        availability: str | None = None,
    ) -> ArtifactReference:
        return self.artifacts.write(
            provider=self.provider,
            fetched_at=fetched_at,
            raw_bytes=raw_bytes,
            media_type="application/json",
            manifest={
                "run_id": run_id,
                "platform": self.platform,
                "action": "video_detail",
                "provider": self.provider,
                "provider_version": self.provider_version(),
                "capability_id": capability_id,
                "source_url": source_url,
                "status": status.value,
                "returncode": returncode,
                "availability": availability,
                "proxy_used": bool(self.settings.ytdlp_proxy),
                "global_config_ignored": True,
                "cookies_used": False,
                "media_download_requested": False,
                "error_type": error_type,
            },
        )

    @staticmethod
    def _artifact_context(artifact: ArtifactReference) -> dict[str, Any]:
        return {"artifact": artifact.model_dump(mode="json")}

    async def fetch(
        self,
        request: VideoDetailRequest,
        *,
        capability_id: str,
    ) -> VideoDetailResponse:
        source_url = self.canonical_video_url(str(request.url))
        started = time.perf_counter()
        fetched_at = datetime.now(timezone.utc)
        run_id = str(uuid.uuid4())
        timeout = min(max(self.settings.request_timeout, 10), 180)
        try:
            command = await self.runner(self._arguments(source_url), timeout)
        except TimeoutError as exc:
            artifact = self._write_artifact(
                run_id=run_id,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=None,
                fetched_at=fetched_at,
                error_type="timeout",
            )
            raise SourceUnavailableError(
                "yt-dlp metadata extraction timed out.",
                warnings=["No media download was attempted."],
                context=self._artifact_context(artifact),
            ) from exc
        except OSError as exc:
            artifact = self._write_artifact(
                run_id=run_id,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.MISCONFIGURED,
                raw_bytes=None,
                fetched_at=fetched_at,
                error_type=exc.__class__.__name__,
            )
            raise GatewayError(
                "yt-dlp could not be started.",
                status=ResultStatus.MISCONFIGURED,
                http_status=503,
                warnings=["Install the pinned yt-dlp Python dependency."],
                context=self._artifact_context(artifact),
            ) from exc

        stdout = command.stdout
        if len(stdout) > self.maximum_payload_bytes:
            artifact = self._write_artifact(
                run_id=run_id,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=None,
                fetched_at=fetched_at,
                returncode=command.returncode,
                error_type="payload_too_large",
            )
            raise SourceUnavailableError(
                "yt-dlp metadata exceeded the 10 MB raw artifact limit.",
                context=self._artifact_context(artifact),
            )

        if command.returncode != 0:
            artifact = self._write_artifact(
                run_id=run_id,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=stdout or None,
                fetched_at=fetched_at,
                returncode=command.returncode,
                error_type="yt_dlp_failed",
            )
            raise SourceUnavailableError(
                f"yt-dlp metadata extraction exited with code {command.returncode}.",
                warnings=[
                    "No media download was attempted.",
                    "Subprocess stderr is intentionally omitted from artifacts and API responses.",
                ],
                context=self._artifact_context(artifact),
            )

        try:
            payload = json.loads(stdout.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            artifact = self._write_artifact(
                run_id=run_id,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=stdout,
                fetched_at=fetched_at,
                returncode=command.returncode,
                error_type=exc.__class__.__name__,
            )
            raise SourceUnavailableError(
                "yt-dlp did not return valid UTF-8 JSON metadata.",
                context=self._artifact_context(artifact),
            ) from exc

        extractor_key = str(payload.get("extractor_key") or "") if isinstance(payload, dict) else ""
        external_id = str(payload.get("id") or "").strip() if isinstance(payload, dict) else ""
        title = str(payload.get("title") or "").strip() if isinstance(payload, dict) else ""
        availability = str(payload.get("availability") or "").strip() if isinstance(payload, dict) else ""
        if availability in _RESTRICTED_AVAILABILITY:
            artifact = self._write_artifact(
                run_id=run_id,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.AUTHENTICATION_REQUIRED,
                raw_bytes=stdout,
                fetched_at=fetched_at,
                returncode=command.returncode,
                availability=availability,
                error_type="restricted_availability",
            )
            raise AuthenticationRequiredError(
                "The video metadata indicates login, premium or subscriber-only availability.",
                warnings=["The Gateway will not supply cookies or bypass access controls."],
                context=self._artifact_context(artifact),
            )
        if (
            not isinstance(payload, dict)
            or payload.get("_type") in {"playlist", "multi_video"}
            or not extractor_key.casefold().startswith("bilibili")
            or not external_id
            or not title
        ):
            artifact = self._write_artifact(
                run_id=run_id,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=stdout,
                fetched_at=fetched_at,
                returncode=command.returncode,
                availability=availability or None,
                error_type="schema_mismatch",
            )
            raise SourceUnavailableError(
                "yt-dlp metadata did not match the approved single Bilibili video contract.",
                warnings=["The complete unmatched JSON remains available in the raw artifact."],
                context=self._artifact_context(artifact),
            )

        artifact = self._write_artifact(
            run_id=run_id,
            capability_id=capability_id,
            source_url=source_url,
            status=ResultStatus.SUCCESS,
            raw_bytes=stdout,
            fetched_at=fetched_at,
            returncode=command.returncode,
            availability=availability or None,
        )
        return VideoDetailResponse(
            ok=True,
            status=ResultStatus.SUCCESS,
            platform=self.platform,
            provider=self.provider,
            provider_version=self.provider_version(),
            fetched_at=fetched_at,
            duration_ms=round((time.perf_counter() - started) * 1000),
            video=VideoDetailPreview(
                external_id=external_id,
                title=title,
                url=source_url,
            ),
            artifact=artifact,
            warnings=[
                "The complete yt-dlp JSON was retained locally; preview fields are not a content database.",
                "yt-dlp global configuration was ignored, no cookies were supplied and no media download was attempted.",
                "Raw formats may contain time-limited public media delivery URLs; keep artifacts local and apply a retention policy.",
            ],
        )

    async def health(self) -> SourceHealth:
        provider_version = self.provider_version()
        ready = bool(provider_version)
        return SourceHealth(
            source=self.provider,
            status=ResultStatus.SUCCESS if ready else ResultStatus.MISCONFIGURED,
            ready=ready,
            collector=self.collector,
            details={
                "version": provider_version or None,
                "python": sys.executable,
                "proxy_configured": bool(self.settings.ytdlp_proxy),
                "network_access_verified_on_execute": True,
            },
            warnings=[] if ready else ["The pinned yt-dlp Python dependency is not installed."],
        )
