from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any, Mapping

from intelligence_collector import (
    CollectionResult,
    CollectorClient,
    CollectorClientError,
    xiaohongshu_account_public_notes,
    xiaohongshu_note_public_comment_replies,
    xiaohongshu_note_public_comments,
    xiaohongshu_note_public_detail,
    xiaohongshu_public_notes_search,
)


UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
SHA256 = re.compile(r"^sha256:[a-f0-9]{64}$")
BUILD_FINGERPRINT = re.compile(r"^[a-f0-9]{64}$")
EXPECTED_CASES = {
    "xiaohongshu.public-notes-search": "xiaohongshu.search.public_notes.v1",
    "xiaohongshu.note-public-detail": "xiaohongshu.note.public_detail.v1",
    "xiaohongshu.note-public-comments": "xiaohongshu.note.public_comments.v1",
    "xiaohongshu.note-public-comment-replies": "xiaohongshu.note.public_comment_replies.v1",
    "xiaohongshu.account-public-notes": "xiaohongshu.account.public_notes.v1",
}


def manifest_path() -> Path:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "docs" / "validation" / "xiaohongshu-sdk-reconciliation-v0.7.17.json"
        if candidate.is_file():
            return candidate
    raise RuntimeError("xiaohongshu_reconciliation_manifest_missing")


def read_manifest(path: Path | None = None) -> dict[str, Any]:
    raw = (path or manifest_path()).read_text(encoding="utf-8")
    if raw.startswith("\ufeff"):
        raise RuntimeError("xiaohongshu_reconciliation_manifest_bom_forbidden")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError("xiaohongshu_reconciliation_manifest_json_invalid") from error
    return validate_manifest(value)


def build_request(
    evidence: Mapping[str, Any],
    *,
    browser_binding_id: str,
    query: str,
) -> dict[str, Any]:
    common = {
        "client_request_id": evidence["clientRequestId"],
        "browser_binding_id": browser_binding_id,
    }
    input_evidence = evidence["inputEvidence"]
    case_id = evidence["caseId"]
    if case_id == "xiaohongshu.public-notes-search":
        if sha256(query) != input_evidence["querySha256"]:
            raise RuntimeError("xiaohongshu_reconciliation_query_digest_mismatch")
        return xiaohongshu_public_notes_search(
            **common,
            query=query,
            maximum_details=input_evidence["maximumDetails"],
        )
    if case_id == "xiaohongshu.note-public-detail":
        return xiaohongshu_note_public_detail(
            **common,
            execution_target=input_evidence["executionTarget"],
            result_rank=input_evidence["resultRank"],
        )
    if case_id == "xiaohongshu.note-public-comments":
        return xiaohongshu_note_public_comments(
            **common,
            maximum_scrolls=input_evidence["maximumScrolls"],
        )
    if case_id == "xiaohongshu.note-public-comment-replies":
        return xiaohongshu_note_public_comment_replies(
            **common,
            maximum_threads=input_evidence["maximumThreads"],
        )
    if case_id == "xiaohongshu.account-public-notes":
        return xiaohongshu_account_public_notes(
            **common,
            execution_target=input_evidence["executionTarget"],
            maximum_scrolls=input_evidence["maximumScrolls"],
        )
    raise RuntimeError("xiaohongshu_reconciliation_case_unknown")


async def reconcile_case(
    client: CollectorClient,
    evidence: Mapping[str, Any],
    request: Mapping[str, Any],
) -> dict[str, Any]:
    result = await client.collect_and_wait_model(request)
    return await verify_case(client, evidence, result, "idempotent_collect")


