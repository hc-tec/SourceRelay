from __future__ import annotations

from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
import re
from collections.abc import Awaitable, Callable
from urllib.parse import urljoin, urlsplit

import httpx

from .connectors.article import validate_public_url
from .errors import GatewayError
from .normalization import canonicalize_url


SOGOU_REDIRECT_HOST = "www.sogou.com"
SOGOU_REDIRECT_PATH = "/link"
MAX_REDIRECT_BODY_BYTES = 64 * 1024
MAX_REDIRECT_TIMEOUT_SECONDS = 15.0
MAX_REDIRECT_RESOLUTIONS_PER_SEARCH = 10

# This deliberately accepts only literal, public HTTP(S) URLs.  It is not a
# JavaScript interpreter: dynamic redirect code is left unresolved instead of
# being executed in a browser profile.
_LOCATION_RE = re.compile(
    r"""(?:window\.)?location\.(?:replace|assign)\(\s*[\"'](?P<target>https?://[^\s\"'<>\\]+)[\"']\s*\)""",
    flags=re.IGNORECASE,
)
_META_REFRESH_URL_RE = re.compile(
    r"""(?:^|;)\s*url\s*=\s*(?P<target>[^;]+)""",
    flags=re.IGNORECASE,
)

PublicUrlValidator = Callable[[str], Awaitable[None]]


class _MetaRefreshParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.contents: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.casefold() != "meta":
            return
        values = {key.casefold(): value or "" for key, value in attrs}
        if values.get("http-equiv", "").casefold() == "refresh" and values.get("content"):
            self.contents.append(values["content"])


@dataclass(frozen=True, slots=True)
class SogouRedirectResolution:
    """A canonical target derived without fetching the target page."""

    discovery_url: str
    target_url: str | None
    method: str | None
    warning: str | None = None


