# 产品规格：面向中文平台研究的浏览器采集策略系统

- 状态：Accepted
- 日期：2026-07-17
- 适用范围：Personal Intelligence 的浏览器扩展执行面、平台采集策略与本地研究证据包
- 相关决策：[Grill 决策账本](collector-grilling-decision-log.md)、[决策一致性与实现差距审计](collector-decision-audit.md)、[ADR-002：数据源层](data-source-layer.md)、[浏览器扩展采集系统基线](../research/browser-extension-collection-architecture-2026-07-17.md)、[受控网络响应观察](../research/browser-extension-network-observation-2026-07-17.md)

## 1. 北极星与边界

北极星不是“通用爬虫”、持续监控面板或把所有平台数据预先入库，而是按需产出一个可审计的**研究证据包（research evidence pack）**：

```text
研究问题 + 决策语境 + 平台范围 + 证据要求 + 预算
  -> 采集计划
  -> 用户浏览器上下文中的受限平台执行
  -> 本地、去敏、可追溯的证据包
  -> DeepResearch 读取、分析、引用与指出缺口
```

任务的最小单位不是“关键词 + 网站”，而是研究问题。例如：

```text
“比较三个品牌在小红书和知乎中对某产品风险的真实讨论，
 优先覆盖面，必要时读取代表性正文与少量评论。”
```

每个来源独立报告其执行状态和覆盖范围。`authentication_required`、`layout_changed`、`rate_limited`、`partial`、`no_results` 与 `source_unavailable` 都是证据，不能被静默降级成“无信息”。外部搜索发现只能标为 `external_discovery_only`，绝不能被叙述为平台站内搜索成功。

本规格不授权绕过登录、验证码、风控、付费限制或平台私有接口；不导出 Cookie、Token、密码、二维码、请求头/体或用户浏览器 Profile。用户如需登录，只在其隔离且可见的浏览器上下文中自行完成。

## 2. 用户可见的研究档案

研究档案表达“想获得什么证据”，而不是强迫用户选择 DOM、网络观察或具体选择器。第一版固定以下五种档案；平台策略在其能力范围内选择实施机制。

| 档案 | 主要目标 | 默认范围 | 典型输出 | 默认不做 |
|---|---|---|---|---|
| `scout` | 快速发现、判断是否值得继续 | 多平台、有限结果页 | 候选链接、标题、来源、可见摘要、状态 | 批量详情、评论、深翻页 |
| `evidence` | 对关键主张给出可复查的一手条目 | 指定平台/主题 | 去重后的发现条目、代表性详情、覆盖说明 | 无预算的全量深读 |
| `deep_dive` | 在明确边界内理解一组内容 | 选中条目或窄主题 | 详情正文/元数据、语义动作轨迹、缺口 | 未确认的站内批量漫游 |
| `discussion` | 观察观点、反驳与讨论结构 | 选中内容及限定评论样本 | 帖子详情、评论样本、排序/展开条件 | 默认抓取全部评论或楼中楼 |
| `account_archive` | 保存某账号当前可见内容的可恢复快照 | 一个或多个指定账号、声明的时间/数量预算 | 内容卡片清单、覆盖状态、可选详情与评论扩展 | 声称取得平台上的全部历史内容 |

`scout` 可以只追求广度；`evidence` 与 `deep_dive` 可以要求更高详情；`discussion` 和 `account_archive` 是独立任务类型，而不是关键词搜索的布尔开关。计划必须明确数量、时间、页数/滚动、详情和评论预算，不能以“尽可能多”为唯一边界。

## 3. 证据目标与采集机制分离

平台能力的选择有两个正交维度：

```text
证据目标（用户选择）                 采集机制（经验证的策略选择）
-----------------------------------------------------------------------
breadth_search                         native_navigation
detail_read                            visible_dom
discussion_sample                      bounded_interaction
account_context / account_archive      approved_response
trend_snapshot                         detail_navigation
                                      comment_navigation
```

含义如下：

- `breadth_search`：站内查询后的结果发现与有限覆盖；
- `detail_read`：读取已知或已发现的单条内容；
- `discussion_sample`：在明确帖子、数量与排序条件下读取讨论样本；
- `account_context`：账号基本上下文与近期可见内容；
- `account_archive`：可恢复的账号可见内容目录快照；
- `trend_snapshot`：在声明时间点取得可见榜单或趋势证据。

