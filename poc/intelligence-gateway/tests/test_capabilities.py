from app.capabilities import CapabilityCatalog
from app.models import (
    CapabilityAction,
    CapabilityManifest,
    CapabilityStatus,
    TaskPlanRequest,
)


def test_catalog_loads_versioned_manifests() -> None:
    catalog = CapabilityCatalog()
    capabilities = catalog.list()
    assert len(capabilities) == 19
    assert {item.capability_id for item in capabilities} == {
        "36kr.hotlist_fetch.newsnow.v1",
        "bilibili.keyword_search.maxun.v1",
        "bilibili.video_detail.yt-dlp.v1",
        "bilibili.hotlist_fetch.newsnow-hot-search.v1",
        "bilibili.hotlist_fetch.newsnow-hot-video.v1",
        "bilibili.hotlist_fetch.newsnow-ranking.v1",
        "douyin.hotlist_fetch.newsnow.v1",
        "kuaishou.hotlist_fetch.newsnow.v1",
        "thepaper.hotlist_fetch.newsnow.v1",
        "tieba.hotlist_fetch.newsnow.v1",
        "tieba.forum_threads.aiotieba.v1",
        "tieba.post_detail.aiotieba.v1",
        "weibo.hotlist_fetch.newsnow.v1",
        "xiaohongshu.keyword_search.browserwing.v1",
        "web.keyword_search.searxng.v1",
        "web.article_extract.trafilatura.v1",
        "web.detail_fetch.trafilatura.v1",
        "zhihu.hotlist_fetch.newsnow.v1",
        "wechat_official.article_detail.public-html.v1",
    }


def test_declared_failed_hotlist_capability_is_discoverable_but_not_plannable() -> None:
    catalog = CapabilityCatalog()
    declared = catalog.get("douyin.hotlist_fetch.newsnow.v1")
    plan = catalog.plan(
        TaskPlanRequest(
            platform="douyin",
            action=CapabilityAction.HOTLIST_FETCH,
            input={"feed_id": "douyin"},
        )
    )

    assert declared.status == CapabilityStatus.DECLARED_UNVERIFIED
    assert declared.scope["allowed_feed_ids"] == ["douyin"]
    assert plan.available is False
    assert any("fixed-sample verification" in warning for warning in plan.warnings)


def test_verified_bilibili_hotlist_plan_preserves_distinct_feed_ids() -> None:
    catalog = CapabilityCatalog()
    capability = catalog.get("bilibili.hotlist_fetch.newsnow-ranking.v1")
    plan = catalog.plan(
        TaskPlanRequest(
            platform="bilibili",
            action=CapabilityAction.HOTLIST_FETCH,
            input={"feed_id": "bilibili-ranking"},
        )
    )

    assert capability.status == CapabilityStatus.VERIFIED
    assert capability.scope["allowed_feed_ids"] == ["bilibili-ranking"]
    assert plan.available is True
    assert plan.selected_capability.capability_id == capability.capability_id
    assert plan.effective_input["feed_id"] == "bilibili-ranking"


def test_hotlist_plan_requires_feed_id_instead_of_guessing_a_platform_default() -> None:
    plan = CapabilityCatalog().plan(
        TaskPlanRequest(
            platform="bilibili",
            action=CapabilityAction.HOTLIST_FETCH,
            input={},
        )
    )

    assert plan.available is False
    assert plan.warnings == [
        "feed_id is required to select an exact hotlist capability."
    ]


def test_verified_video_detail_enters_planner_after_live_sample() -> None:
    catalog = CapabilityCatalog()
    capability = catalog.get("bilibili.video_detail.yt-dlp.v1")
    plan = catalog.plan(
        TaskPlanRequest(
            platform="bilibili",
            action=CapabilityAction.VIDEO_DETAIL,
            input={"url": "https://www.bilibili.com/video/BV1XTNR69Etx"},
        )
    )

    assert capability.status == CapabilityStatus.VERIFIED
    assert plan.available is True
    assert plan.selected_capability.capability_id == capability.capability_id


def test_direct_platform_plan_includes_safe_fallback() -> None:
    catalog = CapabilityCatalog()
    plan = catalog.plan(
        TaskPlanRequest(
            platform="bilibili",
            action=CapabilityAction.KEYWORD_SEARCH,
            input={"query": "测试"},
        )
    )
    assert plan.available is True
    assert plan.degraded is False
    assert plan.selected_capability.capability_id == "bilibili.keyword_search.maxun.v1"
    assert [item.capability_id for item in plan.fallback_capabilities] == [
        "web.keyword_search.searxng.v1"
    ]