async def verify_case(
    client: CollectorClient,
    evidence: Mapping[str, Any],
    result: CollectionResult,
    reconciliation_mode: str,
) -> dict[str, Any]:
    artifact_evidence = evidence["artifact"]
    if (
        not isinstance(result, CollectionResult)
        or not result.succeeded
        or result.artifact is None
        or result.operation.operation_id != evidence["expectedOperationId"]
        or result.operation.capability != evidence["capability"]
        or result.operation.state != "completed"
        or result.operation.terminal_reason != evidence["expectedTerminalReason"]
        or result.operation.error_code is not None
        or result.operation.artifact is None
        or result.operation.artifact.artifact_id != artifact_evidence["artifactId"]
        or result.artifact.capability != evidence["capability"]
        or result.artifact.artifact_id != artifact_evidence["artifactId"]
    ):
        raise RuntimeError("xiaohongshu_reconciliation_operation_identity_mismatch")

    metadata = await client.read_artifact_metadata(artifact_evidence["artifactId"])
    if (
        metadata.get("artifactId") != artifact_evidence["artifactId"]
        or metadata.get("operationId") != evidence["expectedOperationId"]
        or metadata.get("capability") != evidence["capability"]
        or metadata.get("byteLength") != artifact_evidence["byteLength"]
        or metadata.get("sha256") != artifact_evidence["sha256"]
        or metadata.get("terminalStatus") != "completed"
        or metadata.get("available") is not True
        or metadata.get("deletionState") != "retained"
    ):
        raise RuntimeError("xiaohongshu_reconciliation_artifact_metadata_mismatch")
    windows = await verify_artifact_windows(client, artifact_evidence)
    return {
        "caseId": evidence["caseId"],
        "capability": evidence["capability"],
        "reconciliationMode": reconciliation_mode,
        "collectionSubmitted": reconciliation_mode == "idempotent_collect",
        "operationId": evidence["expectedOperationId"],
        "coreState": result.operation.state,
        "terminalReason": result.operation.terminal_reason,
        "artifactId": artifact_evidence["artifactId"],
        "byteLength": metadata["byteLength"],
        "sha256": metadata["sha256"],
        "windowCount": windows,
        "sameOperationIdentity": True,
        "newPlatformActionExpected": False,
    }


async def run() -> dict[str, Any]:
    token = os.environ.get("COLLECTOR_SERVICE_TOKEN")
    binding_id = os.environ.get("COLLECTOR_SERVICE_BINDING_ID")
    query = os.environ.get("COLLECTOR_XIAOHONGSHU_RECONCILE_QUERY")
    if not token:
        raise RuntimeError("collector_service_token_required")
    if not binding_id:
        raise RuntimeError("collector_service_binding_id_required")
    if not query:
        raise RuntimeError("xiaohongshu_reconciliation_query_required")

    manifest = read_manifest()
    origin = os.environ.get("COLLECTOR_SERVICE_ORIGIN", "http://127.0.0.1:43127")
    async with CollectorClient(origin=origin, token=token) as client:
        release = await client.read_release()
        capabilities = await client.list_capabilities()
        bindings = await client.list_browser_bindings()
        if (
            release.get("releaseVersion") != manifest["releaseVersion"]
            or not isinstance(release.get("service"), Mapping)
            or release["service"].get("schemaVersion") != manifest["serviceSchemaVersion"]
        ):
            raise RuntimeError("xiaohongshu_reconciliation_release_mismatch")
        if any(
            not any(
                item.get("capability") == evidence["capability"]
                and item.get("dispatchState") == "direct_ready"
                for item in capabilities
            )
            for evidence in manifest["cases"]
        ):
            raise RuntimeError("xiaohongshu_reconciliation_capability_unavailable")
        if not any(
            item.get("browserBindingId") == binding_id and item.get("state") == "online"
            for item in bindings
        ):
            raise RuntimeError("xiaohongshu_reconciliation_binding_not_online")

        cases = []
        for evidence in manifest["cases"]:
            request = build_request(evidence, browser_binding_id=binding_id, query=query)
            cases.append(await reconcile_case(client, evidence, request))
    return {
        "ok": True,
        "language": "python",
        "releaseVersion": manifest["releaseVersion"],
        "caseCount": len(cases),
        "collectionSubmissions": len(cases),
        "expectedNewCoreOperations": 0,
        "expectedLivePlatformActions": manifest["livePlatformActionsExpected"],
        "browserBindingOnline": True,
        "cases": cases,
    }


