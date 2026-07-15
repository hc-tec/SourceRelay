from app.config import Settings
from app.connectors.maxun import MaxunBilibiliConnector
from app.models import SearchRequest, SourceName
from app.storage import GatewayStore


def test_maxun_labels_are_normalized_and_promoted_rows_are_explicit(tmp_path) -> None:
    store = GatewayStore(tmp_path / "gateway.db")
    store.initialize()
    connector = MaxunBilibiliConnector(Settings.from_env(), store)
    request = SearchRequest(source=SourceName.BILIBILI, query="DeepSeek", limit=10)
    payload = {
        "run": {
            "runId": "run-1",
            "data": {
                "listData": {
                    "rows": [
                        {
                            "Label 1": "https://www.bilibili.com/video/BV123?spm_id_from=333",
                            "Label 2": "普通视频",
                            "Label 4": "https://space.bilibili.com/123?from=search",
                            "Label 5": "作者",
                            "Label 6": "3小时前",
                        },
                        {
                            "Label 1": "https://cm.bilibili.com/track?id=1",
                            "Label 2": "推广内容",
                            "Label 5": "广告主",
                        },
                    ]
                }
            },
        }
    }
    items = connector._normalize_rows(request, payload)
    assert len(items) == 2
    assert items[0].url == "https://www.bilibili.com/video/BV123"
    assert items[0].author == "作者"
    assert items[0].published_text == "3小时前"
    assert items[0].raw_ref == "maxun-run:run-1"
    assert items[1].promoted is True
    assert items[1].url == ""
    assert items[1].warnings


def test_promoted_rows_can_be_excluded(tmp_path) -> None:
    store = GatewayStore(tmp_path / "gateway.db")
    store.initialize()
    connector = MaxunBilibiliConnector(Settings.from_env(), store)
    request = SearchRequest(
        source=SourceName.BILIBILI,
        query="DeepSeek",
        limit=10,
        include_promoted=False,
    )
    payload = {
        "run": {
            "data": {
                "listData": {
                    "rows": [{"Label 1": "https://example.com/ad", "Label 2": "推广"}]
                }
            }
        }
    }
    assert connector._normalize_rows(request, payload) == []
