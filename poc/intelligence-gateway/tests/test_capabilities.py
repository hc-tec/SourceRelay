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
    assert len(capabilities) == 5
    assert {item.capability_id for item in capabilities} == {
        "bilibili.keyword_search.maxun.v1",
        "xiaohongshu.keyword_search.browserwing.v1",
        "web.keyword_search.searxng.v1",
        "web.article_extract.trafilatura.v1",
        "web.detail_fetch.trafilatura.v1",
    }


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
