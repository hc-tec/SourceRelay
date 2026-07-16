from __future__ import annotations

from datetime import datetime
import hashlib
from importlib.metadata import version
import re
import time
from typing import Any
from urllib.parse import urlsplit
import uuid

from fastapi import BackgroundTasks, FastAPI, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .config import Settings
from .capabilities import CapabilityCatalog
from .connectors.article import validate_public_url
from .connectors.browserwing import BrowserWingXiaohongshuConnector
from .drafts import BrowserWingDraftExplorer
from .errors import AuthenticationRequiredError, GatewayError, SourceUnavailableError
from .models import (
    FetchRequest,
    FetchResponse,
    ForumThreadsRequest,
    ForumThreadsResponse,
    ArticleResult,
    ChangeType,
    CapabilityAction,
    CapabilityCheckResponse,
    CapabilityManifest,
    CapabilityReliabilityResponse,
    CapabilityStatus,
    DraftCapabilityRecord,
    DraftCapabilityRequest,
    DraftStatus,
    DraftValidationResponse,
    JobAccepted,
    JobRecord,
    HotlistRequest,
    HotlistResponse,
    PostDetailRequest,
    PostDetailResponse,
    ResultStatus,
    SearchRequest,
    SearchResponse,
    SearchItem,
    SearchAndFetchRequest,
    SearchAndFetchResponse,
    DetailFetchItem,
    SourceName,
    ProfileStatus,
    TaskExecutionRequest,
    TaskExecutionResponse,
    TaskPlanRequest,
    TaskPlanResponse,
    VideoDetailRequest,
    VideoDetailResponse,
)
from .normalization import canonicalize_url, deduplicate_items
from .registry import ConnectorRegistry
from .storage import GatewayStore


def _error_body(error: GatewayError) -> dict[str, Any]:
    return {
        "ok": False,
        "status": error.status.value,
        "error": str(error),
        "warnings": error.warnings,
        **error.context,
    }


SEARCH_RECIPE_FIELDS = {
    "start_url",
    "input_selector",
    "result_item_selector",
    "expected_host",
}
DETAIL_RECIPE_FIELDS = {
    "sample_url",
    "allowed_host",
    "content_selector",
    "minimum_text_chars",
    "maximum_text_chars",
}


def _missing_recipe_fields(recipe: dict[str, Any], required: set[str]) -> list[str]:
    return sorted(
        field
        for field in required
        if field not in recipe or recipe.get(field) is None or recipe.get(field) == ""
    )


