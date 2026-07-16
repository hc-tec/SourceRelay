from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


GATEWAY_ROOT = Path(__file__).resolve().parents[1]


def _path_from_env(name: str, default: str) -> Path:
    raw = Path(os.getenv(name, default))
    return raw if raw.is_absolute() else (GATEWAY_ROOT / raw).resolve()


@dataclass(frozen=True, slots=True)
class Settings:
    host: str
    port: int
    log_level: str
    request_timeout: float
    database_path: Path
    maxun_base_url: str
    maxun_template_robot: str
    maxun_api_key_file: Path
    browserwing_root: Path
    browserwing_xhs_script: Path
    searxng_base_url: str
    newsnow_base_url: str
    ytdlp_proxy: str
    aiotieba_proxy: bool
    wechat_article_proxy: str
    runtime_dir: Path

    @classmethod
    def from_env(cls) -> "Settings":
        runtime_dir = (GATEWAY_ROOT / "runtime").resolve()
        return cls(
            host=os.getenv("GATEWAY_HOST", "127.0.0.1"),
            port=int(os.getenv("GATEWAY_PORT", "8765")),
            log_level=os.getenv("GATEWAY_LOG_LEVEL", "info"),
            request_timeout=float(os.getenv("GATEWAY_REQUEST_TIMEOUT", "180")),
            database_path=_path_from_env("GATEWAY_DATABASE", "runtime/intelligence-gateway.db"),
            maxun_base_url=os.getenv("MAXUN_BASE_URL", "http://127.0.0.1:18081").rstrip("/"),
            maxun_template_robot=os.getenv("MAXUN_TEMPLATE_ROBOT", "bilibili-deepseek-titles-poc"),
            maxun_api_key_file=_path_from_env(
                "MAXUN_API_KEY_FILE", "../maxun/cookies/maxun-api-key.txt"
            ),
            browserwing_root=_path_from_env("BROWSERWING_ROOT", "../browserwing"),
            browserwing_xhs_script=_path_from_env(
                "BROWSERWING_XHS_SCRIPT", "../browserwing/scripts/run-xiaohongshu-search.ps1"
            ),
            searxng_base_url=os.getenv("SEARXNG_BASE_URL", "http://127.0.0.1:8888").rstrip("/"),
            newsnow_base_url=os.getenv("NEWSNOW_BASE_URL", "http://127.0.0.1:4444").rstrip("/"),
            ytdlp_proxy=os.getenv("YTDLP_PROXY", "").strip(),
            aiotieba_proxy=os.getenv("AIOTIEBA_PROXY", "").strip().lower()
            in {"1", "true", "yes", "on"},
            wechat_article_proxy=os.getenv("WECHAT_ARTICLE_PROXY", "").strip(),
            runtime_dir=runtime_dir,
        )
