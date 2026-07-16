from __future__ import annotations

import asyncio
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
    ZhihuAnswerPreview,
    ZhihuQaDetailRequest,
    ZhihuQaDetailResponse,
)


_QUESTION_ID = re.compile(r"^[0-9]{1,20}$")
_ANSWER_ID = re.compile(r"^[0-9]{1,30}$")
_PUBLIC_ANSWER_URL = re.compile(r"^https://www\.zhihu\.com/question/[0-9]{1,20}/answer/[0-9]{1,30}$")
_PUBLIC_PEOPLE_URL = re.compile(r"^https://www\.zhihu\.com/people/[^/?#]+$")
_FORBIDDEN_KEYS = {"cookie", "cookies", "token", "zd_token", "localstorage", "sessionstorage"}


def _contains_forbidden_key(value: Any) -> bool:
    if isinstance(value, dict):
        return any(
            str(key).casefold() in _FORBIDDEN_KEYS or _contains_forbidden_key(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(_contains_forbidden_key(item) for item in value)
    return False


class BrowserWingZhihuQaConnector:
    provider = "browserwing-zhihu"
    collector = "browserwing"
    collector_version = "1.1.1-beta.1"
    platform = "zhihu"
    maximum_payload_bytes = 15_000_000

    def __init__(self, settings: Settings, *, lock: asyncio.Lock) -> None:
        self.settings = settings
        self.lock = lock
        self.artifacts = RawArtifactStore(settings.runtime_dir)

    @property
    def _binary(self) -> Path:
        return self.settings.browserwing_root / "node_modules" / "browserwing" / "bin" / "browserwing.exe"

    async def _run_adapter(self, request: ZhihuQaDetailRequest) -> dict[str, Any]:
        if not self.settings.browserwing_zhihu_script.is_file():
            raise MisconfiguredError("BrowserWing Zhihu QA adapter script is missing.")
        if not self._binary.is_file():
            raise MisconfiguredError("BrowserWing executable is missing.")

        staging = self.settings.runtime_dir / "raw" / "browserwing"
        staging.mkdir(parents=True, exist_ok=True)
        identifier = uuid.uuid4().hex
        output_path = staging / f"zhihu-qa-{identifier}.json"
        diagnostic_path = staging / f"zhihu-qa-{identifier}.log"
        command = [
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
            str(self.settings.browserwing_zhihu_script), "-QuestionId", request.question_id,
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
                    raise SourceUnavailableError("BrowserWing Zhihu QA adapter timed out.") from exc

            diagnostic = diagnostic_path.read_text(encoding="utf-8-sig", errors="replace")
            if process.returncode != 0:
                if "authentication_required" in diagnostic.casefold():
                    raise AuthenticationRequiredError(
                        "Zhihu requires manual authentication in the isolated BrowserWing profile."
                    )
                raise SourceUnavailableError("BrowserWing Zhihu QA adapter failed.")
            if not output_path.is_file():
                raise SourceUnavailableError("BrowserWing completed without writing its Zhihu QA JSON output.")
            try:
                return json.loads(output_path.read_text(encoding="utf-8-sig"))
            except (OSError, json.JSONDecodeError) as exc:
                raise SourceUnavailableError("BrowserWing Zhihu QA JSON output could not be parsed.") from exc
        finally:
            output_path.unlink(missing_ok=True)
            diagnostic_path.unlink(missing_ok=True)

    @staticmethod
    def _preview(value: object, maximum: int = 2_000) -> str:
        return " ".join(str(value or "").split())[:maximum]

    @staticmethod
    def _safe_answer_url(question_id: str, row: dict[str, Any]) -> str:
        answer_id = str(row.get("answer_id") or "").strip()
        candidate = str(row.get("answer_url") or "").split("?", 1)[0].split("#", 1)[0]
        if _PUBLIC_ANSWER_URL.fullmatch(candidate) and f"/question/{question_id}/" in candidate:
            return candidate
        if _ANSWER_ID.fullmatch(answer_id):
            return f"https://www.zhihu.com/question/{question_id}/answer/{answer_id}"
        return ""

    @staticmethod
    def _safe_people_url(value: object) -> str:
        candidate = str(value or "").split("?", 1)[0].split("#", 1)[0]
        return candidate if _PUBLIC_PEOPLE_URL.fullmatch(candidate) else ""

    async def fetch(
        self, request: ZhihuQaDetailRequest, *, capability_id: str
    ) -> ZhihuQaDetailResponse:
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
                    "action": "qa_detail",
                    "provider": self.provider,
                    "provider_version": self.collector_version,
                    "capability_id": capability_id,
                    "question_id": request.question_id,
                    "limit": request.limit,
                    "source_url": f"https://www.zhihu.com/question/{request.question_id}",
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

        if not isinstance(payload, dict) or payload.get("question_id") != request.question_id:
            raise SourceUnavailableError("Zhihu QA adapter returned a different question than requested.")
        if _contains_forbidden_key(payload):
            raise SourceUnavailableError("Zhihu QA adapter violated the public-field artifact contract.")

        rows = list(payload.get("answers") or [])[: request.limit]
        answers: list[ZhihuAnswerPreview] = []
        safe_rows: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            answer_id = str(row.get("answer_id") or "").strip()
            answer_url = self._safe_answer_url(request.question_id, row)
            if not _ANSWER_ID.fullmatch(answer_id) or not answer_url:
                continue
            text = self._preview(row.get("text"), maximum=50_000)
            if not text:
                continue
            safe_row = {
                "answer_id": answer_id,
                "answer_url": answer_url,
                "author_name": self._preview(row.get("author_name"), maximum=200),
                "author_url": self._safe_people_url(row.get("author_url")),
                "author_headline": self._preview(row.get("author_headline"), maximum=500),
                "text": text,
                "text_length": int(row.get("text_length") or len(text)),
                "published_text": self._preview(row.get("published_text"), maximum=200),
                "text_truncated": bool(row.get("text_truncated")),
            }
            safe_rows.append(safe_row)
            answers.append(
                ZhihuAnswerPreview(
                    answer_id=answer_id,
                    answer_url=answer_url,
                    author_name=safe_row["author_name"],
                    author_url=safe_row["author_url"],
                    author_headline=safe_row["author_headline"],
                    text_preview=self._preview(text),
                    published_text=safe_row["published_text"],
                    text_truncated=safe_row["text_truncated"],
                )
            )

        safe_payload = {
            "schema_version": 1,
            "platform": self.platform,
            "operation": "qa_detail",
            "question_id": request.question_id,
            "question_title": self._preview(payload.get("question_title"), maximum=500),
            "question_text": self._preview(payload.get("question_text"), maximum=10_000),
            "topics": [self._preview(item, maximum=100) for item in (payload.get("topics") or [])[:20]],
            "source_url": f"https://www.zhihu.com/question/{request.question_id}",
            "query_scope": "anonymous-public-rendered-question-first-answers",
            "page_state": str(payload.get("page_state") or "ok"),
            "partial": True,
            "item_count": len(safe_rows),
            "answers": safe_rows,
        }
        raw_bytes = json.dumps(safe_payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(raw_bytes) > self.maximum_payload_bytes:
            raise SourceUnavailableError("Zhihu QA response exceeded the 15 MB raw artifact limit.")
        status = ResultStatus.SUCCESS if answers else ResultStatus.NO_RESULTS
        artifact = self.artifacts.write(
            provider=self.provider,
            fetched_at=fetched_at,
            raw_bytes=raw_bytes,
            media_type="application/json",
            manifest={
                "run_id": run_id,
                "platform": self.platform,
                "action": "qa_detail",
                "provider": self.provider,
                "provider_version": self.collector_version,
                "capability_id": capability_id,
                "question_id": request.question_id,
                "limit": request.limit,
                "source_url": f"https://www.zhihu.com/question/{request.question_id}",
                "status": status.value,
                "profile_used": True,
                "authentication_required": False,
                "cookies_exported": False,
                "read_only": True,
                "partial": True,
            },
        )
        return ZhihuQaDetailResponse(
            ok=bool(answers),
            status=status,
            provider=self.provider,
            question_id=request.question_id,
            question_title=self._preview(payload.get("question_title"), maximum=500),
            question_text_preview=self._preview(payload.get("question_text")),
            fetched_at=fetched_at,
            duration_ms=round((time.perf_counter() - started) * 1000),
            item_count=len(answers),
            answers=answers,
            artifact=artifact,
            warnings=[
                "Only the first rendered public answer cards are read; no answer expansion, comments, pagination or interaction is performed.",
                "The raw local artifact uses an explicit public-field allowlist and stores visible answer text rather than the complete page state.",
                "Browser credentials, storage and expiring entity-link addresses are never exported.",
            ],
            error=None if answers else "The public Zhihu question returned no readable answers.",
        )

    async def health(self) -> SourceHealth:
        details = {
            "adapter_script_exists": self.settings.browserwing_zhihu_script.is_file(),
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
            warnings=["Health checks local files; fixed public questions provide live verification."],
        )