class SogouRedirectResolver:
    """Safely resolve Sogou's public ``/link`` wrappers.

    Sogou returns a 200 HTML page containing a static client-side redirect for
    many search-result links.  Following redirects in an HTTP client does not
    execute that JavaScript, and clicking it in BrowserWing would navigate a
    shared browser profile to an arbitrary target.  This resolver fetches only
    the exact public Sogou wrapper, reads a small HTML response, and validates
    the extracted target before returning it.  It never fetches the target.
    """

    def __init__(
        self,
        *,
        timeout_seconds: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
        url_validator: PublicUrlValidator = validate_public_url,
    ) -> None:
        self.timeout_seconds = min(
            MAX_REDIRECT_TIMEOUT_SECONDS, max(1.0, float(timeout_seconds))
        )
        self.transport = transport
        self.url_validator = url_validator

    @staticmethod
    def _parts(url: str):
        try:
            return urlsplit(url)
        except ValueError:
            return None

    @classmethod
    def is_sogou_owned_url(cls, url: str) -> bool:
        parts = cls._parts(url)
        host = (parts.hostname or "").casefold().rstrip(".") if parts else ""
        return host == "sogou.com" or host.endswith(".sogou.com")

    @classmethod
    def is_sogou_redirect_url(cls, url: str) -> bool:
        parts = cls._parts(url)
        if not parts:
            return False
        try:
            port = parts.port
        except ValueError:
            return False
        return bool(
            parts.scheme.casefold() == "https"
            and (parts.hostname or "").casefold() == SOGOU_REDIRECT_HOST
            and port is None
            and parts.path == SOGOU_REDIRECT_PATH
            and parts.query
        )

    @staticmethod
    def _host_matches_site(host: str, expected_site: str) -> bool:
        normalized_host = host.casefold().rstrip(".")
        normalized_site = expected_site.casefold().rstrip(".")
        return bool(normalized_host and normalized_site) and (
            normalized_host == normalized_site
            or normalized_host.endswith(f".{normalized_site}")
        )

    @staticmethod
    def _extract_html_target(body: bytes, encoding: str | None) -> tuple[str | None, str | None]:
        text = body.decode(encoding or "utf-8", errors="replace")
        location = _LOCATION_RE.search(text)
        if location:
            return unescape(location.group("target")).strip(), "sogou_html_location"

        parser = _MetaRefreshParser()
        parser.feed(text)
        parser.close()
        for content in parser.contents:
            meta = _META_REFRESH_URL_RE.search(unescape(content))
            if not meta:
                continue
            target = meta.group("target").strip().strip("\"'")
            if target:
                return target, "sogou_html_meta_refresh"
        return None, None

    @staticmethod
    async def _read_limited_body(response: httpx.Response) -> bytes | None:
        raw_length = response.headers.get("content-length")
        if raw_length:
            try:
                if int(raw_length) > MAX_REDIRECT_BODY_BYTES:
                    return None
            except ValueError:
                pass
        body = bytearray()
        async for chunk in response.aiter_bytes():
            body.extend(chunk)
            if len(body) > MAX_REDIRECT_BODY_BYTES:
                return None
        return bytes(body)

    async def _accept_target(
        self,
        *,
        discovery_url: str,
        raw_target: str,
        method: str,
        expected_site: str | None,
    ) -> SogouRedirectResolution:
        target_url = canonicalize_url(urljoin(discovery_url, raw_target))
        parts = self._parts(target_url)
        if not target_url or not parts or not parts.hostname:
            return SogouRedirectResolution(
                discovery_url=discovery_url,
                target_url=None,
                method=method,
                warning="Sogou redirect candidate was excluded because it did not contain a valid HTTP(S) target URL.",
            )
        if self.is_sogou_owned_url(target_url):
            return SogouRedirectResolution(
                discovery_url=discovery_url,
                target_url=None,
                method=method,
                warning="Sogou internal navigation link was excluded because it is not a canonical result target.",
            )
        if expected_site and not self._host_matches_site(parts.hostname, expected_site):
            return SogouRedirectResolution(
                discovery_url=discovery_url,
                target_url=None,
                method=method,
                warning=(
                    "Sogou redirect candidate was excluded because its target falls outside "
                    f"the requested site:{expected_site} boundary."
                ),
            )
        try:
            await self.url_validator(target_url)
        except GatewayError:
            return SogouRedirectResolution(
                discovery_url=discovery_url,
                target_url=None,
                method=method,
                warning="Sogou redirect candidate was excluded by the public URL safety policy.",
            )
        return SogouRedirectResolution(
            discovery_url=discovery_url,
            target_url=target_url,
            method=method,
        )

    async def resolve(
        self, discovery_url: str, *, expected_site: str | None = None
    ) -> SogouRedirectResolution | None:
        """Resolve one exact Sogou wrapper, or return ``None`` for other URLs."""

        normalized_url = canonicalize_url(discovery_url)
        if not self.is_sogou_redirect_url(normalized_url):
            return None
        try:
            await self.url_validator(normalized_url)
        except GatewayError:
            return SogouRedirectResolution(
                discovery_url=normalized_url,
                target_url=None,
                method=None,
                warning="Sogou redirect candidate was excluded by the public URL safety policy.",
            )

        headers = {
            "User-Agent": "IntelligenceGateway/0.13 (+public Sogou redirect resolution)",
            "Accept": "text/html,application/xhtml+xml",
        }
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self.timeout_seconds),
                follow_redirects=False,
                headers=headers,
                trust_env=False,
                transport=self.transport,
            ) as client:
                async with client.stream("GET", normalized_url) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        location = response.headers.get("location")
                        if not location:
                            return SogouRedirectResolution(
                                discovery_url=normalized_url,
                                target_url=None,
                                method=None,
                                warning="Sogou redirect candidate was excluded because its HTTP redirect had no location.",
                            )
                        return await self._accept_target(
                            discovery_url=normalized_url,
                            raw_target=location,
                            method="sogou_http_location",
                            expected_site=expected_site,
                        )
                    if response.status_code < 200 or response.status_code >= 300:
                        return SogouRedirectResolution(
                            discovery_url=normalized_url,
                            target_url=None,
                            method=None,
                            warning=(
                                "Sogou redirect candidate was excluded because the wrapper "
                                f"returned HTTP {response.status_code}."
                            ),
                        )
                    content_type = response.headers.get("content-type", "").casefold()
                    if not any(
                        allowed in content_type
                        for allowed in ("text/html", "application/xhtml+xml")
                    ):
                        return SogouRedirectResolution(
                            discovery_url=normalized_url,
                            target_url=None,
                            method=None,
                            warning="Sogou redirect candidate was excluded because its wrapper was not HTML.",
                        )
                    body = await self._read_limited_body(response)
        except httpx.HTTPError:
            return SogouRedirectResolution(
                discovery_url=normalized_url,
                target_url=None,
                method=None,
                warning="Sogou redirect candidate was excluded because its wrapper could not be read safely.",
            )

        if body is None:
            return SogouRedirectResolution(
                discovery_url=normalized_url,
                target_url=None,
                method=None,
                warning=(
                    "Sogou redirect candidate was excluded because its wrapper exceeded "
                    f"the {MAX_REDIRECT_BODY_BYTES // 1024} KiB safety limit."
                ),
            )
        raw_target, method = self._extract_html_target(body, response.encoding)
        if not raw_target or not method:
            return SogouRedirectResolution(
                discovery_url=normalized_url,
                target_url=None,
                method=None,
                warning="Sogou redirect candidate was excluded because no static redirect target was found.",
            )
        return await self._accept_target(
            discovery_url=normalized_url,
            raw_target=raw_target,
            method=method,
            expected_site=expected_site,
        )
