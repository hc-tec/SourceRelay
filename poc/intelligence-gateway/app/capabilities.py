from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from typing import Any
from urllib.parse import urlsplit

from .config import GATEWAY_ROOT
from .models import (
    CapabilityAction,
    CapabilityManifest,
    CapabilityReliabilityResponse,
    CapabilityStatus,
    ResultStatus,
    TaskPlanRequest,
    TaskPlanResponse,
    utc_now,
)


PLATFORM_SITES = {
    "bilibili": "bilibili.com",
    "xiaohongshu": "xiaohongshu.com",
    "zhihu": "zhihu.com",
    "weibo": "weibo.com",
    "douyin": "douyin.com",
    "kuaishou": "kuaishou.com",
    "tieba": "tieba.baidu.com",
    "wechat_official": "mp.weixin.qq.com",
}


class CapabilityCatalog:
    def __init__(
        self,
        directory: Path | None = None,
        runtime_directory: Path | None = None,
    ) -> None:
        self.directory = directory or (GATEWAY_ROOT / "capabilities")
        self.runtime_directory = runtime_directory
        self._manifests: dict[str, CapabilityManifest] = {}
        self._manifest_paths: dict[str, Path] = {}
        self._write_lock = RLock()
        self.reload()

    def _load(self) -> dict[str, CapabilityManifest]:
        manifests: dict[str, CapabilityManifest] = {}
        manifest_paths: dict[str, Path] = {}
        directories = [self.directory]
        if self.runtime_directory is not None:
            directories.append(self.runtime_directory)
        for directory in directories:
            if not directory.is_dir():
                continue
            for path in sorted(directory.glob("*.json")):
                payload = json.loads(path.read_text(encoding="utf-8-sig"))
                manifest = CapabilityManifest.model_validate(payload)
                if manifest.capability_id in manifests:
                    raise ValueError(f"Duplicate capability ID: {manifest.capability_id}")
                manifests[manifest.capability_id] = manifest
                manifest_paths[manifest.capability_id] = path
        if not manifests:
            raise ValueError(f"No capability manifests found in {self.directory}")
        for manifest in manifests.values():
            missing = [item for item in manifest.fallback_ids if item not in manifests]
            if missing:
                raise ValueError(
                    f"Capability {manifest.capability_id} has missing fallbacks: {missing}"
                )
        self._manifest_paths = manifest_paths
        return manifests

    def reload(self) -> list[CapabilityManifest]:
        self._manifests = self._load()
        return self.list()

    def save_runtime_manifest(self, manifest: CapabilityManifest) -> Path:
        if self.runtime_directory is None:
            raise ValueError("Runtime capability directory is not configured.")
        with self._write_lock:
            self.runtime_directory.mkdir(parents=True, exist_ok=True)
            target = self.runtime_directory / f"{manifest.capability_id}.json"
            temporary = target.with_suffix(".json.tmp")
            temporary.write_text(
                json.dumps(manifest.model_dump(mode="json"), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temporary.replace(target)
            self.reload()
        return target

    def is_runtime_mutable(self, capability_id: str) -> bool:
        if self.runtime_directory is None:
            return False
        path = self._manifest_paths.get(capability_id)
        if path is None:
            return False
        return path.parent.resolve() == self.runtime_directory.resolve()

    def reliability(self, capability_id: str) -> CapabilityReliabilityResponse:
        manifest = self.get(capability_id)
        return CapabilityReliabilityResponse(
            capability_id=capability_id,
            capability_status=manifest.status,
            planner_eligible=manifest.status in {
                CapabilityStatus.VERIFIED,
                CapabilityStatus.DEGRADED,
            },
            runtime_mutable=self.is_runtime_mutable(capability_id),
            reliability=manifest.reliability,
        )

    def record_verification(
        self,
        capability_id: str,
        *,
        succeeded: bool,
        result_status: ResultStatus,
        error: str | None = None,
        warnings: list[str] | None = None,
    ) -> CapabilityManifest:
        if not self.is_runtime_mutable(capability_id):
            return self.get(capability_id)
        with self._write_lock:
            self.reload()
            manifest = self.get(capability_id).model_copy(deep=True)
            reliability = manifest.reliability
            timestamp = utc_now()
            reliability.last_attempt_at = timestamp
            reliability.last_verification_status = result_status
            reliability.last_warnings = list(warnings or [])
            if succeeded:
                reliability.consecutive_failures = 0
                reliability.last_success_at = timestamp
                reliability.last_error = None
                reliability.blocked_at = None
                manifest.last_verified_at = timestamp
                manifest.status = CapabilityStatus.VERIFIED
            else:
                reliability.consecutive_failures += 1
                reliability.last_failure_at = timestamp
                reliability.last_error = error or result_status.value
                if reliability.consecutive_failures >= reliability.failure_threshold:
                    reliability.blocked_at = timestamp
                    manifest.status = CapabilityStatus.BLOCKED
                else:
                    manifest.status = CapabilityStatus.DEGRADED
            self.save_runtime_manifest(manifest)
            return self.get(capability_id)

    def list(
        self,
        platform: str | None = None,
        action: CapabilityAction | None = None,
        status: CapabilityStatus | None = None,
    ) -> list[CapabilityManifest]:
        items = list(self._manifests.values())
        if platform:
            items = [item for item in items if item.platform == platform.strip().lower()]
        if action:
            items = [item for item in items if item.action == action]
        if status:
            items = [item for item in items if item.status == status]
        return sorted(items, key=lambda item: item.capability_id)

    def get(self, capability_id: str) -> CapabilityManifest:
        try:
            return self._manifests[capability_id]
        except KeyError as exc:
            raise KeyError(capability_id) from exc

    def platform_site(self, platform: str, task_input: dict[str, Any]) -> str | None:
        explicit = task_input.get("site")
        if explicit:
            return str(explicit)
        normalized = platform.strip().lower()
        if normalized in PLATFORM_SITES:
            return PLATFORM_SITES[normalized]
        return normalized if "." in normalized and "/" not in normalized else None

    def public_search_fallbacks(self) -> list[CapabilityManifest]:
        platform_priority = {"bing": 0, "sogou": 1}
        fallbacks = [
            item
            for item in self.list(action=CapabilityAction.KEYWORD_SEARCH)
            if item.executor == "browserwing_recipe"
            and item.platform in platform_priority
            and item.status in {
                CapabilityStatus.VERIFIED,
                CapabilityStatus.DEGRADED,
            }
            and not item.authentication.required
            and item.recipe
        ]
        fallbacks.sort(
            key=lambda item: (
                item.status != CapabilityStatus.VERIFIED,
                platform_priority[item.platform],
                item.capability_id,
            )
        )
        return fallbacks

    def _extend_public_search_fallbacks(
        self,
        fallbacks: list[CapabilityManifest],
        *,
        allow_fallback: bool,
    ) -> list[CapabilityManifest]:
        if not allow_fallback or not any(
            item.capability_id == "web.keyword_search.searxng.v1"
            for item in fallbacks
        ):
            return fallbacks
        existing = {item.capability_id for item in fallbacks}
        return [
            *fallbacks,
            *[
                item
                for item in self.public_search_fallbacks()
                if item.capability_id not in existing
            ],
        ]

    def plan(self, request: TaskPlanRequest) -> TaskPlanResponse:
        matching = self.list(platform=request.platform, action=request.action)
        if request.action == CapabilityAction.HOTLIST_FETCH:
            requested_feed_id = str(request.input.get("feed_id") or "").strip().lower()
            if not requested_feed_id:
                return TaskPlanResponse(
                    available=False,
                    requested_platform=request.platform,
                    requested_action=request.action,
                    effective_input=dict(request.input),
                    warnings=[
                        "feed_id is required to select an exact hotlist capability."
                    ],
                )
            matching = [
                item
                for item in matching
                if requested_feed_id in (item.scope.get("allowed_feed_ids") or [])
            ]
        candidates = [
            item
            for item in matching
            if item.status in {
                CapabilityStatus.VERIFIED,
                CapabilityStatus.DEGRADED,
            }
        ]
        status_priority = {
            CapabilityStatus.VERIFIED: 0,
            CapabilityStatus.DEGRADED: 1,
            CapabilityStatus.AUTHENTICATION_REQUIRED: 2,
            CapabilityStatus.DECLARED_UNVERIFIED: 3,
        }
        candidates.sort(key=lambda item: status_priority.get(item.status, 99))
        if request.action == CapabilityAction.DETAIL_FETCH and request.input.get("url"):
            direct = self.get("web.detail_fetch.trafilatura.v1")
            requested_host = (
                urlsplit(str(request.input["url"])).hostname or ""
            ).casefold().rstrip(".")
            rendered_fallbacks = []
            if request.allow_fallback and requested_host:
                for item in candidates:
                    if item.executor != "browserwing_detail_recipe" or item.status not in {
                        CapabilityStatus.VERIFIED,
                        CapabilityStatus.DEGRADED,
                    }:
                        continue
                    allowed_host = str(
                        (item.recipe or {}).get("allowed_host") or ""
                    ).casefold().rstrip(".")
                    if requested_host == allowed_host or requested_host.endswith(
                        f".{allowed_host}"
                    ):
                        rendered_fallbacks.append(item)
            return TaskPlanResponse(
                available=True,
                requested_platform=request.platform,
                requested_action=request.action,
                selected_capability=direct,
                fallback_capabilities=rendered_fallbacks[:1],
                effective_input=dict(request.input),
                degraded=False,
                warnings=(
                    [
                        "A host-scoped rendered-detail recipe is registered as a fallback after public HTML extraction."
                    ]
                    if rendered_fallbacks
                    else []
                ),
            )
        if candidates:
            selected = candidates[0]
            fallbacks = (
                [self.get(item) for item in selected.fallback_ids]
                if request.allow_fallback
                else []
            )
            fallbacks = self._extend_public_search_fallbacks(
                [selected, *fallbacks],
                allow_fallback=request.allow_fallback,
            )[1:]
            has_public_search_fallback = any(
                item.executor == "browserwing_recipe" for item in fallbacks
            )
            return TaskPlanResponse(
                available=True,
                requested_platform=request.platform,
                requested_action=request.action,
                selected_capability=selected,
                fallback_capabilities=fallbacks,
                effective_input=dict(request.input),
                degraded=selected.status != CapabilityStatus.VERIFIED,
                warnings=[
                    *selected.warnings,
                    *(
                        [
                            "Verified Bing/Sogou browser recipes are registered as low-frequency discovery fallbacks."
                        ]
                        if has_public_search_fallback
                        else []
                    ),
                ],
            )

        blocked = [
            item for item in matching if item.status == CapabilityStatus.BLOCKED
        ]
        if request.allow_fallback:
            for unavailable in blocked:
                for fallback_id in unavailable.fallback_ids:
                    fallback = self.get(fallback_id)
                    if fallback.status in {
                        CapabilityStatus.BLOCKED,
                        CapabilityStatus.RETIRED,
                    }:
                        continue
                    effective_input = dict(request.input)
                    if unavailable.fallback_site:
                        effective_input["site"] = unavailable.fallback_site
                    return TaskPlanResponse(
                        available=True,
                        requested_platform=request.platform,
                        requested_action=request.action,
                        selected_capability=fallback,
                        fallback_capabilities=(
                            self.public_search_fallbacks()
                            if fallback.capability_id
                            == "web.keyword_search.searxng.v1"
                            else []
                        ),
                        effective_input=effective_input,
                        degraded=True,
                        warnings=[
                            f"Capability {unavailable.capability_id} is blocked after repeated verification failures.",
                            "Planning its configured fallback instead of executing the stale recipe.",
                        ],
                    )

        if request.action == CapabilityAction.KEYWORD_SEARCH and request.platform != "web":
            site = self.platform_site(request.platform, request.input)
            if site:
                generic = self.get("web.keyword_search.searxng.v1")
                effective_input = {**request.input, "site": site}
                browser_fallbacks = (
                    self.public_search_fallbacks() if request.allow_fallback else []
                )
                return TaskPlanResponse(
                    available=True,
                    requested_platform=request.platform,
                    requested_action=request.action,
                    selected_capability=generic,
                    fallback_capabilities=browser_fallbacks,
                    effective_input=effective_input,
                    degraded=True,
                    warnings=[
                        f"No verified internal {request.platform} search Adapter is registered.",
                        f"Planning external discovery with site:{site}; this is not a complete platform index.",
                        *(
                            [
                                "Verified Bing/Sogou browser recipes are registered as low-frequency discovery fallbacks."
                            ]
                            if browser_fallbacks
                            else []
                        ),
                    ],
                )

        if request.action in {
            CapabilityAction.ARTICLE_EXTRACT,
            CapabilityAction.DETAIL_FETCH,
        } and request.input.get("url"):
            capability_id = (
                "web.detail_fetch.trafilatura.v1"
                if request.action == CapabilityAction.DETAIL_FETCH
                else "web.article_extract.trafilatura.v1"
            )
            generic = self.get(capability_id)
            return TaskPlanResponse(
                available=True,
                requested_platform=request.platform,
                requested_action=request.action,
                selected_capability=generic,
                effective_input=dict(request.input),
                degraded=request.platform != "web",
                warnings=(
                    ["Using generic public-page extraction; platform login or script rendering is not available."]
                    if request.platform != "web"
                    else []
                ),
            )

        return TaskPlanResponse(
            available=False,
            requested_platform=request.platform,
            requested_action=request.action,
            effective_input=dict(request.input),
            warnings=[
                *(
                    [
                        "Matching capabilities are declared but have not passed fixed-sample verification."
                    ]
                    if any(
                        item.status == CapabilityStatus.DECLARED_UNVERIFIED
                        for item in matching
                    )
                    else []
                ),
                "No matching capability or safe external-discovery fallback is registered.",
            ],
        )
