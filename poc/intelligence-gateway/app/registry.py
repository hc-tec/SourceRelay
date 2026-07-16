from __future__ import annotations

import asyncio

from .config import Settings
from .connectors.article import ArticleExtractor
from .connectors.aiotieba import AiotiebaReadConnector
from .connectors.base import SearchConnector
from .connectors.browserwing import BrowserWingXiaohongshuConnector
from .connectors.maxun import MaxunBilibiliConnector
from .connectors.newsnow import NewsNowHotlistConnector
from .connectors.searxng import SearXNGConnector
from .connectors.ytdlp import YtDlpBilibiliVideoConnector
from .connectors.wechat_article import WechatPublicArticleConnector
from .connectors.weibo_account import BrowserWingWeiboAccountConnector
from .connectors.zhihu_qa import BrowserWingZhihuQaConnector
from .models import (
    FetchRequest,
    FetchResponse,
    ForumThreadsRequest,
    ForumThreadsResponse,
    HotlistRequest,
    HotlistResponse,
    PostDetailRequest,
    PostDetailResponse,
    SearchRequest,
    SearchResponse,
    SourceHealth,
    SourceName,
    VideoDetailRequest,
    VideoDetailResponse,
    WechatArticleDetailRequest,
    WechatArticleDetailResponse,
    WeiboAccountPostsRequest,
    WeiboAccountPostsResponse,
    ZhihuQaDetailRequest,
    ZhihuQaDetailResponse,
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
        self.ytdlp = YtDlpBilibiliVideoConnector(settings)
        self.aiotieba = AiotiebaReadConnector(settings)
        self.wechat_article = WechatPublicArticleConnector(settings)
        self.weibo_account = BrowserWingWeiboAccountConnector(
            settings, lock=self.connectors[SourceName.XIAOHONGSHU].lock
        )
        self.zhihu_qa = BrowserWingZhihuQaConnector(
            settings, lock=self.connectors[SourceName.XIAOHONGSHU].lock
        )

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

    async def video_detail(
        self,
        request: VideoDetailRequest,
        *,
        capability_id: str,
    ) -> VideoDetailResponse:
        return await self.ytdlp.fetch(request, capability_id=capability_id)

    async def forum_threads(
        self, request: ForumThreadsRequest, *, capability_id: str
    ) -> ForumThreadsResponse:
        return await self.aiotieba.forum_threads(request, capability_id=capability_id)

    async def post_detail(
        self, request: PostDetailRequest, *, capability_id: str
    ) -> PostDetailResponse:
        return await self.aiotieba.post_detail(request, capability_id=capability_id)

    async def wechat_article_detail(
        self, request: WechatArticleDetailRequest, *, capability_id: str
    ) -> WechatArticleDetailResponse:
        return await self.wechat_article.fetch(request, capability_id=capability_id)

    async def weibo_account_posts(
        self, request: WeiboAccountPostsRequest, *, capability_id: str
    ) -> WeiboAccountPostsResponse:
        return await self.weibo_account.fetch(request, capability_id=capability_id)

    async def zhihu_qa_detail(
        self, request: ZhihuQaDetailRequest, *, capability_id: str
    ) -> ZhihuQaDetailResponse:
        return await self.zhihu_qa.fetch(request, capability_id=capability_id)

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

    def video_detail_providers(self) -> list[dict[str, str]]:
        return [
            {
                "provider": self.ytdlp.provider,
                "collector": self.ytdlp.collector,
            }
        ]

    def forum_read_providers(self) -> list[dict[str, str]]:
        return [
            {
                "provider": self.aiotieba.provider,
                "collector": self.aiotieba.collector,
            }
        ]

    def public_article_providers(self) -> list[dict[str, str]]:
        return [
            {
                "provider": self.wechat_article.provider,
                "collector": self.wechat_article.collector,
            }
        ]

    def account_post_providers(self) -> list[dict[str, str]]:
        return [
            {
                "provider": self.weibo_account.provider,
                "collector": self.weibo_account.collector,
            }
        ]

    def qa_detail_providers(self) -> list[dict[str, str]]:
        return [
            {
                "provider": self.zhihu_qa.provider,
                "collector": self.zhihu_qa.collector,
            }
        ]
