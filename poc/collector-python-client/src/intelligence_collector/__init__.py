from .client import CollectorClient
from .constants import DIRECT_CAPABILITY_NAMES
from .errors import CollectorClientError
from .validation import artifact_path_from_operation


def list_direct_capabilities() -> list[str]:
    """Return a detached copy of the SDK's direct capability allowlist."""

    return list(DIRECT_CAPABILITY_NAMES)


__all__ = [
    "CollectorClient",
    "CollectorClientError",
    "artifact_path_from_operation",
    "list_direct_capabilities",
]