def test_unknown_internal_platform_plans_external_site_discovery() -> None:
    catalog = CapabilityCatalog()
    plan = catalog.plan(
        TaskPlanRequest(
            platform="zhihu",
            action=CapabilityAction.KEYWORD_SEARCH,
            input={"query": "测试"},
        )
    )
    assert plan.available is True
    assert plan.degraded is True
    assert plan.selected_capability.capability_id == "web.keyword_search.searxng.v1"
    assert plan.effective_input["site"] == "zhihu.com"
    assert any("not a complete platform index" in warning for warning in plan.warnings)


def test_unknown_platform_without_domain_has_no_safe_plan() -> None:
    catalog = CapabilityCatalog()
    plan = catalog.plan(
        TaskPlanRequest(
            platform="unknown-platform",
            action=CapabilityAction.KEYWORD_SEARCH,
            input={"query": "测试"},
        )
    )
    assert plan.available is False
    assert plan.selected_capability is None


def test_detail_fetch_has_a_generic_public_page_plan() -> None:
    catalog = CapabilityCatalog()
    plan = catalog.plan(
        TaskPlanRequest(
            platform="csdn",
            action=CapabilityAction.DETAIL_FETCH,
            input={"url": "https://blog.csdn.net/example/article/details/1"},
        )
    )
    assert plan.available is True
    assert plan.degraded is False
    assert plan.selected_capability.capability_id == "web.detail_fetch.trafilatura.v1"


def test_detail_plan_keeps_direct_first_and_host_scopes_rendered_fallback(
    tmp_path,
) -> None:
    catalog = CapabilityCatalog(runtime_directory=tmp_path / "capabilities")
    base = catalog.get("web.detail_fetch.trafilatura.v1")
    rendered = CapabilityManifest.model_validate(
        {
            **base.model_dump(mode="json"),
            "capability_id": "csdn.detail_fetch.browserwing_recipe.v1",
            "platform": "csdn",
            "status": CapabilityStatus.VERIFIED,
            "executor": "browserwing_detail_recipe",
            "adapter": "GeneratedBrowserWingDetailRecipe",
            "fallback_ids": [],
            "recipe": {
                "sample_url": "https://blog.csdn.net/example/article/details/1",
                "allowed_host": "blog.csdn.net",
                "title_selector": "h1",
                "content_selector": "article",
                "minimum_text_chars": 200,
                "maximum_text_chars": 200000,
            },
        }
    )
    catalog.save_runtime_manifest(rendered)

    matched = catalog.plan(
        TaskPlanRequest(
            platform="csdn",
            action=CapabilityAction.DETAIL_FETCH,
            input={"url": "https://x.blog.csdn.net/article/details/2"},
        )
    )
    external = catalog.plan(
        TaskPlanRequest(
            platform="csdn",
            action=CapabilityAction.DETAIL_FETCH,
            input={"url": "https://example.net/article/2"},
        )
    )

    assert matched.selected_capability.capability_id == (
        "web.detail_fetch.trafilatura.v1"
    )
    assert [item.capability_id for item in matched.fallback_capabilities] == [
        rendered.capability_id
    ]
    assert external.fallback_capabilities == []


def test_searxng_plan_adds_verified_public_browser_search_fallbacks(
    tmp_path,
) -> None:
    catalog = CapabilityCatalog(runtime_directory=tmp_path / "capabilities")
    base = catalog.get("web.keyword_search.searxng.v1")
    bing = CapabilityManifest.model_validate(
        {
            **base.model_dump(mode="json"),
            "capability_id": "bing.keyword_search.browserwing_recipe.v1",
            "platform": "bing",
            "status": CapabilityStatus.VERIFIED,
            "executor": "browserwing_recipe",
            "adapter": "GeneratedBrowserWingRecipe",
            "source": None,
            "authentication": {"required": False, "mode": "none"},
            "fallback_ids": ["web.keyword_search.searxng.v1"],
            "fallback_site": None,
            "recipe": {
                "start_url": "https://www.bing.com/",
                "input_selector": "#sb_form_q",
                "submit_selector": "",
                "result_item_selector": "h2",
                "expected_host": "www.bing.com",
            },
        }
    )
    catalog.save_runtime_manifest(bing)

    web_plan = catalog.plan(
        TaskPlanRequest(
            platform="web",
            action=CapabilityAction.KEYWORD_SEARCH,
            input={"query": "低空经济"},
        )
    )
    zhihu_plan = catalog.plan(
        TaskPlanRequest(
            platform="zhihu",
            action=CapabilityAction.KEYWORD_SEARCH,
            input={"query": "个人知识库"},
        )
    )

    assert web_plan.selected_capability.capability_id == (
        "web.keyword_search.searxng.v1"
    )
    assert [item.capability_id for item in web_plan.fallback_capabilities] == [
        bing.capability_id
    ]
    assert zhihu_plan.effective_input["site"] == "zhihu.com"
    assert [item.capability_id for item in zhihu_plan.fallback_capabilities] == [
        bing.capability_id
    ]
