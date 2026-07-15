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


@pytest.mark.parametrize("site", ["zhihu.com/path", "zhihu.com:443", "user@zhihu.com"])
def test_site_scope_rejects_non_hostname_values(site: str) -> None:
    with pytest.raises(ValidationError):
        SearchRequest(source=SourceName.WEB, query="测试", site=site)
