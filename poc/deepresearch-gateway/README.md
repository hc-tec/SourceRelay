# DeepResearch Gateway Adapter

这是一个不绑定 DeerFlow、DeepAgents、LangGraph、AgentScope、CrewAI 或其他
编排框架的工具适配层。它的唯一数据源是本仓库的
[Intelligence Gateway](../intelligence-gateway/README.md)，不实现也不调用
Tavily、Serper、Brave、Bing、Jina 等直接搜索服务。

## 为什么单独做这一层

DeepResearch 框架解决的是查询规划、并行 Agent、上下文压缩和报告生成；中文
平台的登录边界、能力选择、失败状态、raw artifact 和降级证据则属于 Gateway。
如果把每个平台的搜索 SDK 直接塞进研究 Agent，框架会把
`source_unavailable`、`authentication_required` 和 `no_results` 混成普通空结果，
也会绕过现有 Capability Planner。这个适配层把两个边界固定下来：

```text
模型 .env ───────────────► DeepResearch runtime
                              │ 只能使用本包暴露的工具
                              ▼
                       Intelligence Gateway
                              │
                              ├─ SearXNG / NewsNow
                              ├─ Maxun / BrowserWing
                              ├─ aiotieba / yt-dlp
                              └─ 本地 raw artifact
```

`.env` 中的 `DEEPSEEK_API_KEY` 只交给上层模型客户端。本包不会把它发送给
Gateway，也不会接收 Cookie、浏览器 Profile 或平台 Token。

## 安装与最小调用

```powershell
cd D:\AIProject\inteligence\poc\deepresearch-gateway
..\intelligence-gateway\.venv\Scripts\python.exe -m pip install -e ".[dev]"
```

如果根目录 `.env` 已存在，可以显式加载它；适配器会自动读取当前目录、包目录
或工作区根目录的 `.env`，进程环境变量优先：

```python
from deepresearch_gateway import AdapterSettings, ArtifactReader, GatewayClient, GatewayToolSet

settings = AdapterSettings.from_env(env_file=r"D:\AIProject\inteligence\.env")
client = GatewayClient(settings.gateway_url, timeout=settings.request_timeout)
tools = GatewayToolSet(client, ArtifactReader(settings.artifact_root))

async def collect():
    # 默认 persistence=none；不把临时研究写入 Gateway 情报库。
    search = await tools.search(
        query="低空经济",
        platform="zhihu",
        limit=10,
    )
    # 需要正文时，优先使用组合接口；响应会保留 capability 链和 partial。
    hydrated = await tools.search_and_fetch(
        query="低空经济",
        platform="web",
        search_limit=10,
        detail_limit=3,
    )
    return search, hydrated
```

## DeepAgents/LangGraph first PoC

The repository includes a runnable first swarm in
[examples/deepagents_gateway_research.py](examples/deepagents_gateway_research.py).
It uses `ChatOpenAI` only as a DeepSeek-compatible model client, while all source
tools are wrappers around `GatewayToolSet`. A shared semaphore caps Gateway calls
at three concurrent operations, and the single sub-agent role receives no direct
browser or search SDK.

Install and run it after starting Intelligence Gateway:

```powershell
python -m pip install -e ".[deepagents]"
python examples/deepagents_gateway_research.py "低空经济在中文平台的近期讨论"
```

需要做验收或调试时，加上 `--trace-file`：

```powershell
python examples/deepagents_gateway_research.py `
  --trace-file D:\AIProject\inteligence\runtime\validation\gateway-trace.json `
  "低空经济在中文平台的近期讨论"
```

trace 是 UTF-8 JSON，记录每个 `gateway_*` 调用的输入、HTTP 状态、Gateway status、
能力链、`degraded/partial`、结果数量和警告。最终中文报告不能替代这份机器证据。

新写出的 trace 使用 schema version 2：每个事件都有 event_index，并额外投影
evidence_items。投影会把搜索发现、search-and-fetch 的详情 hydration、已知详情
（video/article/answers/posts）和 hotlist 分开记录；每项保留其 URL、stage、
capability chain、raw_ref 和 artifact 引用。它不复制正文或读取 artifact 内容。

同时写出确定性审计结果时，传入预期平台。重复的 --expected-platform 会把没有被
实际调用的平台明确写成 not_attempted，而不是让它从表格中静默消失：

~~~powershell
python examples/deepagents_gateway_research.py "低空经济在中文平台的近期讨论" --trace-file D:\AIProject\inteligence\runtime\validation\gateway-trace.json --audit-file D:\AIProject\inteligence\runtime\validation\gateway-audit.md --expected-platform bilibili --expected-platform zhihu --expected-platform weibo
~~~

不需要再次运行模型，也可以审计一个已经存在的 UTF-8 trace：

~~~powershell
intelligence-gateway-citation-audit D:\AIProject\inteligence\runtime\validation\gateway-trace.json --output D:\AIProject\inteligence\runtime\validation\gateway-audit.md --expected-platform bilibili --expected-platform zhihu --expected-platform weibo
~~~

