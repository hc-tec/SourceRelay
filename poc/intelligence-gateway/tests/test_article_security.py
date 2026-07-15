import pytest
from dataclasses import replace

from app.config import Settings
from app.connectors.article import ArticleExtractor, validate_public_url
from app.errors import GatewayError
from app.models import FetchRequest


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/admin",
        "http://10.0.0.8/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
    ],
)
async def test_literal_non_public_addresses_are_rejected(url: str) -> None:
    with pytest.raises(GatewayError, match="non-public"):
        await validate_public_url(url)


@pytest.mark.asyncio
async def test_hostname_resolving_to_private_address_is_rejected() -> None:
    async def resolver(_hostname: str, _port: int) -> list[str]:
        return ["192.168.1.50"]

    with pytest.raises(GatewayError, match="non-public"):
        await validate_public_url("https://internal.example/article", resolver)


@pytest.mark.asyncio
async def test_public_hostname_is_allowed() -> None:
    async def resolver(_hostname: str, _port: int) -> list[str]:
        return ["93.184.216.34"]

    await validate_public_url("https://example.com/article", resolver)


@pytest.mark.asyncio
async def test_credentials_in_url_are_rejected() -> None:
    with pytest.raises(GatewayError, match="credentials"):
        await validate_public_url("https://user:password@example.com/article")


@pytest.mark.asyncio
async def test_thin_shell_page_is_not_reported_as_article(monkeypatch, tmp_path) -> None:
    extractor = ArticleExtractor(replace(Settings.from_env(), database_path=tmp_path / "db.sqlite"))

    async def download(_url: str):
        return "https://example.com/article", b"<html></html>", "utf-8"

    monkeypatch.setattr(extractor, "_download", download)
    monkeypatch.setattr(
        "app.connectors.article.trafilatura.extract",
        lambda *_args, **_kwargs: '{"title":"shell","text":"too short"}',
    )
    response = await extractor.fetch(FetchRequest(url="https://example.com/article"))
    assert response.ok is False
    assert response.status.value == "no_results"
    assert response.article is None
