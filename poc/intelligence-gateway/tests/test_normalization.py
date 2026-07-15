from app.models import SearchItem, SourceName
from app.normalization import canonicalize_url, deduplicate_items, item_content_hash, item_identity


def _item(rank: int, url: str, title: str = "title") -> SearchItem:
    return SearchItem(
        source=SourceName.WEB,
        query="query",
        rank=rank,
        title=title,
        url=url,
        collector="test",
    )


def test_canonicalize_url_removes_tracking_and_fragment() -> None:
    result = canonicalize_url(
        "HTTPS://Example.COM//news?id=42&utm_source=test&xsec_token=secret#comments"
    )
    assert result == "https://example.com/news?id=42"


def test_deduplicate_items_uses_canonical_url_and_reassigns_rank() -> None:
    items = [
        _item(4, "https://example.com/a?utm_source=one"),
        _item(9, "https://example.com/a?utm_source=two"),
        _item(12, "https://example.com/b"),
    ]
    result = deduplicate_items(items)
    assert [item.url for item in result] == ["https://example.com/a", "https://example.com/b"]
    assert [item.rank for item in result] == [1, 2]


def test_cross_source_fingerprint_groups_matching_titles() -> None:
    web = _item(1, "https://example.com/story", title="同一个事件")
    bilibili = SearchItem(
        source=SourceName.BILIBILI,
        query="query",
        rank=1,
        title="同一个事件",
        url="https://www.bilibili.com/video/BV1",
        collector="test",
    )
    web_document, _, web_cross = item_identity(web)
    bilibili_document, _, bilibili_cross = item_identity(bilibili)
    assert web_document != bilibili_document
    assert web_cross == bilibili_cross


def test_search_engine_ranking_metrics_do_not_create_content_change() -> None:
    first = _item(1, "https://example.com/story")
    first.metrics = {"score": 1.0, "engines": ["one"]}
    second = _item(9, "https://example.com/story")
    second.metrics = {"score": 9.0, "engines": ["two"]}
    assert item_content_hash(first) == item_content_hash(second)
