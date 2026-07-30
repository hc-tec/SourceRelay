from __future__ import annotations

from typing import Any, Mapping

from intelligence_collector import CollectorClient, CollectorClientError


class CollectorApplication:
    """Small upper-layer facade; platform behavior remains in Collector."""

    def __init__(self, client: CollectorClient) -> None:
        self.client = client

    async def capabilities(self) -> list[dict[str, Any]]:
        return await self.client.list_capabilities()

    async def openapi(self) -> dict[str, Any]:
        return await self.client.read_openapi()

    async def bindings(self) -> list[dict[str, Any]]:
        return await self.client.list_browser_bindings()

    async def collect(self, request: Mapping[str, Any]) -> dict[str, Any]:
        capabilities = await self.client.list_capabilities()
        descriptor = next(
            (
                item
                for item in capabilities
                if item.get("capability") == request.get("capability")
            ),
            None,
        )
        if descriptor is None:
            raise CollectorClientError("collector_app_capability_unknown", 400)
        if descriptor.get("dispatchState") != "direct_ready":
            raise CollectorClientError(
                "collector_app_capability_not_dispatchable",
                409,
                {"capability": request.get("capability"), "dispatchState": descriptor.get("dispatchState")},
            )
        return await self.client.collect_and_wait(request)
