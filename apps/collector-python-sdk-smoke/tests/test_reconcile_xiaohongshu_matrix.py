from __future__ import annotations

import json

import pytest

from collector_sdk_smoke.reconcile_xiaohongshu_matrix import build_request, read_manifest


BINDING_ID = "11111111-1111-4111-8111-111111111111"
QUERY = "人工智能"
RETAINED_READ_BUILDER_ID = "55555555-5555-4555-8555-555555555555"


def test_shared_evidence_contains_five_safe_reconciliation_identities() -> None:
    manifest = read_manifest()
    serialized = json.dumps(manifest, ensure_ascii=False)

    assert len(manifest["cases"]) == 5
    assert manifest["livePlatformActionsExpected"] == 0
    assert sum(case["reconciliationMode"] == "idempotent_collect" for case in manifest["cases"]) == 4
    assert sum(case["reconciliationMode"] == "retained_operation_read" for case in manifest["cases"]) == 1
    assert QUERY not in serialized
    assert "browserBindingId" not in serialized
    assert "profileUrl" not in serialized


def test_all_python_builders_reconstruct_exact_bounded_capability_requests() -> None:
    manifest = read_manifest()
    requests = [
        build_request(
            evidence,
            browser_binding_id=BINDING_ID,
            query=QUERY,
            client_request_id=evidence.get("clientRequestId", RETAINED_READ_BUILDER_ID),
        )
        for evidence in manifest["cases"]
    ]

    assert [request["capability"] for request in requests] == [
        evidence["capability"] for evidence in manifest["cases"]
    ]
    assert [request["clientRequestId"] for request in requests] == [
        evidence.get("clientRequestId", RETAINED_READ_BUILDER_ID)
        for evidence in manifest["cases"]
    ]
    assert [request["input"] for request in requests] == [
        {"query": QUERY, "maximumDetails": 0},
        {"resultRank": 1},
        {"maximumScrolls": 2},
        {"maximumThreads": 1},
        {"maximumScrolls": 3},
    ]


def test_different_query_is_rejected_before_sdk_submission() -> None:
    manifest = read_manifest()
    with pytest.raises(RuntimeError, match="xiaohongshu_reconciliation_query_digest_mismatch"):
        build_request(
            manifest["cases"][0],
            browser_binding_id=BINDING_ID,
            query="不同查询",
        )
