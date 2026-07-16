from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .models import ResultStatus


@dataclass(slots=True)
class GatewayError(Exception):
    message: str
    status: ResultStatus = ResultStatus.ERROR
    http_status: int = 500
    warnings: list[str] = field(default_factory=list)
    context: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        return self.message


class AuthenticationRequiredError(GatewayError):
    def __init__(
        self,
        message: str,
        warnings: list[str] | None = None,
        context: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message=message,
            status=ResultStatus.AUTHENTICATION_REQUIRED,
            http_status=424,
            warnings=warnings or [],
            context=context or {},
        )


class SourceUnavailableError(GatewayError):
    def __init__(
        self,
        message: str,
        warnings: list[str] | None = None,
        context: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message=message,
            status=ResultStatus.SOURCE_UNAVAILABLE,
            http_status=503,
            warnings=warnings or [],
            context=context or {},
        )


class MisconfiguredError(GatewayError):
    def __init__(self, message: str, warnings: list[str] | None = None) -> None:
        super().__init__(
            message=message,
            status=ResultStatus.MISCONFIGURED,
            http_status=503,
            warnings=warnings or [],
        )