机制只描述实现方法，不代表数据质量承诺：

- `native_navigation`：进入平台自己的搜索、账号或详情入口；
- `visible_dom`：投影用户当前可见页面的白名单字段；
- `bounded_interaction`：执行预先注册的筛选、排序、滚动、分页、展开或打开评论面板；
- `approved_response`：仅观察任务绑定页面已经合法发生、精确 route 已批准的去敏 JSON 投影；
- `detail_navigation`、`comment_navigation`：在同一任务预算内进入明确的详情或评论页面。

同一个 `account_archive` 在一个平台可通过 `visible_dom + bounded_interaction` 枚举，在另一个平台可辅以 `approved_response`；两者的输出契约、覆盖条件和失败语义必须相同。没有已验证机制时，计划应拒绝或只给出较低层级的 `account_context`，而不是假装完成归档。

`approved_response` 只增强页面正常呈现信息的结构、游标和状态判断。response 中没有呈现给用户的字段不得进入长期证据；可见内容与 response 投影不一致时，优先报告差异或部分覆盖，不得用隐藏字段扩展用户授权的数据表面。

## 4. 执行架构与权限模型

采用一个 Manifest V3 **Collector Core**，而不是每个平台一个高权限扩展、一个“万能 crawler”，或运行时下载任意插件：

```text
Collector Core
  ├─ task planner / lease broker
  ├─ read-only DOM executor
  ├─ bounded interaction executor
  ├─ controlled response observer
  ├─ artifact writer
  └─ static Platform Capture Strategy Registry
       └─ repository-local, code-reviewed, versioned, live-validated packs
```

策略包在构建时静态注册、随仓库版本发布。它们不得直接访问特权浏览器 API、浏览器会话材料、原始 header、用户 Profile 路径、任意网络、Gateway 连接或任意 JavaScript 执行能力。Core 只向策略暴露受限的页面角色、动作 AST、字段投影与配额接口。第三方平台爬虫仓库只能提供调研参考，不能复制、集成、运行或成为策略后端；正式采集只通过扩展在 Collection Browser Profile 的正常页面上下文中执行。

默认权限保持最小化。安全底座只在精确任务 tab/document 中做固定文件注入和去敏响应观察；不使用 OS 级抓包、MITM、`webRequest`、`debugger`、浏览器会话导出、请求重放或私有 API 签名。平台行为不使用离线 fixture 验证，只在用户控制环境中的专用 Validation Profile 低频真实验证；远程 CI 只构建制品。编译、bundle、MV3 manifest、脚本存在性、自动加载和权限清单属于构建门禁，不作为平台能力测试。

任何新策略进入代码前，必须先完成[数据源勘察工作流](source-reconnaissance-workflow.md)。系统先像人类研究者一样复现浏览路径，联合观察页面 DOM、正常交互和页面自己触发的 XHR / fetch，再按字段选择最小且稳定的证据表面。未形成 Source Reconnaissance Dossier、字段—证据映射、失败状态矩阵和真实验证计划时，不得创建 production selector、action graph 或 response route；“先写采集代码再看能不能用”不属于本产品流程。

## 5. 平台策略契约

每个策略包必须声明能力，不得靠 LLM 临场生成选择器或任意点击脚本。最小契约如下：

```yaml
id: xiaohongshu.account_archive.v1
platform: xiaohongshu
version: 1.0.0
maturity: draft | build_ready | live_anonymous_verified | live_authenticated_verified | suspended
objectives: [account_context, account_archive]
page_roles: [profile, content_list, detail, comments]
allowed_mechanisms: [native_navigation, visible_dom, bounded_interaction]
interaction_steps:                     # 受限动作 AST，而非任意 JavaScript
  - open_profile
  - apply_declared_filter
  - scroll_until_terminal_or_budget
approved_response_routes: []           # 精确 origin + pathname；未验证时为空
quota:
  max_pages: 20
  max_scrolls: 80
  max_details: 30
  max_comment_items: 100
output_contract: content_inventory.v1
validation_contract: build gates + local live-validation record + failure semantics
reconnaissance_dossier: docs/reconnaissance/xiaohongshu/...
```

完整契约至少还要定义：

