from __future__ import annotations

import asyncio
import json
import time
import uuid
from pathlib import Path

from ..config import Settings
from ..errors import AuthenticationRequiredError, MisconfiguredError, SourceUnavailableError
from ..models import (
    ResultStatus,
    SearchItem,
    SearchRequest,
    SearchResponse,
    SourceHealth,
    SourceName,
    utc_now,
)
from ..normalization import canonicalize_url, deduplicate_items, is_xiaohongshu_note_url
from .base import SearchConnector


class BrowserWingXiaohongshuConnector(SearchConnector):
    source = SourceName.XIAOHONGSHU
    collector = "browserwing"
    collector_version = "1.1.1-beta.1"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = asyncio.Lock()

    @property
    def lock(self) -> asyncio.Lock:
        return self._lock

    @property
    def _binary(self) -> Path:
        return self.settings.browserwing_root / "node_modules" / "browserwing" / "bin" / "browserwing.exe"

    async def _run_adapter(self, request: SearchRequest) -> tuple[dict, str]:
        if not self.settings.browserwing_xhs_script.is_file():
            raise MisconfiguredError("BrowserWing Xiaohongshu adapter script is missing.")
        if not self._binary.is_file():
            raise MisconfiguredError("BrowserWing executable is missing.")

        raw_dir = self.settings.runtime_dir / "raw" / "browserwing"
        raw_dir.mkdir(parents=True, exist_ok=True)
        artifact_id = str(uuid.uuid4())
        output_path = raw_dir / f"xiaohongshu-{artifact_id}.json"
        diagnostic_path = raw_dir / f"xiaohongshu-{artifact_id}.log"
        command = [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(self.settings.browserwing_xhs_script),
            "-Keyword",
            request.query,
            "-Limit",
            str(request.limit),
            "-OutputPath",
            str(output_path),
        ]
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
                        "taskkill.exe",
                        "/PID",
                        str(process.pid),
                        "/T",
                        "/F",
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    await cleanup.wait()
                    await process.wait()
                raise SourceUnavailableError("BrowserWing Xiaohongshu adapter timed out.") from exc

        try:
            diagnostic = diagnostic_path.read_text(encoding="utf-8-sig", errors="replace")
        except OSError:
            diagnostic = ""
        if process.returncode != 0:
            lowered = diagnostic.casefold()
            if any(token in lowered for token in ("login", "登录", "no note cards", "登录态")):
                raise AuthenticationRequiredError(
                    "Xiaohongshu authentication is missing or expired in the isolated BrowserWing profile."
                )
            lines = [line.strip() for line in diagnostic.splitlines() if line.strip()]
            summary = lines[-1][:300] if lines else "No diagnostic output."
            raise SourceUnavailableError(
                "BrowserWing Xiaohongshu adapter failed.", warnings=[summary]
            )
        if not output_path.is_file():
            raise SourceUnavailableError("BrowserWing completed without writing its JSON artifact.")
        try:
            payload = json.loads(output_path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SourceUnavailableError("BrowserWing JSON artifact could not be parsed.") from exc
        return payload, str(output_path.relative_to(self.settings.runtime_dir))

    def _normalize(self, request: SearchRequest, payload: dict, raw_ref: str) -> list[SearchItem]:
        items: list[SearchItem] = []
        for index, row in enumerate(payload.get("items") or [], start=1):
            url = canonicalize_url(str(row.get("url") or ""))
            warnings: list[str] = []
            if url and not is_xiaohongshu_note_url(url):
                warnings.append("Unexpected Xiaohongshu URL shape.")
            items.append(
                SearchItem(
                    source=self.source,
                    query=request.query,
                    rank=index,
                    title=str(row.get("title") or "").strip(),
                    url=url,
                    author=str(row.get("author") or "").strip(),
                    published_text="",
                    snippet=str(row.get("text") or "").strip(),
                    metrics={"likes_text": str(row.get("likes") or "").strip()},
                    content_type="note",
                    promoted=False,
                    collector=self.collector,
                    collector_version=self.collector_version,
                    partial=True,
                    raw_ref=raw_ref,
                    warnings=warnings,
                )
            )
        return deduplicate_items(items)[: request.limit]

    async def search(self, request: SearchRequest) -> SearchResponse:
        started = time.perf_counter()
        async with self._lock:
            payload, raw_ref = await self._run_adapter(request)
        items = self._normalize(request, payload, raw_ref)
        duration_ms = round((time.perf_counter() - started) * 1000)
        if not items:
            raise AuthenticationRequiredError(
                "Xiaohongshu returned no canonical note cards; login may have expired or the page layout changed."
            )
        warnings = list(payload.get("warnings") or [])
        warnings.append("Results depend on an isolated, user-authenticated BrowserWing Chrome profile.")
        return SearchResponse(
            ok=True,
            status=ResultStatus.SUCCESS,
            source=self.source,
            query=request.query,
            duration_ms=duration_ms,
            partial=True,
            item_count=len(items),
            items=items,
            warnings=warnings,
        )

    async def health(self) -> SourceHealth:
        details = {
            "adapter_script_exists": self.settings.browserwing_xhs_script.is_file(),
            "browserwing_binary_exists": self._binary.is_file(),
            "profile_directory_exists": (
                self.settings.browserwing_root / "runtime" / "chrome-user-data"
            ).is_dir(),
            "authentication_state": "unknown_until_search",
        }
        ready = all(
            (details["adapter_script_exists"], details["browserwing_binary_exists"], details["profile_directory_exists"])
        )
        return SourceHealth(
            source=self.source,
            status=ResultStatus.SUCCESS if ready else ResultStatus.MISCONFIGURED,
            ready=ready,
            collector=self.collector,
            details=details,
            warnings=[
                "Health check confirms local files only; Xiaohongshu authentication is verified by an actual search."
            ],
        )
