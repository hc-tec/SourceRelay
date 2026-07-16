from __future__ import annotations

import html as html_module
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
from lxml import etree, html

from ..artifacts import RawArtifactStore
from ..config import Settings
from ..errors import GatewayError, SourceUnavailableError
from ..models import (
    ArtifactReference,
    ResultStatus,
    SourceHealth,
    WechatArticleDetailRequest,
    WechatArticleDetailResponse,
    WechatArticlePreview,
)


_ARTICLE_PATH = re.compile(r"^/s/([A-Za-z0-9_-]{8,100})$")
_TITLE_SCRIPT = re.compile(r"var\s+msg_title\s*=\s*(['\"])(.*?)\1", re.DOTALL)
_ACCOUNT_SCRIPT = re.compile(r"var\s+nickname\s*=\s*htmlDecode\((['\"])(.*?)\1\)", re.DOTALL)
_PUBLISHED_SCRIPT = re.compile(r'var\s+ct\s*=\s*"(\d{10})"')
_WHITESPACE = re.compile(r"[ \t\f\v]+")
_EMPTY_LINES = re.compile(r"\n{3,}")


class WechatPublicArticleConnector:
    provider = "wechat-public-html"
    collector = "wechat-public-html"
    platform = "wechat_official"
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
    def canonical_article_url(value: str) -> tuple[str, str]:
        try:
            parts = urlsplit(value)
        except ValueError as exc:
            raise GatewayError("WeChat article URL is invalid.", http_status=422) from exc
        match = _ARTICLE_PATH.fullmatch(parts.path)
        if (
            parts.scheme != "https"
            or parts.hostname != "mp.weixin.qq.com"
            or parts.port is not None
            or parts.username is not None
            or parts.password is not None
            or parts.query
            or not match
        ):
            raise GatewayError(
                "Only canonical public https://mp.weixin.qq.com/s/... article URLs are allowed.",
                http_status=422,
            )
        return urlunsplit(("https", "mp.weixin.qq.com", parts.path, "", "")), match.group(1)

    def _write_artifact(
        self,
        *,
        run_id: str,
        capability_id: str,
        source_url: str,
        status: ResultStatus,
        raw_bytes: bytes | None,
        media_type: str,
        fetched_at: datetime,
        http_status: int | None = None,
        error_type: str | None = None,
        deleted: bool = False,
    ) -> ArtifactReference:
        return self.artifacts.write(
            provider=self.provider,
            fetched_at=fetched_at,
            raw_bytes=raw_bytes,
            media_type=media_type,
            manifest={
                "run_id": run_id,
                "platform": self.platform,
                "action": "article_detail",
                "provider": self.provider,
                "capability_id": capability_id,
                "source_url": source_url,
                "status": status.value,
                "http_status": http_status,
                "proxy_used": bool(self.settings.wechat_article_proxy),
                "authentication_used": False,
                "cookies_used": False,
                "redirects_followed": False,
                "deleted": deleted,
                "error_type": error_type,
            },
        )

    @staticmethod
    def _artifact_context(artifact: ArtifactReference) -> dict[str, Any]:
        return {"artifact": artifact.model_dump(mode="json")}

    @staticmethod
    def _meta_content(tree: html.HtmlElement, property_name: str) -> str:
        values = tree.xpath(
            "//meta[@property=$name]/@content", name=property_name
        )
        return str(values[0]).strip() if values else ""

    @staticmethod
    def _clean_text(value: str) -> str:
        lines = [_WHITESPACE.sub(" ", line).strip() for line in value.splitlines()]
        return _EMPTY_LINES.sub("\n\n", "\n".join(lines)).strip()

    @classmethod
    def _parse_article(
        cls, raw_bytes: bytes, *, source_url: str, external_id: str
    ) -> WechatArticlePreview | None:
        document = raw_bytes.decode("utf-8-sig", errors="replace")
        try:
            tree = html.fromstring(document)
        except (ValueError, etree.ParserError):
            return None
        content_nodes = tree.xpath('//*[@id="js_content"]')
        if not content_nodes:
            return None
        text = cls._clean_text(content_nodes[0].text_content())
        if len(text) < 50:
            return None

        title = cls._meta_content(tree, "og:title")
        if not title and (match := _TITLE_SCRIPT.search(document)):
            title = html_module.unescape(match.group(2)).strip()
        account_values = tree.xpath('//*[@id="js_name"]//text()')
        account_name = cls._clean_text(" ".join(map(str, account_values)))
        if not account_name and (match := _ACCOUNT_SCRIPT.search(document)):
            account_name = html_module.unescape(match.group(2)).strip()
        published_at = None
        if match := _PUBLISHED_SCRIPT.search(document):
            published_at = datetime.fromtimestamp(int(match.group(1)), tz=timezone.utc)
        if not title:
            return None
        return WechatArticlePreview(
            external_id=external_id,
            title=title,
            url=source_url,
            account_name=account_name,
            published_at=published_at,
            text_preview=text[:4000],
        )

    async def fetch(
        self,
        request: WechatArticleDetailRequest,
        *,
        capability_id: str,
    ) -> WechatArticleDetailResponse:
        source_url, external_id = self.canonical_article_url(str(request.url))
        started = time.perf_counter()
        fetched_at = datetime.now(timezone.utc)
        run_id = str(uuid.uuid4())
        raw_bytes: bytes | None = None
        media_type = "application/octet-stream"
        http_status: int | None = None
        payload_too_large = False
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(min(max(self.settings.request_timeout, 10), 60)),
                trust_env=False,
                follow_redirects=False,
                proxy=(self.settings.wechat_article_proxy or None)
                if self.transport is None
                else None,
                transport=self.transport,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml",
                },
            ) as client:
                async with client.stream("GET", source_url) as response:
                    http_status = response.status_code
                    media_type = response.headers.get("content-type", "application/octet-stream")
                    chunks: list[bytes] = []
                    byte_count = 0
                    async for chunk in response.aiter_bytes():
                        byte_count += len(chunk)
                        if byte_count > self.maximum_payload_bytes:
                            payload_too_large = True
                            chunks.clear()
                            break
                        chunks.append(chunk)
                    raw_bytes = None if payload_too_large else b"".join(chunks)
        except httpx.HTTPError as exc:
            artifact = self._write_artifact(
                run_id=run_id,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=None,
                media_type=media_type,
                fetched_at=fetched_at,
                error_type=exc.__class__.__name__,
            )
            raise SourceUnavailableError(
                "The public WeChat article request failed.",
                context=self._artifact_context(artifact),
            ) from exc

        if payload_too_large:
            artifact = self._write_artifact(
                run_id=run_id,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=None,
                media_type=media_type,
                fetched_at=fetched_at,
                http_status=http_status,
                error_type="payload_too_large",
            )
            raise SourceUnavailableError(
                "WeChat article exceeded the 5 MB raw artifact limit.",
                context=self._artifact_context(artifact),
            )

        if http_status != 200:
            artifact = self._write_artifact(
                run_id=run_id,
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
                f"WeChat returned HTTP {http_status}.",
                context=self._artifact_context(artifact),
            )
        normalized_media_type = media_type.casefold()
        if "html" not in normalized_media_type:
            artifact = self._write_artifact(
                run_id=run_id,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=raw_bytes,
                media_type=media_type,
                fetched_at=fetched_at,
                http_status=http_status,
                error_type="unexpected_content_type",
            )
            raise SourceUnavailableError(
                "WeChat did not return HTML.", context=self._artifact_context(artifact)
            )

        document = (raw_bytes or b"").decode("utf-8-sig", errors="replace")
        deleted = "该内容已被发布者删除" in document or "此内容因违规无法查看" in document
        if deleted:
            artifact = self._write_artifact(
                run_id=run_id,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.NO_RESULTS,
                raw_bytes=raw_bytes,
                media_type=media_type,
                fetched_at=fetched_at,
                http_status=http_status,
                deleted=True,
                error_type="article_unavailable",
            )
            return WechatArticleDetailResponse(
                ok=False,
                status=ResultStatus.NO_RESULTS,
                provider=self.provider,
                fetched_at=fetched_at,
                duration_ms=round((time.perf_counter() - started) * 1000),
                artifact=artifact,
                warnings=["The upstream page states that the article is no longer available."],
                error="The article was deleted or made unavailable by its publisher.",
            )

        article = self._parse_article(
            raw_bytes or b"", source_url=source_url, external_id=external_id
        )
        if article is None:
            artifact = self._write_artifact(
                run_id=run_id,
                capability_id=capability_id,
                source_url=source_url,
                status=ResultStatus.SOURCE_UNAVAILABLE,
                raw_bytes=raw_bytes,
                media_type=media_type,
                fetched_at=fetched_at,
                http_status=http_status,
                error_type="article_contract_mismatch",
            )
            raise SourceUnavailableError(
                "The WeChat page did not match the approved public article contract.",
                warnings=["The raw HTML was retained for diagnosing a shell, verification or layout change."],
                context=self._artifact_context(artifact),
            )

        artifact = self._write_artifact(
            run_id=run_id,
            capability_id=capability_id,
            source_url=source_url,
            status=ResultStatus.SUCCESS,
            raw_bytes=raw_bytes,
            media_type=media_type,
            fetched_at=fetched_at,
            http_status=http_status,
        )
        return WechatArticleDetailResponse(
            ok=True,
            status=ResultStatus.SUCCESS,
            provider=self.provider,
            fetched_at=fetched_at,
            duration_ms=round((time.perf_counter() - started) * 1000),
            article=article,
            artifact=artifact,
            warnings=[
                "The complete public WeChat HTML was retained locally; the API returns only a lightweight preview.",
                "No account, login, cookie or private platform API was used.",
            ],
        )

    async def health(self) -> SourceHealth:
        return SourceHealth(
            source=self.provider,
            status=ResultStatus.SUCCESS,
            ready=True,
            collector=self.collector,
            details={
                "strict_host": "mp.weixin.qq.com",
                "strict_path": "/s/<public-article-id>",
                "proxy_configured": bool(self.settings.wechat_article_proxy),
                "network_access_verified_on_execute": True,
            },
        )
