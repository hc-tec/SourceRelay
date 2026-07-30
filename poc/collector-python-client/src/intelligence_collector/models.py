"""Structured, raw-preserving views over Collector operation responses.

The Gateway intentionally keeps platform result payloads open-ended.  These
models expose the stable envelope (operation, artifact reference, provenance,
summary and result) while retaining a detached ``raw`` mapping so a new
platform field never disappears merely because this SDK has not named it yet.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .errors import CollectorClientError
from .validation import clone, is_operation


def _mapping(value: Any, code: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise CollectorClientError(code, 502)
    return clone(dict(value))


@dataclass(frozen=True, slots=True)
class ArtifactReference:
    """The capability-bound reference returned in an operation summary."""

    artifact_id: str
    retrieval_path: str
    summary: dict[str, Any]
    raw: dict[str, Any]

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "ArtifactReference":
        raw = _mapping(value, "collector_client_operation_artifact_invalid")
        artifact_id = raw.get("artifactId")
        retrieval_path = raw.get("retrievalPath")
        summary = raw.get("summary")
        if (
            not isinstance(artifact_id, str)
            or not isinstance(retrieval_path, str)
            or not isinstance(summary, Mapping)
        ):
            raise CollectorClientError("collector_client_operation_artifact_invalid", 502)
        return cls(artifact_id, retrieval_path, clone(dict(summary)), raw)

    def to_dict(self) -> dict[str, Any]:
        return clone(self.raw)


@dataclass(frozen=True, slots=True)
class Operation:
    """Stable operation envelope with a detached raw projection."""

    operation_id: str
    browser_binding_id: str | None
    platform: str | None
    capability: str
    execution_target: str | None
    state: str
    queued_at: str | None
    claimed_at: str | None
    completed_at: str | None
    error_code: str | None
    terminal_reason: str | None
    artifact: ArtifactReference | None
    raw: dict[str, Any]

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "Operation":
        raw = _mapping(value, "collector_client_operation_invalid")
        if not is_operation(raw):
            raise CollectorClientError("collector_client_operation_invalid", 502)
        reference_value = raw.get("artifact")
        artifact = (
            ArtifactReference.from_mapping(reference_value)
            if isinstance(reference_value, Mapping)
            else None
        )
        return cls(
            operation_id=raw["operationId"],
            browser_binding_id=raw.get("browserBindingId") if isinstance(raw.get("browserBindingId"), str) else None,
            platform=raw.get("platform") if isinstance(raw.get("platform"), str) else None,
            capability=raw["capability"],
            execution_target=raw.get("executionTarget") if isinstance(raw.get("executionTarget"), str) else None,
            state=raw["state"],
            queued_at=raw.get("queuedAt") if isinstance(raw.get("queuedAt"), str) else None,
            claimed_at=raw.get("claimedAt") if isinstance(raw.get("claimedAt"), str) else None,
            completed_at=raw.get("completedAt") if isinstance(raw.get("completedAt"), str) else None,
            error_code=raw.get("errorCode") if isinstance(raw.get("errorCode"), str) else None,
            terminal_reason=raw.get("terminalReason") if isinstance(raw.get("terminalReason"), str) else None,
            artifact=artifact,
            raw=raw,
        )

    @property
    def succeeded(self) -> bool:
        return self.state in {"completed", "partial"}

    def to_dict(self) -> dict[str, Any]:
        return clone(self.raw)


@dataclass(frozen=True, slots=True)
class Artifact:
    """Raw-first artifact response with common fields projected when present."""

    capability: str
    artifact_id: str | None
    summary: dict[str, Any]
    provenance: dict[str, Any] | None
    result: Any
    payload: dict[str, Any]
    raw: dict[str, Any]

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "Artifact":
        raw = _mapping(value, "collector_client_artifact_invalid")
        capability = raw.get("capability")
        payload_value = raw.get("artifact")
        if not isinstance(capability, str) or not isinstance(payload_value, Mapping):
            raise CollectorClientError("collector_client_artifact_invalid", 502)
        payload = clone(dict(payload_value))
        summary_value = payload.get("summary")
        summary = clone(dict(summary_value)) if isinstance(summary_value, Mapping) else {}
        provenance_value = payload.get("provenance")
        provenance = clone(dict(provenance_value)) if isinstance(provenance_value, Mapping) else None
        result = clone(payload["result"]) if "result" in payload else clone(payload)
        artifact_id = payload.get("artifactId")
        if artifact_id is not None and not isinstance(artifact_id, str):
            raise CollectorClientError("collector_client_artifact_invalid", 502)
        return cls(
            capability=capability,
            artifact_id=artifact_id,
            summary=summary,
            provenance=provenance,
            result=result,
            payload=payload,
            raw=raw,
        )

    def to_dict(self) -> dict[str, Any]:
        return clone(self.raw)


@dataclass(frozen=True, slots=True)
class CollectionResult:
    """Result of one submit → wait → artifact-read workflow."""

    operation: Operation
    artifact: Artifact | None
    raw: dict[str, Any]

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "CollectionResult":
        raw = _mapping(value, "collector_client_collection_result_invalid")
        operation_value = raw.get("operation")
        if not isinstance(operation_value, Mapping):
            raise CollectorClientError("collector_client_collection_result_invalid", 502)
        operation = Operation.from_mapping(operation_value)
        artifact_value = raw.get("artifact")
        artifact = Artifact.from_mapping(artifact_value) if isinstance(artifact_value, Mapping) else None
        if artifact is not None and artifact.capability != operation.capability:
            raise CollectorClientError("collector_client_collection_result_invalid", 502)
        return cls(operation=operation, artifact=artifact, raw=raw)

    @property
    def result(self) -> Any:
        return None if self.artifact is None else self.artifact.result

    @property
    def succeeded(self) -> bool:
        return self.operation.succeeded

    def to_dict(self) -> dict[str, Any]:
        return clone(self.raw)


__all__ = ["ArtifactReference", "Operation", "Artifact", "CollectionResult"]
