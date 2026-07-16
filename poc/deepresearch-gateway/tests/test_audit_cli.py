from __future__ import annotations

import json

import pytest

from deepresearch_gateway.audit_cli import load_trace, main


def test_audit_cli_reads_utf8_event_list_and_writes_expected_platform_gap(tmp_path) -> None:
    trace_path = tmp_path / "trace.json"
    output_path = tmp_path / "audit.md"
    trace_path.write_text(
        json.dumps(
            [
                {
                    "schema_version": 2,
                    "event_index": 0,
                    "tool": "gateway_search",
                    "arguments": {
                        "platform": "bilibili",
                        "query": "低空经济",
                        "limit": 1,
                    },
                    "status": "success",
                    "executed_capability_id": "bilibili.keyword_search.maxun.v1",
                    "attempted_capabilities": ["bilibili.keyword_search.maxun.v1"],
                    "result_item_count": 1,
                    "result_items": [
                        {
                            "rank": 1,
                            "title": "B站公开视频",
                            "url": "https://www.bilibili.com/video/BV1audit",
                            "source": "bilibili",
                            "raw_ref": "fixture:maxun",
                        }
                    ],
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    assert main(
        [
            str(trace_path),
            "--output",
            str(output_path),
            "--expected-platform",
            "bilibili",
            "--expected-platform",
            "zhihu",
        ]
    ) == 0

    markdown = output_path.read_text(encoding="utf-8")
    assert "B站公开视频" in markdown
    assert "native_success" in markdown
    assert "zhihu" in markdown
    assert "NOT_ATTEMPTED" in markdown


def test_load_trace_accepts_a_future_events_envelope(tmp_path) -> None:
    trace_path = tmp_path / "trace-envelope.json"
    trace_path.write_text(
        json.dumps({"schema_version": 2, "events": [{"tool": "gateway_search"}]}),
        encoding="utf-8",
    )

    assert load_trace(trace_path) == [{"tool": "gateway_search"}]


def test_load_trace_rejects_non_utf8_input(tmp_path) -> None:
    trace_path = tmp_path / "not-utf8.json"
    trace_path.write_bytes(b"\xff\xfe")

    with pytest.raises(ValueError, match="Could not read trace file"):
        load_trace(trace_path)
