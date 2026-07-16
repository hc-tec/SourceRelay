from __future__ import annotations

from datetime import datetime
import hashlib
from importlib.metadata import version
import re
import time
from typing import Any
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
from .errors import GatewayError
from .models import (
    FetchRequest,
    FetchResponse,
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
    }


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
        version="0.5.0",
        description="Explicit-status API for Bilibili, Xiaohongshu, web discovery and article extraction.",
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
            "version": "0.5.0",
            "docs": "/docs",
            "sources": [entry["source"] for entry in registry.sources()],
            "article_extraction": True,
            "capability_runtime": True,
            "capabilities": "/capabilities",
            "capability_drafts": "/capability-drafts",
            "search_and_fetch": "/tasks/search-and-fetch",
        }

    @app.get("/sources")
    async def sources() -> dict[str, Any]:
        return {"sources": registry.sources(), "article_collector": registry.article.collector}

    @app.get("/sources/health")
    async def source_health() -> dict[str, Any]:
        health = await registry.health()
        return {"sources": [item.model_dump(mode="json") for item in health]}

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
        if manifest.executor == "browserwing_recipe":
            recipe = manifest.recipe or {}
            required = {
                "start_url",
                "input_selector",
                "result_item_selector",
                "expected_host",
            }
            missing = sorted(required - recipe.keys())
            binary_ready = draft_explorer.binary.is_file()
            blocked = manifest.status == CapabilityStatus.BLOCKED
            ready = not missing and binary_ready and not blocked
            return CapabilityCheckResponse(
                capability_id=manifest.capability_id,
                ready=ready,
                status=(
                    ResultStatus.SUCCESS
                    if ready
                    else (
                        ResultStatus.SOURCE_UNAVAILABLE
                        if blocked
                        else ResultStatus.MISCONFIGURED
                    )
                ),
                details={
                    "executor": manifest.executor,
                    "recipe_fields_complete": not missing,
                    "missing_recipe_fields": missing,
                    "browserwing_binary_exists": binary_ready,
                    "capability_status": manifest.status.value,
                    "planner_eligible": not blocked,
                    "reliability": manifest.reliability.model_dump(mode="json"),
                    "network_access_verified_on_execute": True,
                },
                warnings=list(manifest.warnings),
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
        payload = await draft_explorer.inspect(draft.start_url)
        inspection = payload.get("inspection") or {}
        has_input = bool(inspection.get("inputs"))
        return store.update_capability_draft(
            draft_id,
            status=DraftStatus.INSPECTED if has_input else DraftStatus.FAILED,
            inspection=inspection,
            recipe=payload.get("recipe"),
            validation={
                "passed": False,
                "issues": (
                    [] if has_input else ["No visible search input candidate was found."]
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
        payload = await draft_explorer.validate(draft.start_url, draft.sample_query)
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
                "authentication_gate_suspected": validation.get(
                    "authentication_gate_suspected", False
                ),
                "sample_items": (payload.get("items") or [])[:3],
            },
            issues=list(validation.get("issues") or []),
        )

    def generated_capability_id(draft: DraftCapabilityRecord) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", draft.platform.lower()).strip("-")
        if not slug:
            slug = f"site-{hashlib.sha256(draft.platform.encode('utf-8')).hexdigest()[:10]}"
        return f"{slug}.keyword_search.browserwing_recipe.v1"

    @app.post(
        "/capability-drafts/{draft_id}/promote",
        response_model=CapabilityManifest,
    )
    async def promote_capability_draft(draft_id: str):
        draft = get_draft_or_404(draft_id)
        if isinstance(draft, JSONResponse):
            return draft
        required_recipe_fields = {
            "start_url",
            "input_selector",
            "result_item_selector",
            "expected_host",
        }
        missing = sorted(required_recipe_fields - set(draft.recipe or {}))
        if draft.status not in {DraftStatus.VALIDATED, DraftStatus.PROMOTED}:
            return JSONResponse(
                status_code=409,
                content={
                    "ok": False,
                    "status": "error",
                    "error": "Only a validated capability draft can be promoted.",
                },
            )
        if missing:
            return JSONResponse(
                status_code=422,
                content={
                    "ok": False,
                    "status": "error",
                    "error": "Validated draft recipe is incomplete.",
                    "missing_fields": missing,
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
        else:
            promoted_at = datetime.now().astimezone()
            manifest = CapabilityManifest(
                capability_id=capability_id,
                version="1.0.0",
                platform=draft.platform,
                action=draft.action,
                status=CapabilityStatus.VERIFIED,
                executor="browserwing_recipe",
                adapter="GeneratedBrowserWingRecipe",
                authentication={"required": False, "mode": "none"},
                input_schema={
                    "query": {"type": "string", "required": True, "max_length": 300},
                    "limit": {"type": "integer", "default": 20, "maximum": 100},
                },
                output_schema="search_response.v1",
                scope={
                    "generated_from_draft": draft.draft_id,
                    "public_pages_only": True,
                    "first_rendered_page_only": True,
                    "pagination": False,
                    "heuristic_extraction": True,
                },
                fallback_ids=["web.keyword_search.searxng.v1"],
                fallback_site=str((draft.recipe or {})["expected_host"]),
                verification_input={"query": draft.sample_query, "limit": 5},
                recipe=draft.recipe,
                last_verified_at=promoted_at,
                reliability={
                    "last_verification_status": "success",
                    "last_attempt_at": promoted_at,
                    "last_success_at": promoted_at,
                },
                license="Generated recipe; target-site terms and policies apply.",
                warnings=[
                    "Generated BrowserWing adapter; selectors require regression maintenance.",
                    "Only the first rendered result page is extracted.",
                    "Titles and URLs are inferred heuristically from repeated containers.",
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
    ) -> SearchResponse | FetchResponse:
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
                started = time.perf_counter()
                payload = await draft_explorer.execute_recipe(
                    manifest.recipe, query, limit=limit
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
            if index > 0 and manifest.platform == "web" and request.platform != "web":
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
                attempt_warnings.append(
                    f"{manifest.capability_id} failed with {exc.status.value}: {exc}"
                )
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
            )
        raise GatewayError(
            "Task produced no executable capability result.",
            status=ResultStatus.ERROR,
            http_status=500,
            warnings=attempt_warnings,
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
            try:
                fetched = await execute_manifest(
                    detail_manifest,
                    fetch_request.model_dump(mode="json"),
                    "none",
                )
            except GatewayError as exc:
                details.append(
                    DetailFetchItem(
                        rank=search_item.rank,
                        search_item=search_item,
                        url=search_item.url,
                        ok=False,
                        status=exc.status,
                        warnings=exc.warnings,
                        error=str(exc),
                    )
                )
                continue
            except Exception as exc:
                details.append(
                    DetailFetchItem(
                        rank=search_item.rank,
                        search_item=search_item,
                        url=search_item.url,
                        ok=False,
                        status=ResultStatus.ERROR,
                        error=f"Detail fetch failed with {exc.__class__.__name__}.",
                    )
                )
                continue
            details.append(
                DetailFetchItem(
                    rank=search_item.rank,
                    search_item=search_item,
                    url=search_item.url,
                    ok=fetched.ok,
                    status=fetched.status,
                    duration_ms=fetched.duration_ms,
                    article=fetched.article,
                    warnings=(fetched.article.warnings if fetched.article else []),
                    error=fetched.error,
                )
            )

        successful = sum(item.ok for item in details)
        failed = len(details) - successful
        warnings = [
            "Detail hydration is limited to public HTML/text and at most five selected search results.",
            "Each redirect is revalidated against public-network URL rules before download.",
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
