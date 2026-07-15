from app.capabilities import CapabilityCatalog
from app.models import CapabilityAction, TaskPlanRequest


def test_catalog_loads_versioned_manifests() -> None:
    catalog = CapabilityCatalog()
    capabilities = catalog.list()
    assert len(capabilities) == 4
    assert {item.capability_id for item in capabilities} == {
        "bilibili.keyword_search.maxun.v1",
        "xiaohongshu.keyword_search.browserwing.v1",
        "web.keyword_search.searxng.v1",
        "web.article_extract.trafilatura.v1",
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
