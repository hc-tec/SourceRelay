from __future__ import annotations

import json
from dataclasses import replace

import httpx
import pytest

from app.config import Settings
from app.connectors.ytdlp import CommandResult, YtDlpBilibiliVideoConnector
from app.errors import AuthenticationRequiredError, GatewayError, SourceUnavailableError
from app.main import create_app
from app.models import ResultStatus, VideoDetailRequest


def _settings(tmp_path, *, proxy: str = ""):
    return replace(
        Settings.from_env(),
        database_path=tmp_path / "gateway.db",
        runtime_dir=tmp_path / "runtime",
        ytdlp_proxy=proxy,
    )


def test_bilibili_video_url_is_strict_and_keeps_only_meaningful_part() -> None:
    connector = YtDlpBilibiliVideoConnector(Settings.from_env())

    assert connector.canonical_video_url(
        "https://www.bilibili.com/video/BV1abc123/?p=2&spm_id_from=333.1"
    ) == "https://www.bilibili.com/video/BV1abc123?p=2"

    rejected = [
        "http://www.bilibili.com/video/BV1abc123",
        "https://b23.tv/example",
        "https://www.bilibili.com/list/watchlater",
        "https://user:secret@www.bilibili.com/video/BV1abc123",
        "https://www.bilibili.com/video/BV1abc123?redirect=https://example.com",
    ]
    for url in rejected:
        with pytest.raises(GatewayError):
            connector.canonical_video_url(url)


