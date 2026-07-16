"""Offline contract tests for the deterministic Gateway Citation Auditor.

These traces deliberately contain no live Gateway, model, browser, or search
provider call.  They document the evidence boundary the report writer may rely
on: native capability coverage, external discovery, canonical citations, raw
provenance, and explicit machine-readable gaps are all derived from tool trace
facts rather than an LLM answer.
"""

from __future__ import annotations

from typing import Any

from deepresearch_gateway.audit import AuditReport, audit_trace, render_markdown


def _platform(report: AuditReport, name: str):
    return next(audit for audit in report.platforms if audit.platform == name)


def _item(
    *,
    url: str,
    title: str = "公开条目",
    source: str = "web",
    rank: int = 1,
    promoted: bool = False,
    raw_ref: str = "fixture-raw:1",
) -> dict[str, Any]:
    return {
        "rank": rank,
        "title": title,
        "url": url,
        "source": source,
        "promoted": promoted,
        "raw_ref": raw_ref,
    }


def _search_event(
    *,
    platform: str,
    items: list[dict[str, Any]],
    capability_id: str,
    site: str | None = None,
    degraded: bool = False,
    status: str = "success",
    item_count: int | None = None,
    artifact: dict[str, Any] | None = None,
) -> dict[str, Any]:
    arguments: dict[str, Any] = {"platform": platform, "query": "低空经济", "limit": 10}
    if site is not None:
        arguments["site"] = site
    return {
        "tool": "gateway_search",
        "arguments": arguments,
        "status": status,
        "executed_capability_id": capability_id,
        "attempted_capabilities": [capability_id],
        "degraded": degraded,
        "partial": False,
        "result_item_count": len(items) if item_count is None else item_count,
        "result_items": items,
        "artifact": artifact,
        "warnings": [],
    }


def test_expected_platforms_are_not_attempted_and_report_a_stable_gap() -> None:
    report = audit_trace([], expected_platforms=["bilibili", "zhihu", "weibo"])

    assert [audit.platform for audit in report.platforms] == ["bilibili", "weibo", "zhihu"]
    for platform_name in ("bilibili", "zhihu", "weibo"):
        audit = _platform(report, platform_name)
        assert audit.event_count == 0
        assert audit.statuses == ()
        assert audit.claim_status == "not_attempted"
        assert audit.coverage_status == "not_attempted"
        assert audit.canonical_citation_count == 0
        assert "NOT_ATTEMPTED" in audit.gaps


def test_native_bilibili_success_is_not_downgraded_by_sogou_external_discovery() -> None:
    report = audit_trace(
        [
            _search_event(
                platform="bilibili",
                capability_id="bilibili.keyword_search.maxun.v1",
                items=[
                    _item(
                        title="B站原生搜索视频",
                        url="https://www.bilibili.com/video/BV1native",
                        source="bilibili",
                        raw_ref="maxun-run:native",
                    )
                ],
            ),
            _search_event(
                platform="web",
                site="bilibili.com",
                capability_id="sogou.keyword_search.browserwing_recipe.v1",
                degraded=True,
                items=[
                    _item(
                        title="搜狗包装链接",
                        url="https://www.sogou.com/link?url=opaque-bilibili-token",
                        raw_ref="browserwing-run:sogou",
                    )
                ],
            ),
        ]
    )

    audit = _platform(report, "bilibili")

    # The external fallback remains visible, but cannot rewrite a verified
    # native success into "fallback only" or make its canonical citation unsafe.
    assert audit.event_count == 2
    assert audit.coverage_status == "native_success"
    assert audit.claim_status == "citable"
    assert set(audit.collection_modes) == {"native", "external_discovery"}
    assert audit.canonical_citation_count == 1
    assert audit.canonical_citations[0].event_index == 0
    assert audit.canonical_citations[0].executed_capability_id == (
        "bilibili.keyword_search.maxun.v1"
    )
    assert audit.canonical_citations[0].degraded is False
    assert audit.coverage_degraded is False
    assert audit.degraded is True
    assert [citation.kind for citation in audit.noncanonical_citations] == ["search_redirect"]
    assert audit.noncanonical_citations[0].event_index == 1
    assert audit.noncanonical_citations[0].degraded is True


