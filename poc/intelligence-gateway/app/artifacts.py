from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import ArtifactReference


_SAFE_SEGMENT = re.compile(r"^[a-z0-9][a-z0-9-]*$")


class RawArtifactStore:
    """Persist provider payloads without turning them into a content database."""

    def __init__(self, runtime_dir: Path) -> None:
        self.root = runtime_dir / "artifacts"

    @staticmethod
    def _suffix(media_type: str) -> str:
        normalized = media_type.casefold()
        if "json" in normalized:
            return ".json"
        if "html" in normalized:
            return ".html"
        if "markdown" in normalized:
            return ".md"
        if normalized.startswith("text/"):
            return ".txt"
        return ".bin"

    @staticmethod
    def _atomic_write(path: Path, content: bytes) -> None:
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        temporary.write_bytes(content)
        temporary.replace(path)

    def write(
        self,
        *,
        provider: str,
        manifest: dict[str, Any],
        raw_bytes: bytes | None,
        media_type: str,
        fetched_at: datetime | None = None,
    ) -> ArtifactReference:
        if not _SAFE_SEGMENT.fullmatch(provider):
            raise ValueError("provider must be a safe lowercase identifier")

        timestamp = fetched_at or datetime.now(timezone.utc)
        run_id = str(manifest.get("run_id") or uuid.uuid4())
        directory = self.root / provider / timestamp.date().isoformat() / run_id
        directory.mkdir(parents=True, exist_ok=False)

        raw_relative: str | None = None
        digest: str | None = None
        byte_count = 0
        if raw_bytes is not None:
            raw_path = directory / f"raw{self._suffix(media_type)}"
            self._atomic_write(raw_path, raw_bytes)
            raw_relative = raw_path.relative_to(self.root.parent).as_posix()
            digest = hashlib.sha256(raw_bytes).hexdigest()
            byte_count = len(raw_bytes)

        manifest_path = directory / "manifest.json"
        payload = {
            "artifact_version": 1,
            **manifest,
            "run_id": run_id,
            "fetched_at": timestamp.isoformat(),
            "media_type": media_type,
            "raw_file": raw_relative,
            "byte_count": byte_count,
            "sha256": digest,
        }
        self._atomic_write(
            manifest_path,
            json.dumps(payload, ensure_ascii=False, indent=2, default=str).encode("utf-8"),
        )
        return ArtifactReference(
            manifest_file=manifest_path.relative_to(self.root.parent).as_posix(),
            raw_file=raw_relative,
            media_type=media_type,
            byte_count=byte_count,
            sha256=digest,
        )
