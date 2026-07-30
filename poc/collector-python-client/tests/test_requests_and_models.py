from __future__ import annotations

import pytest

from intelligence_collector import (
    Artifact,
    CollectionResult,
    CollectorClientError,
    Operation,
    bilibili_account_inventory,
    bilibili_account_profile,
    bilibili_collection_series_detail,
    bilibili_collection_series_overview,
    bilibili_danmaku,
    bilibili_discussion,
    bilibili_dynamic,
    bilibili_native_search,
    bilibili_native_search_batch,
    bilibili_video_detail,
    xiaohongshu_account_public_notes,
    xiaohongshu_note_public_comment_replies,
    xiaohongshu_note_public_comments,
    xiaohongshu_note_public_detail,
    xiaohongshu_public_notes_search,
)


BINDING_ID = "11111111-1111-4111-8111-111111111111"
VIDEO_URL = "https://www.bilibili.com/video/BV1qZSLBYEpa"
PROFILE_URL = "https://space.bilibili.com/7481602"
XHS_PROFILE_URL = (
    "https://www.xiaohongshu.com/user/profile/638392c7000000001f01fffa"
    "?xsec_token=AB3nhVTKjaU7yknO8aprs8qBc4HQ4mWSoXDm4Bse0ZIIo=&xsec_source=pc_feed"
)


def test_bilibili_builders_emit_only_registered_wire_shapes() -> None:
    requests = [
        bilibili_video_detail(browser_binding_id=BINDING_ID, canonical_video_url=f"{VIDEO_URL}/"),
        bilibili_native_search(browser_binding_id=BINDING_ID, query="  人工\n智能  "),
        bilibili_native_search_batch(browser_binding_id=BINDING_ID, query="DeepSeek"),
        bilibili_account_profile(browser_binding_id=BINDING_ID, canonical_profile_url=f"{PROFILE_URL}/"),
        bilibili_account_inventory(browser_binding_id=BINDING_ID, canonical_profile_url=PROFILE_URL),
        bilibili_account_inventory(
            browser_binding_id=BINDING_ID,
            canonical_profile_url=PROFILE_URL,
            execution_target="user_selected_tab",
        ),
        bilibili_dynamic(browser_binding_id=BINDING_ID, canonical_profile_url=PROFILE_URL),
        bilibili_collection_series_overview(browser_binding_id=BINDING_ID, canonical_profile_url=PROFILE_URL),
        bilibili_collection_series_detail(
            browser_binding_id=BINDING_ID,
            canonical_profile_url=PROFILE_URL,
            stable_series_id="123",
            list_type="series",
        ),
        bilibili_danmaku(browser_binding_id=BINDING_ID, canonical_video_url=VIDEO_URL),
        bilibili_discussion(browser_binding_id=BINDING_ID, canonical_video_url=VIDEO_URL),
    ]
    assert len(requests) == 11
    assert all(set(value) == {"schemaVersion", "browserBindingId", "platform", "capability", "executionTarget", "input"} for value in requests)
    assert requests[0]["input"] == {"canonicalVideoUrl": VIDEO_URL}
    assert requests[1]["input"] == {"query": "人工 智能"}
    assert requests[5]["executionTarget"] == "user_selected_tab"
    assert requests[-1]["executionTarget"] == "user_selected_tab"


def test_xiaohongshu_builders_preserve_profile_signature_and_budget_shape() -> None:
    search = xiaohongshu_public_notes_search(
        browser_binding_id=BINDING_ID,
        query="人工智能",
        maximum_details=3,
        comments_maximum_scrolls=2,
        replies_maximum_threads=1,
    )
    profile = xiaohongshu_account_public_notes(
        browser_binding_id=BINDING_ID,
        maximum_scrolls=20,
        execution_target="ephemeral_public_profile_url",
        profile_url=XHS_PROFILE_URL,
    )
    detail = xiaohongshu_note_public_detail(browser_binding_id=BINDING_ID, result_rank=2)
    comments = xiaohongshu_note_public_comments(browser_binding_id=BINDING_ID, maximum_scrolls=3)
    replies = xiaohongshu_note_public_comment_replies(browser_binding_id=BINDING_ID, maximum_threads=2)

    assert search["input"] == {
        "query": "人工智能",
        "maximumDetails": 3,
        "comments": {"maximumScrolls": 2, "replies": {"maximumThreads": 1}},
    }
    assert profile["input"]["profileUrl"] == XHS_PROFILE_URL
    assert profile["executionTarget"] == "ephemeral_public_profile_url"
    assert detail["input"] == {"resultRank": 2}
    assert comments["input"] == {"maximumScrolls": 3}
    assert replies["input"] == {"maximumThreads": 2}


