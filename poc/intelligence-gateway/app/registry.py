from __future__ import annotations

import asyncio

from .config import Settings
from .connectors.article import ArticleExtractor
from .connectors.base import SearchConnector
from .connectors.browserwing import BrowserWingXiaohongshuConnector
from .connectors.maxun import MaxunBilibiliConnector
from .connectors.newsnow import NewsNowHotlistConnector
from .connectors.searxng import SearXNGConnector
from .models import (
    FetchRequest,
    FetchResponse,
    HotlistRequest,
    HotlistResponse,
    SearchRequest,
    SearchResponse,
    SourceHealth,
    SourceName,
)
from .storage import GatewayStore


class ConnectorRegistry:
    def __init__(self, settings: Settings, store: GatewayStore) -> None:
        self.connectors: dict[SourceName, SearchConnector] = {
            SourceName.BILIBILI: MaxunBilibiliConnector(settings, store),
            SourceName.XIAOHONGSHU: BrowserWingXiaohongshuConnector(settings),
            SourceName.WEB: SearXNGConnector(settings),
        }
        self.article = ArticleExtractor(settings)
        self.newsnow = NewsNowHotlistConnector(settings)

    async def search(self, request: SearchRequest) -> SearchResponse:
        return await self.connectors[request.source].search(request)

    async def fetch(self, request: FetchRequest) -> FetchResponse:
        return await self.article.fetch(request)

    async def hotlist(
        self,
        request: HotlistRequest,
        *,
        capability_id: str,
    ) -> HotlistResponse:
        return await self.newsnow.fetch(request, capability_id=capability_id)

    async def health(self) -> list[SourceHealth]:
        return list(await asyncio.gather(*(connector.health() for connector in self.connectors.values())))

    def sources(self) -> list[dict[str, str]]:
        return [
            {
                "source": source.value,
                "collector": getattr(connector, "collector", connector.__class__.__name__),
            }
            for source, connector in self.connectors.items()
        ]

    def hotlist_providers(self) -> list[dict[str, str]]:
        return [
            {
                "provider": self.newsnow.provider,
                "collector": self.newsnow.collector,
            }
        ]
