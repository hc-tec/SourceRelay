from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import GATEWAY_ROOT
from .models import (
    CapabilityAction,
    CapabilityManifest,
    CapabilityStatus,
    TaskPlanRequest,
    TaskPlanResponse,
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
        self.reload()

    def _load(self) -> dict[str, CapabilityManifest]:
        manifests: dict[str, CapabilityManifest] = {}
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
        if not manifests:
            raise ValueError(f"No capability manifests found in {self.directory}")
        for manifest in manifests.values():
            missing = [item for item in manifest.fallback_ids if item not in manifests]
            if missing:
                raise ValueError(
                    f"Capability {manifest.capability_id} has missing fallbacks: {missing}"
                )
        return manifests

    def reload(self) -> list[CapabilityManifest]:
        self._manifests = self._load()
        return self.list()

    def save_runtime_manifest(self, manifest: CapabilityManifest) -> Path:
        if self.runtime_directory is None:
            raise ValueError("Runtime capability directory is not configured.")
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

    def plan(self, request: TaskPlanRequest) -> TaskPlanResponse:
        candidates = [
            item
            for item in self.list(platform=request.platform, action=request.action)
            if item.status not in {CapabilityStatus.RETIRED, CapabilityStatus.BLOCKED}
        ]
        status_priority = {
            CapabilityStatus.VERIFIED: 0,
            CapabilityStatus.DEGRADED: 1,
            CapabilityStatus.AUTHENTICATION_REQUIRED: 2,
            CapabilityStatus.DECLARED_UNVERIFIED: 3,
        }
        candidates.sort(key=lambda item: status_priority.get(item.status, 99))
        if candidates:
            selected = candidates[0]
            fallbacks = (
                [self.get(item) for item in selected.fallback_ids]
                if request.allow_fallback
                else []
            )
            return TaskPlanResponse(
                available=True,
                requested_platform=request.platform,
                requested_action=request.action,
                selected_capability=selected,
                fallback_capabilities=fallbacks,
                effective_input=dict(request.input),
                degraded=selected.status != CapabilityStatus.VERIFIED,
                warnings=list(selected.warnings),
            )

        if request.action == CapabilityAction.KEYWORD_SEARCH and request.platform != "web":
            site = self.platform_site(request.platform, request.input)
            if site:
                generic = self.get("web.keyword_search.searxng.v1")
                effective_input = {**request.input, "site": site}
                return TaskPlanResponse(
                    available=True,
                    requested_platform=request.platform,
                    requested_action=request.action,
                    selected_capability=generic,
                    effective_input=effective_input,
                    degraded=True,
                    warnings=[
                        f"No verified internal {request.platform} search Adapter is registered.",
                        f"Planning external discovery with site:{site}; this is not a complete platform index.",
                    ],
                )

        if request.action == CapabilityAction.ARTICLE_EXTRACT and request.input.get("url"):
            generic = self.get("web.article_extract.trafilatura.v1")
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
                "No matching capability or safe external-discovery fallback is registered."
            ],
        )