@pytest.mark.parametrize(
    "factory",
    [
        lambda: bilibili_video_detail(browser_binding_id=BINDING_ID, canonical_video_url="https://evil.example/video/BV1qZSLBYEpa"),
        lambda: bilibili_account_profile(browser_binding_id=BINDING_ID, canonical_profile_url="https://space.bilibili.com/1?from=search"),
        lambda: bilibili_collection_series_detail(browser_binding_id=BINDING_ID, canonical_profile_url=PROFILE_URL, stable_series_id="0", list_type="series"),
        lambda: xiaohongshu_public_notes_search(browser_binding_id=BINDING_ID, query="x", comments_maximum_scrolls=1),
        lambda: xiaohongshu_account_public_notes(browser_binding_id=BINDING_ID, maximum_scrolls=4),
        lambda: xiaohongshu_account_public_notes(browser_binding_id=BINDING_ID, maximum_scrolls=1, execution_target="ephemeral_public_profile_url"),
        lambda: xiaohongshu_note_public_detail(browser_binding_id=BINDING_ID, result_rank=21),
    ],
)
def test_builders_reject_unsafe_or_incomplete_inputs(factory) -> None:
    with pytest.raises(CollectorClientError) as failure:
        factory()
    assert failure.value.code == "collector_client_request_builder_invalid"


def test_models_project_envelope_and_keep_unknown_fields() -> None:
    operation_raw = {
        "schemaVersion": 1,
        "operationId": "22222222-2222-4222-8222-222222222222",
        "browserBindingId": BINDING_ID,
        "platform": "bilibili",
        "capability": "bilibili.native_search",
        "executionTarget": "collector_work_tab",
        "state": "completed",
        "queuedAt": "2026-07-30T00:00:00.000Z",
        "claimedAt": "2026-07-30T00:00:01.000Z",
        "completedAt": "2026-07-30T00:00:02.000Z",
        "errorCode": None,
        "terminalReason": None,
        "coverage": {"capturedItems": 1},
        "futureField": {"kept": True},
        "artifact": {
            "artifactId": "33333333-3333-4333-8333-333333333333",
            "retrievalPath": "/v1/collect/artifacts/bilibili.native_search/33333333-3333-4333-8333-333333333333",
            "summary": {"capturedItems": 1},
        },
    }
    artifact_response = {
        "schemaVersion": 2,
        "capability": "bilibili.native_search",
        "artifact": {
            "summary": {"capturedItems": 1},
            "provenance": {"surface": "public"},
            "result": {"items": [{"title": "结果"}]},
            "futurePayloadField": "kept",
        },
    }
    operation = Operation.from_mapping(operation_raw)
    artifact = Artifact.from_mapping(artifact_response)
    result = CollectionResult.from_mapping({"operation": operation_raw, "artifact": artifact_response})

    assert operation.operation_id.endswith("2222")
    assert operation.succeeded is True
    assert operation.artifact is not None
    assert operation.raw["futureField"] == {"kept": True}
    assert artifact.result["items"][0]["title"] == "结果"
    assert artifact.provenance == {"surface": "public"}
    assert artifact.payload["futurePayloadField"] == "kept"
    assert result.result == {"items": [{"title": "结果"}]}
    raw = result.to_dict()
    raw["operation"]["future"] = True
    assert "future" not in result.raw["operation"]
