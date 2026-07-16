from __future__ import annotations

import asyncio
import html
import json
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..artifacts import RawArtifactStore
from ..config import Settings
from ..errors import AuthenticationRequiredError, GatewayError, MisconfiguredError, SourceUnavailableError
from ..models import (
    ResultStatus,
    SourceHealth,
    WeiboAccountPostsRequest,
    WeiboAccountPostsResponse,
    WeiboPostPreview,
)


_TAG = re.compile(r"<[^>]+>")
_FORBIDDEN_KEYS = {"user_token", "cookie", "cookies", "token", "stream_url", "stream_url_hd", "urls"}


def _contains_forbidden_key(value: Any) -> bool:
    if isinstance(value, dict):
        return any(
            str(key).casefold() in _FORBIDDEN_KEYS or _contains_forbidden_key(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(_contains_forbidden_key(item) for item in value)
    return False


class BrowserWingWeiboAccountConnector:
    provider = "browserwing-weibo"
    collector = "browserwing"
    collector_version = "1.1.1-beta.1"
    platform = "weibo"
    maximum_payload_bytes = 10_000_000

    def __init__(self, settings: Settings, *, lock: asyncio.Lock) -> None:
        self.settings = settings
        self.lock = lock
        self.artifacts = RawArtifactStore(settings.runtime_dir)

    @property
    def _binary(self) -> Path:
        return self.settings.browserwing_root / "node_modules" / "browserwing" / "bin" / "browserwing.exe"

    async def _run_adapter(self, request: WeiboAccountPostsRequest) -> dict[str, Any]:
        if not self.settings.browserwing_weibo_script.is_file():
            raise MisconfiguredError("BrowserWing Weibo adapter script is missing.")
        if not self._binary.is_file():
            raise MisconfiguredError("BrowserWing executable is missing.")

        staging = self.settings.runtime_dir / "raw" / "browserwing"
        staging.mkdir(parents=True, exist_ok=True)
        identifier = uuid.uuid4().hex
        output_path = staging / f"weibo-{identifier}.json"
        diagnostic_path = staging / f"weibo-{identifier}.log"
        command = [
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
            str(self.settings.browserwing_weibo_script), "-AccountId", request.account_id,
            "-Limit", str(request.limit), "-OutputPath", str(output_path),
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
                    raise SourceUnavailableError("BrowserWing Weibo adapter timed out.") from exc

            diagnostic = diagnostic_path.read_text(encoding="utf-8-sig", errors="replace")
            if process.returncode != 0:
                lowered = diagnostic.casefold()
                if "authentication_required" in lowered:
                    raise AuthenticationRequiredError(
                        "Weibo requires manual authentication in the isolated BrowserWing profile."
                    )
                raise SourceUnavailableError("BrowserWing Weibo adapter failed.")
            if not output_path.is_file():
                raise SourceUnavailableError("BrowserWing completed without writing its Weibo JSON output.")
            try:
                return json.loads(output_path.read_text(encoding="utf-8-sig"))
            except (OSError, json.JSONDecodeError) as exc:
                raise SourceUnavailableError("BrowserWing Weibo JSON output could not be parsed.") from exc
        finally:
            output_path.unlink(missing_ok=True)
            diagnostic_path.unlink(missing_ok=True)

    @staticmethod
    def _preview(value: str) -> str:
        text = html.unescape(_TAG.sub(" ", value))
        return " ".join(text.split())[:500]

    async def fetch(
        self, request: WeiboAccountPostsRequest, *, capability_id: str
    ) -> WeiboAccountPostsResponse:
        started = time.perf_counter()
        fetched_at = datetime.now(timezone.utc)
        run_id = str(uuid.uuid4())
        try:
            async with self.lock:
                payload = await self._run_adapter(request)
        except GatewayError as exc:
            artifact = self.artifacts.write(
                provider=self.provider,
                fetched_at=fetched_at,
                raw_bytes=None,
                media_type="application/json",
                manifest={
                    "run_id": run_id,
                    "platform": self.platform,
                    "action": "account_posts",
                    "provider": self.provider,
                    "provider_version": self.collector_version,
                    "capability_id": capability_id,
                    "account_id": request.account_id,
                    "limit": request.limit,
                    "source_url": f"https://m.weibo.cn/u/{request.account_id}",
                    "status": exc.status.value,
                    "profile_used": True,
                    "authentication_required": exc.status == ResultStatus.AUTHENTICATION_REQUIRED,
                    "cookies_exported": False,
                    "read_only": True,
                    "error_type": exc.__class__.__name__,
                },
            )
            exc.context.setdefault("artifact", artifact.model_dump(mode="json"))
            raise

        if payload.get("account_id") != request.account_id:
            raise SourceUnavailableError("Weibo adapter returned a different account than requested.")
        if _contains_forbidden_key(payload):
            raise SourceUnavailableError("Weibo adapter violated the public-field artifact contract.")

        items = list(payload.get("items") or [])[: request.limit]
        posts = [
            WeiboPostPreview(
                post_id=str(row.get("mid") or row.get("id") or ""),
                text_preview=self._preview(str(row.get("text_html") or "")),
                url=f"https://m.weibo.cn/status/{row.get('mid') or row.get('id')}",
                published_text=str(row.get("created_at") or ""),
            )
            for row in items
            if str(row.get("mid") or row.get("id") or "")
        ]
        raw_bytes = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(raw_bytes) > self.maximum_payload_bytes:
            raise SourceUnavailableError("Weibo response exceeded the 10 MB raw artifact limit.")
        status = ResultStatus.SUCCESS if posts else ResultStatus.NO_RESULTS
        artifact = self.artifacts.write(
            provider=self.provider,
            fetched_at=fetched_at,
            raw_bytes=raw_bytes,
            media_type="application/json",
            manifest={
                "run_id": run_id,
                "platform": self.platform,
                "action": "account_posts",
                "provider": self.provider,
                "provider_version": self.collector_version,
                "capability_id": capability_id,
                "account_id": request.account_id,
                "limit": request.limit,
                "source_url": f"https://m.weibo.cn/u/{request.account_id}",
                "status": status.value,
                "profile_used": True,
                "authentication_required": False,
                "cookies_exported": False,
                "read_only": True,
            },
        )
        return WeiboAccountPostsResponse(
            ok=bool(posts),
            status=status,
            provider=self.provider,
            account_id=request.account_id,
            account_name=str(payload.get("account_name") or ""),
            fetched_at=fetched_at,
            duration_ms=round((time.perf_counter() - started) * 1000),
            item_count=len(posts),
            posts=posts,
            artifact=artifact,
            warnings=[
                "Only the first anonymous public rendered page is read; no interaction or pagination is performed.",
                "The raw local artifact contains an explicit public-field allowlist, not the complete browser or Vue object.",
                "Browser credentials, storage and expiring media addresses are never exported.",
            ],
            error=None if posts else "The public account page returned no post cards.",
        )

    async def health(self) -> SourceHealth:
        details = {
            "adapter_script_exists": self.settings.browserwing_weibo_script.is_file(),
            "browserwing_binary_exists": self._binary.is_file(),
            "shared_profile_lock": True,
            "authentication": "not_required_for_verified_public_samples",
        }
        ready = details["adapter_script_exists"] and details["browserwing_binary_exists"]
        return SourceHealth(
            source=self.platform,
            status=ResultStatus.SUCCESS if ready else ResultStatus.MISCONFIGURED,
            ready=ready,
            collector=self.collector,
            details=details,
            warnings=["Health checks local files; fixed public accounts provide live verification."],
        )
