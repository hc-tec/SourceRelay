from app.models import (
    DraftCapabilityRequest,
    DraftStatus,
    ResultStatus,
    SearchItem,
    SearchRequest,
    SearchResponse,
    SourceName,
)
from app.storage import GatewayStore


def test_job_lifecycle_is_persisted(tmp_path) -> None:
    store = GatewayStore(tmp_path / "gateway.db")
    store.initialize()
    created = store.create_job("search", "web", {"source": "web", "query": "测试"})
    assert created.status.value == "queued"

    store.mark_job_running(created.job_id)
    running = store.get_job(created.job_id)
    assert running.status.value == "running"
    assert running.started_at is not None

    store.complete_job(created.job_id, {"ok": True, "items": []})
    finished = store.get_job(created.job_id)
    assert finished.status.value == "success"
    assert finished.response == {"ok": True, "items": []}
    assert finished.finished_at is not None


def test_connector_binding_round_trip(tmp_path) -> None:
    store = GatewayStore(tmp_path / "gateway.db")
    store.initialize()
    store.set_binding("bilibili", "query-hash", "robot-id", "robot-name", {"query": "测试"})
    binding = store.get_binding("bilibili", "query-hash")
    assert binding is not None
    assert binding["remote_id"] == "robot-id"
    assert binding["remote_name"] == "robot-name"
    assert binding["metadata"] == {"query": "测试"}
    assert binding["updated_at"]


def test_capability_draft_lifecycle_is_persisted(tmp_path) -> None:
    store = GatewayStore(tmp_path / "gateway.db")
    store.initialize()
    draft = store.create_capability_draft(
        DraftCapabilityRequest(
            platform="baidu",
            start_url="https://www.baidu.com",
            sample_query="个人知识库",
            description="Public search draft",
        )
    )
    assert draft.status == DraftStatus.PROPOSED

    inspected = store.update_capability_draft(
        draft.draft_id,
        status=DraftStatus.INSPECTED,
        inspection={"inputs": [{"selector": "#kw"}]},
    )
    assert inspected.inspection == {"inputs": [{"selector": "#kw"}]}

    validated = store.update_capability_draft(
        draft.draft_id,
        status=DraftStatus.VALIDATED,
        recipe={
            "start_url": "https://www.baidu.com",
            "input_selector": "#kw",
            "submit_selector": "#su",
            "result_item_selector": "div.result",
            "expected_host": "www.baidu.com",
        },
        validation={"passed": True, "item_count": 3},
    )
    assert validated.status == DraftStatus.VALIDATED
    assert validated.validation == {"passed": True, "item_count": 3}
    assert store.list_capability_drafts() == [validated]


def _response(views: int) -> SearchResponse:
    return SearchResponse(
        ok=True,
        status=ResultStatus.SUCCESS,
        source=SourceName.WEB,
        query="个人知识库",
        duration_ms=12,
        item_count=1,
        items=[
            SearchItem(
                source=SourceName.WEB,
                query="个人知识库",
                rank=1,
                title="如何搭建个人知识库",
                url="https://example.com/article?utm_source=test",
                author="作者",
                metrics={"views": views},
                collector="test",
            )
        ],
    )


def test_search_observations_distinguish_new_seen_and_changed(tmp_path) -> None:
    store = GatewayStore(tmp_path / "gateway.db")
    store.initialize()
    request = SearchRequest(source=SourceName.WEB, query="个人知识库")

    first_run = store.create_search_run(request)
    first = store.persist_search_response(first_run, _response(views=10))
    assert (first.new_count, first.changed_count, first.seen_count) == (1, 0, 0)

    second_run = store.create_search_run(request)
    second = store.persist_search_response(second_run, _response(views=10))
    assert (second.new_count, second.changed_count, second.seen_count) == (0, 0, 1)

    third_run = store.create_search_run(request)
    third = store.persist_search_response(third_run, _response(views=11))
    assert (third.new_count, third.changed_count, third.seen_count) == (0, 1, 0)

    documents = store.list_documents(source="web", query="知识库")
    assert len(documents) == 1
    assert documents[0].observation_count == 3
    assert documents[0].metrics == {"views": 11}
    observations = store.list_observations(document_id=documents[0].document_id)
    assert [item.change_type.value for item in observations] == ["changed", "seen", "new"]
    assert store.library_stats() == {
        "document_count": 1,
        "observation_count": 3,
        "search_run_count": 3,
        "documents_by_source": {"web": 1},
        "observations_by_change": {"changed": 1, "new": 1, "seen": 1},
    }


def test_failed_search_run_is_queryable(tmp_path) -> None:
    store = GatewayStore(tmp_path / "gateway.db")
    store.initialize()
    request = SearchRequest(source=SourceName.XIAOHONGSHU, query="测试")
    run_id = store.create_search_run(request, job_id="job-1")
    store.fail_search_run(run_id, "authentication_required", "Manual login required")
    run = store.get_search_run(run_id)
    assert run.job_id == "job-1"
    assert run.status == "authentication_required"
    assert run.error == "Manual login required"
    assert run.finished_at is not None


def test_matching_titles_form_a_cross_source_cluster(tmp_path) -> None:
    store = GatewayStore(tmp_path / "gateway.db")
    store.initialize()
    web_request = SearchRequest(source=SourceName.WEB, query="个人知识库")
    web_run = store.create_search_run(web_request)
    store.persist_search_response(web_run, _response(views=10))

    bilibili_request = SearchRequest(source=SourceName.BILIBILI, query="个人知识库")
    bilibili_response = SearchResponse(
        ok=True,
        status=ResultStatus.SUCCESS,
        source=SourceName.BILIBILI,
        query="个人知识库",
        duration_ms=10,
        item_count=1,
        items=[
            SearchItem(
                source=SourceName.BILIBILI,
                query="个人知识库",
                rank=1,
                title="如何搭建个人知识库",
                url="https://www.bilibili.com/video/BV1",
                collector="test",
            )
        ],
    )
    bilibili_run = store.create_search_run(bilibili_request)
    store.persist_search_response(bilibili_run, bilibili_response)

    clusters = store.list_clusters()
    assert len(clusters) == 1
    assert clusters[0]["document_count"] == 2
    assert clusters[0]["source_count"] == 2
    assert clusters[0]["sources"] == ["bilibili", "web"]
    documents = store.list_documents_by_fingerprint(
        clusters[0]["cross_source_fingerprint"]
    )
    assert {document.source for document in documents} == {"bilibili", "web"}
