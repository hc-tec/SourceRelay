from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import SearchRequest, SearchResponse, SourceHealth, SourceName


class SearchConnector(ABC):
    source: SourceName

    @abstractmethod
    async def search(self, request: SearchRequest) -> SearchResponse:
        raise NotImplementedError

    @abstractmethod
    async def health(self) -> SourceHealth:
        raise NotImplementedError

