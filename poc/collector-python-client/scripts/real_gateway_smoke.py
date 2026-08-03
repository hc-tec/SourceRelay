from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

from intelligence_collector import (
    CollectorClient,
    CollectorClientError,
    CollectionResult,
    bilibili_native_search,
    create_client_request_id,
    list_direct_capabilities,
)


BINDING_ID_PLACEHOLDER = "00000000-0000-4000-8000-000000000000"


async def run() -> dict[str, Any]:
    origin = os.environ.get("COLLECTOR_SERVICE_ORIGIN", "http://127.0.0.1:43127")
    token = os.environ.get("COLLECTOR_SERVICE_TOKEN")
    if not token:
        raise RuntimeError("COLLECTOR_SERVICE_TOKEN is required")

    async with CollectorClient(origin=origin, token=token) as client:
        capabilities = await client.list_capabilities()
        openapi = await client.read_openapi()
        bindings = await client.list_browser_bindings()

        direct_ready = {
            item.get("capability")
            for item in capabilities
            if item.get("dispatchState") == "direct_ready"
        }
        if len(capabilities) != 18 or len(direct_ready) != 15:
            raise AssertionError("unexpected_capability_catalog_shape")
        if set(list_direct_capabilities()) != direct_ready:
            raise AssertionError("python_allowlist_catalog_mismatch")
        expected_paths = {
            "/v2/capabilities",
            "/v2/collector-service/browser-bindings",
            "/v2/collect",
            "/v2/collect/operations/{operationId}",
            "/v2/collect/artifacts/{artifactId}",
            "/v2/collect/artifacts/{artifactId}/content",
            "/v1/collect/artifacts/{capability}/{artifactId}",
        }
        openapi_paths = openapi.get("paths", {})
        if not isinstance(openapi_paths, dict) or not expected_paths.issubset(openapi_paths):
            raise AssertionError(f"openapi_paths_incomplete:{sorted(openapi_paths) if isinstance(openapi_paths, dict) else type(openapi_paths).__name__}")
        binding = next(
            (item for item in bindings if item.get("state") == "online"),
            None,
        )
        if not binding or not isinstance(binding.get("browserBindingId"), str):
            raise AssertionError("online_binding_missing")

        # The three catalog-only/migration capabilities must be rejected before
        # Python SDK sends a POST. This verifies the language-specific contract
        # layer against the same safety boundary as the JS SDK.
        try:
            await client.collect({
                "schemaVersion": 3,
                "clientRequestId": create_client_request_id(),
                "browserBindingId": BINDING_ID_PLACEHOLDER,
                "platform": "xiaohongshu",
                "capability": "xiaohongshu.current_page.network_metadata",
                "executionTarget": "user_selected_tab",
                "input": {},
            })
        except CollectorClientError as error:
            if error.code != "collector_client_collect_request_invalid":
                raise
        else:
            raise AssertionError("catalog_only_capability_was_accepted")

        request = bilibili_native_search(
            client_request_id=create_client_request_id(),
            browser_binding_id=binding["browserBindingId"],
            query="DeepSeek",
        )
        result = await client.collect_and_wait_model(request)
        if not isinstance(result, CollectionResult):
            raise AssertionError("python_sdk_real_result_model_missing")
        operation = result.operation
        artifact = result.artifact
        if operation.state != "completed":
            raise AssertionError(f"python_sdk_real_operation_not_completed:{operation.state}")
        if operation.capability != "bilibili.native_search":
            raise AssertionError("python_sdk_real_operation_capability_mismatch")
        if artifact is None or artifact.capability != operation.capability:
            raise AssertionError("python_sdk_real_artifact_capability_mismatch")
        summary = artifact.summary
        if not isinstance(summary, dict):
            raise AssertionError("python_sdk_real_artifact_summary_missing")

        return {
            "capabilityCount": len(capabilities),
            "directReadyCount": len(direct_ready),
            "onlineBinding": True,
            "openapiPathCount": len(openapi_paths),
            "catalogOnlyRejected": True,
            "operationState": operation.state,
            "operationCapability": operation.capability,
            "artifactCapability": artifact.capability,
            "capturedItems": summary.get("capturedItems"),
            "visibleVideoCardCount": summary.get("visibleVideoCardCount"),
        }


def main() -> int:
    try:
        print(json.dumps(asyncio.run(run()), ensure_ascii=False, separators=(",", ":")))
    except Exception as error:
        print(f"python_sdk_real_gateway_smoke_failed:{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
