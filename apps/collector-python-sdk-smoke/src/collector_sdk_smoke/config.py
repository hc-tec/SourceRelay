from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AppConfig:
    origin: str
    token: str

    @classmethod
    def from_env(cls) -> "AppConfig":
        token = os.environ.get("COLLECTOR_SERVICE_TOKEN")
        if not token:
            raise RuntimeError("COLLECTOR_SERVICE_TOKEN is required")
        return cls(
            origin=os.environ.get(
                "COLLECTOR_SERVICE_ORIGIN",
                "http://127.0.0.1:43127",
            ),
            token=token,
        )
