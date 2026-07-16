# DeepResearch 与蜂群模式调研报告

日期：2026-07-16
分支：`research/deepresearch-swarm`
范围：GitHub 开源 DeepResearch、研究型 Agent 和多智能体编排底座；重点检查
中文平台数据源是否可替换、蜂群并发/状态/失败传播、MCP 与安全边界、License、
Issue 以及实际源码结构。

## 结论先行

你的 `.env` 可以只承担 AI 模型配置，但搜索不能跟着框架默认配置走。最稳的
边界是：

```text
DEEPSEEK_API_KEY / 模型配置
             │
             ▼
DeepResearch / Swarm Runtime
  Planner → Source Router → 并行 Worker → Verifier → Citation Auditor → Report
             │
             │ 只能使用 gateway_* 工具
             ▼
Intelligence Gateway
  SearXNG / NewsNow / Maxun / BrowserWing / aiotieba / yt-dlp / public HTML
             │
             ▼
本地 raw artifact（按需读取，不要求字段全部入库）
```

仓库调研结果不是“找一个万能 DeepResearch 仓库”：

1. DeerFlow 的蜂群、沙箱、MCP、长任务和研究工作台最完整，但默认搜索器很多，
   需要通过 MCP 或工具注册点做严格替换；
2. DeepAgents/LangGraph 结构较小、可插拔、状态和失败语义清晰，最适合作为第一
   个 Gateway-only PoC；
3. AgentScope 的中文生态、Agent Team、服务化和 MCP 很有吸引力，适合作为中文
   多租户路线的第二候选；
4. Open Deep Research 适合作为研究图和并行迭代参考，但默认 `search_api=TAVILY`
   且 Issue 暴露了 supervisor 把子任务异常误判成功的风险；
5. Alibaba-NLP/DeepResearch、ParallelMuse 和 DeepResearchAgent 更接近模型/算法
   实验，不应直接充当本项目生产运行时；
6. AutoGen 已进入 maintenance mode，OpenAI Swarm 已明确由 Agents SDK 取代，
   AgentVerse 仍在重构，均不列入主路线；
7. PraisonAI、MetaGPT、CAMEL、CrewAI、Google ADK、Microsoft Agent Framework
   都可做角色编排或工作流实验，但必须关掉自带网页搜索并接入 Gateway。

本分支已实现第一版独立适配包：

```text
poc/deepresearch-gateway/
  GatewayClient       只向 Intelligence Gateway 发 HTTP 请求
  GatewayToolSet      search / search-and-fetch / hotlist / detail / artifact
  GatewayToolResult   保留 status、能力链、降级和 HTTP 状态
  ArtifactReader      受限读取 Gateway raw artifact
  mcp_server.py       可选 MCP bridge
```

适配器默认 `persistence=none`，不会使用 Tavily、Serper、Brave、Bing、Jina 或其他
框架内置搜索服务。当前适配器测试：`8 passed`；Gateway 基线仍为 `114 passed`。

## 1. 调研方法与证据范围

本次优先使用了本地浅克隆的源码、README、LICENSE、git log，再对 GitHub Issue
页面做交叉核验。以下本地 checkout 的最新提交时间均为本次研究附近的快照，星数和
open issue 数会随时间变化，不能当作永久指标：