def test_external_site_discovery_can_be_citable_without_claiming_native_coverage() -> None:
    report = audit_trace(
        [
            _search_event(
                platform="web",
                site="zhihu.com",
                capability_id="sogou.keyword_search.browserwing_recipe.v1",
                degraded=True,
                items=[
                    _item(
                        title="知乎公开问答",
                        url="https://www.zhihu.com/question/123456/answer/7890",
                        raw_ref="browserwing-run:zhihu-discovery",
                    )
                ],
            )
        ],
        expected_platforms=["zhihu"],
    )

    audit = _platform(report, "zhihu")

    assert audit.claim_status == "citable"
    assert audit.coverage_status == "external_discovery_only"
    assert audit.collection_modes == ("external_discovery",)
    assert audit.degraded is True
    assert audit.canonical_citation_count == 1
    citation = audit.canonical_citations[0]
    assert citation.evidence_stage == "search_discovery"
    assert citation.url == "https://www.zhihu.com/question/123456/answer/7890"
    assert citation.raw_ref == "browserwing-run:zhihu-discovery"
    assert "EXTERNAL_DISCOVERY_ONLY" in audit.gaps
    assert "EXTERNAL_DISCOVERY_ONLY" in render_markdown(report)


def test_redirects_homepages_promotions_and_missing_urls_never_become_canonical() -> None:
    report = audit_trace(
        [
            _search_event(
                platform="web",
                site="zhihu.com",
                capability_id="sogou.keyword_search.browserwing_recipe.v1",
                degraded=True,
                items=[
                    _item(
                        title="搜狗跳转",
                        url="https://www.sogou.com/link?url=opaque-token",
                        raw_ref="browserwing-run:redirect",
                    ),
                    _item(
                        title="知乎外跳页",
                        url="https://link.zhihu.com/?target=https%3A%2F%2Fexample.com",
                        rank=2,
                        raw_ref="browserwing-run:zhihu-link",
                    ),
                    _item(
                        title="知乎首页",
                        url="https://www.zhihu.com/",
                        rank=3,
                        raw_ref="browserwing-run:homepage",
                    ),
                    _item(
                        title="推广问答",
                        url="https://www.zhihu.com/question/1",
                        rank=4,
                        promoted=True,
                        raw_ref="browserwing-run:promoted",
                    ),
                    _item(
                        title="没有 URL",
                        url="",
                        rank=5,
                        raw_ref="browserwing-run:missing-url",
                    ),
                ],
            )
        ]
    )

    audit = _platform(report, "zhihu")

    assert audit.claim_status == "uncitable"
    assert audit.canonical_citation_count == 0
    assert [citation.kind for citation in audit.noncanonical_citations] == [
        "search_redirect",
        "search_redirect",
        "platform_home",
        "promoted",
        "missing_url",
    ]
    assert {
        "NO_CANONICAL_CITATION",
        "SEARCH_REDIRECT",
        "PLATFORM_HOME",
        "PROMOTED_RESULT",
        "MISSING_URL",
    }.issubset(audit.gaps)


def test_search_and_fetch_keeps_search_and_detail_stages_with_provenance() -> None:
    search_url = "https://www.zhihu.com/question/123456"
    detail_url = "https://www.zhihu.com/question/123456/answer/7890"
    artifact = {
        "raw_file": "artifacts/fixture-detail-response.json",
        "manifest_file": "artifacts/fixture-detail-response.manifest.json",
        "sha256": "a" * 64,
    }
    report = audit_trace(
        [
            {
                "tool": "gateway_search_and_fetch",
                "arguments": {
                    "platform": "zhihu",
                    "query": "低空经济",
                    "search_limit": 5,
                    "detail_limit": 1,
                    "include_tables": True,
                },
                "status": "success",
                "degraded": False,
                "partial": False,
                "result_item_count": 1,
                "result_items": [
                    {
                        "rank": 1,
                        "url": search_url,
                        "ok": True,
                        "status": "success",
                        "executed_capability_id": "web.detail_fetch.trafilatura.v1",
                        "attempted_capabilities": ["web.detail_fetch.trafilatura.v1"],
                        "degraded": False,
                        "search_item": _item(
                            title="知乎问题",
                            url=search_url,
                            raw_ref="browserwing-run:search-raw",
                        ),
                        "article": {
                            "url": search_url,
                            "final_url": detail_url,
                            "title": "知乎详情正文",
                        },
                    }
                ],
                "search": {
                    "status": "success",
                    "executed_capability_id": "sogou.keyword_search.browserwing_recipe.v1",
                    "attempted_capabilities": [
                        "web.keyword_search.searxng.v1",
                        "sogou.keyword_search.browserwing_recipe.v1",
                    ],
                    "degraded": True,
                    "warnings": ["External discovery only."],
                    "error": None,
                },
                "search_result_item_count": 1,
                "search_result_items": [
                    _item(
                        title="知乎问题",
                        url=search_url,
                        raw_ref="browserwing-run:search-raw",
                    )
                ],
                "artifact": artifact,
                "warnings": [],
            }
        ]
    )

    audit = _platform(report, "zhihu")
    by_stage = {citation.evidence_stage: citation for citation in audit.canonical_citations}

    assert set(by_stage) == {"search_discovery", "detail_hydration"}
    discovery = by_stage["search_discovery"]
    detail = by_stage["detail_hydration"]
    assert discovery.event_index == 0
    assert discovery.tool == "gateway_search_and_fetch"
    assert discovery.executed_capability_id == "sogou.keyword_search.browserwing_recipe.v1"
    assert discovery.attempted_capabilities == (
        "web.keyword_search.searxng.v1",
        "sogou.keyword_search.browserwing_recipe.v1",
    )
    assert detail.event_index == 0
    assert detail.tool == "gateway_search_and_fetch"
    assert detail.url == detail_url
    assert detail.title == "知乎详情正文"
    assert detail.executed_capability_id == "web.detail_fetch.trafilatura.v1"
    assert detail.attempted_capabilities == ("web.detail_fetch.trafilatura.v1",)
    assert detail.raw_ref == "browserwing-run:search-raw"
    assert detail.artifact == artifact


