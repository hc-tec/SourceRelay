# Collector SDK 分层与跨语言边界

## 目标

Collector 的上层消费者可能是 Node/TypeScript 应用，也可能是 Python
DeepResearch、FastAPI 或 Agent runtime。两种 SDK 必须提供同一组 `/v2` 语义，但不能把
运行时、依赖或平台实现混在一起。

```text
                 Gateway protocol truth
              /v2/capabilities + /v2/openapi.json
                         │
          ┌──────────────┴──────────────┐
          │                             │
   JavaScript SDK                  Python SDK
   @intelligence/                 intelligence-collector-client
   collector-client               (import intelligence_collector)
          │                             │
   Node / TS upper apps             Python upper apps
```

## SDK 包边界

| 层 | JavaScript | Python |
| --- | --- | --- |
| 分发目录 | `poc/collector-client` | `poc/collector-python-client` |
| 包名 | `@intelligence/collector-client` | `intelligence-collector-client` |
| import | `@intelligence/collector-client` | `intelligence_collector` |
| 异步风格 | Promise | `asyncio` / await |
| HTTP 依赖 | Node built-in `fetch` | `httpx` |
| 协议字段 | Gateway camelCase | Gateway camelCase |
| SDK 方法 | camelCase | snake_case |
| 平台代码 | 不包含 | 不包含 |
| Browser Profile/Cookie | 不接触 | 不接触 |

JavaScript 包内部进一步拆分为 `transport.mjs`、`validation.mjs`、`client.mjs`、
`public.mjs` 和 `index.mjs`；Python 包对应拆分为 `transport.py`、`validation.py`、
`client.py`、`constants.py`、`errors.py` 和 `__init__.py`。

上层 Python 参考应用位于 `apps/collector-python-sdk-smoke`，只做能力状态门禁、请求
文件读取和结果输出，不复制 SDK 的 transport 或平台逻辑。

## 每个 SDK 内部的四层

### Transport

只负责 loopback HTTP：origin、token header、超时、JSON 字节上限、HTTP 错误和 JSON
解析。Transport 不知道 B 站、小红书，也不接受平台 URL、selector 或 tab ID。

### Contract validation

负责：

- 15 项 direct capability allowlist；
- 8 个受限 execution target；
- `schemaVersion: 2` 和顶层 exact-key；
- `operationId` / `browserBindingId` / artifact ID 格式；
- operation capability 与 artifact retrieval path 绑定；
- 3 项迁移边界的拒绝。

能力名称和 OpenAPI schema 不能在上层应用中另写一份。SDK 的静态 allowlist 由能力矩阵
回归测试与 Gateway catalog、OpenAPI request/operation/artifact 集合比较；运行时仍以
`/v2/capabilities` 为最终能力状态。

### Workflow

负责提交和读取状态：

```text
collect
  → queued operation
  → wait / get operation
  → capability-bound artifact
```

`collect` 每次调用只提交一次。`wait` 只能轮询本地 operation，不会重投平台任务。
发生超时或结果未知时，SDK 抛出明确错误，不能自动重放平台动作。

### Public facade

只暴露上层需要的方法：

```text
listDirectCapabilities / list_direct_capabilities
listCapabilities       / list_capabilities
readOpenApi             / read_openapi
listBrowserBindings     / list_browser_bindings
collect
getOperation            / get_operation
waitOperation           / wait_operation
readArtifact            / read_artifact
collectAndWait          / collect_and_wait
```

## 不允许的交叉依赖

- Python SDK 不导入 `poc/collector-client` 的 JavaScript 源码；
- JavaScript SDK 不导入 Python 包；
- 任一 SDK 不导入平台 connector、浏览器扩展 runtime 或 Browser Host；
- DeepResearch adapter 可以依赖 Python SDK，但不能绕过 SDK 直接构造平台请求；
- 上层应用不能因为两个 SDK 都有 `collect` 就自行拼接另一种语言的请求对象；
- `/v1/collect`、`profileId` 和隔离 Browser Host 永远不作为 `/v2` SDK fallback。

## 版本与变更规则

1. 先更新 Gateway OpenAPI 和 capability catalog；
2. 更新 JS/Python SDK 的 validation 与模型；
3. 运行能力矩阵回归，确认 direct-ready、request union、operation enum、artifact enum 一致；
4. 分别运行 JS SDK、Python SDK 和真实 local 门禁；
5. 需要真实平台的能力必须增加独立 live canary，不能用 fixture 代替；
6. 文档只引用 `/v2/openapi.json` 和 `/v2/capabilities`，不复制一套脱离运行时的永久 schema。
