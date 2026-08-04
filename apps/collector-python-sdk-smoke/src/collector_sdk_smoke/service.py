from __future__ import annotations

from typing import Any, Mapping

from intelligence_collector import (
    CollectionResult,
    CollectorClient,
    CollectorClientError,
    bilibili_native_search,
    bilibili_native_search_batch,
    create_client_request_id,
    xiaohongshu_public_notes_search,
)


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

    async def _resolve_binding_id(self, browser_binding_id: str | None) -> str:
        if browser_binding_id is not None:
            return browser_binding_id
        bindings = await self.client.list_browser_bindings()
        binding = next(
            (
                item
                for item in bindings
                if item.get("state") == "online" and isinstance(item.get("browserBindingId"), str)
            ),
            None,
        )
        if binding is None:
            raise CollectorClientError("collector_app_online_binding_missing", 409)
        return binding["browserBindingId"]

    async def bilibili_search(
        self,
        query: str,
        *,
        browser_binding_id: str | None = None,
        batch: bool = False,
    ) -> CollectionResult:
        """Run the typed Bilibili search builder without exposing wire fields."""

        binding_id = await self._resolve_binding_id(browser_binding_id)
        request = (
            bilibili_native_search_batch if batch else bilibili_native_search
        )(
            client_request_id=create_client_request_id(),
            browser_binding_id=binding_id,
            query=query,
        )
        return CollectionResult.from_mapping(await self.client.collect_and_wait(request))

    async def xiaohongshu_search(
        self,
        query: str,
        *,
        browser_binding_id: str | None = None,
        maximum_details: int | None = None,
        comments_maximum_scrolls: int | None = None,
        replies_maximum_threads: int | None = None,
    ) -> CollectionResult:
        """Run the typed public-note search builder with bounded enrichment."""

        binding_id = await self._resolve_binding_id(browser_binding_id)
        request = xiaohongshu_public_notes_search(
            client_request_id=create_client_request_id(),
            browser_binding_id=binding_id,
            query=query,
            maximum_details=maximum_details,
            comments_maximum_scrolls=comments_maximum_scrolls,  # type: ignore[arg-type]
            replies_maximum_threads=replies_maximum_threads,  # type: ignore[arg-type]
        )
        return CollectionResult.from_mapping(await self.client.collect_and_wait(request))
