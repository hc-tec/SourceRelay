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

        result = await collector.collect_and_wait({
            "schemaVersion": 2,
            "browserBindingId": binding["browserBindingId"],
            "platform": "bilibili",
            "capability": "bilibili.native_search",
            "executionTarget": "collector_work_tab",
            "input": {"query": "DeepSeek"},
        })
        print(result["operation"]["state"])
        print(result["artifact"])


asyncio.run(main())
```

## 分层边界

```text
intelligence_collector
├─ transport.py   loopback origin、token、超时、JSON 大小和 HTTP 错误
├─ validation.py  exact request、direct allowlist、operation 和 artifact path
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
```

Python 使用 snake_case；JavaScript 使用 camelCase。二者的协议字段仍保持 Gateway
定义的 camelCase，例如 `browserBindingId`、`executionTarget`、`operationId`。

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
