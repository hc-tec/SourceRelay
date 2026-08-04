from __future__ import annotations

import asyncio
import time
from copy import deepcopy
from typing import Any, Awaitable, Callable, Mapping

import httpx

from .constants import (
    CORE_RELEASE_VERSION,
    CORE_SERVICE_SCHEMA_VERSION,
    DEFAULT_GATEWAY_ORIGIN,
    DEFAULT_POLL_INITIAL_DELAY_SECONDS,
    DEFAULT_POLL_MAX_DELAY_SECONDS,
    DEFAULT_REQUEST_TIMEOUT_SECONDS,
    DEFAULT_WAIT_TIMEOUT_SECONDS,
    TERMINAL_STATES,
)
from .errors import CollectorClientError
from .models import Artifact, CollectionResult, Operation
from .transport import JsonTransport
from .validation import (
    DIGEST_PATTERN,
    artifact_path_from_operation,
    assert_uuid,
    clone,
    is_artifact_content_window,
    is_artifact_metadata,
    is_operation,
    validate_collect_request,
)


SleepFunction = Callable[[float], Awaitable[None]]


class CollectorClient:
    """Async Python SDK for the registered direct-provider Collector API.

    This client never accepts a browser path, tab ID, selector, script, CDP
    command, platform URL or arbitrary artifact path. A collect call submits
    exactly one local Gateway operation; waiting only reads local state.
    """

    def __init__(
        self,
        origin: str = DEFAULT_GATEWAY_ORIGIN,
        *,
        token: str | None = None,
        request_timeout: float = DEFAULT_REQUEST_TIMEOUT_SECONDS,
        http_client: httpx.AsyncClient | None = None,
        sleep: SleepFunction = asyncio.sleep,
    ) -> None:
        self._transport = JsonTransport(
            origin,
            token=token,
            timeout=request_timeout,
            http_client=http_client,
        )
        if not callable(sleep):
            raise CollectorClientError("collector_client_sleep_invalid", 400)
        self._sleep = sleep

    async def __aenter__(self) -> "CollectorClient":
        await self.start()
        return self

    async def __aexit__(self, _type: Any, _value: Any, _traceback: Any) -> None:
        await self.close()

    async def start(self) -> None:
        await self._transport.start()

    async def close(self) -> None:
        await self._transport.close()

    async def list_capabilities(self) -> list[dict[str, Any]]:
        return clone((await self.read_capability_catalog())["capabilities"])

    async def read_capability_catalog(self) -> dict[str, Any]:
        payload = await self._transport.request_json("GET", "/v2/capabilities")
        if (
            payload.get("schemaVersion") != CORE_SERVICE_SCHEMA_VERSION
            or not isinstance(payload.get("catalogDigest"), str)
            or DIGEST_PATTERN.fullmatch(payload["catalogDigest"]) is None
            or not isinstance(payload.get("capabilities"), list)
            or not isinstance(payload.get("directContracts"), list)
        ):
            raise CollectorClientError("collector_client_capabilities_invalid", 502)
        return clone(payload)

    async def read_status(self) -> dict[str, Any]:
        return clone(await self._transport.request_json("GET", "/v1/status"))

    async def read_openapi(self) -> dict[str, Any]:
        return clone(await self._transport.request_json("GET", "/v2/openapi.json"))

    async def read_release(self) -> dict[str, Any]:
        payload = await self._transport.request_json("GET", "/v2/release")
        service = payload.get("service")
        compatibility = payload.get("compatibility")
        if (
            payload.get("product") != "collector-core"
            or payload.get("releaseVersion") != CORE_RELEASE_VERSION
            or not isinstance(service, Mapping)
            or service.get("schemaVersion") != CORE_SERVICE_SCHEMA_VERSION
            or not isinstance(compatibility, Mapping)
            or compatibility.get("schemaVersion") != 1
            or compatibility.get("digestAlgorithm") != "sha256-canonical-json-v1"
            or not isinstance(compatibility.get("openApiSchemaDigest"), str)
            or DIGEST_PATTERN.fullmatch(compatibility["openApiSchemaDigest"]) is None
            or not isinstance(compatibility.get("capabilityCatalogDigest"), str)
            or DIGEST_PATTERN.fullmatch(compatibility["capabilityCatalogDigest"]) is None
            or not isinstance(compatibility.get("features"), list)
            or not all(isinstance(feature, str) for feature in compatibility["features"])
        ):
            raise CollectorClientError("collector_client_release_manifest_invalid", 502)
        return clone(payload)

    async def list_browser_bindings(self) -> list[dict[str, Any]]:
        payload = await self._transport.request_json(
            "GET",
            "/v2/collector-service/browser-bindings",
            requires_token=True,
        )
        bindings = payload.get("bindings")
        if not isinstance(bindings, list):
            raise CollectorClientError("collector_client_bindings_invalid", 502)
        return clone(bindings)

    async def collect(self, request: Mapping[str, Any]) -> dict[str, Any]:
        validate_collect_request(request)
        payload = await self._transport.request_json(
            "POST",
            "/v2/collect",
            body=request,
            requires_token=True,
        )
        operation = payload.get("result")
        if not is_operation(operation):
            raise CollectorClientError("collector_client_queued_operation_invalid", 502)
        return clone(operation)

    async def collect_model(self, request: Mapping[str, Any]) -> Operation:
        """Submit one request and return its structured queued operation."""

        return Operation.from_mapping(await self.collect(request))

    async def get_operation(self, operation_id: str) -> dict[str, Any]:
        assert_uuid(operation_id, "collector_client_operation_id_invalid")
        payload = await self._transport.request_json(
            "GET",
            f"/v2/collect/operations/{operation_id}",
            requires_token=True,
        )
        operation = payload.get("result")
        if not is_operation(operation):
            raise CollectorClientError("collector_client_operation_invalid", 502)
        return clone(operation)

    async def get_operation_model(self, operation_id: str) -> Operation:
        """Read one operation as a structured, raw-preserving model."""

        return Operation.from_mapping(await self.get_operation(operation_id))

    async def wait_operation(
        self,
        operation_id: str,
        *,
        timeout: float = DEFAULT_WAIT_TIMEOUT_SECONDS,
        initial_delay: float = DEFAULT_POLL_INITIAL_DELAY_SECONDS,
        max_delay: float = DEFAULT_POLL_MAX_DELAY_SECONDS,
    ) -> dict[str, Any]:
        assert_uuid(operation_id, "collector_client_operation_id_invalid")
        _bounded_number(timeout, 0.1, 3_600.0, "collector_client_wait_timeout_invalid")
        _bounded_number(initial_delay, 0.0, 30.0, "collector_client_poll_delay_invalid")
        _bounded_number(max_delay, initial_delay, 60.0, "collector_client_poll_delay_invalid")
        started_at = time.monotonic()
        delay = initial_delay
        operation = await self.get_operation(operation_id)
        while operation["state"] not in TERMINAL_STATES:
            remaining = timeout - (time.monotonic() - started_at)
            if remaining <= 0:
                raise CollectorClientError("collector_client_wait_timeout", 408, {"operationId": operation_id})
            await self._sleep(min(delay, remaining))
            if time.monotonic() - started_at >= timeout:
                raise CollectorClientError("collector_client_wait_timeout", 408, {"operationId": operation_id})
            operation = await self.get_operation(operation_id)
            delay = min(max(delay * 2.0, 0.001), max_delay)
        return operation

    async def wait_operation_model(
        self,
        operation_id: str,
        *,
        timeout: float = DEFAULT_WAIT_TIMEOUT_SECONDS,
        initial_delay: float = DEFAULT_POLL_INITIAL_DELAY_SECONDS,
        max_delay: float = DEFAULT_POLL_MAX_DELAY_SECONDS,
    ) -> Operation:
        """Wait without resubmitting and return a structured operation."""

        return Operation.from_mapping(
            await self.wait_operation(
                operation_id,
                timeout=timeout,
                initial_delay=initial_delay,
                max_delay=max_delay,
            )
        )

    async def read_artifact(self, operation_id: str) -> dict[str, Any]:
        operation = await self.get_operation(operation_id)
        return await self.read_artifact_from_operation(operation)

    async def read_artifact_metadata(self, artifact_id: str) -> dict[str, Any]:
        assert_uuid(artifact_id, "collector_client_artifact_id_invalid")
        payload = await self._transport.request_json(
            "GET",
            f"/v2/collect/artifacts/{artifact_id}",
            requires_token=True,
        )
        metadata = payload.get("metadata")
        if not is_artifact_metadata(metadata):
            raise CollectorClientError("collector_client_artifact_metadata_invalid", 502)
        return clone(metadata)

    async def read_artifact_content_window(
        self,
        artifact_id: str,
        *,
        offset: int = 0,
        max_bytes: int = 16_384,
    ) -> dict[str, Any]:
        assert_uuid(artifact_id, "collector_client_artifact_id_invalid")
        _bounded_integer(
            offset,
            0,
            9_007_199_254_740_991,
            "collector_client_artifact_offset_invalid",
        )
        _bounded_integer(
            max_bytes,
            1,
            65_536,
            "collector_client_artifact_window_invalid",
        )
        payload = await self._transport.request_json(
            "GET",
            f"/v2/collect/artifacts/{artifact_id}/content?offset={offset}&maxBytes={max_bytes}",
            requires_token=True,
        )
        window = payload.get("window")
        if (
            not is_artifact_content_window(window)
            or window["artifactId"] != artifact_id
            or window["offset"] != offset
            or window["maximumBytes"] != max_bytes
        ):
            raise CollectorClientError("collector_client_artifact_window_invalid", 502)
        return clone(window)

    async def read_artifact_model(self, operation_id: str) -> Artifact:
        """Read a capability-bound artifact as a structured model."""

        return Artifact.from_mapping(await self.read_artifact(operation_id))

    async def read_artifact_from_operation(self, operation: Mapping[str, Any]) -> dict[str, Any]:
        retrieval_path = artifact_path_from_operation(operation)
        if retrieval_path is None:
            raise CollectorClientError("collector_client_artifact_unavailable", 409)
        payload = await self._transport.request_json(
            "GET",
            retrieval_path,
            requires_token=True,
        )
        if payload.get("capability") != operation.get("capability") or "artifact" not in payload:
            raise CollectorClientError("collector_client_artifact_invalid", 502)
        return {"operation": clone(operation), "artifact": clone(payload)}

    async def collect_and_wait(self, request: Mapping[str, Any]) -> dict[str, Any]:
        queued = await self.collect(request)
        operation = await self.wait_operation(queued["operationId"])
        if operation.get("artifact") is None:
            return {"operation": operation, "artifact": None}
        return await self.read_artifact_from_operation(operation)

    async def collect_and_wait_model(self, request: Mapping[str, Any]) -> CollectionResult:
        """Run one workflow and return structured envelope plus raw projection."""

        return CollectionResult.from_mapping(await self.collect_and_wait(request))


def _bounded_number(value: float, minimum: float, maximum: float, code: str) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not minimum <= float(value) <= maximum:
        raise CollectorClientError(code, 400)


def _bounded_integer(value: int, minimum: int, maximum: int, code: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise CollectorClientError(code, 400)
