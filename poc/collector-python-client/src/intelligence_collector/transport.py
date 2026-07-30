from __future__ import annotations

from typing import Any, Mapping

import httpx

from .constants import MAX_JSON_BYTES
from .errors import CollectorClientError
from .validation import SAFE_ERROR_PATTERN, validate_loopback_origin, validate_token


class JsonTransport:
    """Loopback-only JSON transport shared by the Python SDK client layer."""

    def __init__(
        self,
        origin: str,
        *,
        token: str | None = None,
        timeout: float = 20.0,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.origin = validate_loopback_origin(origin)
        if token is not None:
            validate_token(token)
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not 0.1 <= float(timeout) <= 120.0:
            raise CollectorClientError("collector_client_request_timeout_invalid", 400)
        self.token = token
        self.timeout = float(timeout)
        self._client = http_client
        self._owns_client = http_client is None

    async def __aenter__(self) -> "JsonTransport":
        await self.start()
        return self

    async def __aexit__(self, _type: Any, _value: Any, _traceback: Any) -> None:
        await self.close()

    async def start(self) -> None:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.origin,
                timeout=self.timeout,
                trust_env=False,
            )

    async def close(self) -> None:
        if self._client is not None and self._owns_client:
            await self._client.aclose()
            self._client = None

    async def request_json(
        self,
        method: str,
        path: str,
        *,
        body: Mapping[str, Any] | None = None,
        requires_token: bool = False,
    ) -> dict[str, Any]:
        if requires_token and self.token is None:
            raise CollectorClientError("collector_client_token_required", 503)
        await self.start()
        assert self._client is not None
        headers = {"Accept": "application/json"}
        if requires_token:
            headers["Authorization"] = f"Bearer {self.token}"
        if body is not None:
            headers["Content-Type"] = "application/json"
        try:
            response = await self._client.request(
                method,
                path,
                headers=headers,
                json=body,
                follow_redirects=False,
            )
        except httpx.TimeoutException as exc:
            raise CollectorClientError("collector_client_request_timeout", 408) from exc
        except httpx.HTTPError as exc:
            raise CollectorClientError("collector_client_gateway_unreachable", 503) from exc

        content_length = response.headers.get("content-length")
        if content_length is not None:
            try:
                declared_length = int(content_length)
            except ValueError as exc:
                raise CollectorClientError("collector_client_response_too_large", 502) from exc
            if declared_length < 0 or declared_length > MAX_JSON_BYTES:
                raise CollectorClientError("collector_client_response_too_large", 502)
        try:
            content = await response.aread()
        except httpx.HTTPError as exc:
            raise CollectorClientError("collector_client_response_invalid", 502) from exc
        if len(content) > MAX_JSON_BYTES:
            raise CollectorClientError("collector_client_response_too_large", 502)
        try:
            payload = response.json()
        except (ValueError, UnicodeDecodeError) as exc:
            raise CollectorClientError("collector_client_response_invalid", 502) from exc
        if not isinstance(payload, dict):
            raise CollectorClientError("collector_client_response_invalid", 502)
        if not response.is_success:
            raw_code = payload.get("error")
            code = raw_code if isinstance(raw_code, str) and SAFE_ERROR_PATTERN.fullmatch(raw_code) else "collector_client_gateway_rejected"
            raise CollectorClientError(code, response.status_code)
        return payload