@pytest.mark.asyncio
async def test_ytdlp_keeps_exact_json_and_uses_metadata_only_policy(tmp_path) -> None:
    raw = json.dumps(
        {
            "id": "BV1abc123",
            "title": "公开视频",
            "webpage_url": "https://www.bilibili.com/video/BV1abc123",
            "extractor_key": "BiliBili",
            "availability": "public",
            "uploader": "测试UP主",
            "description": "平台字段只保留在原始 JSON",
            "formats": [{"format_id": "100026", "url": "https://media.example/video"}],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    captured: list[str] = []

    async def runner(arguments: list[str], timeout: float) -> CommandResult:
        captured.extend(arguments)
        assert 10 <= timeout <= 180
        return CommandResult(returncode=0, stdout=raw, stderr=b"")

    settings = _settings(tmp_path, proxy="http://proxy.test:7890")
    connector = YtDlpBilibiliVideoConnector(settings, runner=runner)
    response = await connector.fetch(
        VideoDetailRequest(
            url="https://www.bilibili.com/video/BV1abc123?spm_id_from=333"
        ),
        capability_id="bilibili.video_detail.yt-dlp.v1",
    )

    assert response.ok is True
    assert response.status == ResultStatus.SUCCESS
    assert response.video.external_id == "BV1abc123"
    assert response.video.title == "公开视频"
    assert response.video.url == "https://www.bilibili.com/video/BV1abc123"
    assert "--ignore-config" in captured
    assert "--no-config-locations" in captured
    assert "--no-playlist" in captured
    assert "--skip-download" in captured
    assert "--dump-single-json" in captured
    assert "--proxy" in captured
    assert "--cookies" not in captured

    raw_path = settings.runtime_dir / str(response.artifact.raw_file)
    manifest_path = settings.runtime_dir / response.artifact.manifest_file
    assert raw_path.read_bytes() == raw
    manifest_text = manifest_path.read_text(encoding="utf-8")
    manifest = json.loads(manifest_text)
    assert manifest["action"] == "video_detail"
    assert manifest["media_download_requested"] is False
    assert manifest["cookies_used"] is False
    assert manifest["global_config_ignored"] is True
    assert manifest["proxy_used"] is True
    assert "proxy.test" not in manifest_text
    assert "uploader" not in manifest
    assert "formats" not in manifest


@pytest.mark.asyncio
async def test_ytdlp_restricted_metadata_is_not_treated_as_public_success(tmp_path) -> None:
    raw = json.dumps(
        {
            "id": "BV1premium",
            "title": "受限视频",
            "extractor_key": "BiliBili",
            "availability": "premium_only",
        }
    ).encode()

    async def runner(_arguments: list[str], _timeout: float) -> CommandResult:
        return CommandResult(returncode=0, stdout=raw, stderr=b"")

    settings = _settings(tmp_path)
    connector = YtDlpBilibiliVideoConnector(settings, runner=runner)
    with pytest.raises(AuthenticationRequiredError) as caught:
        await connector.fetch(
            VideoDetailRequest(url="https://www.bilibili.com/video/BV1premium"),
            capability_id="bilibili.video_detail.yt-dlp.v1",
        )

    artifact = caught.value.context["artifact"]
    manifest = json.loads(
        (settings.runtime_dir / artifact["manifest_file"]).read_text(encoding="utf-8")
    )
    assert manifest["status"] == "authentication_required"
    assert manifest["availability"] == "premium_only"
    assert manifest["cookies_used"] is False


@pytest.mark.asyncio
async def test_ytdlp_failure_omits_stderr_but_keeps_failure_manifest(tmp_path) -> None:
    secret_like_stderr = b"ERROR: cookie=must-not-be-persisted"

    async def runner(_arguments: list[str], _timeout: float) -> CommandResult:
        return CommandResult(returncode=1, stdout=b"", stderr=secret_like_stderr)

    settings = _settings(tmp_path)
    connector = YtDlpBilibiliVideoConnector(settings, runner=runner)
    with pytest.raises(SourceUnavailableError) as caught:
        await connector.fetch(
            VideoDetailRequest(url="https://www.bilibili.com/video/BV1failed"),
            capability_id="bilibili.video_detail.yt-dlp.v1",
        )

    artifact = caught.value.context["artifact"]
    assert artifact["raw_file"] is None
    manifest_path = settings.runtime_dir / artifact["manifest_file"]
    manifest_text = manifest_path.read_text(encoding="utf-8")
    assert "must-not-be-persisted" not in manifest_text
    assert json.loads(manifest_text)["error_type"] == "yt_dlp_failed"


@pytest.mark.asyncio
async def test_ytdlp_health_reports_installed_version_without_network(tmp_path) -> None:
    health = await YtDlpBilibiliVideoConnector(_settings(tmp_path)).health()

    assert health.ready is True
    assert health.details["version"] == "2026.7.4"
    assert health.details["network_access_verified_on_execute"] is True


@pytest.mark.asyncio
async def test_video_detail_task_keeps_database_unchanged(tmp_path) -> None:
    raw = json.dumps(
        {
            "id": "BV1task",
            "title": "任务公开视频",
            "extractor_key": "BiliBili",
            "availability": "public",
        },
        ensure_ascii=False,
    ).encode("utf-8")

    async def runner(_arguments: list[str], _timeout: float) -> CommandResult:
        return CommandResult(returncode=0, stdout=raw, stderr=b"")

    settings = _settings(tmp_path)
    app = create_app(settings)
    app.state.registry.ytdlp.runner = runner
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        before = await client.get("/library/stats")
        response = await client.post(
            "/tasks/execute",
            json={
                "platform": "bilibili",
                "action": "video_detail",
                "input": {"url": "https://www.bilibili.com/video/BV1task"},
                "options": {"persistence": "result_only"},
            },
        )
        after = await client.get("/library/stats")

    body = response.json()
    assert response.status_code == 200
    assert body["executed_capability_id"] == "bilibili.video_detail.yt-dlp.v1"
    assert body["result"]["video"]["external_id"] == "BV1task"
    assert body["result"]["artifact"]["raw_file"].endswith("raw.json")
    assert before.json() == after.json()
    assert any(
        "not written to the intelligence database" in warning
        for warning in body["warnings"]
    )