def validate_manifest(value: Any) -> dict[str, Any]:
    if (
        not isinstance(value, dict)
        or value.get("schemaVersion") != 1
        or value.get("kind") != "xiaohongshu_sdk_reconciliation_matrix"
        or value.get("releaseVersion") != "0.7.17"
        or value.get("serviceSchemaVersion") != 3
        or value.get("livePlatformActionsExpected") != 0
        or not isinstance(value.get("querySha256"), str)
        or not SHA256.fullmatch(value["querySha256"])
        or not isinstance(value.get("cases"), list)
        or len(value["cases"]) != len(EXPECTED_CASES)
    ):
        raise RuntimeError("xiaohongshu_reconciliation_manifest_invalid")
    seen: set[str] = set()
    for evidence in value["cases"]:
        artifact = evidence.get("artifact") if isinstance(evidence, dict) else None
        case_id = evidence.get("caseId") if isinstance(evidence, dict) else None
        if (
            not isinstance(evidence, dict)
            or EXPECTED_CASES.get(case_id) != evidence.get("capability")
            or case_id in seen
            or evidence.get("reconciliationMode") != "idempotent_collect"
            or not isinstance(evidence.get("clientRequestId"), str)
            or not UUID.fullmatch(evidence["clientRequestId"])
            or "provenanceGap" in evidence
            or not isinstance(evidence.get("expectedOperationId"), str)
            or not UUID.fullmatch(evidence["expectedOperationId"])
            or not isinstance(evidence.get("expectedTerminalReason"), str)
            or not isinstance(evidence.get("inputEvidence"), dict)
            or not isinstance(artifact, dict)
            or not isinstance(artifact.get("artifactId"), str)
            or not UUID.fullmatch(artifact["artifactId"])
            or isinstance(artifact.get("byteLength"), bool)
            or not isinstance(artifact.get("byteLength"), int)
            or artifact["byteLength"] < 1
            or not isinstance(artifact.get("sha256"), str)
            or not SHA256.fullmatch(artifact["sha256"])
            or not isinstance(evidence.get("sourceBuildFingerprint"), str)
            or not BUILD_FINGERPRINT.fullmatch(evidence["sourceBuildFingerprint"])
        ):
            raise RuntimeError("xiaohongshu_reconciliation_manifest_case_invalid")
        seen.add(case_id)
    if seen != set(EXPECTED_CASES):
        raise RuntimeError("xiaohongshu_reconciliation_manifest_case_missing")
    return json.loads(json.dumps(value))


async def verify_artifact_windows(client: CollectorClient, artifact: Mapping[str, Any]) -> int:
    digest = hashlib.sha256()
    offset = 0
    windows = 0
    while offset < artifact["byteLength"]:
        if windows >= 2_048:
            raise RuntimeError("xiaohongshu_reconciliation_artifact_window_limit_exceeded")
        window = await client.read_artifact_content_window(
            artifact["artifactId"],
            offset=offset,
            max_bytes=16_384,
        )
        text = window["text"]
        encoded = text.encode("utf-8")
        if (
            window.get("byteLength") != artifact["byteLength"]
            or window.get("sha256") != artifact["sha256"]
            or window.get("offset") != offset
            or window.get("endExclusive") - offset != len(encoded)
            or sha256(text) != window.get("chunkSha256")
            or window.get("nextOffset") != (window.get("endExclusive") if window.get("truncated") else None)
        ):
            raise RuntimeError("xiaohongshu_reconciliation_artifact_window_mismatch")
        digest.update(encoded)
        windows += 1
        offset = window["nextOffset"] if window["nextOffset"] is not None else window["endExclusive"]
    if offset != artifact["byteLength"] or f"sha256:{digest.hexdigest()}" != artifact["sha256"]:
        raise RuntimeError("xiaohongshu_reconciliation_artifact_hash_mismatch")
    return windows


def sha256(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode('utf-8')).hexdigest()}"


def safe_error_code(error: BaseException) -> str:
    value = error.code if isinstance(error, CollectorClientError) else str(error)
    return value if re.fullmatch(r"[a-z0-9_.-]{1,120}", value, re.I) else "xiaohongshu_python_reconciliation_failed"


def main() -> int:
    try:
        result = asyncio.run(run())
    except (CollectorClientError, OSError, RuntimeError, ValueError) as error:
        print(json.dumps({"ok": False, "language": "python", "error": safe_error_code(error)}))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
