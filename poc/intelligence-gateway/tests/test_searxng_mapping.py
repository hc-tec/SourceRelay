from app.config import Settings
from app.connectors.searxng import SearXNGConnector
from app.models import SearchRequest, SourceName
from pydantic import ValidationError
import pytest


def test_site_scope_and_result_mapping() -> None:
    connector = SearXNGConnector(Settings.from_env())
    request = SearchRequest(source=SourceName.WEB, query="个人知识库", site="zhihu.com")
    assert connector._query(request) == "个人知识库 site:zhihu.com"

    items = connector._normalize(
        request,
        {
            "results": [
                {
                    "url": "https://www.zhihu.com/question/1?utm_source=test",
                    "title": "结果",
                    "content": "摘要",
                    "engines": ["bing", "brave"],
                    "score": 3.2,
                    "category": ["general"],
                },
                {
                    "url": "https://www.zhihu.com/question/1?utm_source=duplicate",
                    "title": "重复结果",
                },
            ]
        },
    )
    assert len(items) == 1
    assert items[0].url == "https://www.zhihu.com/question/1"
    assert items[0].content_type == "general"
    assert items[0].metrics["engines"] == ["bing", "brave"]


def test_wechat_shell_results_require_query_evidence() -> None:
    connector = SearXNGConnector(Settings.from_env())
    request = SearchRequest(
        source=SourceName.WEB,
        query="低空经济",
        site="mp.weixin.qq.com",
    )
    items = connector._normalize(
        request,
        {
            "results": [
                {
                    "url": "https://mp.weixin.qq.com/s/opaque-shell",
                    "title": "微信公众平台",
                    "content": "",
                },
                {
                    "url": "https://mp.weixin.qq.com/s/relevant-shell",
                    "title": "微信公众平台",
                    "content": "低空经济政策观察",
                },
                {
                    "url": "https://mp.weixin.qq.com/s/article-title",
                    "title": "低空经济加速起飞",
                    "content": "行业分析",
                },
                {
                    "url": "https://mp.weixin.qq.com/s/irrelevant-title",
                    "title": "微信公众号开发指南",
                    "content": "接口配置说明",
                },
            ]
        },
    )

    filtered, rejected = connector._filter_low_quality_site_results(
        request, items
    )

    assert rejected == 3
    assert [item.url for item in filtered] == [
        "https://mp.weixin.qq.com/s/article-title",
    ]


@pytest.mark.parametrize("site", ["zhihu.com/path", "zhihu.com:443", "user@zhihu.com"])
def test_site_scope_rejects_non_hostname_values(site: str) -> None:
    with pytest.raises(ValidationError):
        SearchRequest(source=SourceName.WEB, query="测试", site=site)
