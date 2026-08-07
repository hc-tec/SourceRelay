from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

from intelligence_collector import (
    CollectorClient,
    CollectorClientError,
    bilibili_native_search,
    create_client_request_id,
    list_direct_capabilities,
)


EXPECTED_CAPABILITY_COUNT = 21
EXPECTED_DIRECT_READY_COUNT = 18
EXPECTED_OPENAPI_PATHS = {
    "/v2/capabilities",
    "/v2/collector-service/browser-bindings",
    "/v2/collect",
    "/v2/collect/operations/{operationId}",
    "/v2/collect/artifacts/{artifactId}",
    "/v2/collect/artifacts/{artifactId}/content",
    "/v1/collect/artifacts/{capability}/{artifactId}",
}
PLACEHOLDER_BINDING_ID = "00000000-0000-4000-8000-000000000000"


async def run_gateway_contract_smoke(
    *,
    origin: str | None = None,
    token: str | None = None,
) -> dict[str, Any]:
    gateway_origin = origin or os.environ.get("COLLECTOR_SERVICE_ORIGIN", "http://127.0.0.1:43127")
    service_token = token or os.environ.get("COLLECTOR_SERVICE_TOKEN")
    if not service_token:
        raise RuntimeError("COLLECTOR_SERVICE_TOKEN is required")

    async with CollectorClient(origin=gateway_origin, token=service_token) as client:
        status = await client.read_status()
        catalog = await client.read_capability_catalog()
        openapi = await client.read_openapi()
        release = await client.read_release()
        bindings = await client.list_browser_bindings()
        capabilities = catalog["capabilities"]
        direct_ready = [item for item in capabilities if item.get("dispatchState") == "direct_ready"]
        official_provider = [
            item for item in capabilities if item.get("executionProvider") == "zhihu_open_platform"
        ]
        online_binding = next((item for item in bindings if item.get("state") == "online"), None)

        if len(capabilities) != EXPECTED_CAPABILITY_COUNT or len(direct_ready) != EXPECTED_DIRECT_READY_COUNT:
            raise AssertionError("unexpected_capability_catalog_shape")
        if (
            len(official_provider) != 3
            or any(
                item.get("runtimeState") not in {"ready", "credential_required"}
                or item.get("credentialLocation") != "gateway_only"
                or item.get("browserBindingRequired") is not False
                for item in official_provider
            )
        ):
            raise AssertionError("python_official_provider_readiness_unexpected")
        direct_names = set(list_direct_capabilities())
        if len(direct_names) != EXPECTED_DIRECT_READY_COUNT or direct_names != {
            item.get("capability") for item in direct_ready
        }:
            raise AssertionError("python_allowlist_catalog_mismatch")
        if (
            status.get("deploymentMode") != "user_owned_browser_extension"
            or status.get("browserProcessControl") != "not_available"
            or status.get("onlineBrowserBindingCount", 0) < 1
        ):
            raise AssertionError("python_runtime_status_unexpected")
        if release.get("releaseVersion") != "0.7.17" or release.get("service", {}).get("schemaVersion") != 3:
            raise AssertionError("python_release_unexpected")
        openapi_paths = openapi.get("paths", {})
        if not isinstance(openapi_paths, dict) or not EXPECTED_OPENAPI_PATHS.issubset(openapi_paths):
            raise AssertionError("openapi_paths_incomplete")
        if not online_binding or not isinstance(online_binding.get("browserBindingId"), str):
            raise AssertionError("online_binding_missing")

        request = bilibili_native_search(
            client_request_id=create_client_request_id(),
            browser_binding_id=online_binding["browserBindingId"],
            query="DeepSeek",
        )
        if (
            request.get("schemaVersion") != 3
            or request.get("capability") != "bilibili.native_search"
            or request.get("executionTarget") != "collector_work_tab"
        ):
            raise AssertionError("python_builder_unexpected")

        migration_capability_rejected = False
        try:
            await client.collect(
                {
                    "schemaVersion": 3,
                    "clientRequestId": create_client_request_id(),
                    "browserBindingId": PLACEHOLDER_BINDING_ID,
                    "platform": "xiaohongshu",
                    "capability": "xiaohongshu.current_page.network_metadata",
                    "executionTarget": "user_selected_tab",
                    "input": {},
                }
            )
        except CollectorClientError as error:
            if error.code != "collector_client_collect_request_invalid":
                raise
            migration_capability_rejected = True
        if not migration_capability_rejected:
            raise AssertionError("catalog_only_capability_was_accepted")

        return {
            "ok": True,
            "sdk": "python",
            "gatewayOrigin": gateway_origin,
            "capabilityCount": len(capabilities),
            "directReadyCount": len(direct_ready),
            "officialProviderReadiness": {
                item["capability"]: item["runtimeState"] for item in official_provider
            },
            "onlineBinding": True,
            "openapiPathCount": len(openapi_paths),
            "releaseVersion": release["releaseVersion"],
            "serviceSchemaVersion": release["service"]["schemaVersion"],
            "typedBuilder": True,
            "migrationCapabilityRejected": True,
            "platformActionSubmitted": False,
        }


def main() -> int:
    try:
        print(json.dumps(asyncio.run(run_gateway_contract_smoke()), ensure_ascii=False, separators=(",", ":")))
    except Exception as error:
        print(f"python_gateway_contract_smoke_failed:{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