1. 平台、策略版本、适用的证据目标和登录状态前提；
2. 可进入的页面角色、规范 URL/稳定 ID 规则、去重键与字段白名单；
3. 每一步可做的受限交互、前置条件、最大重试、超时和停止条件；
4. 可以观察的精确响应 route、MIME、状态、投影字段、大小/数量限制；
5. 输出类型、不可获得字段、覆盖声明和所有失败状态；
6. Source Reconnaissance Dossier、字段—证据映射和被否决的替代方案；
7. 构建制品校验、用户控制环境中的低频真实验证日期/证据和失败语义。

策略成熟度采用保守生命周期：`draft -> build_ready -> live_anonymous_verified | live_authenticated_verified -> suspended`。`build_ready` 只表示制品可构建、加载和满足批准的权限清单，不代表平台能力；页面结构漂移、登录门禁、错误相关性或无法满足 output contract 都必须降低成熟度，不能因某次页面能打开就升格为通用能力。

## 6. 有界交互规则

DOM 交互是产品必需能力，但必须可审计且有上限。策略只能引用预定义语义动作，例如：

```text
open native search/profile/detail
set registered filter or sort
open next page / bounded scroll
expand registered visible text
open registered comment panel
collect visible cards / declared terminal marker
```

每个动作记录目标页面角色、原因、开始/结束、影响的条目数和结果。禁止执行模型生成的任意脚本、无界滚动、隐式关注/点赞/发布、登录按钮、验证码处理或跨平台跳转。若页面要求人工确认，任务返回 `authentication_required` 或 `user_action_required`，等待用户在该浏览器上下文中处理后由用户显式恢复。

账号安全是有界交互的更高优先级门禁。认证 Profile 的动作结果未知、断网、弱网、导航失败、验证码、风控或限流时，本轮立即停止；相同 action ID 不得重试，Gateway 重启不得清除风险状态。验证码、风控、限流、登录失效和中断进入人工解锁；普通网络失败立即回到 `ready`，但不会后台自动重试或恢复，新的真实平台操作仍须新的逐次授权。具体状态机、审计分类和验收条件见[账号安全熔断设计](account-safety-circuit-breaker.md)。

## 7. 账号内容归档（account corpus）

“收集某博主所有笔记/帖子”是 `account_archive`，不是关键词搜索的附属选项。它先完成目录，再按用户预算深化：

```text
canonical profile URL + stable account ID
  -> enumerate visible/traversable content inventory
  -> record coverage and terminal condition
  -> materialize selected/all-within-budget details
  -> optionally collect comments for selected items
  -> write local evidence bundle
```

### 7.1 身份、目录与详情分层

- 账号以规范 Profile URL 和平台稳定账号 ID（可获得时）识别；展示昵称只作呈现，不能作唯一键。
- 第一阶段只产出内容卡片清单：内容 ID/规范 URL、可见标题/摘要、可见发布时间/类型/状态与发现位置。它优先保障覆盖与去重。
- `account_detail_materialization` 是显式升级：用户可选择特定条目、时间段、前 N 条或“目录内全部，但受详情预算限制”。详情失败不得删除已成功枚举的目录记录。
- `discussion_sample` 独立于归档：默认不抓评论；只对已选条目按声明的数量、排序、层级和时间预算采样。

### 7.2 可恢复快照与诚实完成语义

长账号历史按可恢复快照执行，而不是长时间不可中断的单次爬取。任务状态至少保存：

```text
snapshot_id
account identity
strategy version
captured_at / last_resumed_at
visited content IDs and dedupe key type
traversed page/scroll cursors
selected filters and declared range
remaining budgets
observed item count
terminal condition or partial/failure reason
```

coverage 必须随 artifact 输出，至少包括：账号规范 URL、稳定 ID（若有）、登录状态类别、筛选条件、时间范围、已观察条目数、页面/滚动覆盖、去重规则、完成时间、停止条件和中断原因。

可以承诺的表述是：

> “在当前登录状态、声明范围与预算下，于捕获时可见且可遍历的全部内容。”

不得写成“该账号全部历史内容”，除非平台确实暴露了可靠终点且策略已验证。删除、私密、算法隐藏、限流、登录限制或页面不可达内容都必须在 coverage 中成为明确限制。

## 8. 本地 raw-first 证据包

