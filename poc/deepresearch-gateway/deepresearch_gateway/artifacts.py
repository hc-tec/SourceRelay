from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


class ArtifactSecurityError(ValueError):
    """Raised when an Agent asks to read outside the Gateway artifact root."""


class ArtifactReader:
    """Read Gateway raw artifacts on demand with path and size boundaries."""

    def __init__(self, root: str | Path, *, max_bytes: int = 5_000_000) -> None:
        self.root = Path(root).resolve()
        if max_bytes <= 0:
            raise ValueError("max_bytes must be greater than zero")
        self.max_bytes = max_bytes

    def _resolve(self, relative_path: str) -> Path:
        candidate_text = str(relative_path).strip()
        if not candidate_text or Path(candidate_text).is_absolute():
            raise ArtifactSecurityError("Artifact path must be a non-empty relative path.")
        candidate = (self.root / candidate_text).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise ArtifactSecurityError("Artifact path escapes the Gateway artifact root.") from exc
        return candidate

    def read(
        self,
        relative_path: str,
        *,
        offset: int = 0,
        max_chars: int = 20_000,
    ) -> dict[str, Any]:
        if offset < 0 or max_chars <= 0:
            raise ValueError("offset must be non-negative and max_chars must be positive")
        path = self._resolve(relative_path)
        if not path.is_file():
            raise FileNotFoundError(f"Artifact was not found: {relative_path}")
        byte_count = path.stat().st_size
        if byte_count > self.max_bytes:
            raise ArtifactSecurityError(
                f"Artifact is {byte_count} bytes, above the configured {self.max_bytes}-byte limit."
            )
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        text = raw.decode("utf-8", errors="replace")
        excerpt = text[offset : offset + max_chars]
        result: dict[str, Any] = {
            "ok": True,
            "status": "success",
            "path": relative_path,
            "byte_count": byte_count,
            "sha256": digest,
            "offset": offset,
            "max_chars": max_chars,
            "truncated": offset + len(excerpt) < len(text),
            "content": excerpt,
        }
        if path.suffix.casefold() == ".json":
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                result["json"] = None
            else:
                result["json"] = parsed if not result["truncated"] else None
        return result
