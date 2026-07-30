# Intelligence Collector Python SDK

这是当前 user-owned-browser Collector `/v2` API 的 Python SDK。它与
`@intelligence/collector-client`（JavaScript SDK）共享同一份 Gateway 协议，但使用
独立的 Python 包、类型、测试和发布边界；它不是旧
`poc/deepresearch-gateway/deepresearch_gateway` 客户端的别名。

## 安装

在 Python 3.11+ 环境中：

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-python-client
python -m pip install -e ".[dev]"
```

## 最小调用

SDK 是异步的，适合 FastAPI、DeepAgents、LangGraph、AgentScope 和其他 Python
异步上层应用：

```python
import asyncio
import os

from intelligence_collector import CollectorClient


async def main() -> None:
    async with CollectorClient(
        origin=os.getenv("COLLECTOR_SERVICE_ORIGIN", "http://127.0.0.1:43127"),
        token=os.environ["COLLECTOR_SERVICE_TOKEN"],
    ) as collector:
        capabilities = await collector.list_capabilities()
        bindings = await collector.list_browser_bindings()
        binding = next(item for item in bindings if item.get("state") == "online")

        from intelligence_collector import bilibili_native_search

        request = bilibili_native_search(
            browser_binding_id=binding["browserBindingId"],
            query="DeepSeek",
        )
        result = await collector.collect_and_wait_model(request)
        print(result.operation.state)
        print(result.result)


asyncio.run(main())
```

## 分层边界

```text
intelligence_collector
├─ transport.py   loopback origin、token、超时、JSON 大小和 HTTP 错误
├─ validation.py  exact request、direct allowlist、operation 和 artifact path
├─ requests.py    15 项能力化请求 builder 与 URL/预算边界
├─ models.py      operation / artifact / collection 结构化 raw-first 模型
├─ client.py      collect / wait / artifact workflow
└─ __init__.py    稳定公共导出
```

JavaScript SDK 对应的代码边界是：

```text
poc/collector-client
└─ @intelligence/collector-client
```

两个 SDK 不互相导入，不共享平台抓取代码，也不接触浏览器 Profile、Cookie、平台
Token 或原始 Network body。协议真源只有：

```text
GET /v2/capabilities
GET /v2/openapi.json
```

## 公共方法

```text
list_direct_capabilities()
list_capabilities()
read_openapi()
list_browser_bindings()
collect(request)
get_operation(operation_id)
wait_operation(operation_id)
read_artifact(operation_id)
read_artifact_from_operation(operation)
collect_and_wait(request)
collect_model(request)
get_operation_model(operation_id)
wait_operation_model(operation_id)
read_artifact_model(operation_id)
collect_and_wait_model(request)
```

## 能力化请求 builders

上层应用优先使用 `intelligence_collector` 导出的 builder，而不是手写协议字典。
builder 会固定 `schemaVersion`、平台、能力和 execution target，并在本地校验
URL、搜索词、结果序号和评论/滚动预算；Gateway 仍会再次校验。

```python
from intelligence_collector import (
    bilibili_video_detail,
    xiaohongshu_public_notes_search,
)

bilibili_request = bilibili_video_detail(
    browser_binding_id=binding_id,
    canonical_video_url="https://www.bilibili.com/video/BV1qZSLBYEpa",
)

xiaohongshu_request = xiaohongshu_public_notes_search(
    browser_binding_id=binding_id,
    query="人工智能",
    maximum_details=3,
    comments_maximum_scrolls=2,
    replies_maximum_threads=1,
)
```

可用 builder 覆盖全部 15 项 `direct_ready` 能力：

- B站：视频详情、站内搜索/固定两页搜索、账号资料、投稿首屏、动态、合集/系列概览与详情、弹幕、用户已选页评论；
- 小红书：公开搜索、公开博主笔记、公开笔记详情、评论和评论回复。

小红书账号 builder 只有在 `execution_target="ephemeral_public_profile_url"` 时才
接受短时 `profile_url`，并保留签名链接原文；搜索和详情 builder 不接受调用方 URL。
所有 builder 都拒绝 selector、脚本、tab ID、CDP 和任意 Network 控制字段。

## 结构化结果

`Operation`、`ArtifactReference`、`Artifact` 和 `CollectionResult` 只投影稳定的包络
字段，同时保留 detached `raw`/`payload`。因此上层可直接使用
`result.operation.state`、`result.artifact.summary`、`result.result`，而 Gateway
未来新增的业务字段仍可从 `result.raw` 或 `result.artifact.payload` 读取，不会因为
SDK 尚未升级而丢失。

Python 使用 snake_case；JavaScript 使用 camelCase。二者的协议字段仍保持 Gateway
定义的 camelCase，例如 `browserBindingId`、`executionTarget`、`operationId`。

## 上层知识包项目

知识包、跨平台汇总、媒体处理、OCR/ASR 和 DeepResearch 不属于这个 Core SDK。B站知识包
MVP 已迁移到仓库外的独立项目：

```text
D:\AIProject\inteligence-apps
```

该项目通过当前 SDK 的 Gateway 协议调用 Core；Core 不反向依赖它。请在上层项目的
README 中安装并运行知识包测试和 opt-in 真实 Gateway smoke。

## 安全行为

- 只允许 `http://127.0.0.1:<port>` loopback Gateway；
- `collect()` 对顶层字段做 exact-key 校验，并拒绝任意 selector、脚本、tab、URL 或 CDP 字段；
- 只接受 15 项 `direct_ready` capability；
- `collect()` 一次调用只发出一次 `POST /v2/collect`；
- `wait_operation()` 只读取 operation，不重投平台任务；
- artifact path 必须从 operation 的 capability-bound 返回值推导；
- 超时、断网、非法 JSON、非法 artifact 和 Gateway 错误都保留机器可读错误码；
- 不把 `profileId`、旧 `/v1/collect` 或 Browser Host 作为 `/v2` fallback。

## 测试

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-python-client
python -m pytest -q
python -m compileall -q src tests
```

测试使用 `httpx.MockTransport` 只覆盖 SDK transport、contract 和 workflow；真实平台
能力仍必须由项目的真实 Gateway→扩展→隔离验证浏览器 canary 验证，不能用 fake 页面或
fake XHR 代替。