第一阶段不要求把每个平台字段拆入数据库。采用“**去敏的原始证据优先 + 最小索引 + schema-on-read**”：保留足以复查和供 AI 读取的平台特有投影，不预先强行统一成作者、热度、评论等列。这里的 raw 是采集后的可见页面、卡片和安全投影，绝不包括认证材料、隐藏页面状态或原始网络包。“去敏”不删除任务页面公开可见的身份、简介、地区、职业和联系字段；这些字段进入本地加密长期档案，并受显式访问、导出和删除规则约束。

建议目录布局：

```text
evidence/<task-id>/
  task.json                         # 问题、范围、预算、用户批准的升级
  evidence-plan.json                # 目标、平台策略与预计覆盖
  source-status.json                # 每来源 capability、状态、失败/降级证据
  semantic-action-trace.jsonl       # 有界动作与停止条件
  discovery/<platform>.jsonl        # 搜索/目录卡片投影
  details/<platform>/<content-id>.json|html|md
  comments/<platform>/<content-id>.jsonl
  response-projections/<platform>.jsonl
  coverage/<platform>.json
  manifest.json                      # 文件、MIME、SHA-256、版本、保留期
```

文件级索引固定 `task_id`、平台、策略版本、动作、规范来源 URL、采集时间、状态、artifact 相对路径、SHA-256、去敏版本和 coverage 引用。数据库以后可以只保存索引或任务历史；它不是原始证据的唯一真相源。默认保存在本地，保留期和向外发送需由用户/产品显式设置。

## 9. DeepResearch 的边界

DeepResearch（包括蜂群式 Planner、Verifier、Citation Auditor、Report Synthesizer）是证据包消费者，不是浏览器、认证或平台接口的拥有者：

```text
Collector Core / Gateway -> local evidence bundle -> DeepResearch
                                                -> coverage-gap analysis
                                                -> escalation proposal
                                                -> cited report
```

它可以：读取受限 artifact、比较来源冲突、检查覆盖缺口、提出“需要详情/评论/更大目录预算”的升级建议，并在证据完成后综合报告。

它不得：读取 Cookie/Token/Profile、直接调用平台私有 API、替换成默认搜索引擎后假称站内能力、生成任意浏览器动作或自行扩大抓取范围。任何从 `scout` 升级到详情、评论、账号归档深度或新增平台的计划，必须明确显示增量范围和预算，并由用户或上层受控工作流批准。

## 10. 分期与验收

| 阶段 | 交付 | 最小验收 |
|---|---|---|
| P0：执行安全基座 | MV3 Core、任务绑定 DOM、自动构建 / 加载门禁、专用 Validation Browser、空生产 response allowlist | 不需手工加载/点击；不接触日常 Profile；无认证导出/原始网络包；失败状态可见 |
| P1：策略注册表 | `scout` 的平台原生入口、版本化 DOM output contract、能力状态页、真实验证记录 | 每个平台能区分站内成功、外部发现、登录门禁、布局漂移和无结果；只以用户控制环境中的真实验证升级能力 |
| P2：受限深度 | `evidence`/`deep_dive`，详情与有界筛选、分页、展开策略 | 每个动作具备 AST、预算、语义轨迹和失败语义；无任意脚本/无界操作 |
| P3：讨论与账号 | `discussion`、`account_context`、`account_archive`、可恢复快照 | 清单与详情/评论分层；coverage/终点/部分完成可复查；不宣称不可证明的全历史 |
| P4：研究接入 | 本地 Gateway/DeepResearch 只读 artifact 工具与证据审计 | 上层保留来源 URL、策略/能力 ID、状态、降级和 artifact 引用；不能抹掉失败或越权采集 |

跨阶段的完成门槛如下：

1. 每个新增平台/目标都有独立策略、版本、构建制品校验和用户控制环境中的真实验证证据；
2. 每条结果可追溯到来源、策略版本、动作轨迹和去敏 artifact；
3. 深度、评论、账号覆盖与响应观察均有显式预算和停止条件；
4. 所有真实验证自动加载扩展并使用专用 Validation Profile；远程 CI 不访问真实平台；
5. 生产能力表只陈述当前已验证的范围、登录前提和限制；
6. DeepResearch 的结论能引用证据包，同时把未覆盖/失败来源视作不确定性而非反证。

这份规格定义的是长期产品边界。具体平台字段、页面选择器、已批准 response route 和可用性等级只能由各策略的真实验证记录决定，不能从历史 GitHub 爬虫、README 宣称或一次匿名页面访问推断。第三方平台采集仓库只作研究参考，不进入产品代码或运行时依赖。