def _detail_recipe_issues(recipe: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    minimum = recipe.get("minimum_text_chars")
    maximum = recipe.get("maximum_text_chars")
    if type(minimum) is not int or type(maximum) is not int:
        issues.append("Detail text thresholds must be integers.")
        return issues
    if minimum < 200:
        issues.append("minimum_text_chars must be at least 200.")
    if maximum < minimum or maximum > 200_000:
        issues.append(
            "maximum_text_chars must be between minimum_text_chars and 200000."
        )
    sample_url = str(recipe.get("sample_url") or "")
    allowed_host = str(recipe.get("allowed_host") or "").casefold().rstrip(".")
    sample_parts = urlsplit(sample_url)
    sample_host = (sample_parts.hostname or "").casefold().rstrip(".")
    if sample_parts.scheme not in {"http", "https"} or not sample_host:
        issues.append("sample_url must be an absolute HTTP(S) URL.")
    elif not (
        sample_host == allowed_host or sample_host.endswith(f".{allowed_host}")
    ):
        issues.append("sample_url must stay within allowed_host.")
    return issues


def _increment_patch_version(value: str) -> str:
    parts = value.split(".")
    if len(parts) == 3 and all(part.isdigit() for part in parts):
        return f"{parts[0]}.{parts[1]}.{int(parts[2]) + 1}"
    return value


def create_app(settings: Settings | None = None) -> FastAPI:
    active_settings = settings or Settings.from_env()
    store = GatewayStore(active_settings.database_path)
    store.initialize()
    registry = ConnectorRegistry(active_settings, store)
    catalog = CapabilityCatalog(
        runtime_directory=active_settings.runtime_dir / "capabilities"
    )
    browserwing_connector = registry.connectors[SourceName.XIAOHONGSHU]
    if not isinstance(browserwing_connector, BrowserWingXiaohongshuConnector):
        raise TypeError("Xiaohongshu connector must expose the shared BrowserWing lock.")
    draft_explorer = BrowserWingDraftExplorer(
        active_settings, browserwing_connector.lock
    )

    app = FastAPI(
        title="Personal Intelligence Gateway",
        version="0.9.0",
        description="Explicit-status API for Chinese-platform discovery, hotlists and public detail extraction.",
    )
    app.state.settings = active_settings
    app.state.store = store
    app.state.registry = registry
    app.state.capabilities = catalog
    app.state.draft_explorer = draft_explorer

    @app.exception_handler(GatewayError)
    async def gateway_error_handler(_request: Request, exc: GatewayError) -> JSONResponse:
        return JSONResponse(status_code=exc.http_status, content=_error_body(exc))

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "ok": False,
                "status": ResultStatus.ERROR.value,
                "error": "Request validation failed.",
                "details": jsonable_encoder(exc.errors()),
            },
        )

    @app.get("/")
    async def root() -> dict[str, Any]:
        return {
            "name": "personal-intelligence-gateway",
            "version": "0.9.0",
            "docs": "/docs",
            "sources": [entry["source"] for entry in registry.sources()],
            "hotlist_providers": [
                entry["provider"] for entry in registry.hotlist_providers()
            ],
            "video_detail_providers": [
                entry["provider"] for entry in registry.video_detail_providers()
            ],
            "forum_read_providers": [
                entry["provider"] for entry in registry.forum_read_providers()
            ],
            "article_extraction": True,
            "capability_runtime": True,
            "capabilities": "/capabilities",
            "capability_drafts": "/capability-drafts",
            "search_and_fetch": "/tasks/search-and-fetch",
        }

    @app.get("/sources")
    async def sources() -> dict[str, Any]:
        return {
            "sources": registry.sources(),
            "hotlist_providers": registry.hotlist_providers(),
            "video_detail_providers": registry.video_detail_providers(),
            "forum_read_providers": registry.forum_read_providers(),
            "article_collector": registry.article.collector,
        }

    @app.get("/sources/health")
    async def source_health() -> dict[str, Any]:
        health = await registry.health()
        hotlist_health = await registry.newsnow.health()
        video_health = await registry.ytdlp.health()
        forum_read_health = await registry.aiotieba.health()
        return {
            "sources": [item.model_dump(mode="json") for item in health],
            "hotlist_providers": [hotlist_health.model_dump(mode="json")],
            "video_detail_providers": [video_health.model_dump(mode="json")],
            "forum_read_providers": [forum_read_health.model_dump(mode="json")],
        }

    @app.get("/health")
    async def health() -> dict[str, Any]:
        source_states = await registry.health()
        ready = all(item.ready for item in source_states)
        return {
            "ok": ready,
            "status": ResultStatus.SUCCESS.value if ready else ResultStatus.SOURCE_UNAVAILABLE.value,
            "sources": [item.model_dump(mode="json") for item in source_states],
        }

    async def check_manifest(manifest: CapabilityManifest) -> CapabilityCheckResponse:
        if manifest.executor in {
            "browserwing_recipe",
            "browserwing_detail_recipe",
        }:
            recipe = manifest.recipe or {}
            is_detail = manifest.executor == "browserwing_detail_recipe"
            required = DETAIL_RECIPE_FIELDS if is_detail else SEARCH_RECIPE_FIELDS
            missing = _missing_recipe_fields(recipe, required)
            recipe_issues = _detail_recipe_issues(recipe) if is_detail and not missing else []
            binary_ready = draft_explorer.binary.is_file()
            planner_eligible = manifest.status not in {
                CapabilityStatus.BLOCKED,
                CapabilityStatus.RETIRED,
                CapabilityStatus.AUTHENTICATION_REQUIRED,
            }
            ready = not missing and not recipe_issues and binary_ready and planner_eligible
            return CapabilityCheckResponse(
                capability_id=manifest.capability_id,
                ready=ready,
                status=(
                    ResultStatus.SUCCESS
                    if ready
                    else (
                        ResultStatus.SOURCE_UNAVAILABLE
                        if not planner_eligible
                        else ResultStatus.MISCONFIGURED
                    )
                ),
                details={
                    "executor": manifest.executor,
                    "recipe_fields_complete": not missing,
                    "missing_recipe_fields": missing,
                    "recipe_issues": recipe_issues,
                    "browserwing_binary_exists": binary_ready,
                    "capability_status": manifest.status.value,
                    "planner_eligible": planner_eligible,
                    "reliability": manifest.reliability.model_dump(mode="json"),
                    "network_access_verified_on_execute": True,
                },
                warnings=list(manifest.warnings),
            )
        if manifest.action == CapabilityAction.HOTLIST_FETCH:
            allowed_feeds = tuple(manifest.scope.get("allowed_feed_ids") or ())
            known_feeds = registry.newsnow.allowed_feeds(manifest.platform)
            executor_valid = manifest.executor == "newsnow"
            scope_valid = (
                executor_valid
                and bool(allowed_feeds)
                and set(allowed_feeds).issubset(known_feeds)
            )
            planner_eligible = manifest.status in {
                CapabilityStatus.VERIFIED,
                CapabilityStatus.DEGRADED,
            }
            health = await registry.newsnow.health()
            ready = health.ready and scope_valid and planner_eligible
            return CapabilityCheckResponse(
                capability_id=manifest.capability_id,
                ready=ready,
                status=(
                    ResultStatus.SUCCESS
                    if ready
                    else (
                        ResultStatus.MISCONFIGURED
                        if not scope_valid
                        else ResultStatus.SOURCE_UNAVAILABLE
                    )
                ),
                details={
                    **health.details,
                    "executor": manifest.executor,
                    "executor_valid": executor_valid,
                    "dependency_ready": health.ready,
                    "scope_valid": scope_valid,
                    "allowed_feed_ids": list(allowed_feeds),
                    "capability_status": manifest.status.value,
                    "planner_eligible": planner_eligible,
                    "network_access_verified_on_execute": True,
                },
                warnings=[
                    *manifest.warnings,
                    *health.warnings,
                    *(
                        ["This declared capability must pass fixed-sample verification before planning."]
                        if not planner_eligible
                        else []
                    ),
                ],
            )
        if manifest.action == CapabilityAction.VIDEO_DETAIL:
            executor_valid = manifest.executor == "yt-dlp"
            scope_valid = (
                manifest.platform == "bilibili"
                and manifest.scope.get("known_public_url_only") is True
            )
            planner_eligible = manifest.status in {
                CapabilityStatus.VERIFIED,
                CapabilityStatus.DEGRADED,
            }
            health = await registry.ytdlp.health()
            ready = health.ready and executor_valid and scope_valid and planner_eligible
            return CapabilityCheckResponse(
                capability_id=manifest.capability_id,
                ready=ready,
                status=(
                    ResultStatus.SUCCESS
                    if ready
                    else (
                        ResultStatus.MISCONFIGURED
                        if not executor_valid or not scope_valid
                        else ResultStatus.SOURCE_UNAVAILABLE
                    )
                ),
                details={
                    **health.details,
                    "executor": manifest.executor,
                    "executor_valid": executor_valid,
                    "scope_valid": scope_valid,
                    "capability_status": manifest.status.value,
                    "planner_eligible": planner_eligible,
                },
                warnings=[
                    *manifest.warnings,
                    *health.warnings,
                    *(
                        ["This declared capability must pass fixed-sample verification before planning."]
                        if not planner_eligible
                        else []
                    ),
                ],
            )
        if manifest.action in {
            CapabilityAction.FORUM_THREADS,
            CapabilityAction.POST_DETAIL,
        }:
            executor_valid = manifest.executor == "aiotieba"
            scope_valid = (
                manifest.platform == "tieba"
                and manifest.scope.get("anonymous") is True
                and manifest.scope.get("read_only") is True
            )
            planner_eligible = manifest.status in {
                CapabilityStatus.VERIFIED,
                CapabilityStatus.DEGRADED,
            }
            provider_health = await registry.aiotieba.health()
            ready = provider_health.ready and executor_valid and scope_valid and planner_eligible
            return CapabilityCheckResponse(
                capability_id=manifest.capability_id,
                ready=ready,
                status=(
                    ResultStatus.SUCCESS
                    if ready
                    else (
                        ResultStatus.MISCONFIGURED
                        if not executor_valid or not scope_valid
                        else ResultStatus.SOURCE_UNAVAILABLE
                    )
                ),
                details={
                    **provider_health.details,
                    "executor": manifest.executor,
                    "executor_valid": executor_valid,
                    "scope_valid": scope_valid,
                    "capability_status": manifest.status.value,
                    "planner_eligible": planner_eligible,
                },
                warnings=[
                    *manifest.warnings,
                    *provider_health.warnings,
                    *(
                        ["This declared capability must pass fixed-sample verification before planning."]
                        if not planner_eligible
                        else []
                    ),
                ],
            )
        if manifest.action in {
            CapabilityAction.ARTICLE_EXTRACT,
            CapabilityAction.DETAIL_FETCH,
        }:
            return CapabilityCheckResponse(
                capability_id=manifest.capability_id,
                ready=True,
                status=ResultStatus.SUCCESS,
                details={
                    "collector": registry.article.collector,
                    "trafilatura_version": version("trafilatura"),
                    "network_access_verified_on_execute": True,
                },
                warnings=list(manifest.warnings),
            )
        if manifest.source is None:
            return CapabilityCheckResponse(
                capability_id=manifest.capability_id,
                ready=False,
                status=ResultStatus.MISCONFIGURED,
                warnings=["Search capability has no configured source connector."],
            )
        health = await registry.connectors[manifest.source].health()
        return CapabilityCheckResponse(
            capability_id=manifest.capability_id,
            ready=health.ready,
            status=health.status,
            details=health.details,
            warnings=[*manifest.warnings, *health.warnings],
        )

    @app.get("/capabilities")
    async def list_capabilities(
        platform: str | None = None,
        action: CapabilityAction | None = None,
        status: CapabilityStatus | None = None,
    ) -> dict[str, Any]:
        capabilities = catalog.list(platform=platform, action=action, status=status)
        return {
            "count": len(capabilities),
            "capabilities": [item.model_dump(mode="json") for item in capabilities],
        }

    @app.post("/capabilities/{capability_id}/check", response_model=CapabilityCheckResponse)
    async def check_capability(capability_id: str):
        try:
            manifest = catalog.get(capability_id)
        except KeyError:
            return JSONResponse(
                status_code=404,
                content={"ok": False, "status": "error", "error": "Capability was not found."},
            )
        return await check_manifest(manifest)

    @app.get("/capabilities/{capability_id}")
    async def get_capability(capability_id: str):
        try:
            return catalog.get(capability_id).model_dump(mode="json")
        except KeyError:
            return JSONResponse(
                status_code=404,
                content={"ok": False, "status": "error", "error": "Capability was not found."},
            )

    @app.get(
        "/capabilities/{capability_id}/reliability",
        response_model=CapabilityReliabilityResponse,
    )
    async def get_capability_reliability(capability_id: str):
        try:
            return catalog.reliability(capability_id)
        except KeyError:
            return JSONResponse(
                status_code=404,
                content={"ok": False, "status": "error", "error": "Capability was not found."},
            )

    @app.post("/tasks/plan", response_model=TaskPlanResponse)
    async def plan_task(request: TaskPlanRequest) -> TaskPlanResponse:
        return catalog.plan(request)

    def get_draft_or_404(draft_id: str) -> DraftCapabilityRecord | JSONResponse:
        try:
            return store.get_capability_draft(draft_id)
        except KeyError:
            return JSONResponse(
                status_code=404,
                content={
                    "ok": False,
                    "status": "error",
                    "error": "Capability draft was not found.",
                },
            )

    @app.post(
        "/capability-drafts",
        response_model=DraftCapabilityRecord,
        status_code=201,
    )
    async def create_capability_draft(request: DraftCapabilityRequest):
        await validate_public_url(str(request.start_url))
        return store.create_capability_draft(request)

    @app.get("/capability-drafts")
    async def list_capability_drafts(limit: int = Query(default=50, ge=1, le=200)):
        drafts = store.list_capability_drafts(limit=limit)
        return {
            "count": len(drafts),
            "drafts": [item.model_dump(mode="json") for item in drafts],
        }

    @app.get("/capability-drafts/{draft_id}", response_model=DraftCapabilityRecord)
    async def get_capability_draft(draft_id: str):
        return get_draft_or_404(draft_id)

    @app.post(
        "/capability-drafts/{draft_id}/inspect",
        response_model=DraftCapabilityRecord,
    )
    async def inspect_capability_draft(draft_id: str):
        draft = get_draft_or_404(draft_id)
        if isinstance(draft, JSONResponse):
            return draft
        payload = (
            await draft_explorer.inspect_detail(draft.start_url)
            if draft.action == CapabilityAction.DETAIL_FETCH
            else await draft_explorer.inspect(draft.start_url)
        )
        inspection = payload.get("inspection") or {}
        inspected = (
            bool(inspection.get("content_candidates"))
            if draft.action == CapabilityAction.DETAIL_FETCH
            else bool(inspection.get("inputs"))
        )
        return store.update_capability_draft(
            draft_id,
            status=DraftStatus.INSPECTED if inspected else DraftStatus.FAILED,
            inspection=inspection,
            recipe=payload.get("recipe"),
            validation={
                "passed": False,
                "issues": (
                    []
                    if inspected
                    else [
                        "No readable detail content container was found."
                        if draft.action == CapabilityAction.DETAIL_FETCH
                        else "No visible search input candidate was found."
                    ]
                ),
            },
        )

    @app.post(
        "/capability-drafts/{draft_id}/validate",
        response_model=DraftValidationResponse,
    )
    async def validate_capability_draft(draft_id: str):
        draft = get_draft_or_404(draft_id)
        if isinstance(draft, JSONResponse):
            return draft
        payload = (
            await draft_explorer.validate_detail(draft.start_url)
            if draft.action == CapabilityAction.DETAIL_FETCH
            else await draft_explorer.validate(
                draft.start_url, str(draft.sample_query)
            )
        )
        validation = payload.get("validation") or {}
        passed = bool(validation.get("passed"))
        status = DraftStatus.VALIDATED if passed else DraftStatus.FAILED
        store.update_capability_draft(
            draft_id,
            status=status,
            inspection=payload.get("inspection"),
            recipe=payload.get("recipe"),
            validation=validation,
        )
        detail_article = payload.get("article") or {}
        return DraftValidationResponse(
            draft_id=draft_id,
            passed=passed,
            status=status,
            recipe=payload.get("recipe"),
            evidence={
                "item_count": validation.get("item_count", 0),
                "final_url": validation.get("final_url", ""),
                "final_title": validation.get("final_title", ""),
                "submit_method": validation.get("submit_method", ""),
                "text_length": validation.get("text_length", 0),
                "encoding_repaired": validation.get("encoding_repaired", False),
                "authentication_gate_suspected": validation.get(
                    "authentication_gate_suspected", False
                ),
                "sample_items": (payload.get("items") or [])[:3],
                "article": (
                    {
                        "url": detail_article.get("url", ""),
                        "title": detail_article.get("title", ""),
                        "text_preview": str(detail_article.get("text") or "")[:500],
                        "text_length": detail_article.get("text_length", 0),
                    }
                    if draft.action == CapabilityAction.DETAIL_FETCH
                    else None
                ),
            },
            issues=list(validation.get("issues") or []),
        )

    def generated_capability_id(draft: DraftCapabilityRecord) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", draft.platform.lower()).strip("-")
        if not slug:
            slug = f"site-{hashlib.sha256(draft.platform.encode('utf-8')).hexdigest()[:10]}"
        action = (
            "detail_fetch"
            if draft.action == CapabilityAction.DETAIL_FETCH
            else "keyword_search"
        )
        return f"{slug}.{action}.browserwing_recipe.v1"

    @app.post(
        "/capability-drafts/{draft_id}/promote",
        response_model=CapabilityManifest,
    )
    async def promote_capability_draft(draft_id: str):
        draft = get_draft_or_404(draft_id)
        if isinstance(draft, JSONResponse):
            return draft
        is_detail = draft.action == CapabilityAction.DETAIL_FETCH
        required_recipe_fields = (
            DETAIL_RECIPE_FIELDS if is_detail else SEARCH_RECIPE_FIELDS
        )
        recipe = draft.recipe or {}
        missing = _missing_recipe_fields(recipe, required_recipe_fields)
        recipe_issues = _detail_recipe_issues(recipe) if is_detail and not missing else []
        if draft.status not in {DraftStatus.VALIDATED, DraftStatus.PROMOTED}:
            return JSONResponse(
                status_code=409,
                content={
                    "ok": False,
                    "status": "error",
                    "error": "Only a validated capability draft can be promoted.",
                },
            )
        if missing or recipe_issues:
            return JSONResponse(
                status_code=422,
                content={
                    "ok": False,
                    "status": "error",
                    "error": "Validated draft recipe is incomplete.",
                    "missing_fields": missing,
                    "recipe_issues": recipe_issues,
                },
            )
        capability_id = draft.promoted_capability_id or generated_capability_id(draft)
        existing = None
        try:
            existing = catalog.get(capability_id)
        except KeyError:
            pass
        if existing is not None:
            generated_from = existing.scope.get("generated_from_draft")
            if generated_from != draft.draft_id:
                return JSONResponse(
                    status_code=409,
                    content={
                        "ok": False,
                        "status": "error",
                        "error": "A different capability already uses the generated ID.",
                    },
                )
            manifest = existing
            if draft.status == DraftStatus.VALIDATED and draft.recipe != existing.recipe:
                promoted_at = datetime.now().astimezone()
                manifest = existing.model_copy(deep=True)
                manifest.version = _increment_patch_version(manifest.version)
                manifest.recipe = draft.recipe
                manifest.verification_input = (
                    {"url": draft.start_url}
                    if is_detail
                    else {"query": draft.sample_query, "limit": 5}
                )
                manifest.fallback_site = (
                    None
                    if is_detail
                    or draft.platform.casefold() in {"bing", "sogou", "baidu"}
                    else str((draft.recipe or {})["expected_host"])
                )
                manifest.status = CapabilityStatus.VERIFIED
                manifest.last_verified_at = promoted_at
                manifest.reliability.last_verification_status = ResultStatus.SUCCESS
                manifest.reliability.consecutive_failures = 0
                manifest.reliability.last_attempt_at = promoted_at
                manifest.reliability.last_success_at = promoted_at
                manifest.reliability.blocked_at = None
                manifest.reliability.last_error = None
                manifest.reliability.last_warnings = []
                catalog.save_runtime_manifest(manifest)
        else:
            promoted_at = datetime.now().astimezone()
            manifest = CapabilityManifest(
                capability_id=capability_id,
                version="1.0.0",
                platform=draft.platform,
                action=draft.action,
                status=CapabilityStatus.VERIFIED,
                executor=(
                    "browserwing_detail_recipe"
                    if is_detail
                    else "browserwing_recipe"
                ),
                adapter=(
                    "GeneratedBrowserWingDetailRecipe"
                    if is_detail
                    else "GeneratedBrowserWingRecipe"
                ),
                authentication={"required": False, "mode": "none"},
                input_schema=(
                    {
                        "url": {"type": "url", "required": True},
                    }
                    if is_detail
                    else {
                        "query": {"type": "string", "required": True, "max_length": 300},
                        "limit": {"type": "integer", "default": 20, "maximum": 100},
                        "site": {"type": "hostname", "required": False},
                    }
                ),
                output_schema=(
                    "fetch_response.v1" if is_detail else "search_response.v1"
                ),
                scope=(
                    {
                        "generated_from_draft": draft.draft_id,
                        "public_pages_only": True,
                        "rendered_detail": True,
                        "heuristic_extraction": True,
                        "host_scoped": True,
                        "javascript_rendering": True,
                        "comments": False,
                        "login": False,
                    }
                    if is_detail
                    else {
                        "generated_from_draft": draft.draft_id,
                        "public_pages_only": True,
                        "first_rendered_page_only": True,
                        "pagination": False,
                        "heuristic_extraction": True,
                    }
                ),
                fallback_ids=(
                    []
                    if is_detail
                    else ["web.keyword_search.searxng.v1"]
                ),
                fallback_site=(
                    None
                    if is_detail or draft.platform.casefold() in {"bing", "sogou", "baidu"}
                    else str((draft.recipe or {})["expected_host"])
                ),
                verification_input=(
                    {"url": draft.start_url}
                    if is_detail
                    else {"query": draft.sample_query, "limit": 5}
                ),
                recipe=draft.recipe,
                last_verified_at=promoted_at,
                reliability={
                    "last_verification_status": "success",
                    "last_attempt_at": promoted_at,
                    "last_success_at": promoted_at,
                },
                license="Generated recipe; target-site terms and policies apply.",
                warnings=[
                    *(
                        [
                            "Generated BrowserWing detail adapter; selectors require regression maintenance.",
                            "Only public rendered text inside the validated content container is returned.",
                        ]
                        if is_detail
                        else [
                            "Generated BrowserWing adapter; selectors require regression maintenance.",
                            "Only the first rendered result page is extracted.",
                            "Titles and URLs are inferred heuristically from repeated containers.",
                        ]
                    ),
                    "The recipe does not automate login or bypass verification challenges.",
                ],
            )
            catalog.save_runtime_manifest(manifest)
        store.update_capability_draft(
            draft_id,
            status=DraftStatus.PROMOTED,
            promoted_capability_id=manifest.capability_id,
        )
        return manifest

    @app.post("/search", response_model=SearchResponse)
    async def search(request: SearchRequest):
        try:
            return await execute_search(request)
        except GatewayError as exc:
            body = {
                **_error_body(exc),
                "source": request.source.value,
                "operation": "search",
                "query": request.query,
                "partial": True,
                "item_count": 0,
                "items": [],
            }
            return JSONResponse(status_code=exc.http_status, content=body)

    @app.post("/fetch", response_model=FetchResponse)
    async def fetch(request: FetchRequest):
        try:
            return await registry.fetch(request)
        except GatewayError as exc:
            return JSONResponse(status_code=exc.http_status, content=_error_body(exc))

    async def execute_search(
        request: SearchRequest, job_id: str | None = None
    ) -> SearchResponse:
        run_id = store.create_search_run(request, job_id=job_id)
        try:
            response = await registry.search(request)
            summary = store.persist_search_response(run_id, response)
        except GatewayError as exc:
            store.fail_search_run(run_id, exc.status.value, str(exc))
            raise
        except Exception as exc:
            store.fail_search_run(run_id, ResultStatus.ERROR.value, exc.__class__.__name__)
            raise
        response.run_id = run_id
        response.persistence = summary
        return response

    async def execute_manifest(
        manifest: CapabilityManifest,
        task_input: dict[str, Any],
        persistence: str,
    ) -> (
        SearchResponse
        | FetchResponse
        | HotlistResponse
        | VideoDetailResponse
        | ForumThreadsResponse
        | PostDetailResponse
    ):
        if manifest.action == CapabilityAction.KEYWORD_SEARCH:
            if manifest.executor == "browserwing_recipe":
                if not manifest.recipe:
                    raise GatewayError(
                        "Generated capability has no executable recipe.",
                        status=ResultStatus.MISCONFIGURED,
                        http_status=503,
                    )
                query = str(task_input.get("query") or "").strip()
                if not query:
                    raise GatewayError(
                        "Task input validation failed.",
                        status=ResultStatus.ERROR,
                        http_status=422,
                        warnings=["query is required"],
                    )
                limit = int(task_input.get("limit", 20))
                if not 1 <= limit <= 100:
                    raise GatewayError(
                        "Task input validation failed.",
                        status=ResultStatus.ERROR,
                        http_status=422,
                        warnings=["limit must be between 1 and 100"],
                    )
                validated_search_input = SearchRequest(
                    source=SourceName.WEB,
                    query=query,
                    limit=limit,
                    site=task_input.get("site"),
                )
                query = validated_search_input.query
                site = validated_search_input.site or ""
                execution_query = f"site:{site} {query}" if site else query
                started = time.perf_counter()
                payload = await draft_explorer.execute_recipe(
                    manifest.recipe, execution_query, limit=limit
                )
                validation = payload.get("validation") or {}
                if not validation.get("passed"):
                    issues = list(validation.get("issues") or [])
                    raise GatewayError(
                        "Generated BrowserWing recipe no longer passed validation.",
                        status=(
                            ResultStatus.AUTHENTICATION_REQUIRED
                            if validation.get("authentication_gate_suspected")
                            else ResultStatus.SOURCE_UNAVAILABLE
                        ),
                        http_status=(
                            424
                            if validation.get("authentication_gate_suspected")
                            else 503
                        ),
                        warnings=issues,
                    )
                items = deduplicate_items(
                    [
                        SearchItem(
                            source=SourceName.WEB,
                            query=query,
                            rank=index,
                            title=str(item.get("title") or "").strip(),
                            url=canonicalize_url(str(item.get("url") or "")),
                            snippet=str(item.get("text") or "").strip(),
                            content_type="search_result",
                            collector="browserwing_recipe",
                            partial=True,
                            warnings=["Title and URL were extracted heuristically."],
                        )
                        for index, item in enumerate(payload.get("items") or [], start=1)
                    ]
                )[:limit]
                response = SearchResponse(
                    ok=bool(items),
                    status=(ResultStatus.SUCCESS if items else ResultStatus.NO_RESULTS),
                    source=SourceName.WEB,
                    query=query,
                    duration_ms=round((time.perf_counter() - started) * 1000),
                    partial=True,
                    item_count=len(items),
                    items=items,
                    warnings=[
                        "Generated BrowserWing adapter executed a deterministic validated recipe.",
                        "Only the first rendered result page was inspected.",
                        *(
                            [
                                f"The browser query was constrained with site:{site} for external platform discovery."
                            ]
                            if site
                            else []
                        ),
                    ],
                )
                if persistence == "result_only":
                    persistence_request = SearchRequest(
                        source=SourceName.WEB, query=query, limit=limit
                    )
                    run_id = store.create_search_run(persistence_request)
                    summary = store.persist_search_response(run_id, response)
                    response.run_id = run_id
                    response.persistence = summary
                return response
            if manifest.source is None:
                raise GatewayError(
                    "Search capability has no configured source connector.",
                    status=ResultStatus.MISCONFIGURED,
                    http_status=503,
                )
            search_request = SearchRequest.model_validate(
                {
                    "source": manifest.source.value,
                    "query": task_input.get("query"),
                    "limit": task_input.get("limit", 20),
                    "site": task_input.get("site"),
                    "language": task_input.get("language", "zh-CN"),
                    "include_promoted": task_input.get("include_promoted", True),
                }
            )
            if persistence == "result_only":
                return await execute_search(search_request)
            return await registry.search(search_request)
        if manifest.action == CapabilityAction.HOTLIST_FETCH:
            if manifest.executor != "newsnow":
                raise GatewayError(
                    "Hotlist capability has no supported provider executor.",
                    status=ResultStatus.MISCONFIGURED,
                    http_status=503,
                )
            hotlist_request = HotlistRequest.model_validate(
                {
                    "platform": manifest.platform,
                    "feed_id": task_input.get("feed_id"),
                    "limit": task_input.get("limit", 20),
                    "force_latest": task_input.get("force_latest", False),
                }
            )
            allowed_feed_ids = set(manifest.scope.get("allowed_feed_ids") or ())
            if hotlist_request.feed_id not in allowed_feed_ids:
                raise GatewayError(
                    "Task input validation failed.",
                    status=ResultStatus.ERROR,
                    http_status=422,
                    warnings=[
                        f"feed_id must be one of: {', '.join(sorted(allowed_feed_ids))}"
                    ],
                )
            response = await registry.hotlist(
                hotlist_request,
                capability_id=manifest.capability_id,
            )
            if persistence == "result_only":
                response.warnings.append(
                    "Hotlist content was not written to the intelligence database; the raw local artifact is the durable result."
                )
            return response
        if manifest.action == CapabilityAction.VIDEO_DETAIL:
            if manifest.executor != "yt-dlp":
                raise GatewayError(
                    "Video detail capability has no supported provider executor.",
                    status=ResultStatus.MISCONFIGURED,
                    http_status=503,
                )
            video_request = VideoDetailRequest.model_validate(
                {"url": task_input.get("url")}
            )
            response = await registry.video_detail(
                video_request,
                capability_id=manifest.capability_id,
            )
            if persistence == "result_only":
                response.warnings.append(
                    "Video metadata was not written to the intelligence database; the raw local artifact is the durable result."
                )
            return response
        if manifest.action == CapabilityAction.FORUM_THREADS:
            if manifest.executor != "aiotieba":
                raise GatewayError(
                    "Forum threads capability has no supported provider executor.",
                    status=ResultStatus.MISCONFIGURED,
                    http_status=503,
                )
            forum_request = ForumThreadsRequest.model_validate(
                {
                    "forum_name": task_input.get("forum_name"),
                    "page": task_input.get("page", 1),
                    "limit": task_input.get("limit", 30),
                }
            )
            response = await registry.forum_threads(
                forum_request, capability_id=manifest.capability_id
            )
            if persistence == "result_only":
                response.warnings.append(
                    "Forum content was not written to the intelligence database; the raw local artifact is the durable result."
                )
            return response
        if manifest.action == CapabilityAction.POST_DETAIL:
            if manifest.executor != "aiotieba":
                raise GatewayError(
                    "Post detail capability has no supported provider executor.",
                    status=ResultStatus.MISCONFIGURED,
                    http_status=503,
                )
            post_request = PostDetailRequest.model_validate(
                {
                    "thread_id": task_input.get("thread_id"),
                    "page": task_input.get("page", 1),
                    "limit": task_input.get("limit", 30),
                }
            )
            response = await registry.post_detail(
                post_request, capability_id=manifest.capability_id
            )
            if persistence == "result_only":
                response.warnings.append(
                    "Post content was not written to the intelligence database; the raw local artifact is the durable result."
                )
            return response
        if manifest.action in {
            CapabilityAction.ARTICLE_EXTRACT,
            CapabilityAction.DETAIL_FETCH,
        }:
            fetch_request = FetchRequest.model_validate(
                {
                    "url": task_input.get("url"),
                    "include_tables": task_input.get("include_tables", True),
                }
            )
            if (
                manifest.action == CapabilityAction.DETAIL_FETCH
                and manifest.executor == "browserwing_detail_recipe"
            ):
                recipe = manifest.recipe or {}
                missing = _missing_recipe_fields(recipe, DETAIL_RECIPE_FIELDS)
                recipe_issues = _detail_recipe_issues(recipe) if not missing else []
                if missing or recipe_issues:
                    raise GatewayError(
                        "Generated detail capability has no valid executable recipe.",
                        status=ResultStatus.MISCONFIGURED,
                        http_status=503,
                        warnings=[
                            *([f"Missing recipe fields: {', '.join(missing)}"] if missing else []),
                            *recipe_issues,
                        ],
                    )
                started = time.perf_counter()
                payload = await draft_explorer.execute_detail_recipe(
                    recipe, str(fetch_request.url)
                )
                validation = payload.get("validation") or {}
                if not validation.get("passed"):
                    issues = list(validation.get("issues") or [])
                    if validation.get("authentication_gate_suspected"):
                        raise AuthenticationRequiredError(
                            "Generated BrowserWing detail recipe reached an authentication or verification gate.",
                            warnings=issues,
                        )
                    raise SourceUnavailableError(
                        "Generated BrowserWing detail recipe no longer passed validation.",
                        warnings=issues,
                    )
                article_payload = payload.get("article") or {}
                text = str(article_payload.get("text") or "").strip()
                article_warnings = [
                    "Public rendered text was extracted by a validated BrowserWing detail recipe.",
                    "No login, verification challenge, click or form submission was automated.",
                ]
                if article_payload.get("encoding_repaired"):
                    article_warnings.append(
                        "A high-confidence UTF-8 mojibake repair was applied to rendered Chinese text."
                    )
                article = ArticleResult(
                    url=str(fetch_request.url),
                    final_url=str(article_payload.get("url") or fetch_request.url),
                    title=str(article_payload.get("title") or "").strip(),
                    site_name=str(recipe.get("allowed_host") or ""),
                    text=text,
                    collector="browserwing_detail_recipe",
                    warnings=article_warnings,
                )
                return FetchResponse(
                    ok=True,
                    status=ResultStatus.SUCCESS,
                    duration_ms=round((time.perf_counter() - started) * 1000),
                    article=article,
                )
            return await registry.fetch(fetch_request)
        raise GatewayError(
            f"Unsupported capability action: {manifest.action.value}",
            status=ResultStatus.MISCONFIGURED,
            http_status=503,
        )

    async def run_capability_task(request: TaskExecutionRequest) -> TaskExecutionResponse:
        task_id = str(uuid.uuid4())
        plan = catalog.plan(
            TaskPlanRequest(
                platform=request.platform,
                action=request.action,
                input=request.input,
                allow_fallback=request.options.allow_fallback,
            )
        )
        if not plan.available or plan.selected_capability is None:
            raise GatewayError(
                "No matching capability is registered for this task.",
                status=ResultStatus.MISCONFIGURED,
                http_status=422,
                warnings=plan.warnings,
            )

        candidates = [plan.selected_capability]
        if request.options.allow_fallback:
            candidates.extend(plan.fallback_capabilities)
        attempted: list[str] = []
        attempt_warnings: list[str] = []
        last_error: GatewayError | None = None

        for index, manifest in enumerate(candidates):
            attempted.append(manifest.capability_id)
            effective_input = dict(plan.effective_input)
            if (
                index > 0
                and request.action == CapabilityAction.KEYWORD_SEARCH
                and (
                    manifest.platform == "web"
                    or manifest.executor == "browserwing_recipe"
                )
                and request.platform != "web"
            ):
                fallback_site = (
                    plan.selected_capability.fallback_site
                    or catalog.platform_site(request.platform, request.input)
                )
                if fallback_site:
                    effective_input["site"] = fallback_site
            try:
                result = await execute_manifest(
                    manifest, effective_input, request.options.persistence
                )
            except ValidationError as exc:
                last_error = GatewayError(
                    "Task input validation failed.",
                    status=ResultStatus.ERROR,
                    http_status=422,
                    warnings=[str(exc.errors()[0].get("msg", "Invalid task input."))],
                )
                attempt_warnings.append(
                    f"{manifest.capability_id} rejected the task input."
                )
                continue
            except GatewayError as exc:
                last_error = exc
                attempt_warnings.extend(exc.warnings)
                attempt_warnings.append(
                    f"{manifest.capability_id} failed with {exc.status.value}: {exc}"
                )
                if (
                    request.action == CapabilityAction.DETAIL_FETCH
                    and exc.status != ResultStatus.SOURCE_UNAVAILABLE
                ):
                    break
                continue

            has_more = index + 1 < len(candidates)
            if (
                result.status == ResultStatus.NO_RESULTS
                and has_more
                and request.options.fallback_on_no_results
            ):
                attempt_warnings.append(
                    f"{manifest.capability_id} returned no_results; trying configured fallback."
                )
                continue

            degraded = plan.degraded or index > 0
            warnings = [*plan.warnings, *attempt_warnings, *result.model_dump().get("warnings", [])]
            return TaskExecutionResponse(
                task_id=task_id,
                ok=result.ok,
                status=result.status,
                requested_platform=request.platform,
                requested_action=request.action,
                executed_capability_id=manifest.capability_id,
                executor=manifest.executor,
                degraded=degraded,
                attempted_capabilities=attempted,
                scope=manifest.scope,
                result=result.model_dump(mode="json"),
                warnings=list(dict.fromkeys(warnings)),
                error=result.error,
            )

        if last_error is not None:
            raise GatewayError(
                "All planned capabilities failed.",
                status=last_error.status,
                http_status=last_error.http_status,
                warnings=[*plan.warnings, *attempt_warnings],
                context={
                    **last_error.context,
                    "attempted_capabilities": attempted,
                    "executed_capability_id": attempted[-1] if attempted else None,
                    "degraded": plan.degraded or len(attempted) > 1,
                },
            )
        raise GatewayError(
            "Task produced no executable capability result.",
            status=ResultStatus.ERROR,
            http_status=500,
            warnings=attempt_warnings,
            context={
                "attempted_capabilities": attempted,
                "executed_capability_id": attempted[-1] if attempted else None,
                "degraded": plan.degraded or len(attempted) > 1,
            },
        )

    @app.post("/tasks/execute", response_model=TaskExecutionResponse)
    async def execute_task(request: TaskExecutionRequest):
        try:
            return await run_capability_task(request)
        except GatewayError as exc:
            return JSONResponse(
                status_code=exc.http_status,
                content={
                    **_error_body(exc),
                    "requested_platform": request.platform,
                    "requested_action": request.action.value,
                },
            )

    @app.post("/tasks/search-and-fetch", response_model=SearchAndFetchResponse)
    async def search_and_fetch(request: SearchAndFetchRequest):
        task_id = str(uuid.uuid4())
        try:
            search_task = await run_capability_task(
                TaskExecutionRequest(
                    platform=request.platform,
                    action=CapabilityAction.KEYWORD_SEARCH,
                    input={"query": request.query, "limit": request.search_limit},
                    options=request.options,
                )
            )
        except GatewayError as exc:
            return JSONResponse(
                status_code=exc.http_status,
                content={
                    **_error_body(exc),
                    "task_id": task_id,
                    "requested_platform": request.platform,
                    "query": request.query,
                    "operation": "search_and_fetch",
                },
            )

        selected_items: list[SearchItem] = []
        seen_urls: set[str] = set()
        for payload in (search_task.result or {}).get("items", []):
            try:
                search_item = SearchItem.model_validate(payload)
            except ValidationError:
                continue
            url = canonicalize_url(search_item.url)
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            search_item.url = url
            selected_items.append(search_item)
            if len(selected_items) >= request.detail_limit:
                break

        detail_manifest = catalog.get("web.detail_fetch.trafilatura.v1")
        details: list[DetailFetchItem] = []
        for search_item in selected_items:
            fetch_request = FetchRequest(
                url=search_item.url, include_tables=request.include_tables
            )
            detail_plan = catalog.plan(
                TaskPlanRequest(
                    platform=request.platform,
                    action=CapabilityAction.DETAIL_FETCH,
                    input=fetch_request.model_dump(mode="json"),
                    allow_fallback=request.options.allow_fallback,
                )
            )
            candidates = [detail_plan.selected_capability]
            candidates.extend(detail_plan.fallback_capabilities)

            attempted: list[str] = []
            attempt_warnings: list[str] = []
            final_item: DetailFetchItem | None = None
            for candidate_index, candidate in enumerate(candidates):
                if candidate is None:
                    continue
                attempted.append(candidate.capability_id)
                try:
                    fetched = await execute_manifest(
                        candidate,
                        fetch_request.model_dump(mode="json"),
                        "none",
                    )
                except GatewayError as exc:
                    attempt_warnings.extend(exc.warnings)
                    should_fallback = (
                        candidate_index == 0
                        and len(candidates) > 1
                        and exc.status == ResultStatus.SOURCE_UNAVAILABLE
                    )
                    if should_fallback:
                        attempt_warnings.append(
                            f"{candidate.capability_id} failed with {exc.status.value}; trying the registered rendered-detail recipe."
                        )
                        continue
                    final_item = DetailFetchItem(
                        rank=search_item.rank,
                        search_item=search_item,
                        url=search_item.url,
                        attempted_capabilities=attempted,
                        executed_capability_id=candidate.capability_id,
                        degraded=candidate_index > 0,
                        ok=False,
                        status=exc.status,
                        warnings=list(dict.fromkeys(attempt_warnings)),
                        error=str(exc),
                    )
                    break
                except Exception as exc:
                    final_item = DetailFetchItem(
                        rank=search_item.rank,
                        search_item=search_item,
                        url=search_item.url,
                        attempted_capabilities=attempted,
                        executed_capability_id=candidate.capability_id,
                        degraded=candidate_index > 0,
                        ok=False,
                        status=ResultStatus.ERROR,
                        warnings=list(dict.fromkeys(attempt_warnings)),
                        error=f"Detail fetch failed with {exc.__class__.__name__}.",
                    )
                    break

                response_warnings = (
                    fetched.article.warnings if fetched.article else []
                )
                should_fallback = (
                    candidate_index == 0
                    and len(candidates) > 1
                    and fetched.status
                    in {ResultStatus.NO_RESULTS, ResultStatus.SOURCE_UNAVAILABLE}
                    and (
                        fetched.status != ResultStatus.NO_RESULTS
                        or request.options.fallback_on_no_results
                    )
                )
                if should_fallback:
                    attempt_warnings.extend(response_warnings)
                    if fetched.error:
                        attempt_warnings.append(
                            f"{candidate.capability_id}: {fetched.error}"
                        )
                    attempt_warnings.append(
                        f"{candidate.capability_id} returned {fetched.status.value}; trying the registered rendered-detail recipe."
                    )
                    continue
                final_item = DetailFetchItem(
                    rank=search_item.rank,
                    search_item=search_item,
                    url=search_item.url,
                    attempted_capabilities=attempted,
                    executed_capability_id=candidate.capability_id,
                    degraded=candidate_index > 0,
                    ok=fetched.ok,
                    status=fetched.status,
                    duration_ms=fetched.duration_ms,
                    article=fetched.article,
                    warnings=list(
                        dict.fromkeys([*attempt_warnings, *response_warnings])
                    ),
                    error=fetched.error,
                )
                break
            if final_item is None:
                final_item = DetailFetchItem(
                    rank=search_item.rank,
                    search_item=search_item,
                    url=search_item.url,
                    attempted_capabilities=attempted,
                    executed_capability_id=(attempted[-1] if attempted else None),
                    degraded=len(attempted) > 1,
                    ok=False,
                    status=ResultStatus.ERROR,
                    warnings=list(dict.fromkeys(attempt_warnings)),
                    error="Detail capability chain ended without a result.",
                )
            details.append(final_item)

        successful = sum(item.ok for item in details)
        failed = len(details) - successful
        warnings = [
            "Detail hydration is limited to public content and at most five selected search results.",
            "Trafilatura public HTML/text extraction is always attempted before browser rendering.",
            "Browser rendering is used only when a host-matched verified/degraded detail recipe is already registered.",
            "Detail articles are returned in the response but are not persisted by this endpoint.",
        ]
        if len(selected_items) < request.detail_limit:
            warnings.append(
                f"Only {len(selected_items)} unique HTTP(S) search-result URLs were available for detail fetching."
            )
        if failed:
            warnings.append(
                f"{failed} selected search result(s) did not produce readable public article text."
            )
        ok = successful > 0
        return SearchAndFetchResponse(
            task_id=task_id,
            ok=ok,
            status=ResultStatus.SUCCESS if ok else ResultStatus.NO_RESULTS,
            requested_platform=request.platform,
            query=request.query,
            search=search_task,
            detail_capability_id=detail_manifest.capability_id,
            requested_detail_limit=request.detail_limit,
            attempted_detail_count=len(details),
            successful_detail_count=successful,
            failed_detail_count=failed,
            partial=failed > 0 or len(selected_items) < request.detail_limit,
            items=details,
            warnings=warnings,
            error=(
                None
                if ok
                else "No selected search result produced readable public article text."
            ),
        )

    @app.post("/capabilities/{capability_id}/verify", response_model=TaskExecutionResponse)
    async def verify_capability(capability_id: str):
        try:
            manifest = catalog.get(capability_id)
        except KeyError:
            return JSONResponse(
                status_code=404,
                content={"ok": False, "status": "error", "error": "Capability was not found."},
            )
        if not manifest.verification_input:
            return JSONResponse(
                status_code=422,
                content={
                    "ok": False,
                    "status": "error",
                    "error": "Capability has no safe verification input configured.",
                },
            )
        try:
            result = await execute_manifest(
                manifest, dict(manifest.verification_input), "none"
            )
        except ValidationError as exc:
            error = GatewayError(
                "Capability verification input is invalid.",
                status=ResultStatus.ERROR,
                http_status=422,
                warnings=[str(exc.errors()[0].get("msg", "Invalid verification input."))],
            )
            updated = catalog.record_verification(
                capability_id,
                succeeded=False,
                result_status=error.status,
                error=str(error),
                warnings=error.warnings,
            )
            return JSONResponse(
                status_code=error.http_status,
                content=jsonable_encoder(
                    {
                        **_error_body(error),
                        "capability_id": capability_id,
                        "capability_status": updated.status.value,
                        "reliability": updated.reliability.model_dump(mode="json"),
                    }
                ),
            )
        except GatewayError as exc:
            updated = catalog.record_verification(
                capability_id,
                succeeded=False,
                result_status=exc.status,
                error=str(exc),
                warnings=exc.warnings,
            )
            return JSONResponse(
                status_code=exc.http_status,
                content=jsonable_encoder(
                    {
                        **_error_body(exc),
                        "capability_id": capability_id,
                        "capability_status": updated.status.value,
                        "reliability": updated.reliability.model_dump(mode="json"),
                    }
                ),
            )

        result_warnings = list(getattr(result, "warnings", []) or [])
        if isinstance(result, FetchResponse) and result.article is not None:
            result_warnings.extend(result.article.warnings)
        succeeded = result.ok and result.status == ResultStatus.SUCCESS
        updated = catalog.record_verification(
            capability_id,
            succeeded=succeeded,
            result_status=result.status,
            error=result.error,
            warnings=result_warnings,
        )
        reliability_warnings: list[str] = []
        if catalog.is_runtime_mutable(capability_id):
            reliability_warnings.append(
                "Runtime verification succeeded and reset the consecutive failure counter."
                if succeeded
                else (
                    "Runtime verification did not succeed; the consecutive failure counter was incremented."
                )
            )
        return TaskExecutionResponse(
            task_id=str(uuid.uuid4()),
            ok=result.ok,
            status=result.status,
            requested_platform=manifest.platform,
            requested_action=manifest.action,
            executed_capability_id=manifest.capability_id,
            executor=manifest.executor,
            degraded=updated.status != CapabilityStatus.VERIFIED,
            attempted_capabilities=[manifest.capability_id],
            scope=manifest.scope,
            result=result.model_dump(mode="json"),
            warnings=list(
                dict.fromkeys(
                    [*manifest.warnings, *result_warnings, *reliability_warnings]
                )
            ),
            error=result.error,
        )

    @app.get("/profiles")
    async def list_profiles() -> dict[str, Any]:
        profile_manifests = {
            item.authentication.profile_id: item
            for item in catalog.list()
            if item.authentication.profile_id
        }
        profiles: list[ProfileStatus] = []
        for profile_id, manifest in profile_manifests.items():
            check = await check_manifest(manifest)
            profiles.append(
                ProfileStatus(
                    profile_id=profile_id,
                    platform=manifest.platform,
                    executor=manifest.executor,
                    ready=check.ready,
                    authentication_state=str(
                        check.details.get("authentication_state", "unknown_until_execute")
                    ),
                    warnings=check.warnings,
                )
            )
        return {
            "count": len(profiles),
            "profiles": [profile.model_dump(mode="json") for profile in profiles],
        }

    @app.get("/profiles/{platform}/status", response_model=ProfileStatus)
    async def get_profile_status(platform: str):
        manifests = [
            item
            for item in catalog.list(platform=platform)
            if item.authentication.profile_id
        ]
        if not manifests:
            return JSONResponse(
                status_code=404,
                content={
                    "ok": False,
                    "status": "error",
                    "error": "No managed authentication profile is registered for this platform.",
                },
            )
        manifest = manifests[0]
        check = await check_manifest(manifest)
        return ProfileStatus(
            profile_id=manifest.authentication.profile_id or "",
            platform=manifest.platform,
            executor=manifest.executor,
            ready=check.ready,
            authentication_state=str(
                check.details.get("authentication_state", "unknown_until_execute")
            ),
            warnings=check.warnings,
        )

    async def run_search_job(job_id: str, request_payload: dict[str, Any]) -> None:
        store.mark_job_running(job_id)
        try:
            request = SearchRequest.model_validate(request_payload)
            response = await execute_search(request, job_id=job_id)
        except GatewayError as exc:
            store.fail_job(job_id, _error_body(exc))
        except Exception as exc:  # Persist an opaque error; never serialize credentials or tracebacks.
            store.fail_job(
                job_id,
                {
                    "ok": False,
                    "status": ResultStatus.ERROR.value,
                    "error": f"Unexpected job failure: {exc.__class__.__name__}.",
                },
            )
        else:
            store.complete_job(job_id, response.model_dump(mode="json"))

    @app.post("/jobs/search", response_model=JobAccepted, status_code=202)
    async def create_search_job(
        request: SearchRequest, background_tasks: BackgroundTasks
    ) -> JobAccepted:
        record = store.create_job("search", request.source.value, request.model_dump(mode="json"))
        background_tasks.add_task(run_search_job, record.job_id, record.request)
        return JobAccepted(job_id=record.job_id, status=record.status, created_at=record.created_at)

    @app.get("/jobs/{job_id}", response_model=JobRecord)
    async def get_job(job_id: str):
        try:
            return store.get_job(job_id)
        except KeyError:
            return JSONResponse(
                status_code=404,
                content={
                    "ok": False,
                    "status": ResultStatus.ERROR.value,
                    "error": "Job was not found.",
                },
            )

    @app.get("/library/stats")
    async def library_stats() -> dict[str, Any]:
        return store.library_stats()

    @app.get("/documents")
    async def list_documents(
        source: SourceName | None = None,
        q: str | None = Query(default=None, max_length=300),
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
    ) -> dict[str, Any]:
        documents = store.list_documents(
            source=source.value if source else None,
            query=q,
            limit=limit,
            offset=offset,
        )
        return {
            "count": len(documents),
            "limit": limit,
            "offset": offset,
            "documents": [document.model_dump(mode="json") for document in documents],
        }

    @app.get("/documents/{document_id}")
    async def get_document(document_id: str):
        try:
            document = store.get_document(document_id)
        except KeyError:
            return JSONResponse(
                status_code=404,
                content={"ok": False, "status": "error", "error": "Document was not found."},
            )
        return document.model_dump(mode="json")

    @app.get("/documents/{document_id}/observations")
    async def document_observations(
        document_id: str, limit: int = Query(default=100, ge=1, le=500)
    ) -> dict[str, Any]:
        try:
            store.get_document(document_id)
        except KeyError:
            return JSONResponse(
                status_code=404,
                content={"ok": False, "status": "error", "error": "Document was not found."},
            )
        observations = store.list_observations(document_id=document_id, limit=limit)
        return {
            "document_id": document_id,
            "count": len(observations),
            "observations": [item.model_dump(mode="json") for item in observations],
        }

    @app.get("/changes")
    async def list_changes(
        since: datetime | None = None,
        source: SourceName | None = None,
        change_type: ChangeType | None = None,
        limit: int = Query(default=100, ge=1, le=500),
    ) -> dict[str, Any]:
        observations = store.list_observations(
            source=source.value if source else None,
            change_type=change_type.value if change_type else None,
            since=since,
            limit=limit,
        )
        return {
            "count": len(observations),
            "changes": [item.model_dump(mode="json") for item in observations],
        }

    @app.get("/clusters")
    async def list_clusters(
        min_documents: int = Query(default=2, ge=1, le=100),
        limit: int = Query(default=50, ge=1, le=100),
    ) -> dict[str, Any]:
        clusters = store.list_clusters(min_documents=min_documents, limit=limit)
        return {"count": len(clusters), "clusters": clusters}

    @app.get("/clusters/{cross_source_fingerprint}")
    async def get_cluster(cross_source_fingerprint: str):
        documents = store.list_documents_by_fingerprint(cross_source_fingerprint)
        if not documents:
            return JSONResponse(
                status_code=404,
                content={"ok": False, "status": "error", "error": "Cluster was not found."},
            )
        return {
            "cross_source_fingerprint": cross_source_fingerprint,
            "document_count": len(documents),
            "sources": sorted({document.source for document in documents}),
            "documents": [document.model_dump(mode="json") for document in documents],
        }

    @app.get("/runs")
    async def list_runs(
        source: SourceName | None = None,
        q: str | None = Query(default=None, max_length=300),
        limit: int = Query(default=50, ge=1, le=100),
    ) -> dict[str, Any]:
        runs = store.list_search_runs(
            source=source.value if source else None, query=q, limit=limit
        )
        return {"count": len(runs), "runs": [run.model_dump(mode="json") for run in runs]}

    @app.get("/runs/{run_id}")
    async def get_run(run_id: str):
        try:
            run = store.get_search_run(run_id)
        except KeyError:
            return JSONResponse(
                status_code=404,
                content={"ok": False, "status": "error", "error": "Search run was not found."},
            )
        return run.model_dump(mode="json")

    return app


app = create_app()
