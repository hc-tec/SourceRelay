from __future__ import annotations

import json
from dataclasses import dataclass, field, replace

import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.connectors.aiotieba import AiotiebaReadConnector
from app.main import create_app
from app.models import ForumThreadsRequest, PostDetailRequest, ResultStatus


@dataclass
class FakeContents:
    text: str


@dataclass
class FakeThread:
    tid: int
    title: str
    contents: FakeContents


@dataclass
class FakePost:
    pid: int
    floor: int
    text: str


@dataclass
class FakeForum:
    fname: str


@dataclass
class FakeThreadDetail:
    title: str


@dataclass
class FakePage:
    has_more: bool = False


@dataclass
class FakeResult:
    objs: list[object]
    forum: FakeForum = field(default_factory=lambda: FakeForum("python"))
    thread: FakeThreadDetail = field(default_factory=lambda: FakeThreadDetail("公开主题"))
    page: FakePage = field(default_factory=FakePage)
    err: Exception | None = None
    bduss: str = "must-not-leak"

    def __iter__(self):
        return iter(self.objs)

    @property
    def has_more(self) -> bool:
        return self.page.has_more


class FakeClient:
    def __init__(self, *, threads: FakeResult, posts: FakeResult) -> None:
        self.threads = threads
        self.posts = posts
        self.calls: list[tuple[str, tuple[object, ...], dict[str, object]]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get_threads(self, *args, **kwargs):
        self.calls.append(("get_threads", args, kwargs))
        return self.threads

    async def get_posts(self, *args, **kwargs):
        self.calls.append(("get_posts", args, kwargs))
        return self.posts

    def add_thread(self, *_args, **_kwargs):
        raise AssertionError("write methods must never be called")


def _settings(tmp_path, *, proxy: bool = False) -> Settings:
    return replace(
        Settings.from_env(),
        database_path=tmp_path / "gateway.db",
        runtime_dir=tmp_path / "runtime",
        aiotieba_proxy=proxy,
    )


def _fake_client() -> FakeClient:
    return FakeClient(
        threads=FakeResult(
            [FakeThread(123, "公开主题", FakeContents("正文摘要"))],
            page=FakePage(has_more=True),
        ),
        posts=FakeResult(
            [FakePost(456, 1, "公开楼层文本")],
            page=FakePage(has_more=False),
        ),
    )


def test_tieba_inputs_are_bounded_and_cleaned() -> None:
    assert ForumThreadsRequest(forum_name="  python  ").forum_name == "python"
    assert ForumThreadsRequest(forum_name="酒吧").forum_name == "酒吧"
    for invalid in ("", "python?kw=x", "a/b", "x\x00y"):
        with pytest.raises(ValidationError):
            ForumThreadsRequest(forum_name=invalid)
    with pytest.raises(ValidationError):
        ForumThreadsRequest(forum_name="python", limit=31)
    with pytest.raises(ValidationError):
        PostDetailRequest(thread_id=0)
    with pytest.raises(ValidationError):
        PostDetailRequest(thread_id=1, page=0)


@pytest.mark.asyncio
async def test_forum_threads_is_raw_first_anonymous_and_read_only(tmp_path) -> None:
    connector = AiotiebaReadConnector(_settings(tmp_path, proxy=True))
    fake = _fake_client()
    connector._client = lambda: fake  # type: ignore[method-assign]

    response = await connector.forum_threads(
        ForumThreadsRequest(forum_name="python", limit=10),
        capability_id="tieba.forum_threads.aiotieba.v1",
    )

    assert response.status == ResultStatus.SUCCESS
    assert response.items[0].thread_id == 123
    assert response.has_more is True
    assert fake.calls == [("get_threads", ("python", 1), {"rn": 10})]
    raw_path = connector.settings.runtime_dir / str(response.artifact.raw_file)
    manifest_path = connector.settings.runtime_dir / response.artifact.manifest_file
    assert json.loads(raw_path.read_text(encoding="utf-8"))["objs"][0]["tid"] == 123
    manifest_text = manifest_path.read_text(encoding="utf-8")
    manifest = json.loads(manifest_text)
    assert manifest["anonymous"] is True
    assert manifest["credentials_used"] is False
    assert manifest["proxy_used"] is True
    assert manifest["read_only_method"] == "get_threads"
    assert "must-not-leak" not in raw_path.read_text(encoding="utf-8")
    assert "BDUSS" not in manifest_text
    assert "proxy.test" not in manifest_text


@pytest.mark.asyncio
async def test_post_detail_does_not_request_nested_comments(tmp_path) -> None:
    connector = AiotiebaReadConnector(_settings(tmp_path))
    fake = _fake_client()
    connector._client = lambda: fake  # type: ignore[method-assign]

    response = await connector.post_detail(
        PostDetailRequest(thread_id=123, limit=5),
        capability_id="tieba.post_detail.aiotieba.v1",
    )

    assert response.posts[0].post_id == 456
    assert response.posts[0].floor == 1
    assert fake.calls == [("get_posts", (123, 1), {"rn": 5, "with_comments": False})]
    manifest = json.loads(
        (connector.settings.runtime_dir / response.artifact.manifest_file).read_text(
            encoding="utf-8"
        )
    )
    assert manifest["read_only_method"] == "get_posts"
    assert manifest["credentials_used"] is False


@pytest.mark.asyncio
async def test_tieba_source_error_keeps_only_safe_failure_manifest(tmp_path) -> None:
    connector = AiotiebaReadConnector(_settings(tmp_path))
    fake = _fake_client()
    fake.threads.err = RuntimeError("cookie=secret")
    connector._client = lambda: fake  # type: ignore[method-assign]

    from app.errors import SourceUnavailableError

    with pytest.raises(SourceUnavailableError) as caught:
        await connector.forum_threads(
            ForumThreadsRequest(forum_name="python"),
            capability_id="tieba.forum_threads.aiotieba.v1",
        )
    artifact = caught.value.context["artifact"]
    assert artifact["raw_file"] is None
    manifest_text = (
        connector.settings.runtime_dir / artifact["manifest_file"]
    ).read_text(encoding="utf-8")
    assert "cookie=secret" not in manifest_text
    assert json.loads(manifest_text)["error_type"] == "RuntimeError"


@pytest.mark.asyncio
async def test_tieba_tasks_keep_database_unchanged(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = create_app(settings)
    fake = _fake_client()
    app.state.registry.aiotieba._client = lambda: fake
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        before = (await client.get("/library/stats")).json()
        threads = await client.post(
            "/tasks/execute",
            json={
                "platform": "tieba",
                "action": "forum_threads",
                "input": {"forum_name": "python", "limit": 10},
                "options": {"persistence": "result_only"},
            },
        )
        posts = await client.post(
            "/tasks/execute",
            json={
                "platform": "tieba",
                "action": "post_detail",
                "input": {"thread_id": 123, "limit": 5},
                "options": {"persistence": "result_only"},
            },
        )
        after = (await client.get("/library/stats")).json()

    assert threads.status_code == 200
    assert posts.status_code == 200
    assert threads.json()["executed_capability_id"] == "tieba.forum_threads.aiotieba.v1"
    assert posts.json()["executed_capability_id"] == "tieba.post_detail.aiotieba.v1"
    assert before == after
    assert any("not written" in item for item in threads.json()["warnings"])
    assert any("not written" in item for item in posts.json()["warnings"])
