from __future__ import annotations

import dataclasses
import json
import time
import uuid
from datetime import datetime, timezone
from enum import Enum
from importlib.metadata import PackageNotFoundError, version
from typing import Any

import aiotieba

from ..artifacts import RawArtifactStore
from ..config import Settings
from ..errors import SourceUnavailableError
from ..models import (
    ArtifactReference,
    ForumThreadPreview,
    ForumThreadsRequest,
    ForumThreadsResponse,
    PostDetailRequest,
    PostDetailResponse,
    PostPreview,
    ResultStatus,
    SourceHealth,
)


_SENSITIVE_FIELD_NAMES = {
    "account",
    "bduss",
    "cookie",
    "cookies",
    "stoken",
    "token",
}


def _public_json_value(value: Any) -> Any:
    """Convert aiotieba response dataclasses without traversing clients or credentials."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Enum):
        return value.value
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        converted: dict[str, Any] = {}
        for field in dataclasses.fields(value):
            name = field.name.casefold()
            if name == "err" or name in _SENSITIVE_FIELD_NAMES or name.startswith("_"):
                continue
            converted[field.name] = _public_json_value(getattr(value, field.name))
        return converted
    if isinstance(value, dict):
        return {
            str(key): _public_json_value(item)
            for key, item in value.items()
            if str(key).casefold() not in _SENSITIVE_FIELD_NAMES
            and not str(key).startswith("_")
        }
    if isinstance(value, (list, tuple, set)):
        return [_public_json_value(item) for item in value]
    # yarl.URL and other provider scalar value objects are represented safely as text.
    return str(value)


class AiotiebaReadConnector:
    provider = "aiotieba"
    collector = "aiotieba"
    platform = "tieba"
    maximum_payload_bytes = 20_000_000

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.artifacts = RawArtifactStore(settings.runtime_dir)

    @staticmethod
    def provider_version() -> str:
        try:
            return version("aiotieba")
        except PackageNotFoundError:
            return ""

    def _client(self) -> aiotieba.Client:
        # Explicit empty credentials keep this connector anonymous and read-only.
        return aiotieba.Client(BDUSS="", STOKEN="", try_ws=False, proxy=self.settings.aiotieba_proxy)

    def _write_artifact(
        self,
        *,
        run_id: str,
        action: str,
        capability_id: str,
        request_summary: dict[str, Any],
        status: ResultStatus,
        payload: Any | None,
        fetched_at: datetime,
        error_type: str | None = None,
    ) -> ArtifactReference:
        raw_bytes = None
        if payload is not None:
            raw_bytes = json.dumps(
                _public_json_value(payload), ensure_ascii=False, separators=(",", ":")
            ).encode("utf-8")
            if len(raw_bytes) > self.maximum_payload_bytes:
                raise SourceUnavailableError("aiotieba response exceeded the 20 MB raw artifact limit.")
        return self.artifacts.write(
            provider=self.provider,
            fetched_at=fetched_at,
            raw_bytes=raw_bytes,
            media_type="application/json",
            manifest={
                "run_id": run_id,
                "platform": self.platform,
                "action": action,
                "provider": self.provider,
                "provider_version": self.provider_version(),
                "capability_id": capability_id,
                **request_summary,
                "status": status.value,
                "anonymous": True,
                "credentials_used": False,
                "proxy_used": self.settings.aiotieba_proxy,
                "read_only_method": "get_threads" if action == "forum_threads" else "get_posts",
                "error_type": error_type,
            },
        )

    @staticmethod
    def _artifact_context(artifact: ArtifactReference) -> dict[str, Any]:
        return {"artifact": artifact.model_dump(mode="json")}

    async def forum_threads(
        self, request: ForumThreadsRequest, *, capability_id: str
    ) -> ForumThreadsResponse:
        started = time.perf_counter()
        fetched_at = datetime.now(timezone.utc)
        run_id = str(uuid.uuid4())
        summary = {
            "forum_name": request.forum_name,
            "page": request.page,
            "limit": request.limit,
        }
        try:
            async with self._client() as client:
                result = await client.get_threads(
                    request.forum_name, request.page, rn=request.limit
                )
        except Exception as exc:
            artifact = self._write_artifact(
                run_id=run_id,
                action="forum_threads",
                capability_id=capability_id,
                request_summary=summary,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                payload=None,
                fetched_at=fetched_at,
                error_type=exc.__class__.__name__,
            )
            raise SourceUnavailableError(
                "aiotieba could not read the public forum thread list.",
                context=self._artifact_context(artifact),
            ) from exc
        if result.err is not None:
            artifact = self._write_artifact(
                run_id=run_id,
                action="forum_threads",
                capability_id=capability_id,
                request_summary=summary,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                payload=None,
                fetched_at=fetched_at,
                error_type=result.err.__class__.__name__,
            )
            raise SourceUnavailableError(
                "aiotieba returned an error for the public forum thread list.",
                context=self._artifact_context(artifact),
            )

        items = [
            ForumThreadPreview(
                thread_id=thread.tid,
                title=(thread.title or thread.contents.text).strip()[:500],
                url=f"https://tieba.baidu.com/p/{thread.tid}",
            )
            for thread in result
            if thread.tid > 0
        ][: request.limit]
        status = ResultStatus.SUCCESS if items else ResultStatus.NO_RESULTS
        artifact = self._write_artifact(
            run_id=run_id,
            action="forum_threads",
            capability_id=capability_id,
            request_summary=summary,
            status=status,
            payload=result,
            fetched_at=fetched_at,
        )
        return ForumThreadsResponse(
            ok=bool(items),
            status=status,
            provider=self.provider,
            provider_version=self.provider_version(),
            forum_name=result.forum.fname or request.forum_name,
            page=request.page,
            fetched_at=fetched_at,
            duration_ms=round((time.perf_counter() - started) * 1000),
            item_count=len(items),
            has_more=result.has_more,
            items=items,
            artifact=artifact,
            warnings=[
                "The complete aiotieba response was retained locally; preview fields are not a content database.",
                "This capability used an anonymous client and only the approved get_threads read method.",
            ],
            error=None if items else "The public forum page returned no threads.",
        )

    async def post_detail(
        self, request: PostDetailRequest, *, capability_id: str
    ) -> PostDetailResponse:
        started = time.perf_counter()
        fetched_at = datetime.now(timezone.utc)
        run_id = str(uuid.uuid4())
        summary = {
            "thread_id": request.thread_id,
            "page": request.page,
            "limit": request.limit,
        }
        try:
            async with self._client() as client:
                result = await client.get_posts(
                    request.thread_id,
                    request.page,
                    rn=request.limit,
                    with_comments=False,
                )
        except Exception as exc:
            artifact = self._write_artifact(
                run_id=run_id,
                action="post_detail",
                capability_id=capability_id,
                request_summary=summary,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                payload=None,
                fetched_at=fetched_at,
                error_type=exc.__class__.__name__,
            )
            raise SourceUnavailableError(
                "aiotieba could not read the public thread posts.",
                context=self._artifact_context(artifact),
            ) from exc
        if result.err is not None:
            artifact = self._write_artifact(
                run_id=run_id,
                action="post_detail",
                capability_id=capability_id,
                request_summary=summary,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                payload=None,
                fetched_at=fetched_at,
                error_type=result.err.__class__.__name__,
            )
            raise SourceUnavailableError(
                "aiotieba returned an error for the public thread posts.",
                context=self._artifact_context(artifact),
            )

        posts = [
            PostPreview(
                post_id=post.pid,
                floor=max(post.floor, 0),
                text_preview=post.text.strip()[:1000],
                url=f"https://tieba.baidu.com/p/{request.thread_id}?pid={post.pid}#{post.pid}",
            )
            for post in result
            if post.pid > 0
        ][: request.limit]
        status = ResultStatus.SUCCESS if posts else ResultStatus.NO_RESULTS
        artifact = self._write_artifact(
            run_id=run_id,
            action="post_detail",
            capability_id=capability_id,
            request_summary=summary,
            status=status,
            payload=result,
            fetched_at=fetched_at,
        )
        return PostDetailResponse(
            ok=bool(posts),
            status=status,
            provider=self.provider,
            provider_version=self.provider_version(),
            thread_id=request.thread_id,
            thread_title=result.thread.title.strip(),
            page=request.page,
            fetched_at=fetched_at,
            duration_ms=round((time.perf_counter() - started) * 1000),
            item_count=len(posts),
            has_more=result.has_more,
            posts=posts,
            artifact=artifact,
            warnings=[
                "The complete aiotieba response was retained locally; preview fields are not a content database.",
                "This capability used an anonymous client and only the approved get_posts read method.",
                "Nested comments were not requested; use a future explicit read capability if they become necessary.",
            ],
            error=None if posts else "The public thread page returned no posts.",
        )

    async def health(self) -> SourceHealth:
        provider_version = self.provider_version()
        return SourceHealth(
            source=self.provider,
            status=ResultStatus.SUCCESS if provider_version else ResultStatus.MISCONFIGURED,
            ready=bool(provider_version),
            collector=self.collector,
            details={
                "version": provider_version or None,
                "anonymous": True,
                "proxy_configured": self.settings.aiotieba_proxy,
                "approved_methods": ["get_threads", "get_posts"],
                "network_access_verified_on_execute": True,
            },
            warnings=[] if provider_version else ["The pinned aiotieba dependency is not installed."],
        )