| 仓库 | 本地最新提交（研究快照） | License | 侧重点 |
| --- | --- | --- | --- |
| `bytedance/deer-flow` | `6935078`，2026-07-16 | MIT | DeepResearch 工作台 / Super Agent Harness |
| `Alibaba-NLP/DeepResearch` | `f72f75d`，2026-02-27 | Apache-2.0 | Tongyi DeepResearch、WebAgent、ParallelMuse |
| `SkyworkAI/DeepResearchAgent` | `5e3c95d`，2026-05-04 | MIT | self-evolution、debate、研究工具生命周期 |
| `langchain-ai/open_deep_research` | `b764481`，2026-07-14 | MIT | LangGraph 研究图、并行 Research Unit |
| `langchain-ai/deepagents` | `f9b7d75`，2026-07-16 | MIT | LangGraph 之上的 Agent harness / subagents |
| `langchain-ai/langgraph` | 活跃仓库 | MIT | durable、stateful、HITL 编排底座 |
| `agentscope-ai/agentscope` | `7295c98`，2026-07-16 | Apache-2.0 | 中文 Agent Team、服务化、多租户 |
| `camel-ai/camel` | `0b9d986`，2026-07-14 | Apache-2.0 | Agent society、大规模模拟、工具生态 |
| `crewAIInc/crewAI` | 活跃仓库 | MIT | Role-based Crews + event-driven Flows |
| `microsoft/autogen` | `027ecf0`，2026-04-06 | CC-BY-4.0 + code license | 历史多 Agent 框架，README 标注 maintenance mode |
| `microsoft/agent-framework` | `85c00fc`，2026-07-16 | MIT | AutoGen/Semantic Kernel 后继、生产工作流 |
| `google/adk-python` | `221bad9`，2026-07-15 | Apache-2.0 | Agent + Workflow、fan-out/fan-in、Task API |
| `MervinPraison/PraisonAI` | `cdc786a`，2026-07-16 | MIT | planning、MCP、deep research、native web search |
| `geekan/MetaGPT` | `11cdf46`，2026-01-21 | MIT | 角色/SOP、软件公司式协作 |
| `zilliztech/deep-searcher` | 2025-11 后维护节奏降低 | Apache-2.0 | Vector DB / RAG / collection-aware search |
| `mshumer/OpenDeepResearcher` | 2025-05 后维护较弱 | MIT | 早期 DeepResearch demo |
| `btahir/open-deep-research` | archived | MIT | 已归档，不作为候选 |

## 2. DeepResearch 产品型仓库

### 2.1 ByteDance DeerFlow：完整度最高，但必须“工具白名单化”

