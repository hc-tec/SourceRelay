from __future__ import annotations

from typing import Any


class CollectorClientError(RuntimeError):
    """Stable, machine-readable error raised by the Python Collector SDK."""

    def __init__(
        self,
        code: str,
        status: int = 502,
        details: Any | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.status = status
        self.details = details

    def to_dict(self) -> dict[str, Any]:
        value: dict[str, Any] = {
            "code": self.code,
            "status": self.status,
        }
        if self.details is not None:
            value["details"] = self.details
        return value
