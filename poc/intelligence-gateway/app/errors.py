from __future__ import annotations

from dataclasses import dataclass, field

from .models import ResultStatus


@dataclass(slots=True)
class GatewayError(Exception):
    message: str
    status: ResultStatus = ResultStatus.ERROR
    http_status: int = 500
    warnings: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        return self.message


class AuthenticationRequiredError(GatewayError):
    def __init__(self, message: str, warnings: list[str] | None = None) -> None:
        super().__init__(
            message=message,
            status=ResultStatus.AUTHENTICATION_REQUIRED,
            http_status=424,
            warnings=warnings or [],
        )


class SourceUnavailableError(GatewayError):
    def __init__(self, message: str, warnings: list[str] | None = None) -> None:
        super().__init__(
            message=message,
            status=ResultStatus.SOURCE_UNAVAILABLE,
            http_status=503,
            warnings=warnings or [],
        )


class MisconfiguredError(GatewayError):
    def __init__(self, message: str, warnings: list[str] | None = None) -> None:
        super().__init__(
            message=message,
            status=ResultStatus.MISCONFIGURED,
            http_status=503,
            warnings=warnings or [],
        )

