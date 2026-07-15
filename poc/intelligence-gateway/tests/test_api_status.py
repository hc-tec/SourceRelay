from dataclasses import replace

import httpx
import pytest

from app.config import Settings
from app.errors import AuthenticationRequiredError
from app.main import create_app


@pytest.mark.asyncio
async def test_authentication_failure_is_not_disguised_as_empty_success(tmp_path) -> None:
    app = create_app(replace(Settings.from_env(), database_path=tmp_path / "gateway.db"))

    async def fail_search(_request):
        raise AuthenticationRequiredError("Manual login is required.")

    app.state.registry.search = fail_search
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/search", json={"source": "xiaohongshu", "query": "DeepSeek"}
        )

    assert response.status_code == 424
    body = response.json()
    assert body["ok"] is False
    assert body["status"] == "authentication_required"
    assert body["item_count"] == 0
    assert body["items"] == []


@pytest.mark.asyncio
async def test_private_fetch_url_returns_explicit_validation_error(tmp_path) -> None:
    app = create_app(replace(Settings.from_env(), database_path=tmp_path / "gateway.db"))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/fetch", json={"url": "http://127.0.0.1/private"})

    assert response.status_code == 422
    assert response.json()["status"] == "error"
    assert "non-public" in response.json()["error"]


@pytest.mark.asyncio
async def test_invalid_source_returns_structured_422(tmp_path) -> None:
    app = create_app(replace(Settings.from_env(), database_path=tmp_path / "gateway.db"))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/search", json={"source": "unknown", "query": "test"})

    assert response.status_code == 422
    assert response.json()["ok"] is False
    assert response.json()["error"] == "Request validation failed."
