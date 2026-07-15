from __future__ import annotations

import asyncio
import ipaddress
import json
import socket
import time
from collections.abc import Awaitable, Callable
from urllib.parse import urljoin, urlsplit

import httpx
import trafilatura

from ..config import Settings
from ..errors import GatewayError, SourceUnavailableError
from ..models import ArticleResult, FetchRequest, FetchResponse, ResultStatus


MAX_REDIRECTS = 5
MAX_BODY_BYTES = 5 * 1024 * 1024
MIN_ARTICLE_CHARS = 200
Resolver = Callable[[str, int], Awaitable[list[str]]]


def _is_public_address(value: str) -> bool:
    address = ipaddress.ip_address(value)
    return not any(
        (
            address.is_loopback,
            address.is_private,
            address.is_link_local,
            address.is_multicast,
            address.is_reserved,
            address.is_unspecified,
        )
    )


async def resolve_addresses(hostname: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    try:
        records = await loop.getaddrinfo(
            hostname,
            port,
            family=socket.AF_UNSPEC,
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise SourceUnavailableError("Article hostname could not be resolved.") from exc
    return sorted({record[4][0] for record in records})


async def validate_public_url(url: str, resolver: Resolver = resolve_addresses) -> None:
    try:
        parts = urlsplit(url)
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError as exc:
        raise GatewayError("Article URL is invalid.", http_status=422) from exc
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise GatewayError("Only public http and https article URLs are allowed.", http_status=422)
    if parts.username or parts.password:
        raise GatewayError("Article URLs containing credentials are not allowed.", http_status=422)
    try:
        literal = ipaddress.ip_address(parts.hostname.strip("[]"))
    except ValueError:
        addresses = await resolver(parts.hostname, port)
        if not addresses:
            raise SourceUnavailableError("Article hostname resolved to no addresses.")
    else:
        addresses = [str(literal)]
    try:
        unsafe = [address for address in addresses if not _is_public_address(address)]
    except ValueError as exc:
        raise SourceUnavailableError("Article hostname returned an invalid network address.") from exc
    if unsafe:
        raise GatewayError(
            "Article URL resolves to a non-public network address and was rejected.",
            http_status=422,
        )


class ArticleExtractor:
    collector = "trafilatura"

    def __init__(self, settings: Settings, resolver: Resolver = resolve_addresses) -> None:
        self.settings = settings
        self.resolver = resolver

    async def _download(self, initial_url: str) -> tuple[str, bytes, str]:
        current_url = initial_url
        timeout = httpx.Timeout(min(self.settings.request_timeout, 60))
        headers = {
            "User-Agent": "IntelligenceGateway/0.1 (+public article extraction)",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.8",
        }
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=False,
            headers=headers,
            trust_env=False,
        ) as client:
            for redirect_count in range(MAX_REDIRECTS + 1):
                await validate_public_url(current_url, self.resolver)
                try:
                    async with client.stream("GET", current_url) as response:
                        if response.status_code in {301, 302, 303, 307, 308}:
                            location = response.headers.get("location")
                            if not location:
                                raise SourceUnavailableError("Article redirect did not include a location.")
                            if redirect_count >= MAX_REDIRECTS:
                                raise SourceUnavailableError("Article exceeded the redirect limit.")
                            current_url = urljoin(str(response.url), location)
                            continue
                        if response.status_code >= 400:
                            raise SourceUnavailableError(
                                f"Article server returned HTTP {response.status_code}."
                            )
                        content_type = response.headers.get("content-type", "").lower()
                        if not any(
                            allowed in content_type
                            for allowed in ("text/html", "application/xhtml+xml", "text/plain")
                        ):
                            raise GatewayError(
                                "Article URL did not return HTML or text content.", http_status=415
                            )
                        body = bytearray()
                        async for chunk in response.aiter_bytes():
                            body.extend(chunk)
                            if len(body) > MAX_BODY_BYTES:
                                raise GatewayError(
                                    "Article response exceeded the 5 MB safety limit.",
                                    http_status=413,
                                )
                        return str(response.url), bytes(body), response.encoding or "utf-8"
                except GatewayError:
                    raise
                except httpx.HTTPError as exc:
                    raise SourceUnavailableError(
                        f"Article download failed: {exc.__class__.__name__}."
                    ) from exc
        raise SourceUnavailableError("Article download failed before content was received.")

    async def fetch(self, request: FetchRequest) -> FetchResponse:
        started = time.perf_counter()
        final_url, body, encoding = await self._download(str(request.url))
        html = body.decode(encoding, errors="replace")
        extracted = await asyncio.to_thread(
            trafilatura.extract,
            html,
            url=final_url,
            output_format="json",
            with_metadata=True,
            include_tables=request.include_tables,
            include_comments=False,
            favor_precision=True,
        )
        duration_ms = round((time.perf_counter() - started) * 1000)
        if not extracted:
            return FetchResponse(
                ok=False,
                status=ResultStatus.NO_RESULTS,
                duration_ms=duration_ms,
                error="Trafilatura could not identify article text on this page.",
            )
        try:
            data = json.loads(extracted)
        except (TypeError, json.JSONDecodeError) as exc:
            raise SourceUnavailableError("Trafilatura returned an unreadable extraction result.") from exc
        text = str(data.get("text") or data.get("raw_text") or "").strip()
        if len(text) < MIN_ARTICLE_CHARS:
            return FetchResponse(
                ok=False,
                status=ResultStatus.NO_RESULTS,
                duration_ms=duration_ms,
                error=(
                    "Trafilatura returned too little article text; the page may be a shell, "
                    "login wall or script-only response."
                ),
            )
        article = ArticleResult(
            url=str(request.url),
            final_url=final_url,
            title=str(data.get("title") or ""),
            author=str(data.get("author") or ""),
            published_at=str(data.get("date") or ""),
            site_name=str(data.get("sitename") or data.get("hostname") or ""),
            text=text,
            description=str(data.get("description") or ""),
            language=str(data.get("language") or ""),
            collector=self.collector,
            warnings=["Only public HTML/text pages are fetched; scripts and private-network URLs are not accessed."],
        )
        return FetchResponse(
            ok=True,
            status=ResultStatus.SUCCESS,
            duration_ms=duration_ms,
            article=article,
            error=None,
        )