仓库：[bytedance/deer-flow](https://github.com/bytedance/deer-flow)

README 当前定位已从 Deep Research framework 扩大到 Super Agent Harness，包含
lead agent、subagent runtime、MCP、sandbox、memory、LangGraph checkpointer/store。
源码中已确认：

```text
backend/packages/harness/deerflow/agents/lead_agent/agent.py
backend/packages/harness/deerflow/agents/middlewares/delegation_ledger.py
backend/packages/harness/deerflow/agents/middlewares/subagent_limit_middleware.py
backend/app/gateway/routers/mcp.py
backend/packages/harness/deerflow/community/*/tools.py
```

蜂群相关的实质能力：

- `SubagentLimitMiddleware` 同时限制单次并发和每次 run 的总 subagent 数；
- delegation ledger 记录已委派任务、状态、结果摘要和 result hash，避免重复委派；
- sandbox 有本地/远程 provider、路径和命令安全检查；
- MCP 可以把外部工具暴露给 lead agent 和 subagent；
- 社区目录同时存在 Brave、DDG、Exa、Firecrawl、Browserless、Crawl4AI、
  Jina、Serper、Tavily、SearXNG 等工具。

关键 Issue：[#4192 MCP 初始化正常但对话时调不到](https://github.com/bytedance/deer-flow/issues/4192)。
这类问题说明 MCP “加载成功”并不等于工具真的出现在对应 Agent 的可调用集合里，
所以集成验收不能只看启动日志，必须做一次 lead agent、subagent、并发调用和失败
结果的端到端测试。

对本项目的判断：

- 适合未来做完整研究工作台和可视化蜂群；
- 不应直接修改某个 Tavily 文件后当作完成；应把本包的 MCP bridge 注册成唯一来源，
  并在配置和运行时同时禁用所有默认 search tool；
- 需要审计子 Agent 是否能绕开工具白名单、直接使用 sandbox/browser 或读取不该
  读取的文件；
- Linux + Docker 是推荐部署环境，Windows 更适合开发/评估。

### 2.2 Open Deep Research：最清楚的研究图参考，但默认 Tavily

仓库：[langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research)

源码关键点：

- `Configuration.search_api` 默认值为 `TAVILY`，另有 OpenAI/Anthropic native web
  search 和 `NONE`；
- `max_concurrent_research_units` 默认 5；
- `MCPConfig` 支持 MCP server URL、工具白名单和认证标记；
- supervisor 将多个 `ConductResearch` 调用用 `asyncio.gather` 并行执行；
- research、compression、final report 使用不同模型配置；
- LangGraph state 明确保存研究 brief、research iterations、notes 和压缩结果。

关键 Issue：[#283 supervisor 将子 ConductResearch 异常当作成功](https://github.com/langchain-ai/open_deep_research/issues/283)。

接入方式：把 `GatewayToolSet.search` 或 MCP 工具作为唯一研究工具，不能只把
`search_api` 改成 `NONE` 后继续让模型使用 native web search。Issue #283 对本项目
尤其重要：Gateway 返回 `source_unavailable`、`authentication_required`、
`no_results` 时，Open Deep Research 的 supervisor/compression 层必须保留失败状态，
不能生成“成功但没有证据”的 note。

### 2.3 Alibaba-NLP/DeepResearch：算法和模型研究参考

仓库：[Alibaba-NLP/DeepResearch](https://github.com/Alibaba-NLP/DeepResearch)

主要内容是 Tongyi DeepResearch 30B-A3B、WebAgent/WebResearcher/WebDancer/
WebSailor、NestBrowse/WebWalker 和 ParallelMuse。它更像模型能力、长时搜索、
浏览轨迹与并行压缩聚合的实验集合，而不是通用生产控制平面。

已核验 Issue：

- [#242 WebWalker 数据交互问题](https://github.com/Alibaba-NLP/DeepResearch/issues/242)；
- [#245 SimpleVQA 本地图片路径问题](https://github.com/Alibaba-NLP/DeepResearch/issues/245)；
- [#261 建议增加证据 API](https://github.com/Alibaba-NLP/DeepResearch/issues/261)。

最后一个 Issue 与本项目直接相关：即使研究模型很强，也需要显式 evidence API
才能把 URL、原始内容、工具轨迹和结论关联起来。这里的 WebWalker/NestBrowse
搜索和 visit 工具必须换成 Gateway，不应直接让模型访问任意网页。

### 2.4 SkyworkAI/DeepResearchAgent：可演化 Agent 研究参考

仓库：[SkyworkAI/DeepResearchAgent](https://github.com/SkyworkAI/DeepResearchAgent)

仓库强调 self-evolution protocol、context/lifecycle management、版本追踪和
安全 evolution update interface，包含 retriever、deep researcher、debate manager、
reporter、todo 等角色配置。它适合研究“研究工具如何迭代”和辩论式协作，不适合作为
第一版数据源运行时。

Issue [#93 建议增加 BGPT evidence API](https://github.com/SkyworkAI/DeepResearchAgent/issues/93)
再次说明：自演化不能替代来源证据治理；本项目把 evidence 状态放在 Gateway 和
Citation Auditor，而不是让 Agent 自己生成可信度。

### 2.5 其他产品候选

- [zilliztech/deep-searcher](https://github.com/zilliztech/deep-searcher)：偏 RAG、
  向量数据库和 collection-aware search。Issue [#267](https://github.com/zilliztech/deep-searcher/issues/267)
  暴露 collection routing 忽略 caller authorization context，提醒我们不要把
  来源授权交给上层 Agent；Issue [#270](https://github.com/zilliztech/deep-searcher/issues/270)
  讨论增加 SERP provider。可作为证据检索层参考，不做主运行时。
- [mshumer/OpenDeepResearcher](https://github.com/mshumer/OpenDeepResearcher)：MIT、
  早期可运行 demo，但 Issue [#16](https://github.com/mshumer/OpenDeepResearcher/issues/16)
  仍在讨论更便宜的 SERP API，维护和部署稳定性弱于当前候选。
- [btahir/open-deep-research](https://github.com/btahir/open-deep-research)：已归档，
  直接排除。

## 3. 蜂群/多智能体编排底座

### 3.1 DeepAgents + LangGraph：第一 PoC 首选

仓库：[langchain-ai/deepagents](https://github.com/langchain-ai/deepagents)、
[langchain-ai/langgraph](https://github.com/langchain-ai/langgraph)

DeepAgents 是 LangGraph 之上的 Agent harness，内置 planning、filesystem、context
management、subagents、skills、MCP 和 human-in-the-loop；README 明确支持传入自定义
Python tools 或 MCP server。LangGraph 提供 durable execution、长时 stateful run、
checkpoint/store 和可暂停恢复。

它非常适合把本包异步方法包装成 `StructuredTool`：

```python
from deepagents import create_deep_agent
from langchain_core.tools import StructuredTool

search_tool = StructuredTool.from_function(
    coroutine=gateway_tools.search,
    name="gateway_search",
    description="Search only through the Intelligence Gateway.",
)
agent = create_deep_agent(
    model="deepseek:deepseek-chat",
    tools=[search_tool],
    system_prompt="Never call a direct web search provider; preserve Gateway status and citations.",
)
```

真实 PoC 仍需加上：Gateway 结果 Pydantic/JSON schema、失败状态测试、ArtifactReader
工具白名单和每次 run 的并发上限。DeepAgents 的 shell/filesystem 能力必须收紧到研究
工作区，不能让 Agent 读取 `.env`、BrowserWing Profile 或 Gateway Cookie 目录。

### 3.2 AgentScope：中文、多租户和 Agent Team 候选

仓库：[agentscope-ai/agentscope](https://github.com/agentscope-ai/agentscope)

README 当前包含 Agent Team、多租户/多会话服务、RAG、MCP、分布式服务、Web UI
TeamSidebar 和 Subagent HITL card。当前提交仍在修工具安全行为（例如拒绝可变更
文件的 `find` 命令），说明它在持续加强工具边界。

优点：中文文档和社区、服务化路径、Agent Team 和 MCP 都与个人情报工作台匹配；
风险：需要实测 Team 的并行模型、状态共享、取消/超时和工具异常传播。第一步可直接
把 `GatewayToolSet` 的 async 方法注册为 Python tool，或通过本包 MCP bridge 接入。

### 3.3 CAMEL：蜂群社会模拟实验层

仓库：[camel-ai/camel](https://github.com/camel-ai/camel)

CAMEL 侧重角色、任务、工具、环境和 Agent society，README 提到可做大规模 Agent
模拟，提供 browser toolkit、MCP toolkit 和 message agent toolkit。它很适合做
“多个研究角色如何分工/辩论/涌现”的实验，但来源授权、引用、失败状态和平台登录
边界都要由本项目补齐。因此它是蜂群实验层，不是主数据源运行时。

### 3.4 CrewAI：快速角色分工，但要审计失败语义

仓库：[crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)

Crews 提供角色、Agent 和任务协作，Flows 提供事件驱动和较确定的工作流，另有
tracing/observability 与 MCP。它可快速表达“Source Router / Evidence Verifier /
Reporter”，但默认生态包含各种网页工具，并且高层抽象容易把异常变成任务文本。
接入时只注册 `gateway_*`，并为每个工具结果做结构化状态断言。

### 3.5 Microsoft Agent Framework：生产工作流强，生态成本较高

仓库：[microsoft/agent-framework](https://github.com/microsoft/agent-framework)

最新 README 明确支持 Python 与 .NET、多 Agent workflows、sequential/concurrent/
handoff/group collaboration、checkpointing、streaming、HITL、time travel、OpenTelemetry
和 hosting。它是 AutoGen/Semantic Kernel 路线的生产级后继候选，MIT License。

适合已经决定采用 Microsoft/Azure 生产栈时使用；对本项目的 Gateway-only 约束没有
技术障碍，Python workflow 节点可调用 `GatewayToolSet`，但引入量和部署复杂度高于
DeepAgents/LangGraph，暂不做第一 PoC。

### 3.6 Google ADK 2.0：工作流原语很强，但模型生态假设不同

仓库：[google/adk-python](https://github.com/google/adk-python)

README 当前为 2.0，包含图式 Workflow、deterministic flow、routing、fan-out/fan-in、
loops、state、dynamic nodes、HITL 和 Task API；Apache-2.0。它可以表达受控蜂群，
但默认体验更靠近 Google/Gemini 生态，DeepSeek 和中文平台接入需要额外 provider/tool
适配。可作为工作流对照，不优先于 LangGraph/AgentScope。

### 3.7 PraisonAI：功能丰富但默认 Web Search 太容易越界

仓库：[MervinPraison/PraisonAI](https://github.com/MervinPraison/PraisonAI)

README 同时宣传 planning、MCP、deep research、handoff、workflow、reflection、
native web search 和 `web_search=True`；示例/文档中还直接使用 Tavily。它适合快速
验证角色分工，但必须显式关闭 `web_search`，只给 Gateway MCP/函数工具。MIT License，
候选优先级低于 DeepAgents/AgentScope。

### 3.8 MetaGPT：SOP/角色很清晰，但不是情报采集底座

仓库：[geekan/MetaGPT](https://github.com/geekan/MetaGPT)

MetaGPT 把产品经理、架构师、项目经理和工程师组织成软件公司，核心是
`Code = SOP(Team)`；README 仍要求 Python 3.9 且低于 3.12 的环境。角色/SOP 对
“研究计划、证据审核、报告编辑”有启发，但平台数据源、raw artifact、状态契约都需
自行建设，且运行环境与本仓库 Python 3.13/3.11 Gateway 不一致，暂不选主线。

### 3.9 AutoGen、OpenAI Swarm、AgentVerse

- [microsoft/autogen](https://github.com/microsoft/autogen)：README 已标注 maintenance
  mode，并建议新项目使用 Microsoft Agent Framework；只做历史 Group Chat 参考；
- [openai/swarm](https://github.com/openai/swarm)：实验/教育性质、无跨调用状态，已被
  OpenAI Agents SDK 取代；
- [OpenBMB/AgentVerse](https://github.com/OpenBMB/AgentVerse)：README 提示代码正在
  refactor，稳定 simulation 需使用旧分支，暂不作为运行时。

## 4. Issue 暴露的共性风险

| 风险 | Issue/源码证据 | 对 Gateway-only 的要求 |
| --- | --- | --- |
| MCP 加载了但调用不到 | DeerFlow #4192 | 启动检查不够，必须做 lead/subagent 端到端工具调用 |
| 子 Agent 异常被当成功 | Open Deep Research #283 | `source_unavailable` 等状态必须结构化穿过 supervisor/compression |
| evidence API 缺失 | Alibaba #261、DeepResearchAgent #93 | 结论必须绑定 URL、capability ID、raw_ref/artifact |
| 外部 SERP provider/授权混淆 | Deep Searcher #270/#267 | 来源选择和授权留在 Gateway，不交给 collection/Agent |
| 默认工具越界 | DeerFlow community search、PraisonAI `web_search` | 工具白名单、配置禁用、运行时二次校验 |
| 运行/沙箱安全 | DeerFlow MCP 警告、DeepAgents trust-the-LLM | 沙箱/文件根目录限制，禁止读取 `.env`、Cookie、Profile |
| 资源耗尽 | DeerFlow subagent limit、Open Deep Research gather | 并发、总预算、超时和取消必须有硬限制 |

## 5. Gateway 适配器设计与当前实现

### 5.1 配置边界

`AdapterSettings.from_env()` 支持根目录 `.env`、显式 `env_file` 和进程变量；进程
变量优先。它把配置分成：

```text
LLMSettings
  provider / model / api_key / base_url

AdapterSettings
  gateway_url / request_timeout / artifact_root
```

`LLMSettings.api_key` 只返回给上层模型客户端。本包的 `GatewayClient` 既不接收
API key 参数，也不构造第三方搜索 SDK。

### 5.2 工具契约

| 工具 | HTTP | 默认保存语义 |
| --- | --- | --- |
| `gateway_capabilities` | `GET /capabilities` | 不执行来源读取 |
| `gateway_plan` | `POST /tasks/plan` | 不执行来源读取 |
| `gateway_search` | `POST /tasks/execute` + `keyword_search` | `persistence=none` |
| `gateway_search_and_fetch` | `POST /tasks/search-and-fetch` | `persistence=none` |
| `gateway_hotlist` | `POST /tasks/execute` + `hotlist_fetch` | `persistence=none` |
| `gateway_fetch_detail` | `POST /tasks/execute` + 已允许 detail action | `persistence=none` |
| `gateway_read_artifact` | 本地受限读取 | 不写数据库 |

每个 `GatewayToolResult` 都保留 Gateway 原始 JSON，并附带 `http_status` 与
`transport_error`。网络失败返回 `source_unavailable`，绝不会伪装成 `no_results`。

`ArtifactReader` 仅接受 artifact 根目录下的相对路径，拒绝绝对路径、`..` 穿越和
超过配置大小的文件；读取内容按 UTF-8、offset 和 max_chars 窗口返回，适合让 AI 按需
查看 raw JSON/HTML，而不是预先拆成大量字段表。

### 5.3 MCP 与其他框架

`poc/deepresearch-gateway/deepresearch_gateway/mcp_server.py` 是可选 MCP bridge：

```powershell
cd D:\AIProject\inteligence\poc\deepresearch-gateway
python -m pip install -e ".[mcp]"
intelligence-gateway-mcp
```

DeerFlow、Open Deep Research、AgentScope 和其他 MCP 客户端只应连接这一台本地
stdio Server。DeepAgents/LangGraph、CrewAI、Microsoft Agent Framework、Google ADK
也可以直接包装同一组 async Python methods；不要为每个框架重新写平台搜索逻辑。

## 6. 推荐路线

### 第一阶段：DeepAgents/LangGraph Gateway-only PoC

先实现一个单次研究流程和受控并发：

```text
Planner
  → Source Router（调用 gateway_plan）
  → Web/News/Platform Workers（并行，但受预算限制）
  → Evidence Verifier
  → Citation Auditor
  → Report Synthesizer
```

验收样本建议固定为：

1. Web/SearXNG：一个中文主题，验证站点过滤和正文补全；
2. B站/NewsNow：一个热榜 feed + 一个已知视频详情；
3. 知乎：一个问答详情；
4. 小红书或微博：一个需要 BrowserWing 的能力，验证认证/降级状态；
5. 模拟 `source_unavailable`、`authentication_required`、`no_results` 和 partial；
6. 报告中每个重要结论都能回到 URL、`executed_capability_id` 和 artifact。

### 第二阶段：DeerFlow MCP 工作台

当第一阶段证明工具契约和失败传播稳定后，再通过本包 MCP 接入 DeerFlow，使用其：

- lead agent/subagent UI；
- delegation ledger 和并发上限；
- sandbox、HITL、memory、checkpointer；
- 长研究任务和报告工作流。

必须在配置、工具注册和运行时三处验证默认搜索器为空，只剩 `gateway_*`。

### 第三阶段：AgentScope 中文服务化对照

如果目标从个人本地研究扩展到多用户、多会话和中文团队协作，再把同一工具集接入
AgentScope Team/service，重点测试租户隔离、会话状态、取消/超时、MCP 和 UI HITL。

## 7. 成本、并发和凭证边界

- 原始数据按需落本地 artifact，默认不写 SQLite，可把 token 消耗集中在预览和必要正文；
- Gateway 统一限制搜索/浏览器并发，BrowserWing Profile 能力继续串行；
- 上层 Agent 的并发不能突破 Gateway 的 capability/connector 限制；
- 研究模型只拿最小必要预览，按需调用 `gateway_read_artifact`，避免把整份 HTML/JSON
  一次性塞入上下文；
- `.env` 不进入 Git，不向 Gateway 或平台请求转发；
- 不自动读取或生成用户 Cookie，不绕过验证码、付费墙或登录要求；
- 生产部署若跨进程/跨机器，Gateway 需要加认证、TLS、审计和 artifact 权限隔离，不能
  直接把本地 8765 端口暴露公网。

## 8. 最终选择

| 目标 | 选择 |
| --- | --- |
| 现在验证“万物皆接口 + 受控蜂群” | `DeepAgents/LangGraph + poc/deepresearch-gateway` |
| 需要完整研究工作台、UI、长任务 | `DeerFlow + 本包 MCP` |
| 中文多租户 Agent Team 服务 | `AgentScope + 本包工具/MCP` |
| 研究算法、并行压缩、重搜索模型 | Alibaba-NLP/DeepResearch、ParallelMuse（只作参考） |
| 历史教学/快速角色 Demo | CAMEL、CrewAI、MetaGPT、PraisonAI（必须禁用默认 Web Search） |

因此当前不把某个框架的默认搜索接口接进来；已经接入的是一个框架无关的
Gateway-only 工具边界。下一步应做第一阶段小型 DeepAgents/LangGraph 蜂群 PoC，
用真实 Gateway 样本验证“搜索、失败、artifact、引用、并发”闭环，再决定是否把
DeerFlow 作为正式工作台。

## 9. 主要来源

- [DeerFlow README](https://github.com/bytedance/deer-flow)、[Issue #4192](https://github.com/bytedance/deer-flow/issues/4192)
- [Alibaba-NLP/DeepResearch](https://github.com/Alibaba-NLP/DeepResearch)、[Issue #242](https://github.com/Alibaba-NLP/DeepResearch/issues/242)、[Issue #245](https://github.com/Alibaba-NLP/DeepResearch/issues/245)、[Issue #261](https://github.com/Alibaba-NLP/DeepResearch/issues/261)
- [SkyworkAI/DeepResearchAgent](https://github.com/SkyworkAI/DeepResearchAgent)、[Issue #93](https://github.com/SkyworkAI/DeepResearchAgent/issues/93)
- [Open Deep Research](https://github.com/langchain-ai/open_deep_research)、[Issue #283](https://github.com/langchain-ai/open_deep_research/issues/283)
- [DeepAgents](https://github.com/langchain-ai/deepagents)、[LangGraph](https://github.com/langchain-ai/langgraph)
- [AgentScope](https://github.com/agentscope-ai/agentscope)
- [CAMEL](https://github.com/camel-ai/camel)、[CrewAI](https://github.com/crewAIInc/crewAI)
- [Microsoft Agent Framework](https://github.com/microsoft/agent-framework)
- [Google ADK Python](https://github.com/google/adk-python)
- [PraisonAI](https://github.com/MervinPraison/PraisonAI)、[MetaGPT](https://github.com/geekan/MetaGPT)
- [Deep Searcher](https://github.com/zilliztech/deep-searcher)、[OpenDeepResearcher](https://github.com/mshumer/OpenDeepResearcher)