Citation Auditor 不访问网络、不解析跳转页面、不读取模型最终文本。它只接受成功阶段
的结果作为候选 citation，并拒绝 promoted、空 URL、平台首页、Sogou/Bing/Baidu
搜索跳转和站内跳转域。每个平台同时输出两种互不混淆的状态：

| 字段 | 说明 |
|---|---|
| coverage_status | native_success、gateway_fallback_success、external_discovery_only、detail_only、失败状态或 not_attempted；它说明实际观测到的收集方式。 |
| claim_status | citable、uncitable、失败状态或 not_attempted；它只说明是否有可引用的规范 URL。 |

例如 site:zhihu.com 返回真实知乎直链时，URL 可以是 citable，但覆盖仍只能是
external_discovery_only；这绝不等价于知乎原生关键词搜索已验证。Markdown 表还会
分别显示覆盖该状态的 degraded/partial 与所有观测事件的 degraded/partial，避免一次
旧的外部 fallback 把后来的原生 B站搜索写成降级。

The example delegates at most three focused aspects, preserves Gateway statuses,
and asks the lead agent to audit URL, source, capability ID and artifact references
before writing a report. The machine audit is authoritative for source provenance;
the model report is only a narrative view over it. This remains a validation PoC,
not a long-running service.

`GatewayToolResult.to_dict()` 保留 Gateway 的原始响应字段，并增加一个轻量外层：

```json
{
  "ok": true,
  "status": "success",
  "http_status": 200,
  "requested_platform": "zhihu",
  "executed_capability_id": "zhihu.keyword_search.browserwing.v1",
  "attempted_capabilities": ["zhihu.keyword_search.browserwing.v1"],
  "degraded": false,
  "partial": false,
  "warnings": [],
  "result": {"items": []}
}
```

失败不会被转成 `items=[]` 的成功：Gateway 的
`no_results`、`source_unavailable`、`authentication_required`、`misconfigured`
和 `error` 原样保留，网络不可达也会返回 `source_unavailable`。

## 可用工具

`GatewayToolSet` 提供以下异步函数：

- `capabilities`：发现已验证的能力；默认只列出 `verified`；
- `plan`：让 Gateway 选择 capability 和 fallback 链；
- `search`：关键词搜索；
- `search_and_fetch`：关键词搜索并按上限读取公开正文；
- `hotlist`：按 `feed_id` 读取 NewsNow 等已注册热榜；
- `fetch_detail`：调用已注册的平台详情能力，不是任意 URL 浏览器；
- `read_artifact`：按返回的相对路径、大小上限和 UTF-8 偏移读取本地 raw 文件。

`GatewayToolSet.openai_tools()` 返回 OpenAI-compatible function-tool JSON Schema；
`GatewayToolSet.invoke(name, arguments)` 可直接作为函数调用分派器。这样同一套
工具可以被 DeepAgents/LangGraph 的 `StructuredTool`、AgentScope Python tool、
CrewAI tool 或自定义 Agent runtime 包装，而不复制搜索逻辑。

## MCP（可选）

需要 DeerFlow 或其他 MCP 客户端时安装可选依赖：

```powershell
python -m pip install -e ".[mcp]"
intelligence-gateway-mcp
```

MCP Server 只注册上述 `gateway_*` 工具。DeerFlow 配置中只添加这个本地 MCP
Server，并关闭 Brave/DDG/Exa/Firecrawl/Tavily 等默认 search tool；不能同时把
框架默认搜索器暴露给 lead agent 或 subagent。

可复制 [examples/deerflow-extensions.example.json](examples/deerflow-extensions.example.json)
到 DeerFlow 的 `extensions_config.json`，再确保运行 DeerFlow 的 Python 环境已经
安装本包。还要从 DeerFlow `config.yaml` 的 `tools` 段删除或注释默认的
`web_search`（例如 DDG、SearXNG、Brave、Tavily）条目；MCP routing 的 `prefer` 只是
提示，不是硬禁止，真正的“只能走 Gateway”依赖工具清单和运行时校验。

## 蜂群接入约束

推荐的受控分层蜂群如下：

```text
Planner
  └─ Source Router
      ├─ gateway_search（Web / 站内能力）
      ├─ gateway_hotlist（热榜）
      ├─ gateway_fetch_detail（平台详情）
      └─ gateway_search_and_fetch（公开正文）
             └─ Evidence Verifier → Citation Auditor → Synthesizer
```

每个 Worker 只能调用 Gateway 工具；不得直接导入平台爬虫、搜索 SDK、Cookie 或
Profile。并行度应在 Gateway/运行时统一限制，带人工 Profile 的 BrowserWing 能力
仍按 Gateway 的串行边界执行。报告生成前必须检查每个关键结论是否有规范 URL、
`executed_capability_id` 和 `raw_ref`/artifact 引用。

## 验证

```powershell
..\intelligence-gateway\.venv\Scripts\python.exe -m pytest -q
..\intelligence-gateway\.venv\Scripts\python.exe -m compileall -q deepresearch_gateway tests
```

适配器测试使用 `httpx.MockTransport`，不会访问真实搜索引擎，也不会读取或打印
任何模型密钥。
