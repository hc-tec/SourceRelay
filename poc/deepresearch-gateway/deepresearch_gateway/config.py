from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


def _parse_env_file(path: Path) -> dict[str, str]:
    """Read a small dotenv file without printing or importing its secrets.

    The repository intentionally avoids making ``python-dotenv`` a runtime
    dependency.  This parser supports the common ``KEY=value`` form, optional
    ``export`` and single/double quoted values.  Environment variables that
    are already present always win over values from the file.
    """

    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        name, separator, value = line.partition("=")
        if not separator:
            continue
        name = name.strip()
        if not name or not name.replace("_", "").isalnum():
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[name] = value
    return values


def load_env_file(path: str | Path, *, environ: Mapping[str, str] | None = None) -> dict[str, str]:
    """Return merged environment values without mutating ``os.environ``.

    This makes it safe for a long-running research service to load the model
    configuration explicitly while keeping secrets out of logs and child
    processes.  Values in ``environ`` (or the process environment) take
    precedence over the file.
    """

    source = dict(os.environ if environ is None else environ)
    file_values = _parse_env_file(Path(path))
    return {**file_values, **source}


def _discover_env_file(package_root: Path) -> Path | None:
    """Find the workspace dotenv file without requiring it to be committed."""

    candidates = (
        Path.cwd() / ".env",
        package_root / ".env",
        package_root.parent / ".env",
        package_root.parent.parent / ".env",
    )
    return next((candidate for candidate in candidates if candidate.is_file()), None)


def _first(values: Mapping[str, str], *names: str, default: str = "") -> str:
    for name in names:
        value = values.get(name)
        if value is not None and value.strip():
            return value.strip()
    return default


@dataclass(frozen=True, slots=True)
class LLMSettings:
    """Model configuration kept separate from source access configuration."""

    provider: str
    model: str
    api_key: str
    base_url: str

    @classmethod
    def from_values(cls, values: Mapping[str, str]) -> "LLMSettings":
        provider = _first(values, "DEEPRESEARCH_LLM_PROVIDER", default="deepseek")
        if provider.casefold() == "deepseek":
            api_key = _first(values, "DEEPSEEK_API_KEY")
            base_url = _first(
                values,
                "DEEPRESEARCH_LLM_BASE_URL",
                "DEEPSEEK_BASE_URL",
                default="https://api.deepseek.com",
            ).rstrip("/")
            model = _first(values, "DEEPRESEARCH_MODEL", default="deepseek-chat")
        else:
            # Unknown providers are allowed so a runtime can add its own
            # client, but no provider key is ever sent to the Gateway.
            api_key = _first(values, "DEEPRESEARCH_API_KEY")
            base_url = _first(values, "DEEPRESEARCH_LLM_BASE_URL", default="").rstrip("/")
            model = _first(values, "DEEPRESEARCH_MODEL", default="")
        return cls(provider=provider, model=model, api_key=api_key, base_url=base_url)


@dataclass(frozen=True, slots=True)
class AdapterSettings:
    gateway_url: str
    request_timeout: float
    artifact_root: Path
    llm: LLMSettings

    @classmethod
    def from_env(
        cls,
        env_file: str | Path | None = None,
        *,
        environ: Mapping[str, str] | None = None,
        package_root: Path | None = None,
    ) -> "AdapterSettings":
        root = package_root or Path(__file__).resolve().parents[1]
        selected_env_file = Path(env_file) if env_file is not None else _discover_env_file(root)
        values = (
            load_env_file(selected_env_file, environ=environ)
            if selected_env_file is not None
            else dict(os.environ if environ is None else environ)
        )
        raw_artifact_root = _first(
            values,
            "GATEWAY_ARTIFACT_ROOT",
            default="../intelligence-gateway/runtime",
        )
        artifact_root = Path(raw_artifact_root)
        if not artifact_root.is_absolute():
            artifact_root = (root / artifact_root).resolve()
        timeout_text = _first(values, "GATEWAY_REQUEST_TIMEOUT", default="180")
        try:
            timeout = float(timeout_text)
        except ValueError as exc:
            raise ValueError("GATEWAY_REQUEST_TIMEOUT must be a number") from exc
        if timeout <= 0:
            raise ValueError("GATEWAY_REQUEST_TIMEOUT must be greater than zero")
        gateway_host = _first(values, "GATEWAY_HOST", default="127.0.0.1")
        gateway_port = _first(values, "GATEWAY_PORT", default="8765")
        gateway_url = _first(
            values,
            "INTELLIGENCE_GATEWAY_URL",
            "GATEWAY_BASE_URL",
            default=f"http://{gateway_host}:{gateway_port}",
        ).rstrip("/")
        if not gateway_url.startswith(("http://", "https://")):
            raise ValueError("INTELLIGENCE_GATEWAY_URL must be an HTTP(S) URL")
        return cls(
            gateway_url=gateway_url,
            request_timeout=timeout,
            artifact_root=artifact_root,
            llm=LLMSettings.from_values(values),
        )
