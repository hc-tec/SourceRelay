"""Tools for connecting DeepResearch runtimes to the Intelligence Gateway.

The package deliberately does not contain a web-search implementation.  Every
source lookup is translated into an HTTP call to the local Intelligence
Gateway, which owns capability selection, credentials, rate limits, fallback
semantics and raw artifact persistence.
"""

from .artifacts import ArtifactReader, ArtifactSecurityError
from .client import GatewayClient, GatewayToolResult
from .config import AdapterSettings, LLMSettings, load_env_file
from .tools import GatewayToolSet

__all__ = [
    "AdapterSettings",
    "ArtifactReader",
    "ArtifactSecurityError",
    "GatewayClient",
    "GatewayToolResult",
    "GatewayToolSet",
    "LLMSettings",
    "load_env_file",
]