def test_item_count_mismatch_and_missing_raw_evidence_are_explicit_gaps() -> None:
    report = audit_trace(
        [
            _search_event(
                platform="bilibili",
                capability_id="bilibili.keyword_search.maxun.v1",
                item_count=2,
                items=[
                    _item(
                        title="数量不一致的公开视频",
                        url="https://www.bilibili.com/video/BV1mismatch",
                        source="bilibili",
                        raw_ref="",
                    )
                ],
            )
        ]
    )

    audit = _platform(report, "bilibili")

    assert audit.canonical_citation_count == 1
    assert "ITEM_COUNT_MISMATCH" in audit.gaps
    assert "MISSING_RAW_EVIDENCE" in audit.gaps


def test_failed_detail_hydration_never_creates_a_citation() -> None:
    report = audit_trace(
        [
            {
                "tool": "gateway_search_and_fetch",
                "arguments": {
                    "platform": "zhihu",
                    "query": "低空经济",
                    "search_limit": 1,
                    "detail_limit": 1,
                },
                "status": "no_results",
                "partial": True,
                "result_items": [
                    {
                        "rank": 1,
                        "url": "https://www.zhihu.com/question/123",
                        "ok": False,
                        "status": "source_unavailable",
                        "executed_capability_id": "web.detail_fetch.trafilatura.v1",
                        "attempted_capabilities": ["web.detail_fetch.trafilatura.v1"],
                    }
                ],
                "search": {
                    "status": "success",
                    "executed_capability_id": "sogou.keyword_search.browserwing_recipe.v1",
                    "attempted_capabilities": ["sogou.keyword_search.browserwing_recipe.v1"],
                },
                "search_result_items": [],
                "warnings": [],
            }
        ]
    )

    audit = _platform(report, "zhihu")

    assert audit.canonical_citation_count == 0
    assert audit.claim_status == "uncitable"
    assert {
        "DETAIL_HYDRATION_FAILED",
        "SOURCE_UNAVAILABLE",
        "NO_CANONICAL_CITATION",
    }.issubset(audit.gaps)


def test_hotlist_events_are_evidence_not_ignored_trace_noise() -> None:
    report = audit_trace(
        [
            {
                "tool": "gateway_hotlist",
                "arguments": {
                    "platform": "bilibili",
                    "feed_id": "bilibili-hot-video",
                    "limit": 1,
                },
                "status": "success",
                "executed_capability_id": "bilibili.hotlist_fetch.newsnow-hot-video.v1",
                "attempted_capabilities": ["bilibili.hotlist_fetch.newsnow-hot-video.v1"],
                "degraded": False,
                "partial": False,
                "result_item_count": 1,
                "result_items": [
                    _item(
                        title="B站热榜公开视频",
                        url="https://www.bilibili.com/video/BV1hotlist",
                        source="bilibili",
                        raw_ref="newsnow:fixture-hotlist",
                    )
                ],
                "artifact": {
                    "raw_file": "artifacts/fixture-hotlist.json",
                    "manifest_file": "artifacts/fixture-hotlist.manifest.json",
                },
                "warnings": [],
            }
        ]
    )

    audit = _platform(report, "bilibili")

    assert report.ignored_event_count == 0
    assert audit.event_count == 1
    assert audit.claim_status == "citable"
    assert audit.coverage_status == "native_success"
    assert audit.canonical_citation_count == 1
    citation = audit.canonical_citations[0]
    assert citation.tool == "gateway_hotlist"
    assert citation.evidence_stage == "hotlist"
    assert citation.executed_capability_id == "bilibili.hotlist_fetch.newsnow-hot-video.v1"
