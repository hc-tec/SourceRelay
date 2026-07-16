# ADR-003：DeepResearch 只通过 Intelligence Gateway 获取数据

状态：Accepted（2026-07-16）
分支：`research/deepresearch-swarm`

## 背景

DeerFlow、Open Deep Research、DeepAgents、AgentScope、CAMEL 等项目都能提供
查询规划或多 Agent 协作，但它们通常自带 Tavily、Serper、Brave、Exa、Firecrawl、
DDG 等默认工具。那些工具无法复用本项目已经验证的中文站点能力，也无法统一
处理人工登录、平台降级、NewsNow 缓存和 raw-first artifact。

本项目需要的是“需要时才发起研究”，不是把所有平台内容提前搬进一个新数据库。
因此上层运行时必须消费现有 Gateway，而不是重新实现一套搜索层。

## 决策

新增 `poc/deepresearch-gateway/` 适配包，作为所有研究框架的唯一数据工具边界：

1. `AdapterSettings` 从 `.env` 读取模型配置和 Gateway 地址；
2. `LLMSettings` 与 Gateway 配置分离，`DEEPSEEK_API_KEY` 永不进入 Gateway 请求；
3. `GatewayClient` 只向一个配置的 `INTELLIGENCE_GATEWAY_URL` 发 HTTP 请求；
4. 默认 `persistence=none`，临时研究不写入数据库；
5. `GatewayToolResult` 保留 Gateway 原始 JSON、HTTP 状态和结构化 `status`；
6. `GatewayToolSet` 提供可包装成 LangGraph、AgentScope、CrewAI 或 MCP 工具的异步函数；
7. `ArtifactReader` 只能读取 Gateway artifact 根目录内的相对路径，并限制文件大小和文本窗口；
8. 上层不得暴露框架默认搜索工具，不能把 Gateway 的失败转写成“没有相关信息”。

## 工具契约

| 工具 | Gateway 请求 | 用途 |
| --- | --- | --- |
| `gateway_capabilities` | `GET /capabilities` | 发现已验证能力 |
| `gateway_plan` | `POST /tasks/plan` | 获取 selected/fallback capability |
| `gateway_search` | `POST /tasks/execute` + `keyword_search` | Web 或平台关键词搜索 |
| `gateway_search_and_fetch` | `POST /tasks/search-and-fetch` | 搜索后读取少量公开正文 |
| `gateway_hotlist` | `POST /tasks/execute` + `hotlist_fetch` | 热榜/趋势 feed |
| `gateway_fetch_detail` | `POST /tasks/execute` + 已允许详情动作 | 视频、文章、问答、帖子、账号 |
| `gateway_read_artifact` | 本地受限读取 | 按需取回 raw JSON/HTML/Markdown |

每次工具结果都要保留：

```text
ok / status / http_status
requested_platform / requested_action
result.items[].source / title / url / snippet / raw_ref
attempted_capabilities / executed_capability_id
degraded / partial / warnings
artifact.manifest_file / artifact.raw_file / artifact.sha256
```

## 为什么不直接改 DeerFlow 的默认搜索器

DeerFlow 的默认搜索目录和配置会随着版本变化，且 subagent 可能继承或动态发现
工具。直接在上游 checkout 中替换一个 Tavily 文件，容易在升级或 MCP 配置时重新
暴露外部搜索器；也无法让 DeepAgents、AgentScope 等其他候选复用这段代码。单独
适配包把“来源治理”固定在框架之外，再给不同框架提供薄包装，升级成本更低。

## 蜂群运行规则

推荐采用受控分层，而不是自由全连接互聊：

```text
Research Planner → Source Router → 并行 Gateway Workers
                                      ↓
                              Evidence Verifier
                                      ↓
                              Citation Auditor
                                      ↓
                              Report Synthesizer
```

- Source Router 先调用 `gateway_plan`，只把 `available=true` 的能力分派出去；
- 各 Worker 只知道 `gateway_*` 工具，不知道 Tavily/Serper/浏览器驱动；
- 任务级并发可以并行，但带 BrowserWing Profile 的能力仍由 Gateway 串行控制；
- `source_unavailable`、`authentication_required`、`no_results`、`partial` 都进入证据状态；
- `authentication_required` 不自动重试、不请求 Agent 自己读取 Cookie；
- Citation Auditor 在报告前要求 URL、能力 ID 和 artifact 引用；
- 只有证据收集完成后才做辩论/投票，不能用 Agent 互聊替代数据采集。

## 框架接入矩阵

| 上层项目 | 适配方式 | 结论 |
| --- | --- | --- |
| DeerFlow | 本包的 MCP Server 或 `invoke` 分派器 | 作为完整研究工作台候选；关闭默认 search |
| DeepAgents/LangGraph | `openai_tools()` 或薄 `StructuredTool` 包装 | 最适合先做小型 PoC，状态/失败语义清晰 |
| AgentScope | 直接注册异步 Python 方法 | 中文 Agent Team 和服务化候选 |
| CrewAI | 将异步方法包装成 Crew tool | 适合角色分工试验，需自查失败传播 |
| Open Deep Research | 替换其 search provider 为 `GatewayToolSet.search` | 适合研究算法参考，不能保留 Tavily |
| Alibaba-NLP/DeepResearch | 将 Gateway 作为 WebAgent/WebResearcher 工具 | Heavy/ParallelMuse 可参考，不作为运行时 |

## 安全边界

- 模型 API key 只由 LLM 客户端使用；工具请求不携带该 key；
- Gateway 是唯一拥有平台 Cookie、Profile、代理和连接器配置的进程；
- artifact 读取拒绝绝对路径和 `..` 越界路径，并限制最大字节数；
- 适配包不提供任意 URL 浏览器工具；详情动作必须命中已注册 capability；
- MCP 只启动本地 stdio Server，不向任意远程 MCP Server 传播凭证；
- 用户若使用外部部署，必须额外加入鉴权、来源隔离和审计，不能把本地 Gateway 端口暴露到公网。

## 验收标准

1. 用 `httpx.MockTransport` 验证请求始终发往 `/tasks/*`，且默认 `persistence=none`；
2. 模拟 503、连接失败和 `authentication_required`，上层仍能看到明确状态；
3. 模拟降级链，保留 `attempted_capabilities` 和 `degraded`；
4. artifact 路径穿越被拒绝，UTF-8 内容可按窗口读取；
5. 工具定义中没有 Tavily、Serper、Brave、Bing、Jina 等直连搜索器；
6. 上层框架接入时只注册 `gateway_*` 工具。
