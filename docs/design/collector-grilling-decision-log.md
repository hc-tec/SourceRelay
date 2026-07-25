# 浏览器采集策略系统：Grill 决策账本

- 状态：Complete / Audited through 170 — 已采纳决策的权威累积记录
- 创建日期：2026-07-17
- 更新规则：每一批问题得到采纳后，先写入本账本，再进入下一批；只有显式记录的后续决策才能替代已有决策。
- 问询格式：每批恰好 5 题；每题必须完整显示 A / B / C / D 四项与推荐项；发送前执行选项完整性检查，优先使用固定文本块避免渲染吞项。
- 相关规格：[平台采集策略产品规格](platform-strategy-product-spec.md)、[数据源勘察工作流](source-reconnaissance-workflow.md)、[决策一致性与实现差距审计](collector-decision-audit.md)

本文件记录产品问询（grill）中**已经采纳**的结果。它不是待办清单，也不把尚未回答的问题或候选实现误写成既定能力。术语、架构和验收要求的完整说明以产品规格为准；本账本回答的是“为什么这样定、哪些边界不可反悔”。

## 已采纳决策总览

| 批次 | 主题 | 采纳状态 |
|---|---|---|
| 1–5 | 北极星、任务单位、失败模型、数据模型、扩展架构 | 已采纳推荐方案 |
| 6–10 | 账号归档语义、详情、身份、恢复、评论默认值 | 已采纳推荐方案 |
| 11–15 | 快照、新鲜度、详情预算、评论样本、多账号、升级权限 | 已采纳推荐方案 |
| 16–20 | 登录衔接、成熟度、动作授权、留存、原始材料 | 已采纳推荐方案 |
| 21–25 | 首个纵向样板、交互、去重、审计、蜂群分工 | 已采纳推荐方案 |
| 26–30 | 限流、访问边界、能力缺口、取消、报告引用 | 已采纳推荐方案 |
| 31–35 | 身份歧义、特殊内容、时间范围、策略降级、route 准入 | 已采纳推荐方案 |
| 36–40 | 缺少选项、筛选映射、详情抽样、预算分配、证据可读性 | 已采纳推荐方案 |
| 41–45 | 查询扩展、实体映射、快照变动、tab 接管、公开信息留存 | 41–44 采纳推荐方案；45 采纳 B |
| 46–50 | 可见表面、媒体保存、档案加密、删除快照、访问导出 | 已采纳推荐方案 |
| 51–55 | 持久登录、多账号、会话恢复、登录态验证、测试路线 | 51–54 采纳 A；55 采纳 B |
| 56–60 | 离线测试范围、实站频率、验证环境、稳定断言、只读测试 | 56 采纳 B；57–60 采纳 A |
| 61–65 | 构建门禁、实站运行位置、覆盖范围、验证证据、阻断状态 | 已采纳推荐方案 |
| 66–70 | 目标类型、外部发现、已知 URL、公开网站工厂、搜索凭据 | 已采纳推荐方案 |
| 71–75 | 分批封存、蜂群并发、补采协议、框架适配、搜索工具 | 已采纳推荐方案 |
| 76–80 | 任务启动、任务窗口、站点权限、Gateway 配对、重启恢复 | 已采纳推荐方案 |
| 81–85 | 任务创建、能力预检、人工通知、覆盖进度、证据浏览 | 已采纳推荐方案 |
| 86–90 | 一期范围、平台顺序、能力矩阵、证据复用、定时增量 | 已采纳推荐方案 |
| 91–95 | Vault 位置、容量清理、密钥恢复、schema 演进、完整性 | 已采纳推荐方案 |
| 96–100 | 第三方采集仓库、发布门槛、紧急停用、诊断、一期完成 | 96 采纳自定义方案；97–100 采纳 A |
| 101–105 | Collection Window、页面所有权、并发边界、页面状态与回收 | 已采纳推荐方案 |
| 106–110 | 两层 lease、选页顺序、用户接管、隔离恢复、页面容量 | 已采纳推荐方案 |
| 111–115 | 前台许可、Control 页、Browser Host、重启恢复、关闭语义 | 已采纳推荐方案 |
| 116–120 | 页面身份、导航 generation、弱网、lease deadline、Console | 已采纳推荐方案 |
| 121–125 | pageRole 策略、认证页、新建页、用户保留、两阶段回收 | 已采纳推荐方案 |
| 126–130 | Browser Host IPC、单写者、防重放、跨 Profile 调度、迁移 | 已采纳推荐方案 |
| 131–135 | Host 启动、扩展升级、运行 journal、崩溃语义、MVP 验收 | 已采纳推荐方案 |
| 136–140 | 包边界、零兼容迁移、错误模型、真实验证、Git checkpoint | 136、138–140 采纳推荐方案；137 采纳零兼容自定义方案 |
| 141–145 | 混合执行面、Native Messaging、交互 ticket、新 target、XHR 链路 | 已采纳推荐方案 |
| 146–150 | Strategy 部署、Action AST、ObserverBinding、证据 receipt、取消 | 已采纳推荐方案 |
| 151–155 | frame/shadow、下载、弹窗、renderer crash、坐标稳定 | 已采纳推荐方案 |
| 156–160 | 文本输入、媒体静音、外部协议、全局输入许可、用户关窗 | 已采纳推荐方案 |
| 161–165 | 公平调度、用户接管、idle stale、账号核验、安全边界 | 已采纳推荐方案 |
| 166–170 | Snapshot 恢复、状态 UX、Strategy 漂移、canary 提交、Console MVP | 已采纳推荐方案 |

## 批次 1–5：产品北极星与总体架构

### 1. 北极星输出

系统首先交付一次性的、跨平台、可核验的**研究证据包**，而不是先做通用爬虫、持续监控仪表盘或预先全量入库。证据包必须包含来源、策略、范围、状态、时间与缺口，以供后续 DeepResearch 使用。

### 2. 任务最小单位

任务以“研究问题 + 决策语境 + 平台范围 + 所需证据 + 预算”为单位，不能退化为“关键词 + 网站”。系统要理解用户是在找广度、关键材料、账号内容、讨论反例还是趋势快照。

### 3. 失败与部分完成模型

每个平台、每个策略独立报告状态。`partial`、`authentication_required`、`verification_required`、`layout_changed`、`rate_limited`、`route_unapproved` 等都是有意义的结果；禁止静默降级，尤其禁止把外部搜索伪装为平台站内搜索成功。

### 4. 数据与保存模型

一期采用本地、去敏、`raw-first + schema-on-read` 的证据包与薄索引，不强制先建设完整关系数据库。这里的 raw 是可读内容快照、安全字段投影与来源证据，不是 Cookie、Token、HAR、请求头/体、完整响应包或浏览器 Profile。第 45–50 题进一步明确：“去敏”主要删除认证材料、隐藏状态和未授权数据，不删除任务页面公开可见的身份与联系字段；这些公开字段进入加密长期档案。

### 5. 扩展架构

采用一个最小权限的 MV3 **Collector Core**，加仓库内静态注册、代码审查、版本化并经真实平台验证的平台策略包。策略包不是运行时下载插件，不能直接获得特权浏览器 API、认证状态、任意网络或 Gateway 能力。早期“fixture 测试的平台策略包”措辞已被第 55–56 题覆盖；fixture 不再属于最终验证路线。

## 批次 6–10：账号语料库的真实性语义

### 6. “某博主全部笔记”的定义

只能承诺“在采集时刻、当前登录状态和声明范围下，页面可见且可遍历的内容集合”。不得宣称获得私密、删除、算法隐藏、访问受限或不可验证历史边界的内容；没有明确终点时必须返回部分覆盖或覆盖未知。

### 7. 账号归档的默认深度

先建立完整的内容卡片目录 / inventory，再由明确范围升级为详情物化。目录完成率、详情完成率、评论完成率是三条独立覆盖维度，不能互相冒充。

### 8. 账号身份

以规范主页 URL 与平台稳定账号 ID 为主键；昵称、头像、简介只用于展示和人工核验。不得只以显示名作为可恢复语料库的身份依据。

### 9. 长历史与中断恢复

账号归档是可恢复快照任务。必须保存已访问 ID、去重键、分页 / 滚动状态、停止条件、部分完成原因与覆盖账本；重启后不能把已完成目录重新当作未知任务。

### 10. 评论默认行为

账号归档默认不采集评论。评论采集只能作为对选中内容显式发起的独立扩展，且必须记录排序、页数、层级和停止条件。

## 批次 11–15：新鲜度、预算与升级控制

### 11. 快照与增量

每次账号采集生成不可变本地快照。后续任务可显式创建增量比较（新增、删除、变化），但不得原地覆写旧证据或把“最新状态”冒充历史事实。

### 12. 详情物化预算

目录枚举后，默认通过透明规则与预算物化重点详情；全量详情必须显式确认，并展示预计数量、平台、时间与动作成本。DeepResearch 不得自行无限扩大详情范围。

### 13. 评论采样规则

一旦用户明确要求评论，任务必须声明排序、目标内容数、评论页数与回复深度；例如“热门前两页一级评论、最多一层回复”。不得默认无限滚动或把样本称作全量讨论。

### 14. 多账号比较

每个账号独立建立身份、目录、覆盖账本与失败状态，再由比较层做横向分析。不得合并分页、共享完成率或用一个总进度掩盖某个账号的覆盖不足。

### 15. DeepResearch 的补采权限

DeepResearch 可以提出结构化补采建议，但每一次详情、评论、翻页、响应观察或预算升级都必须显示新增能力、范围与成本，并等待用户批准后执行。

## 批次 16–20：登录、授权与本地材料边界

### 16. 登录衔接

遇到需要登录的页面，任务进入 `needs_user_action` / `authentication_required`。用户仅在可见的专用任务 tab 中自行登录，然后显式继续；系统不得索要、读取、导出或处理密码、Cookie、二维码、验证码、Token 或短信。

### 17. 策略成熟度

只有经过真实低频验证的策略才可作为正式研究证据能力。第 55–56 题取消 `fixture_verified` 作为最终成熟度；当前生命周期采用 `draft`、`build_ready`、`live_anonymous_verified`、`live_authenticated_verified`、`suspended`。`build_ready` 只表示制品可构建和加载，不表示任何平台能力已经验证。

### 18. 动作授权粒度

授权以任务计划中的动作类别与预算为粒度：原生搜索、受限筛选 / 翻页 / 加载、详情、评论、响应观察等都应可见。无需为每一次安全点击打断用户，但禁止一次安装后永久获得任意浏览器操作权。

### 19. 本地留存

每个任务默认保留独立、去敏、不可变且可审计的本地证据包，直至用户主动删除；任务可额外选择“报告后不留存”。一期不上云、不默认入数据库、不跨设备同步。

### 20. 页面与媒体材料

默认保存去敏后的可读文本快照、有限结构投影、规范 URL、采集时间、策略版本与完整性信息。完整 HTML、图片、视频、附件或其他媒体只在任务明确需要、策略允许且安全边界满足时保存；不保存认证信息、时效签名链接、原始网络包或无边界媒体下载。

## 批次 21–25：首个样板与蜂群边界

### 21. 首个纵向平台样板

优先以 **B 站**验证一条完整但有界的纵向链路：发现 / 搜索卡片 → 已知内容详情 → 有限讨论样本。此选择用于验证执行器与证据合同，不等于已承诺 B 站账号归档或完整评论能力。

### 22. DOM 交互执行器

交互只执行策略声明的受限动作图。每一步都有前置页面状态、成功信号、最大次数与明确终态；遇到未知页面、布局漂移、无进展、登录或验证状态立即停止，不能让模型自由点击或无限重试。

### 23. 去重与相似内容

同一平台优先按稳定内容 ID 或规范 URL 去重，并保留重复映射、原始排名、页面位置与来源。跨平台文本相似不自动合并，以免把独立平台证据压缩成一条“相同内容”。

### 24. 最小审计证明

每个任务至少保留任务计划、能力锁定、平台 / 策略状态、语义动作轨迹、覆盖账本、证据索引和文件校验值。不得以 HAR、Cookie、完整浏览器录像或私密 trace 代替安全审计。

### 25. DeepResearch 蜂群分工

采集协调器是浏览器任务、预算、页面 lease 与覆盖账本的单一所有者。分析 Agent 只能读取稳定 artifact；Citation / Coverage Auditor 独立校验来源、范围与结论强度。多个 Agent 不得争抢同一账号分页或直接控制浏览器。

## 批次 26–30：执行保守性与报告可信度

### 26. 并发、频率与退避

按平台保守限流，每个平台由单一执行队列控制；跨平台可以并行，但平台内的分页、账号归档与评论线程不通过多 tab、代理轮换、账号池或增加并发绕开限制。限流后退避并如实报告。

### 27. 访问边界

只读取当前登录状态下、页面正常呈现、任务明确授权的可见内容。私密、删除、仅粉丝、付费、地区 / 年龄限制、验证码与风控等边界均应停止并记录原因；空 DOM 绝不等同于无内容。

### 28. 尚无能力的请求

若平台 × 目标没有可用策略，应明确报告能力缺口。用户可显式启动不产出正式证据的“验证运行”，用于确认页面状态、选择器、失败语义或候选 response route；禁止静默转用外部搜索或未知爬虫路线。

### 29. 取消与预算终止

取消、关闭任务 tab、预算耗尽或策略停止时，应停止新的浏览器动作，保留已完成且去敏的证据与覆盖账本，并标记 `cancelled_partial` 或 `budget_exhausted_partial`。不得假装完整，也不得无说明地丢弃已有可审计成果。

### 30. 报告与引用规则

每个关键结论须关联具体证据、规范 URL、平台、策略版本、采集时点与覆盖等级。报告必须区分“已观察”“合理推断”“未知 / 未覆盖”；语言流畅不能替代来源级引用或完整性说明。

## 批次 31–35：页面语义与策略演进

### 31. 账号身份歧义

当昵称、搜索结果、主页 URL、头像或显示名不一致时，以规范主页 URL 与平台稳定账号 ID 为准；昵称等信息只作辅助核验。存在无法消解的歧义时暂停任务，等待用户确认，不能按热度、粉丝数或模型猜测自动选择账号。

### 32. 特殊内容类型

置顶、转发 / 搬运、合集、广告、直播回放、已删除占位等内容必须保留独立类型与状态。任务显式决定它们是否纳入正文集合；默认不得混同为普通原创历史内容，也不能交由分析阶段事后猜测。

### 33. 时间范围与排序覆盖

保留平台实际呈现的排序、筛选和可见时间字段。只有页面能够验证地满足用户指定日期区间或排序时，才可宣称范围覆盖；否则应使用 `bounded` 或 `coverage_unknown`，不得用无界滚动或外部收录时间伪造时间完整性。

### 34. 策略版本、漂移与降级

策略必须版本化，并经过构建门禁与真实低频验证后才可升级。页面结构漂移、选择器失效或实站验证失败时，策略立即降为 `suspended`，不得运行时下载任意选择器 / JavaScript、静默回退到外部搜索，或继续显示为“已支持”。早期 fixture 回归要求已被第 55–56、61–65 题覆盖。

**用户补充、待下一批细化：**“期望的筛选、排序、内容类型或页面入口选项在当前页面不存在”必须成为独立问题。它不能被默认为 `no_results`、普通 `layout_changed` 或自动替换为近似选项；下一批将决定其专门状态、可否建议替代项以及继续 / 暂停规则。

### 35. response projection route 准入

候选 JSON response 不能因“被观察到”就成为正式能力。正式准入需要低频 metadata-only 确认、字段价值评估、精确 `origin + pathname`、代码审查、策略绑定、版本记录和用户控制环境中的真实验证；涉及登录态必须获得用户明确批准。按照第 46 题，长期档案只保存已在页面正常呈现或通过批准只读动作可见的信息；response 中未呈现字段只能用于短时控制、游标或状态判定，不能作为长期证据字段。早期独立 fixture 要求已被第 55–56 题覆盖。禁止自动 allowlist、请求重放、签名复刻和私有 API 直调。

## 批次 36–40：计划映射、预算与证据可用性

### 36. 页面缺少期望选项

用户要求的筛选、排序、内容类型或页面入口在当前页面不存在时，返回专门的 `option_unavailable` 状态。系统不得自动选择近似项；可以展示策略已经验证的替代选项，但必须等待用户明确确认后才能修改计划。该状态不能被归类为 `no_results`、普通 `layout_changed`，也不能通过无界刷新或滚动寻找隐藏入口。

### 37. 平台筛选意图映射

用户表达平台无关的研究意图，例如“只要视频”“排除转发”“按最新”或“限定图文笔记”。平台策略只把这些意图映射到已经验证的真实页面选项，并在计划与证据包中记录实际映射、生效页面状态和未映射项；用户无需提供 CSS selector、XPath 或点击脚本，模型也不得临场猜测控件。

### 38. 有限详情预算下的选择

详情物化采用透明的覆盖优先策略：先满足研究相关性，再在作者、时间、内容类型、观点方向和互动层级上做有界分层抽样。计划必须保留选择规则、已选原因、未选原因和预算消耗；不得永远只取排名最高、互动最高，或让 DeepResearch 无边界选择。

### 39. 跨平台预算分配

任务设总预算，同时为每个平台保留独立的页数、详情数、评论数、动作数和时间上限。一个平台未使用的预算不能静默转移给另一个平台；任何预算重分配都要在计划中展示并获得用户明确批准。不得由最容易返回数据的平台吞掉整个研究任务的资源。

### 40. 人与 AI 均可读的证据包

本地证据包采用可直接阅读的 Markdown / 文本快照，加 JSON / JSONL 索引、manifest、coverage ledger、相对路径与校验值。人工可以直接打开复核，DeepResearch 可以批量读取；证据包不依赖私有数据库、未来 UI 或专有二进制格式。

## 批次 41–45：查询、实体、快照一致性与公开信息留存

### 41. 查询词扩展

系统可以把用户输入扩展为同义词、别名、旧称、缩写、中英文写法和消歧词，但完整查询集合、每个查询的来源与目的必须先出现在采集计划中。用户批准计划后才能执行；每条发现证据必须记录其来源查询。禁止在运行中静默加入热门词，也禁止把外部搜索查询冒充平台内部搜索。

### 42. 跨平台实体与账号映射

同一个人、品牌或机构的跨平台关联使用显式实体记录表示，并分别保存各平台规范主页 URL、稳定账号 ID 与核验依据。系统可以提出关联建议和置信度，但歧义必须由用户确认；平台账号语料库继续保持独立的身份、分页与覆盖账本。禁止仅凭相似昵称、头像、文风或人脸自动合并。

### 43. 长任务中的页面内容变动

账号归档和长时间翻页以 `captured_at`、稳定内容 ID、分页 / 滚动边界与去重账本建立快照边界。插入、删除、置顶重排、重复卡片或游标不连续都要进入异常记录；无法证明遍历连续性时返回 `partial` 或 `coverage_unknown`。不得静默重启后把两个时间点的页面状态拼成一个“完整快照”。

### 44. 用户接管或导航任务 tab

用户在专用任务 tab 中改写地址、点击到其他页面、关闭页面或主动接管时，当前 document / stage lease 立即失效，任务暂停为 `task_context_changed`。已完成的安全证据继续保留，用户可以选择按新页面重新规划、回到原任务继续或取消。禁止在未知页面上沿用旧策略、旧 route 或旧授权，也不锁死浏览器阻止用户接管。

### 45. 页面公开可见信息的长期保存

本题明确采纳 **B**，作为对“默认只保存最小身份字段”的显式修改：只要信息在任务合法进入的页面上公开可见，就保存进长期账号档案，包括公开显示的昵称、账号 ID、主页链接、简介、地区、职业、邮箱、手机号以及其他页面公开字段。保存仍受第 19 题的本地留存与用户主动删除规则约束。

该决定不授权读取隐藏 DOM 状态、页面内部状态、Cookie、Token、请求头 / 体、私密内容或访问受限内容；不授权通过搜索引擎、数据经纪服务、人脸识别或模型推断补全页面未公开的信息；也不授权自动联系、营销或发布。公开图片、视频、附件等二进制媒体是否属于“全部保存”，以及这些长期档案的访问、加密、导出和源内容删除后的处理，将在下一批单独决定。

## 批次 46–50：公开信息长期档案的具体边界

### 46. “页面公开可见”的采集表面

公开可见信息包括任务合法进入的页面中已经渲染、用户可以看到的文本、字段和链接，以及通过任务已授权的展开全文、切换内容标签、加载更多等只读操作后正常显示的内容。它不包括隐藏 DOM、页面 JavaScript 内部状态、未呈现给用户的 response 字段、浏览器存储、Cookie、Token、请求头或请求体。

### 47. 公开图片、视频与附件

默认保存公开媒体的规范引用、可见说明、公开元数据、缩略图或必要截图。原始图片、视频、音频和附件只有在任务明确要求、预算允许且来源可正常访问时才下载到本地。禁止保存需要认证重放的临时媒体请求、短期签名地址或受限媒体；第 45 题的“全部公开信息”因此不自动等同于下载全部二进制媒体。

### 48. 含联系方式的长期档案保护

长期账号档案默认加密保存，解密密钥绑定本机用户或操作系统凭据存储。浏览器扩展只提交任务产物，不持有长期主密钥；只有明确配对的本地档案管理组件和用户显式发起的导出可以读取完整档案。不得以普通明文目录、自动云同步或任意本地 Agent 的全局读取权作为默认方案。

### 49. 源信息修改、删除或转为不可见

保留带 `captured_at`、来源和校验值的不可变历史快照。后续重新验证时新增 `changed`、`removed` 或 `no_longer_visible` 状态，不静默覆盖或删除旧证据。用户可以按账号、字段或任务显式执行永久清除；系统不得把历史快照继续描述为来源的当前状态。

### 50. 长期档案的访问与导出

默认仅当前本机用户和明确配对的本地研究组件可访问长期账号档案。每次导出必须由用户显式发起，并携带来源、采集时间、字段范围、覆盖说明、隐私提示和校验 manifest。默认不自动上传、分享、发布、营销触达，也不向任意 Agent 或插件开放全库访问。

## 批次 51–55：持久登录、多账号与真实平台测试

### 51. 持久化登录状态

真实采集任务使用专用、可见、持久化的 Collection Browser Profile。用户在需要时自行登录，浏览器正常保存登录状态；系统不得导出 Cookie、Token 或 storage state。Collection Profile 与用户日常 Chrome / Edge、Playwright 临时测试 Profile 和 BrowserWing Profile 分离。

### 52. 同一平台多账号隔离

每个平台账号使用独立 Collection Browser Profile 或等价隔离容器。任务显式绑定“平台 + 账号身份 + Profile”，执行前核验当前页面显示的账号身份。不同账号不得共享 Cookie、缓存、任务 tab、覆盖账本或 response route lease，默认不在同一平台内并发运行多个账号任务。

### 53. 登录会话失效后的恢复

登录状态过期或出现扫码、验证码、安全确认时，任务暂停为 `session_expired` 或 `authentication_required`，当前 stage / document lease 失效。用户在可见任务页面自行重新登录；系统重新核验平台、账号和页面角色后，从覆盖账本中的安全检查点恢复。禁止保存密码、自动扫码、处理验证码、提取刷新 Token 或伪报 `no_results`。

### 54. 需要登录的策略验证

登录态策略使用独立的 `authenticated validation run`。运行前展示平台、页面角色、动作、预算和拟验证字段，由用户显式批准并在专用 Collection Profile 自行登录。验证只记录去敏 DOM 结构结论、动作状态、route metadata、字段价值与失败语义，不保存认证材料，也不自动成为正式研究证据。策略须通过相应审查后才能升级为 `live_authenticated_verified`。

### 55. 平台策略测试改为真实平台路线

本题明确采纳 **B**：取消以离线页面 fixture 作为平台行为验证主路线，平台策略测试直接访问真实平台，以获得最贴近生产页面、登录墙、风控和改版状态的结果。这一选择覆盖此前将 loopback 页面 fixture 作为平台策略主要验证层的推荐方向；现有实现暂不改动，直到 grill 完成。

第 56 题随后明确取消全部离线测试；第 61 题只保留产生可运行扩展所必需、但不称为测试的编译、bundle、MV3 manifest、脚本存在性、自动加载和权限清单构建门禁。真实测试的触发、账号、断言与只读范围由第 57–65 题确定。

## 批次 56–60：全实站测试路线的进一步边界

### 56. 取消全部离线测试

本题明确采纳 **B**：取消所有离线测试，不仅取消平台页面 fixture，也取消以离线测试形式运行的类型、权限、脱敏、URL 规范化、预算、状态机和敏感字段反例测试；测试活动全部通过访问真实平台完成。该决定进一步覆盖第 55 题中“是否仍保留纯离线安全测试”的待定项。

较晚的第 139 题对本题作出明确修订：fixture、fake Gateway、fake XHR 和合成平台页面继续禁止冒充平台验证；但纯 reducer、schema validator、canonicalization 和预算计算可以做单元测试，IPC/浏览器集成必须使用真实本地执行面，平台能力必须使用真实站点。

由于扩展至少需要经过编译与打包才能在浏览器中运行，编译器报错、构建失败、manifest 无法加载等是否属于“测试”尚未定义；下一批将区分“测试”与“产生可运行制品所必需的构建门禁”，不在本条中自行推断。

### 57. 真实平台测试触发频率

真实平台测试采用低频、事件驱动方式：策略、选择器、页面状态分类或 route 修改后；策略新版本发布前；长时间未验证；用户报告页面变化时运行。涉及登录态的测试必须由用户显式启动。不得在每次普通提交时访问所有平台，也不做持续高频探测。

### 58. 真实平台测试账号与 Profile

优先匿名验证公开能力。必须登录时使用专用 Validation Profile，并绑定用户批准的验证账号；它与日常浏览器、正式 Collection Profile 和其他自动化环境分离。用户在可见页面自行登录，系统不得把账号凭据放入远程 CI。只有一个合法账号时，验证任务和正式证据任务仍使用不同运行记录，避免污染覆盖账本。

### 59. 真实平台测试的稳定断言

测试验证稳定不变量与能力合同：正确平台入口、登录 / 验证 / 无结果 / 限流 / 漂移状态、规范 URL 或稳定 ID、预算执行、只读边界、敏感信息不泄露、覆盖账本和明确终态。实站结果是带时间戳的能力证据，不硬编码具体标题、账号、评论、条数或排名；不得只靠截图和模型主观判断。

### 60. 真实平台测试保持只读

真实平台测试和正式采集任务均禁止点赞、关注、收藏、评论、私信、发布、投票、订阅、上传等写操作。允许的动作仅包括搜索、已验证筛选与排序、翻页、滚动、展开全文、打开详情、展开评论和读取公开可见内容。登录由用户自行完成，不属于测试自动化写操作。

## 批次 61–65：全实站测试的可执行治理

### 61. 保留必要构建门禁

尽管取消全部离线测试，仍保留不被称为“测试”的构建门禁：TypeScript 必须能够编译、bundle 必须生成、manifest 必须是有效 MV3、声明脚本必须存在、浏览器必须能够自动加载扩展，最终制品的权限清单必须与已批准产品配置一致。平台功能、脱敏输出和页面状态仍由真实平台验证；构建门禁不得重新包装平台 fixture 或模拟响应。

### 62. 真实验证仅在用户控制的本地环境运行

真实平台验证只在用户本机或用户明确控制的验证机器上运行。系统自动启动可见 Validation Browser、自动安装待测扩展、执行只读步骤并保存去敏结果；需要登录时由用户自行完成。远程 CI 只可生成构建制品，不访问真实平台、不持有平台登录态，也不得使用共享测试服务器或用户日常浏览器 Profile。

### 63. 变更影响范围加轮换回归

每轮必须验证本次改动涉及的平台与策略；Collector Core 改动时至少选择一个公开能力做核心 smoke；其他平台按计划轮换验证；正式里程碑发布前执行完整能力矩阵验证。未在本轮验证的策略保留原 `last_verified_at`，不得冒充刚刚通过。禁止每次普通改动全量访问所有平台，也不能只验证 B站便推断其他平台成功。

### 64. 去敏的真实验证证据

真实验证保存本地、加密、去敏的 capability validation record：平台、策略 ID / 版本、验证时间、页面角色、匿名 / 登录类别、只读语义动作、终态、失败原因、规范 URL / 稳定 ID 格式结果、安全页面摘录或必要截图、权限与敏感字段扫描结果、制品校验值。禁止保存 Cookie、Token、密码、验证码、Profile 路径、完整 HAR、完整请求头 / 体或无边界页面内容。

### 65. 限流、验证码和平台故障是未决验证

限流、验证码、网络故障或平台临时不可用分别标记为 `inconclusive`、`rate_limited`、`verification_required` 或 `temporary_platform_failure`，不得直接判为 pass 或 fail。当前验证立即停止，不使用高频重试、代理轮换或账号切换绕过；只安排低频重试。只有不同时间的多次独立验证持续复现策略失效，并排除登录、限流和平台故障后，才将策略降为 `suspended`。

## 批次 66–70：数据源与任务入口路由

### 66. 三类显式任务目标

采集目标明确分为 `keyword_query`、`account_target` 和 `known_url`，一个研究任务可以组合三类目标。关键词用于平台内部发现；账号目标用于身份确认后的目录、详情或评论子任务；已知 URL 用于直接读取具体内容。三者分别选择策略、预算、覆盖账本和完成语义，不能把账号归档或已知 URL 伪装成关键词搜索。

### 67. 外部搜索只承担外部发现

`.env` 提供的外部搜索服务只产生 `external_discovery_only` 候选，每条记录包含 provider、query、requested_at、目标域名和 canonical URL。候选可进入 `known_url` 详情读取，或提示用户启动相应平台内部搜索验证；它永远不计入 `native_platform_search` 的成功率和覆盖率，不替代登录后的筛选、排序、账号目录或评论能力。

### 68. 已知 URL 优先直接读取

用户提供具体文章、视频、帖子、问答或笔记 URL 时，先规范化 URL、识别平台和页面角色，然后执行 `known_url / detail_read`。只有任务明确要求时才扩展作者上下文、相关搜索、评论样本、媒体下载或同主题证据。禁止为读取一条已知内容先运行无关全平台搜索或默认归档作者全部历史。

### 69. 长尾公开网站能力工厂

新闻、政府公开站点和长尾中文网站使用共享的公开网站能力工厂，但每个站点仍有最小、可验证契约：规范域名与入口、公开搜索 / 栏目 / 已知 URL 能力、页面角色、public HTML / visible DOM 正文规则、分页与失败状态、规范 URL / 时间 / 来源、最近真实验证时间。通用正文提取器可以共享，入口、状态和覆盖承诺必须按站点验证；默认不启用登录、response observation 或复杂交互。

### 70. `.env` 搜索凭据归本地 Gateway

搜索服务 API Key 只由本地 Gateway / Search Adapter 读取和使用。浏览器扩展、页面脚本、平台策略和证据包均不得接收凭据；DeepResearch 只能调用注册后的本地搜索工具，不能读取 `.env`。搜索证据保存 provider、query、requested_at、canonical_url 和 `external_discovery_only` 状态，不保存 Key、Authorization 或原始请求头。

## 批次 71–75：DeepResearch 与蜂群接入

### 71. 按阶段封存证据批次

采集过程可以按 discovery、detail、discussion、account inventory 等阶段生成已封存、校验完成的不可变证据批次。DeepResearch 可提前读取已封存批次，但不得读取仍在写入的临时文件，也不得把阶段覆盖写成最终覆盖。最终报告发布前，Coverage Auditor 必须读取最终 coverage ledger，检查后续失败、取消、缺口和补采结果。

### 72. 账号枚举单一所有者，详情有界并发

账号目录枚举由单一 Enumeration Coordinator 独占，只有它能滚动主页、推进分页游标和判断终点，并持续写入去重后的稳定 item ledger。已稳定入账的条目可交给有界 Detail Workers 并发读取；评论由显式 Discussion Workers 对选中条目执行。平台级并发、动作和时间预算继续生效，由 Coverage Auditor 对目录、详情、评论和失败数量进行对账。

### 73. 结构化补采协议

DeepResearch 只能生成结构化 `CollectionGapRequest`，说明当前证据缺口、补采理由、平台与目标类型、查询 / 账号 / URL、所需证据目标、预算、登录 / 交互 / response observation 前置条件、预期证据和不补采时的报告限制。用户批准后由 Collector Planner 重新检查能力和权限；DeepResearch 不直接提升浏览器 lease，也不能用模糊的“再多搜一点”自动扩容。

### 74. DeepResearch 框架保持可替换

DeerFlow、天工式方案或其他蜂群框架通过稳定适配边界接入：读取 ResearchTask、EvidencePackage、coverage ledger 和 citation index，输出报告、矛盾地图、主题聚类、时间线及 CollectionGapRequest。浏览器扩展、平台策略、Collection Profile、搜索凭据和 artifact writer 留在独立 Collector / Gateway 层；不得把平台采集逻辑复制进每个框架或让框架持有浏览器会话。

### 75. 禁用框架自带搜索

默认禁用或不注册 DeepResearch 框架内置的 Google、Bing、Tavily、Serper 等搜索工具。分析侧只获得本地 Gateway 的 Search Adapter、EvidencePackage Reader、Citation / Coverage 工具和 CollectionGapRequest Writer。新增搜索服务必须先接入本地 Gateway 的统一来源契约，所有结果继续标为 `external_discovery_only`；Agent 不得私自联网或安装未知搜索插件。

### 架构澄清：产品始终是浏览器扩展模式

产品执行面是 **Collector Core 浏览器扩展 + 持久化 Collection Browser Profile**。平台正常登录状态天然由浏览器 Profile 持有，扩展直接运行在该已登录上下文中；产品不设计 Cookie 管理、导入、导出、注入或跨进程分发子系统。DeepResearch、Gateway 和平台策略都不需要接触 Cookie。后续讨论统一围绕 Profile、扩展任务和页面 lease，不再把 Cookie 当作待建设能力反复询问。

## 批次 76–80：浏览器扩展产品控制面

### 76. 本地控制面启动扩展任务

用户在本地 Research Console / Gateway 创建研究任务并批准采集计划，控制面随后把结构化任务发送给已配对扩展。扩展自动创建任务页面、导航平台入口、执行已批准只读策略、汇报登录与失败状态并交付去敏证据。扩展图标或侧边栏仅用于状态、暂停、继续、取消和紧急停止，不是每次任务的手工必经入口；网页和 DeepResearch Agent 不得绕过控制面直接调用浏览器 API。

### 77. 专用、可见的 Collection Window

每个采集任务使用专用、可见的 Collection Window，tab 明确归属于 task、platform、account 和 stage。扩展不在用户已有日常 tab 上自动执行动作，也不默认使用不可见 headless 页面。用户可观察或接管；手工导航触发第 44 题的 `task_context_changed`。任务结束后由用户选择关闭窗口、保留页面复核或继续新阶段，tab 和窗口数量始终受预算控制。

较晚的第 101 题覆盖本题的窗口粒度：现在每个 Collection Profile 使用一个持久可见窗口，任务专用性由 PageLease/StageLease 保证，不再为每个任务创建 OS 窗口。

### 78. 按策略请求精确站点权限

Collector Core 安装时保持最小权限。用户首次启用平台或站点策略时，扩展按照经过审查的策略声明请求精确 optional host permission；计划展示域名、只读能力、登录要求、详情 / 评论 / response observation 范围和撤销方式。禁止 `<all_urls>`、`*://*/*`、未绑定策略的宽泛 host 权限，也不拆成多个相互竞争的高权限平台扩展。

### 79. Gateway 与扩展显式配对

用户显式完成一次本地配对。协议只允许 loopback，Gateway 实例具有固定身份；扩展保存配对授权而非平台凭据。每个任务携带 task ID、短时 challenge / nonce 和能力计划摘要，扩展再次验证平台、策略、预算与动作类别。网页不能直接调用 Gateway，新 Gateway 需重新批准，用户可随时撤销配对和中止任务。禁止任意 localhost 客户端、公网 WebSocket 或页面 `postMessage` 充当控制端。

### 80. 重启后以新 lease 恢复

Collection Browser Profile 正常保留浏览器登录状态；Gateway / artifact writer 持久保存计划、item ledger、覆盖账本、已封存批次和安全检查点。重启后旧 tab、document 和 stage lease 全部失效；系统展示可恢复任务，用户确认后创建新 Collection Window 和新 lease，重新核验平台、账号、页面角色和登录状态，再从稳定 ledger 恢复。禁止无提示后台续跑、删除全部成果或尝试恢复旧 document lease。

较晚的第 114 题将“重启”拆分：仅 Gateway 重启时 Browser Host/Chromium 和 idle 页面所有权继续存在，但 active lease 失效；Browser Host/Chromium 换代时才使整个 browser session 和旧 target 身份失效。两种情况都不恢复旧平台动作。

## 批次 81–85：用户任务与证据复核体验

### 81. 自然语言任务加研究档案和高级设置

任务创建采用“自然语言研究问题 + 决策语境 + 平台范围 + 目标对象 + 研究档案 + 可展开高级设置”。用户从 `scout`、`evidence`、`deep_dive`、`discussion`、`account_archive` 选择主要档案；Planner 生成可审阅计划，展示查询扩展、策略、动作、预算、登录要求、站点权限、保存范围和缺口。高级设置可修改筛选、页数、详情、评论、时间、账号和媒体，不要求普通任务从 JSON / YAML 开始，也不允许隐藏计划直接执行。

### 82. 执行前 capability preflight

执行前必须生成平台 × 目标的 capability preflight，逐项展示 strategy ID / 版本、maturity、`last_verified_at`、匿名 / 登录 / 用户确认要求、采集机制、精确站点权限、预算与预计动作、已知缺口、正式 / 实验 / 不支持状态以及 `external_discovery_only` 标记。用户批准后才执行；不支持目标不得静默替换，实验验证必须单独启动。

### 83. 只在可操作阻塞和权限变化时通知

用户通知限于 `authentication_required` / `session_expired`、`verification_required`、`option_unavailable`、新站点权限、详情 / 评论 / 媒体 / 预算升级、`task_context_changed` 和带关键缺口的完成状态。通知展示 task、platform、account、阻塞原因、所需操作和继续范围，可出现在 Research Console 与本地桌面通知，但不泄露页面敏感内容。普通翻页、滚动、详情打开和成功采集不逐项打断。

### 84. 多维覆盖账本替代单一进度百分比

进度按平台与证据维度展示 planned、executed、captured、deduplicated、inventory enumerated、details materialized、discussions sampled、skipped by policy、unavailable、blocked 和 unknown。只有存在可靠分母时才显示该维度百分比，同时展示停止原因、时间范围、页数、唯一内容数和完整性等级。任务级使用 `completed`、`completed_with_gaps`、`partial`、`needs_user_action`、`blocked`、`cancelled` 等真实状态，不用一个“100%”掩盖详情或评论缺口。

### 85. 本地 Evidence Explorer

提供以来源与任务为中心的 Evidence Explorer：按平台、账号、查询、时间、内容类型、策略和状态筛选；查看可读快照、安全投影、规范 URL、采集时间、策略版本与覆盖条件；查看排名、重复映射及详情 / 评论关系；比较账号快照变化；从报告跳转 evidence item，再打开当前公开来源；查看 changed、removed、no_longer_visible 与历史版本；显式导出或删除。Explorer 读取本地加密档案，不依赖云端数据库或浏览器缓存。

## 批次 86–90：一期范围与平台能力路线

### 86. 一期只做按需 Research Task

一期只做好用户明确创建、预检并批准的按需任务，不同时建设后台长期采集、自动定时搜索、实时预警、无边界博主更新追踪或预先全量入库。优先把一次任务的能力、登录、覆盖、证据、恢复和真实验证做可靠，避免持续监控反过来掩盖基础采集不可信。

### 87. B站样板后的平台推进顺序

先完成 B站纵向样板与通用 Collector Core；随后以小红书 `account_archive` 验证账号身份、可见笔记目录、恢复、详情物化和显式评论；再推进知乎平台内部搜索、已知问题 / 回答 / 专栏详情与作者上下文；之后推进微博登录搜索、账号目录、单帖详情与评论；最后扩展公众号已知文章、外部发现边界及新闻 / 政府公开站点能力工厂。每个平台的搜索、账号、详情和评论独立验收，既不等待“全平台完成”，也不同时铺开大量半成品。

### 88. 平台支持必须展示能力矩阵

产品不得使用单一“已支持某平台”标志。至少按 native keyword search、account context、account archive、detail read、discussion sample、filters / sort / pagination、response projection、anonymous / authenticated、maturity 和 `last_verified_at` 独立展示。某平台已知 URL 详情可用，不代表其站内搜索、账号归档或评论可用。

### 89. 旧证据可见地复用或刷新

Planner 先查找匹配的本地封存证据并展示来源、`captured_at`、策略版本、登录类别、覆盖范围、完整性、变化状态和匹配程度。用户或计划可以选择直接复用、复用并补采、全部刷新。旧证据不得自动当作当前事实，引用必须保留原采集时间；重新采集也不覆盖旧快照。

### 90. 定时增量放在第二阶段

只有按需任务已经证明 Profile 登录、账号身份、分页终点、快照 / 增量、阻塞暂停、artifact 加密和通知可靠后，才建设定时增量。定时任务仍是一次次有边界、不可变的 Research Task，由用户配置平台、目标、时间、预算和保存策略；遇到登录、验证码、权限变化或 suspended 策略即暂停并通知，不允许 DeepResearch 自行后台刷新。

## 批次 91–95：本地证据 Vault 生命周期

### 91. Gateway 管理专用加密仓库

本地 Gateway / Artifact Vault 管理专用加密证据仓库。首次设置提供操作系统用户数据目录中的默认位置，并允许用户选择其他本地磁盘目录；系统保存 vault 配置和逻辑 artifact ID，报告与证据使用相对路径，不硬编码机器绝对路径。扩展只通过已配对 Gateway 提交产物，网页不能决定写入路径；档案不默认进入 Git 仓库、Downloads、浏览器缓存或云存储。

### 92. 显式容量预算与清理

Preflight 展示并限制每任务、每平台、原始媒体、单文件和长期账号档案容量，同时显示 vault 剩余空间与预计新增量。接近上限时暂停大文件，允许降级为文本、元数据和缩略图。不可变证据不自动删除；用户在 Evidence Explorer 按任务、账号、时间或媒体类型显式清理，清理动作进入审计记录。

### 93. 操作系统保护主密钥并支持用户恢复材料

主密钥由本机操作系统凭据存储保护，用户可显式创建加密恢复包或恢复密钥。恢复材料只由用户主动生成，不包含明文档案，不写入仓库、`.env`、扩展或普通日志；若未创建恢复材料，产品明确提示系统损坏可能导致无法解密。迁移电脑时重新配对 Gateway 和扩展，不迁移旧页面 lease，也不依赖第三方云托管主密钥。

### 94. 版本化 schema 与不可变原始证据

Task、manifest、evidence envelope、coverage ledger 和索引均带 `schemaVersion`。原始封存证据保持不可变；新版 Reader 通过显式迁移器读取旧版本，需要新结构时创建派生索引或新版本包，并记录原文件、迁移版本、时间和校验关系。未知或不兼容 schema 必须停止分析，禁止批量原地改写历史文件或让 AI 猜字段继续。

### 95. 哈希 manifest 与损坏隔离

每个封存批次生成包含相对路径、大小、哈希、schemaVersion 和封存时间的完整性 manifest，并在封存、Explorer 打开、DeepResearch handoff、导出、恢复和迁移时验证。损坏文件标记 `corrupted` / `integrity_failed`、隔离、更新覆盖账本并禁止交给分析；允许重新采集来源或重建派生索引。不得静默忽略、让模型猜缺失内容或删除整个 vault。

## 批次 96–100：依赖边界、发布治理与一期完成

### 96. 第三方平台采集仓库仅作参考，不接入产品

MediaCrawler、XHS-Downloader、`xhs`、my-collection-skills 及各种微博 / 知乎传统采集仓库只用于调研平台页面、已知场景、Issue 中的失效模式和产品需求，不能复制代码、集成依赖、运行其爬虫、复用其 Cookie / 签名 / 私有 API 链路，也不能成为正式策略的运行时后端。

正式平台采集路线完全转为 **Collector 浏览器扩展运行在用户授权的真实 Collection Browser Profile 中**：读取页面正常呈现的数据，执行有界只读交互，并在必要时观察经过批准的页面响应投影。不再把寻找私有 API、复刻签名、构造请求、伪装浏览器或维护传统爬虫对抗链路作为产品方向。

这里“不接入第三方仓库”特指第三方平台采集 / 爬虫实现。第 74 题已经批准的 DeepResearch 框架适配、许可证兼容的通用构建依赖和浏览器标准 API 不受此条误伤，但仍需依赖与许可证记录。此路线减少传统爬虫与正常浏览器环境的差异，不代表授权绕过验证码、访问控制、付费限制、限流或平台安全措施；第 27、60、65 题的停止边界继续有效。

### 97. 正式平台策略发布门槛

策略正式发布必须完成构建门禁、精确 host permission 审查、只读动作与预算审查、页面角色和失败状态定义、用户控制环境中的真实平台验证、匿名 / 登录类别、长期档案边界检查、capability validation record、strategy ID / version / maturity / `last_verified_at`、暂停与回滚方案及用户可读限制说明。只有满足门槛才能标为 `live_anonymous_verified` 或 `live_authenticated_verified`；一次成功、README 声明和旧接口样例均不构成发布证明。

### 98. 本地 capability kill switch

严重问题发生时，按具体 strategy ID / version 标为 `suspended`，停止新 stage、使相关 lease 失效、保留已封存证据和停止原因、阻止 Planner 继续选择、在能力矩阵显示时间与原因，并可提示撤销 optional host permission。修复必须以新策略版本重新真实验证。Kill switch 只改变本地能力状态，不远程下载或执行 JavaScript，也不删除 Collection Profile 或证据 Vault。

### 99. 默认仅本地去敏诊断

默认仅在本地保存 task / run / strategy ID、扩展与策略版本、页面角色、语义动作与耗时、状态转换、预算、安全错误码、capability / 构建版本及不含敏感内容的异常摘要。默认不上传查询词、完整 URL、正文、截图、账号信息、公开联系方式、Profile 路径或登录状态。用户可显式导出去敏诊断包，导出前展示字段并再次扫描；页面脚本不得向开发者服务器发送诊断。

### 100. 一期完成定义

一期必须形成产品、数据源、证据、真实验证和研究五个闭环，而不是可加载的扩展壳：本地 Console / Gateway 可创建、预检、批准并自动启动单一 MV3 Collector；专用可见窗口和持久 Collection Profile 支持登录暂停 / 恢复；B站完成真实验证的 discovery → detail → bounded discussion；小红书完成登录态 account identity → visible inventory → resumable archive → selected detail；至少一类公开新闻 / 文章 known URL 可读；`.env` 搜索接口通过本地 Search Adapter 提供外部发现；能力矩阵如实显示缺口。

同时，本地加密 Vault、manifest、coverage ledger、哈希、schemaVersion、Evidence Explorer、取消 / 重启 / 登录失效 / 缺少选项 / suspended 终态均可用；构建门禁与用户控制环境中的只读真实验证通过，不以离线平台 fixture 冒充实站能力；DeepResearch 只读封存 EvidencePackage、禁用框架自带搜索、引用可回到 evidence item，补采走 CollectionGapRequest 与用户批准。一期不要求持续监控、自动预警、所有中文平台全部能力、全量媒体下载或无人值守验证码处理。

## Grill 状态

第 1–100 题核心产品问询已经完成，跨决策冲突、覆盖缺口和术语一致性审计也已完成。后续决定优先级为：明确用户自定义选择 > 较晚批次 > 较早批次；具体场景决定 > 总体默认。当前没有仍需用户选择的阻塞性产品问题。项目实现和真实平台开发/验证已经获得下文记录的常设授权，现有代码仍不得被误写成已经满足本账本。

## 后续显式产品决定：数据源勘察先于策略实现

2026-07-18 用户进一步明确：平台能力开发必须遵循人类研究网站的顺序。先在真实受管浏览器中研究前端页面内容、页面状态、正常交互以及 XHR / fetch 数据流，不断深入到足以理解字段来源、分页、失败态和登录依赖；再逐字段决定 DOM、approved response、有界交互或混合方案；最后才允许编写策略代码。

这是一项硬 admission 前置门禁：

- 没有 Source Reconnaissance Dossier，不进入 production strategy 实现；
- 没有字段—证据映射，不批准 selector 或 response projector；
- 发现 JSON route 不等于批准私有 API，也不授权请求重放、签名复刻或隐藏字段保存；
- 第三方仓库只能提供勘察线索，所有结论必须在当前真实浏览器页面重新验证；
- 实现中发现新页面行为时退回勘察阶段，不能静默扩大策略。

2026-07-18 用户进一步纠正：XHR / fetch 侦察不是 DOM 研究失败后的后备步骤，而应与 DOM 勘察在同一次真实浏览路径中并行启动。两条观察面共享 run ID 和时间轴，才能比较页面生命周期、DOM readiness、正常交互与网络 route 的先后关系。并行研究不改变准入门槛：默认只留去 query/hash 的 route / method / status / MIME / size / phase metadata，不读取或保存 request header/body、response body、Cookie、Token；任何 response projector 仍需字段—可见页面映射和独立 review。

## 后续显式产品决定：账号安全高于自动恢复与覆盖

2026-07-19 用户补充了真实账号封禁经历，并要求产品必须考虑断网、弱网、页面卡顿、验证码和其他异常状态导致的重复点击、刷新或开页风险。该决定优先于任务完成率、自动恢复和采集覆盖：平台动作结果不确定时停止，而不是重试。

- 验证码、异常访问、风控和限流进入跨 Gateway 重启持久的人工解锁状态；
- 断网、导航失败、弱网和连续 Fetch/XHR failure 终止本轮并立即回到 `ready`，不自动续跑；
- 每个语义 action ID 在一个 run 中 at-most-once，超时或结果未知也视为已经尝试；
- 本地状态轮询、幂等 Evidence 提交和扩展 Control 恢复可以有界重试，但不得产生新的平台导航或用户事件；
- 崩溃前未完成的认证 run 在重启后锁定，不能静默恢复；
- 认证实网研究必须先满足[账号安全熔断门禁](account-safety-circuit-breaker.md)；项目所有者已在后续决定中授予常设权限，因此不再要求逐 run 聊天批准。

## 后续显式产品决定：真实平台开发与验证采用常设授权

2026-07-19 用户明确授予本项目代理真实平台可行性研究、能力验证和采集开发的持续权限，并要求未来不再逐次索要授权。该较晚决定覆盖本账本中“每个开发/验证 run 都要再次在聊天中批准”的旧表述。

- 代理可以自主启动本地专用 Profile，导航目标平台，执行低频 hover、公开控件点击、滚动、筛选、排序、分页、详情/评论展开和 DOM/XHR 观察；
- 登录状态由浏览器 Profile 正常持久化。只有扫码、密码、验证码等必须由用户本人完成的身份动作才通知用户，这不构成重新申请研究权限；
- 不读取、导出或传递 Cookie、Token、密码、storage state 或 Profile 内容，不绕过验证码、访问控制、付费限制、限流和平台安全措施；
- 账号风险、动作 at-most-once、预算、独立 run、风险锁和清理门禁继续有效；常设授权不允许失败恢复逻辑重放旧动作；
- 产品面向最终用户的 EvidencePlan、任务同意、预算升级、Profile 绑定和审计仍保留。这里改变的是项目代理的开发/验证授权方式，不是删除产品权限模型。

## 后续显式产品决定：先以人类视角证明真实交互

2026-07-19 字幕侦察进一步验证并固化了 Source Reconnaissance 的具体方法。任何复杂页面动作在编码前必须先暂时绕开待验证扩展、Gateway runner、content script、旧 selector 和旧 XHR 假设，从可见真实浏览器中按人类流程完成一次可行性研究：

```text
视觉理解页面和控件层级
  -> DOM 定位真正交互节点与实时边界框
  -> 浏览器级可信 mouse move / hover / click
  -> 视觉、DOM、Network 三类后置条件互证
  -> 记录动作账本和失败语义
  -> 最后才迁移到生产代码
```

content script 的 `HTMLElement.click()`、synthetic `MouseEvent`、直接修改 class 或离线页面克隆都不能证明真实人类交互可行。侦察坐标只用于证明输入层能力，生产策略必须从当时页面实时取得位置。该方法已固化为仓库内 [`recon-live-web-interactions`](../../skills/recon-live-web-interactions/SKILL.md)，未来字幕、评论、筛选、排序、分页、账号主页和其他需要主动触发 XHR 的操作都必须复用。

## 批次 101–105：多页面池 MVP 的拓扑、所有权与生命周期

### 101. 每个 Collection Profile 一个持久可见窗口，窗口内使用受管多页面池

每个 Collection Profile 对应一个独立、持久、可见的 Collection Window；窗口内部可以同时存在多个受管 tab。每个受管 tab 通过 lease 归属于具体 task / stage / platform / page role，但登录状态和账号隔离仍由 Profile 边界承担。不同 Profile 使用不同浏览器上下文或窗口，不得混用登录状态。

本决定细化并部分覆盖第 77 题的“每个采集任务使用专用 Collection Window”：专用性下沉到页面 lease，而不是要求每个任务创建新的 OS 窗口。任务仍只能使用明确属于它的页面，不得接管用户页面或其他任务正在租用的页面。

### 102. 页面所有权只由本地 session 账本建立，URL 不能建立所有权

MVP 只认 Collector 在当前浏览器 session 中亲自创建并登记的页面。页面身份使用本地 `browserSessionId + Chrome targetId`；URL、页面角色和其他页面特征只用于核验该受管页面是否仍处于预期上下文，不能用来认领所有权。

启动时已存在但没有进入当前 session 所有权账本的页面一律视为 `unmanaged / user_owned`，不得自动复用、导航或关闭。不得依赖 URL 相同、tab 顺序、DOM 属性、`window.name`、query 参数或页面注入标记推断 Collector 所有权。

### 103. 页面池支持多 lease，认证 Profile 的平台动作并发由独立调度门禁控制

页面池从 MVP 起支持多个受管页面和多个彼此独立的 lease，不能在数据结构或 API 上退化为单工作 tab。页面容量与真实平台动作并发是两个不同维度：MVP 默认每个认证 Profile 同一时刻最多执行一个会触碰平台的导航或交互动作；不同 Profile、不同浏览器上下文可以并行，本地 artifact 写入、去敏投影、解析和 AI 分析也可以并行。

同一 Profile 的详情页有界并发属于后续按平台验证后才能放宽的调度能力；不得因为页面池能够提供多个 tab，就默认允许多个 worker 同时滚动、点击或翻页。该规则与第 72 题兼容：Enumeration Coordinator 的单一所有者约束保持不变，Detail Workers 的并发还必须通过平台和账号安全门禁。

### 104. 受管页面采用显式生命周期状态机

受管页面至少具有以下状态：

```text
leased
idle_reusable
quarantined
reclaim_pending
closed
```

- `leased`：页面被一个且仅一个 active lease 使用；
- `idle_reusable`：Collector 所有、无 active lease，且页面身份核验通过；
- `quarantined`：Collector 所有，但发生用户导航、身份不符、验证码、风控、登录变化、网络结果未知或其他无法安全判断的情况；
- `reclaim_pending`：页面已经进入显式回收计划，但关闭前仍需再次核验所有权、lease 与页面身份；
- `closed`：页面已经确认关闭，不再参与调度。

没有进入 Collector 所有权账本的页面是 `unmanaged / user_owned`，不进入受管状态机，也不参与自动调度。页面状态只能由 acquire、release、reconcile、reclamation 等受控操作转换，不得按 URL 或标题即时猜测为“空闲”。

### 105. 正常任务结束只释放页面；MVP 不自动关闭页面

正常完成或正常耗尽预算时，页面释放为 `idle_reusable`，不得在任务结束后立即关闭。后续任务优先复用合适的空闲页；即使目标 URL 不同，只要页面仍符合最后预期身份，也可以由新 lease 在同一页面正常导航，从而避免 tab 持续增加。

MVP 可以生成可审计的 `reclaim_pending` 计划，但只有用户执行页面清理、关闭 Profile，或明确的浏览器开发生命周期切换才真正关闭页面。关闭前必须再次确认页面仍为 Collector 所有、没有 active lease、身份未发生意外变化，且不处于 `quarantined`。`leased`、`quarantined` 和 `unmanaged / user_owned` 页面绝不进入自动关闭范围。自动超时关闭或容量压力下的无人值守关闭不属于 MVP，待真实使用证明所有权与接管检测可靠后再单独决策。

## 批次 106–110：页面 lease、确定性调度与隔离恢复

### 106. 物理页面占用使用独立 PageLease，并与 StageLease 显式关联

页面池使用内部 `PageLease` 表达物理 tab 的独占占用；现有 `StageLease` 继续表达获批 task / stage 的执行与证据提交权限。二者职责和生命周期不同，不合并：

```text
PageLease
  acquire page -> use page -> release page

StageLease
  approve stage -> execute document -> submit evidence / terminate
```

`PageLease` 至少绑定 `pageLeaseId`、`browserSessionId`、`targetId`、`profileId`、`taskId`、`runId`、`pageRole`、取得时间和状态；正式任务执行时再关联可选的 `stageLeaseId`。一个受管页面同一时刻只能拥有一个 active `PageLease`，错误 lease、过期 lease、重复 release 和跨 run 操作都必须拒绝。没有正式 `StageLease` 的侦察、登录状态检查等内部流程也必须先取得 `PageLease`，但不能因此获得正式证据提交权限。

### 107. Acquire 使用确定性的分层复用顺序

页面选择顺序固定为：

```text
1. 同 Profile、同平台、同规范目标、同页面角色的 idle_reusable 页面
2. 同 Profile、同平台、同页面角色族的 idle_reusable 页面
3. 同 Profile 内其他已核验的 idle_reusable 页面
4. 在 Profile 页面预算内创建新的受管页面
5. 没有安全页面且已到上限时，失败 page_pool_capacity_exhausted
```

同一优先级内按最久未使用优先。第 2、3 类页面可以由新 lease 正常导航到新目标，但导航前必须重新核验所有权、状态和最后预期页面身份。每次 acquire 都要记录安全的 selection reason；不得随机选页、抢占 leased 页面、复用 quarantined 页面，也不得因为目标 URL 不同就无条件新增 tab。

### 108. 通过预期动作窗口和页面状态观察识别用户接管

Collector 执行动作前创建带 action ID 的短时 action epoch，声明该动作允许发生的导航、滚动、页面角色变化和后置条件。动作窗口外发生用户滚动、点击、键盘输入、表单变化、非预期主文档导航、SPA 路由变化、页面关闭、页面替换或 document generation 改变时，当前 `PageLease` 和关联 `StageLease` 立即失效，页面进入 `quarantined / unexpected_user_activity`。

单纯切换到 tab、窗口获得焦点、鼠标移动或停留查看不算接管，用户仍可观察任务。Collector 自己的浏览器级输入必须关联 action ID，不能只依赖 `event.isTrusted` 区分人类和自动化，因为浏览器级自动化输入同样可能产生可信事件。无法归因的状态变化按接管或上下文未知处理，不继续沿用旧策略。

### 109. Quarantine 按良性上下文变化和账号风险分流

`benign_context_change` 包括用户导航、页面角色改变和无风险的意外跳转。页面保持可见，用户可以按当前页面重新规划并创建新 lease、放弃 Collector 所有权转为 unmanaged，或显式关闭；系统不自动导航回原地址。

`risk_or_identity_change` 包括验证码、风控、登录账号变化、会话失效和平台动作结果未知。页面保持 quarantined，并同时进入对应账号安全或认证状态；不能仅通过“重新使用页面”把它改回空闲，也不能用自动刷新尝试恢复。恢复页面资源状态不能绕过账号安全状态机。

### 110. MVP 默认每个 Collection Profile 最多三个受管 Web 页面

MVP 默认预算为：

```text
maximumManagedPagesPerProfile = 3
maximumActivePlatformActionsPerProfile = 1
```

`leased`、`idle_reusable`、`quarantined` 和 `reclaim_pending` 都占用受管页面名额；`unmanaged / user_owned` 不占受管名额，但必须进入浏览器总页面数遥测。达到上限时优先复用 `idle_reusable` 页面；如果只有 leased 或 quarantined 页面，则返回 `page_pool_capacity_exhausted`，不得抢占、关闭或继续开页。后续任务计划可以显式申请提高上限，但升级必须可见，并继续受 Profile、平台、账号和动作并发门禁控制。

## 批次 111–115：前台操作、控制页与浏览器进程生命周期

### 111. PageLease 与窗口前台操作权分离

取得 `PageLease` 不自动调用 `bringToFront()`。每个 Collection Window 另有至多一个 `ForegroundActionPermit`；只有导航、滚动、hover、点击、键盘输入、筛选、展开等需要可见浏览器输入的动作序列才能申请该许可。取得许可后只切换一次目标 tab，等待页面稳定，执行一组语义连贯的动作，核验视觉、DOM 和 XHR 后置条件，再释放许可。页面停留在最终状态，不自动切回 Control 页。

已经加载的页面可以在后台完成不产生新平台输入的 DOM 投影、已观察响应解析和 artifact 写入。不得为了模拟真人随机切 tab、随机停留或随机制造输入；目标是确定、可解释、不机械抖动的页面工作流，而不是伪造随机行为。

### 112. 每个 Browser Session 最多一个非池化 Control 页

Control 页具有独立系统角色：

```text
pageRole = collector_control
ownership = collector_system
poolEligible = false
reclaimable = false
platformActionEligible = false
```

扩展 worker 必须先在不可见探测阶段完成版本与 control surface 核验，随后每个 Browser Session 至多打开一次 Control 页。Control 页不进入 Web 页面池、不被平台任务导航、不在每个 run 开始或结束时切到前台。用户手工关闭后，任务运行期间不得通过失败重试循环自动重开；Research Console 或明确本地命令可以重新打开一次。Gateway 与扩展的后台控制通信不能依赖 Control 页保持打开或处于前台。

### 113. Browser Host 独立拥有 Chromium 生命周期

新增独立、长寿命的本地 Browser Host，由它启动并持有 Chromium、Collection Profile、`browserSessionId`、页面所有权账本、`PageLease` 状态和扩展加载核验。Gateway 通过受保护的本地控制通道连接 Browser Host，负责研究任务、计划、动作和证据协调；Gateway 重启、崩溃或升级不关闭 Collection Window。

不得把未经认证的原始 CDP 端口暴露给任意 localhost 客户端。控制通道必须使用固定本地身份、随机 session secret、操作系统级命名管道或等价保护。不得为了获得进程持久性而连接用户日常 Chrome，也不得恢复成每个 task 启停一个 Chromium 进程。

### 114. Gateway 与 Chromium 重启采用两级恢复语义

Gateway 重启而 Browser Host 与 Chromium 仍存活时，`browserSessionId` 不变，Browser Host 页面所有权账本继续有效，`idle_reusable` 页面保持空闲；旧 Gateway 的 active `PageLease` 全部失效，对应页面进入 `quarantined / controller_disconnected`。新 Gateway 可以读取去敏页面池摘要，但必须申请新 lease，不能恢复旧平台动作。

Browser Host 或 Chromium 重启时生成新的 `browserSessionId`，旧 `targetId`、`PageLease` 和页面账本全部失效。即使浏览器恢复出 URL 相同的 tab，也将其视为 `unmanaged / user_owned`，不得按 URL、历史摘要或 tab 顺序重新认领。稳定 task ledger、coverage 和 artifact 可以恢复，但继续任务必须重新核验 Profile、平台、账号、页面角色和安全状态。

### 115. 暂停、取消、断开和关闭 Profile 是四种不同操作

产品和代码必须区分：

```text
pause_task
  停止开始新平台动作；当前动作按有界后置条件收尾

cancel_task
  终止该任务后续 stage；保留已完成 artifact；释放或隔离页面

disconnect_gateway
  Browser Host 与浏览器继续存活；旧 active lease 失效

close_collection_profile
  用户明确请求关闭整个 Collection Window
```

`close_collection_profile` 默认拒绝在存在 active lease 时执行，并先展示 leased、idle、quarantined 和 unmanaged 页面数量；用户解决 active lease 或明确强制关闭后，Browser Host 才关闭 Chromium context。扩展升级、Gateway 重启、重新构建、普通任务结束和 `cancel_task` 都不得隐式调用该操作。平台动作结果未知时遵守 at-most-once 和隔离规则，不能把“暂停”实现成关闭页面后重试。

## 批次 116–120：页面身份、导航世代、弱网与可观察性

### 116. 页面身份采用所有权、文档导航和平台语义三层契约

页面身份分为：

```text
本地所有权身份
  browserSessionId + targetId + profileId + ownership record

文档与导航身份
  main-frame document generation + route generation
  规范 origin/path/page kind + 最近批准导航的 URL digest

平台语义身份
  platform + pageRole + stable target identity
  登录状态类别 + 可可靠核验时的公开账号身份
```

所有权只能由第一层证明，不能由 URL 或页面内容建立。Acquire 空闲页面时核验第一、二层；开始平台动作或采集证据前核验全部三层；正常 release 前再次核验所有权、文档身份和动作后置条件。无法证明平台语义身份时返回 `page_identity_unverified`、登录或漂移状态，不得猜测匹配。

### 117. 分离 browser session、document、route 与 action 四种 generation

`browserSessionGeneration` 在 Chromium 或 Browser Host session 换代时变化；`documentGeneration` 在主 frame 提交新文档时递增；`routeGeneration` 在 `pushState`、`replaceState`、`popstate` 或平台 SPA 路由变化时递增；`actionEpoch` 为每个已批准语义动作独立编号。

`PageLease` 可以跨一次已计划导航继续占用同一物理 tab，但完整主文档导航会使旧 document-bound `StageLease` 和 observer 失效，新文档必须建立新绑定。已声明的 SPA transition 可以保留 PageLease，但必须递增 route generation、重新核验 pageRole 和目标身份；未声明的 route transition 返回 `task_context_changed` 并隔离页面。

迟到的 DOM 或 XHR 结果必须同时匹配 `PageLease + documentGeneration + routeGeneration + actionEpoch`，否则丢弃，不能写入当前证据批次。

### 118. 目标网络动作一次发出，弱网和结果未知不自动恢复

每个导航和语义动作最多发出一次，并使用有界 deadline。已确认目标后置条件才继续；验证码、风控、限流和登录变化终止 run、隔离页面并进入对应安全状态；主文档或目标 route 超时、断网、网络切换、连接中断和动作是否生效未知时，将动作记录为 `attempted / outcome_unknown`，终止 run 并隔离页面，不执行 reload、back、重复点击或另开 tab。

无关图片、广告、推荐和遥测资源失败不构成任务失败；只有策略声明的主文档、目标 route 与动作后置条件参与终态判断。deadline 内可以本地轮询已经存在的 DOM、响应队列和浏览器状态，但不得重新发出平台动作。后续尝试必须属于新 run 和新 action ID。

### 119. PageLease deadline 从获批任务预算派生

active `PageLease.expiresAt` 不得晚于当前 run deadline、获批 stage/task `maxDuration` 和 Browser Host 本地安全硬上限。Gateway 使用受保护的本地 heartbeat 证明控制器存活；续租仅限原 lease 未过期、controller generation、task/run/stage 均未变化、仍在总时间预算内、没有 outcome_unknown 动作且页面身份核验通过。续租只延长本地资源占用，不产生平台输入。

heartbeat 丢失或 lease 到期时，若没有在途平台动作，页面进入 `quarantined / controller_timeout`；若存在可能已经发出的平台动作，页面进入 `quarantined / platform_action_outcome_unknown`，run 按 at-most-once 终止。页面不会因 lease 到期自动关闭。

### 120. Console 展示去敏页面池状态卡，不暴露浏览器内部或页面内容

Console 为当前 session 的页面分配本地短别名，展示 Profile、Browser Session 状态、page alias、平台、pageRole、ownership、lifecycle state、关联 task/run 短别名、lease/idle age、前台许可、最后状态转换、安全 selection reason、quarantine reason 和 reclaim eligibility，并提供聚焦页面、查看隔离原因、按当前页重新规划、放弃 Collector 所有权、生成回收计划和显式关闭安全页面等本地操作。

默认不得展示 Chrome `targetId`、完整 URL/query/fragment、页面标题或正文、账号敏感信息、Cookie、Token、storage、请求头或请求体。用户需要理解的是页面归属、状态、任务关系和安全操作，不是内部 target 标识；更深调试只能通过受控、去敏诊断导出提供。

## 批次 121–125：页面角色、身份交互、用户保留与回收执行

### 121. pageRole 分类与转换由版本化 Platform Strategy 声明

通用页面池只负责所有权、lease 独占、容量、LRU 和生命周期转换；平台 Strategy 负责从已批准的 URL、DOM 和公开语义证据核验 pageRole，并声明允许的角色转换与复用亲和度。Strategy 至少返回 `verified role / unknown / drifted`，并提供 exact target、same role、same role family、generic navigable page 和 incompatible 等复用等级。

页面池不得硬编码 `/search`、`/video`、`/dynamic` 等跨平台 URL 猜测，也不得把任意空闲页直接交给任意策略。Strategy 无法证明当前角色时，页面不能进入 `idle_reusable`；未声明的角色转换按上下文变化处理。

### 122. 登录、扫码和验证码页面进入受保护的人类身份交互模式

任务页面进入登录、扫码或验证码页面时，当前 `PageLease` 与 `StageLease` 失效，页面分别进入 `quarantined / authentication_required` 或 `quarantined / verification_required`，角色为 `user_authentication` 或 `user_verification`。这些页面由 Browser Host 保护，但永远不进入普通复用和回收池。

身份交互模式中暂停 Collector 输入与证据观察，不截图凭据区域、不读取输入框、不记录二维码内容、不捕获认证请求，也不自动刷新或点击。用户本人进行的点击、扫码和密码输入属于该模式的预期人类动作，不重复归类为普通 `unexpected_user_activity`。用户完成后显式恢复，系统只核验非敏感登录状态、平台、账号类别和目标页面角色，再创建新的 PageLease 与 StageLease。

### 123. 新页面采用 reserve、create、register、navigate 原子流程

新建受管页面的顺序固定为：预留 Profile 容量，取得 `ForegroundActionPermit`，创建 `about:blank` target，立即取得 `targetId`，用 `browserSessionId + targetId` 登记所有权，创建状态为 `leased_pre_navigation` 的 PageLease，只发出一次批准目标导航，最后核验 document generation、pageRole 和目标身份。

如果尚未发出外部导航，本地创建失败可以回滚容量并关闭纯 `about:blank` 页面；这不属于关闭任务页面。如果已经发出目标导航但结果未知，则页面进入 `quarantined / navigation_outcome_unknown`，不得关闭、重开或自动重试。所有权必须先于外部动作建立，且只有真正取得容量和前台许可后才创建 tab。

### 124. 用户保留页面使用显式 retained、transfer 和 close 语义

任务结束后的默认状态是 `idle_reusable`。用户可以选择：

```text
保留在页面池
  -> idle_reusable

固定供我查看
  -> retained_for_review
  -> Browser Host 保护，但不复用、不回收、不自动导航

交给我
  -> 删除 Collector 所有权
  -> unmanaged / user_owned

关闭
  -> 无 active lease 且身份核验通过后显式关闭
```

`retained_for_review` 页面以后可以经重新核验返回页面池。用户在 idle 页面上交互但未显式选择时，页面进入 quarantine；系统不得从一次点击或滚动自动推断永久所有权转移。该决定在第 104 题的最小状态机上新增 `retained_for_review` 状态。

### 125. 页面回收采用带版本快照的 Plan 与 Execute 两阶段协议

用户选择 Profile 和期望释放数量后，Browser Host 先 reconcile 页面池，只选择 Collector-owned、`idle_reusable`、无 PageLease、无前台许可、非 Control、非 retained、非 quarantined 且身份仍匹配的页面；按低复用亲和度与最久未使用排序，标记 `reclaim_pending`，生成短时有效的 `reclaimPlanId`。计划只展示 page alias、pageRole、idle age、选择原因与预计释放数量。

执行时逐页重新核验 browser session、record version、ownership、state、lease 和页面身份。未变化的页面才关闭；任一条件变化则跳过，并返回 `closed / skipped / changed` 的逐项结果。计划过期或取消时，仍满足条件的页面回到 `idle_reusable`。回收只关闭本地 tab，不导航、刷新或触发平台动作；MVP 不自动生成并执行无人值守回收。

## 批次 126–130：Browser Host 控制协议、调度与迁移路径

### 126. Browser Host 使用窄能力、认证的操作系统本地 IPC

Windows 使用 Named Pipe，Linux/macOS 使用 Unix Domain Socket。Browser Host 只开放版本化、类型化的页面状态、lease、前台许可、批准动作、reconcile、回收和 Profile 生命周期命令；不暴露任意 Playwright Page、任意 CDP、任意 JavaScript evaluate、浏览器认证材料或文件系统能力。

Browser Host 启动时生成 `hostInstanceId` 和本地 bootstrap secret，endpoint 与 secret 使用当前操作系统用户可读的 ACL。Gateway 通过固定身份和短时 handshake 建立 controller generation，后续命令携带认证摘要、nonce 和 deadline。不得提供无认证 localhost HTTP API或公开 raw remote-debugging port。

### 127. Browser Host 是页面资源账本和状态机的唯一写入者

Gateway 只能发送 acquire、release、action 和 reclaim 意图；扩展/content script 只能上报 document、route、用户活动和策略证据；Playwright/Chromium 事件只能报告 target 创建、关闭、导航和崩溃。只有 Browser Host 可以验证这些输入、执行合法状态转换、递增 `PageRecord.version` 并追加审计记录。

Browser Host 保存当前 session 的内存索引和 append-only 本地 journal。journal 用于审计、崩溃诊断和确认旧 lease 失效；Browser Host 或 Chromium 换代后，历史记录不能用于自动认领新 session 页面。不得采用 Gateway 与 Host 最后写入者获胜、content script 直接改状态或每次按 URL 重算状态的多写者模型。

### 128. Browser Host 在浏览器输入边界执行命令防重放

每个命令 envelope 至少包含协议版本、host/browser session、controller generation、command ID/class、PageLease、预期 PageRecord version、task/run/stage、平台动作 action ID、nonce、签发/过期时间和认证摘要。Browser Host 在发出平台输入前持久记录 `attempted`，并维护有界去重账本。

首次有效 command 才能执行；相同 command ID 再次到达只返回已有 outcome。IPC 响应丢失时 Gateway 只能查询 command outcome，不能重新提交平台动作；controller 断开后旧 generation 的命令全部拒绝。只读本地状态查询可以有界重试，导航、hover、click、scroll、筛选和展开不能通过更换 command ID 绕过去重。Host 崩溃时，attempted 但未确定结果的动作归类 outcome unknown。

### 129. 多 Profile 使用 Gateway 全局调度与 Browser Host 本地硬门禁

Gateway Scheduler 按任务优先级、批准时间和平台公平性排队；MVP 默认最多同时运行两个 Collection Profile，每个 Profile 同时最多一个平台动作，避免长账号归档永久饿死其他平台任务。Browser Host 独立核验每 Profile 三页上限、每窗口一个前台许可、PageLease 和 controller generation；即使 Gateway 调度错误也拒绝越界命令。Account Safety 继续按 Profile/platform/run 执行安全状态机。

不同 Profile 可以在各自 Collection Window 中并行。某个 Profile 的 quarantine、登录失效或账号风险只阻断该 Profile；只有 Browser Host 自身完整性失败才升级为全局阻断。不得让 Host 仅凭空闲 tab 自主启动未计划任务，也不得开放无上限并发。

### 130. 先构建 Browser Host 纵向切片，再以 B站 dynamic 迁移作 canary

实施顺序为：Browser Host 进程与 IPC、PageRecord/PageLease/前台许可和去敏 inventory；随后用真实本地 Chromium 验证双 lease、空闲复用、用户导航隔离、Gateway 重启不关闭浏览器和显式回收，且声明 `livePlatformRequests=0`；再迁移已有真实 DOM/XHR/artifact 契约的 B站 dynamic runner，并执行一次低频真实平台闭环；通过后依次迁移账号档案、系列/文章、视频/字幕/讨论，最后删除旧单工作 tab 与 URL 摘要所有权实现。

不设置旧 API 兼容期，也不允许用薄适配器维持旧 runner 调用。切换 checkpoint 必须一次性迁移所有调用点并删除旧 URL 认领、单 tab 状态和旧生命周期 API。真实本地 Chromium 生命周期验证只证明浏览器资源模型，不冒充平台能力验证；平台能力仍需真实站点证据。

## 批次 131–135：Host 启动升级、运行日志、崩溃与 MVP 验收

### 131. Browser Host 采用项目本地、按需启动、当前用户单实例

Browser Host 与 Gateway 一起构建发布，但使用独立入口、进程和 state 目录；MVP 不注册系统服务、不要求管理员权限，也不默认开机自启。Gateway Launcher 先探测当前用户 Named Pipe：健康 Host 已存在就认证连接，不存在时只启动一次 detached hidden Host 并等待 endpoint ready。Gateway 退出后 Host 继续运行，只在用户明确 Exit Browser Host 时结束。

Host 使用当前用户 state 目录单实例锁。第二个 Host 发现健康实例时退出，不能再启动一组 Chromium；只有对应 PID、Named Pipe 和 heartbeat 均不存在时才可清理陈旧锁。一个 Host 管理多个隔离 Collection Profile，不按 Profile 复制完整服务。

### 132. 扩展升级使用不可见探测、空闲时一次 reload 和 generation 换代

Browser Host 管理 `extensionGeneration`，先比较期望 build fingerprint、版本、control surface revision 与实际 worker runtime marker。完全匹配时不 reload、不打开扩展页；不匹配且存在 active PageLease 时进入 `extension_upgrade_pending`，停止接收新任务并等待当前动作安全结束；空闲后至多调用一次 extension runtime reload，再核验新 worker 的完整 marker。

generation 改变会使旧 StageLease、document observer 和 action epoch 全部失效。平台 tab 保持打开，新扩展只能通过受控脚本重新建立当前文档观察绑定，不能刷新页面或重放动作。一次 reload 后仍不匹配则进入 `extension_adoption_failed`，禁止新平台动作、保持 Chromium 打开、不打开 `chrome://extensions`、不循环 reload；是否重启 Profile 属于显式开发生命周期操作。

### 133. Runtime journal 只保存去敏状态事件，默认七天与 32 MiB 上限

journal 允许保存 schema/timestamp、host/browser/controller/extension generation、Profile ID、session-local page alias、target identity digest、PageRecord version、pageRole/state、lease/task/run/stage ID 或摘要、selection/transition reason、command ID/class/outcome 和 quarantine/reclaim 结果。禁止保存 raw targetId、完整 URL/query/fragment、页面标题/正文/截图、DOM/XHR 原文、认证材料、请求头或请求体。

当前 Browser Session journal 保留到 session 正常封存或崩溃处理完成；已结束 session 默认保留七天，并设 32 MiB 总上限，超限只删除最旧的已封存 runtime journal。该清理不影响 Research Evidence、coverage、长期账号档案和安全锁；需要长期保留的安全结论进入独立最小安全状态，不依赖滚动日志。

### 134. Browser Host 崩溃时停止并诚实报告，不自动形成重启开窗循环

Gateway 检测 Host 断线后停止所有 active run，将 attempted 但无确定结果的动作标记 outcome unknown，使对应 Profile 进入安全状态；不立即自动启动新 Host、不重新导航历史 URL、不恢复旧动作。Chromium 若随 Host 退出，则报告 `browser_session_lost`，专用 user-data-dir 继续保存正常浏览器登录数据，下一次明确启动建立新 Browser Session；Chromium 若意外留存，则视为 orphaned browser，不按 URL 或公开 CDP 自动接管，由用户保留或关闭。

MVP 只承诺 Gateway 重启不关闭浏览器，不虚假承诺 Browser Host 进程崩溃后同一 Chromium 必然存活。Launcher 只能在用户下一次明确启动采集时启动一个新 Host，不能后台无限循环重启并反复开窗。

### 135. 页面池 MVP 必须通过四组纵向门槛

完成条件同时包括：Gateway、Browser Host、扩展构建与版本化 IPC/PageRecord/PageLease 契约通过，旧 URL 摘要和单工作 tab 路径删除；真实本地 Chromium 中验证同一 Host 跨 Gateway 重连、双 lease、空闲复用、三页上限、用户导航隔离、retained 保护、两阶段回收且 `livePlatformRequests=0`；验证 command 去重、响应丢失只查 outcome、controller 失联、扩展 mismatch 至多 reload 一次、无 `chrome://extensions` 和额外 Control 页、任务结束不关页；最后执行一次低频真实 B站 dynamic canary，保留真实 DOM/XHR/artifact 互证，release 后页面可见可复用，Gateway 重启后浏览器仍打开且没有重复平台动作、写操作或认证材料输出。

MVP 不要求一次迁移全部平台，但不能用 typecheck、fake Gateway、fake tab 或合成页面冒充真实浏览器闭环。canary 结束后不为测试清理而自动关闭浏览器，必须通过 Host 状态、OS 进程和页面池摘要核验其仍存活。

## 批次 136–140：代码边界、零兼容迁移、错误与验证治理

### 136. Collector 采用明确的多包边界和单向依赖

项目处于早期，不把 Browser Host 继续塞进 Gateway 大文件。建立以下清晰边界：

```text
@intelligence/collector-contracts
  纯协议 DTO、schema、错误码和验证器
  不依赖 Node、Playwright、Chrome 或平台代码

@intelligence/collector-browser-host
  Browser Host 进程、IPC server、Profile runtime
  PageRecord/PageLease 状态机、前台许可、journal、回收、扩展采纳
  唯一允许直接依赖 Playwright 并写页面账本的包

@intelligence/collector-gateway
  研究计划、调度、账号安全、artifact 和 Browser Host client
  完成迁移后不直接持有 Playwright BrowserContext/Page

@intelligence/collector-extension
  MV3 控制、页面策略观察、DOM/XHR 证据和用户活动事件
  不持有 Host journal、长期证据密钥或任意 CDP 能力
```

仓库建立 workspace 级构建顺序，依赖只从 Gateway/Host/Extension 指向 contracts，不形成循环。Host 内继续按 IPC、launcher、profile runtime、page ledger、lease、foreground、extension adoption、reclamation 和 journal 拆分；单文件出现多个状态机、协议和 I/O 责任时必须拆分，不能生成新的千行总管文件。

### 137. 项目不提供旧页面生命周期 API 或状态格式兼容

本题采用用户自定义决定：项目刚开始、自由空间足够，不需要任何兼容性。新 Browser Host 切换时一次性删除 `acquireManagedTargetPage`、`retainManagedTargetPage`、URL 摘要所有权、单工作 tab 遥测和相关 profile 字段；所有 runner、Console、构建脚本和文档在同一切换 checkpoint 改用 PageLease。不得保留 adapter、dual write、legacy endpoint、fallback path 或“新失败后退回旧实现”。

旧 runtime JSON 中未知遗留字段只在读取边界丢弃，不能用于认领页面；专用浏览器 user-data-dir 与正常登录状态不删除。构建门禁显式扫描旧 symbol，任何重新引入都失败。本决定覆盖第 130 题原先允许薄适配器的候选方向。

### 138. 使用结构化 BrowserHostError，不从 Error.message 猜状态

跨 Host、Gateway、Console 和 runner 的失败统一为版本化 discriminated union，至少包含：

```text
code
category
scope: host | browser_session | profile | page | lease | action | stage
terminality
retryClass: never | local_query_only | new_run_required | user_action_required
platformActionAttempted
pageDisposition
profileSafetyDisposition
safeDetails
occurredAt
```

错误类别覆盖 protocol/authentication、capacity、lease conflict/expiry、page identity/context、authentication/verification、platform risk、network outcome unknown、extension adoption、host/session loss、reclamation 和 internal invariant。HTTP、IPC 和 artifact 终态只能映射稳定 code；禁止用正则解析 `Error.message`、把异常堆栈发给 Console，或让调用方自行猜页面应当 idle、quarantine 还是关闭。

### 139. 单元测试只限纯逻辑，其他验证全部使用真实执行面

纯 reducer、schema validator、canonicalization 和预算计算可以使用单元测试。IPC、进程、Chromium、扩展加载、页面池、重连、前台许可、用户接管、回收和升级验证必须启动真实 Browser Host 与真实 Playwright Chromium；平台能力验证必须访问低频真实平台，不使用 fake Gateway、fake XHR、fixture 页面或合成 tab 冒充。

验证由 CLI 全流程自动执行，包括构建、启动、连接、浏览器操作、OS PID/窗口核验、artifact 与去敏审计；除了扫码、密码和验证码等本人身份动作，不要求用户手工加载扩展、点击按钮或关闭页面。真实 canary 结束后浏览器保持打开。

### 140. 采用四个可验证 Git checkpoint，不把整个重构压成一个提交

checkpoint 顺序为：

```text
1. design: freeze managed page pool and browser host decisions
   只提交权威决策、架构和验收文档

2. feat: add contracts and browser host core
   workspace、contracts、Host/IPC/ledger/lease/journal
   真实本地 Chromium 生命周期门禁通过

3. refactor: switch gateway and extension to browser host
   一次性迁移全部现有 runner 调用
   删除旧 API、单 tab、URL 所有权和直接 Playwright 持有

4. feat: validate bilibili dynamic through managed page pool
   低频真实 canary、去敏 artifact、重连与页面保持证据
   修订实现状态和 B站侦察文档
```

每个 checkpoint 只能在其范围内 typecheck/build 和相应真实门禁通过后提交；不得提交明知破编译的中间态，也不得把当前工作树中无关用户修改混入。若某 checkpoint 暴露设计错误，修改当前实现而不是新增兼容分支。

## 批次 141–145：扩展、Browser Host 与 Gateway 的真实执行分工

### 141. 扩展负责平台语义，Browser Host 负责可信输入，Gateway 负责研究调度

Gateway 生成并批准有预算的语义 `ActionCommand`，管理任务、账号安全和证据目标，不直接操作 Playwright Page。Extension Strategy 识别平台、pageRole、目标元素和状态，观察 DOM、SPA route、用户活动与批准 XHR，返回短时 `InteractionTargetTicket`，不使用 `HTMLElement.click()` 冒充可信输入。Browser Host 核验 PageLease、generation、action ID 与前台许可，使用 Playwright/Chromium 发出可信 mouse、keyboard 或 navigation，并执行动作 at-most-once；Host 不运行模型生成的任意脚本。

动作链固定为 Gateway 批准语义动作、Extension 解析当前文档目标、Host 重新核验并发出一次可信输入、Extension 观察视觉/DOM/XHR 后置条件、Host 判定终态、Gateway 接收安全结果与证据。不得让 Gateway 绕过 Host 继续持有 Page，也不得把全部平台选择器和采集逻辑搬入 Host。

### 142. Extension 通过 Chrome Native Messaging 接入 Browser Host

扩展使用 `chrome.runtime.connectNative` 连接当前用户级 Native Messaging Bridge；manifest 绑定固定 extension ID，bridge 只负责版本化消息 framing、身份绑定和连接 Browser Host Named Pipe，不持有页面状态、不执行平台动作。Browser Host 验证 browser session、document binding、PageLease 和 generation，并在 Gateway 与 Extension 之间传递批准任务和去敏 observation。

Native Messaging manifest、bridge 路径和扩展 ID 由本地构建/安装流程自动配置，不要求用户手工编辑注册表。不得继续维护扩展、Gateway、Host 三方各写一部分 lease 的 localhost 轮询模型，不允许网页 `postMessage` 或 raw CDP 成为控制通道。

### 143. Extension 使用一次性 InteractionTargetTicket 交付实时交互目标

ticket 至少绑定 ticket/strategy/page lease/browser session、document/route generation、action epoch、frame、semantic role、批准 locator descriptor、可见/可用/无遮挡状态、实时 bounding box、签发/过期时间和 one-time-use。Browser Host 真正输入前要求 Extension 再次核验 generation、语义节点、可见性、遮挡和位置；已经发出可信输入后 ticket 永久 consumed。

ticket 在未发出平台输入前失效时，可以在同一 action deadline 内重新执行一次本地 DOM 解析；这不算重试平台动作。生产 Strategy 保存语义定位规则，不保存侦察时固定坐标。视觉用于侦察与交叉核验，最终输入必须绑定实时 DOM 目标和 generation。

### 144. 已批准动作因果创建的新 target 可以建立 Collector 所有权

Collector-owned 页面来源扩展为 `direct_created` 和 `action_created`。ActionCommand 必须预先声明 `same_tab / expect_one_new_tab / allow_same_or_one_new_tab / forbid_new_target`。在 action epoch 内，恰好一个具有当前受管 opener、匹配 action 和预期 origin/pageRole 的新 target 可以登记 action-created 所有权并创建 PageRecord/PageLease。

未声明、多个或身份不明的新 target 仍记录为 Collector 动作导致，进入 `quarantined / unexpected_target_created`，不自动操作或关闭，也不伪装为用户页面。意外 target 即使临时突破三页容量也必须入账并隔离，再由用户检查、关闭或转交。本决定扩展第 102 题的“Collector 创建”含义，但仍禁止根据 URL 认领无因果关系的已有页面。

### 145. XHR/fetch 观察由扩展精确投影，并经 Host 上下文核验后交 Gateway

Browser Host 为当前 document/action 建立带批准 origin、pathname、MIME、尺寸和数量预算的 `ObserverBinding`。Extension main-world observer 只观察页面自身正常触发的 fetch/XHR，有界 clone response，在页面/扩展边界完成字段投影和去敏，不读取或保存请求头、请求体、Cookie 或 Token；ObservationBatch 通过 Native Messaging 返回。

Host 核验 PageLease、documentGeneration、routeGeneration 和 actionEpoch，丢弃迟到、跨页、跨动作或超预算 observation，再交 Gateway 写 artifact、coverage 和证据索引。Host 可以观察主文档和目标网络成功/失败元数据，但 production 不用 raw CDP Network 全量抓包替代 route allowlist。DevTools/CDP 只在真实侦察中辅助识别 route，未经审查的响应不能进入生产 Strategy。

## 批次 146–150：Strategy、动作协议、观察绑定与取消一致性

### 146. Platform Strategy 作为扩展内已构建代码和声明式 manifest 发布

Extension bundle 包含 strategy implementation、语义目标 resolver、pageRole classifier、DOM projector 和批准 response projector；Strategy manifest 记录 strategy ID/version、平台、pageRole、允许转换、ActionCommand 类型、response route ID、权限、认证前提、maturity、最近真实验证、侦察 dossier 和 build digest。Gateway 只能选择已安装 registry 中的精确版本，不能上传 JavaScript、selector、evaluate 或模型临时脚本。

任何改变页面识别、动作或 response 投影的修改都递增 strategyVersion 和 extension build digest，触发 extensionGeneration 换代，使旧 StageLease/ObserverBinding 失效，并重新完成对应真实平台验证。不得把 Strategy 变成 Gateway 远程代码或 Browser Host 硬编码平台爬虫。

### 147. ActionPlan 可完整审阅，但 Browser Host 逐个执行受限 Action AST 原语

允许的原语包括已知 URL 导航、解析交互目标、取得/释放前台许可、hover/click、公开查询输入、声明选项选择、有界滚动、等待声明后置条件、DOM 投影、ObserverBinding 激活/封存。每个 ActionCommand 绑定 action/strategy/page lease、预期 record/document/route generation、语义目标、前置条件、输入机制、target behavior、deadline、后置条件、observer binding、预算影响和失败映射。

Planner 可以展示完整 ActionPlan，但 Host 一次只接收执行点上的下一个原语；前一动作形成确定终态后 Gateway 才提交下一动作。同一前台 session 可以保持许可以避免频繁切 tab。`type_public_query` 只允许 Strategy 明确标记的公开搜索/筛选输入，禁止密码、验证码、私信、评论和发布字段。不得发送整段 Playwright 脚本、自由 evaluate、无界循环或自然语言给 Host 自主执行。

### 148. ObserverBinding 必须在可能触发响应的输入前完成握手

Binding 生命周期为 `pending -> ready -> active -> sealing -> sealed`，异常时进入 revoked/expired。Gateway 批准 action 与 route/projection 后，Host 创建 pending binding，Extension 安装精确 observer 并返回 ready；Host 核验 generation 和预算后才允许可信输入。首次导航使用 next-document binding，在 about:blank/当前 tab 预绑定目标 tab 与批准 origin，新文档于 document_start 建立 observer，ready 后才发出一次导航。

动作完成、达到数量/大小预算、deadline、document/route 换代、lease 失效或用户接管时 binding sealing、输出最终批次并撤销。未 ready 时不得先点击或导航；安装失败返回 `observer_binding_unavailable`，不触发动作、不刷新页面。禁止全局长期观察全部 route 后再筛选。

### 149. HostObservationReceipt 将去敏批次绑定到任务、页面和动作上下文

Receipt 至少包含 batch ID/digest、host/browser/controller/extension generation、page alias/PageLease/StageLease、Strategy version/build digest、document/route generation、action epoch、ObserverBinding、projection、捕获时间、条目/字节数、截断与终止原因。Extension 生成去敏 batch 和 digest；Host 核验 binding、lease、generation、预算后出具 receipt；Gateway 再核验任务计划与 StageLease，按 batch ID + digest 幂等写入并更新 coverage。

相同 ID/digest 重复只返回已接收；相同 ID 不同 digest 返回 `evidence_digest_conflict` 并停止证据流。迟到或上下文不符的批次记录拒绝原因，不混入 artifact。只有 action 与 binding 都形成终态后才能封存证据。不得让 Extension 直接写 artifact，也不得让 AI 按内容猜来源。

### 150. 取消按是否越过可信输入提交点分流

动作仍排队、ticket 未解析、binding 未 ready 或可信输入未发出时可以立即取消，撤销 ticket/binding，页面核验后 release。Host 已记录 attempted 且输入已发出时，只记录 `cancel_requested`、禁止任何后续动作，并在原 deadline 内等待当前动作后置条件；确定成功/失败后 task 为 `cancelled_after_inflight_action`，无法确认则 action outcome unknown、task 为 `cancelled_with_unknown_action`，页面隔离并进入对应 Profile 安全状态。

取消不 reload、back、重复点击或立即关页。已完成 artifact 与 coverage 保留，并记录取消发生在输入前还是输入后；不能把已发生动作改写为未执行。

## 批次 151–155：复杂文档、下载、弹窗、崩溃与输入坐标

### 151. frame 与 Shadow DOM 必须进入 Strategy 身份契约

同源 iframe 由 Strategy 声明 frameRole，ticket 绑定 frame ID/origin/document generation；跨域 iframe 必须声明精确 origin、host permission 和独立 resolver，否则返回 `cross_origin_frame_unsupported`。Open Shadow DOM 可以使用验证过的 shadow-aware resolver；Closed Shadow DOM 默认不可操作，只有真实侦察证明稳定 accessibility surface 且输入前可重新核验时才允许专门 resolver，否则返回 `target_not_observable`。

ObserverBinding 同样绑定主 frame 或具体 child frame，一个 frame 的 observation 不能冒充另一个。不得注入所有跨域 frame、盲目穿透 closed shadow 或退回固定坐标。

### 152. 下载必须由任务显式批准并在点击前建立 DownloadExpectation

只有 `download_public_media` 或 `download_public_attachment` 获批时才允许下载。Expectation 绑定任务/stage/action/page/strategy、来源角色、允许 MIME/文件名类别、最大字节/文件数、artifact 临时目录和 deadline。Host 先监听 download，Extension 重核公开目标，再发出一次可信点击；恰好一个匹配事件才保存到任务临时目录，校验大小/MIME/文件名/预算、计算 hash，并原子纳入 manifest。

文件永不自动执行、预览、解压、安装或打开，文件名安全规范化且不可覆盖或路径穿越；不持久化需要认证重放的临时签名 URL。未声明、多文件、类型不符或超预算下载尽早本地取消，记录明确终态，不重复点击。不得默认下载全部媒体或写入用户 Downloads。

### 153. dialog 默认拒绝，只允许 Strategy 声明的最小安全策略

允许的 policy 仅为 none、确认预期只读 alert、dismiss 预期 confirm。Confirm/prompt 默认 dismiss，禁止输入或自动确认；beforeunload 不自动接受离开，取消导航并使页面进入 `quarantined / navigation_blocked_by_beforeunload`；通知、位置、摄像头、麦克风、剪贴板等浏览器权限不自动授予，返回用户动作或能力未批准状态。意外 dialog 停止当前动作，并按是否已经输入判定 failed 或 outcome unknown。

禁止全局 `dialog.accept()`、用关 tab 消除弹窗或在 modal 阻塞时继续发后续输入。产品安装权限通过正式流程管理，平台 Strategy 不点击浏览器 UI 临时提权。

### 154. renderer、target 与 browser session crash 按故障范围分流

单页面 renderer crash 且无在途动作时，lease 失效、页面 `quarantined / renderer_crashed`，其他安全页面可继续，不 reload 或建替代页；有在途动作时 action outcome unknown、页面为 `renderer_crashed_during_action`、run 终止并进入对应账号安全状态。Target 被关闭时记录 closed，active lease 终止 `window_closed`，不自动重建。

Chromium/browser context crash 使整个 browserSessionId、所有 PageLease/StageLease/binding/permit 失效，运行任务停止并报告 `browser_session_lost`，不自动开新浏览器和重放。诊断只保存去敏状态和动作类别，不默认保存 crash dump、内存、完整 URL 或页面内容。

### 155. 坐标只属于一次性 ticket，输入前核验实时窗口与布局

Ticket 记录 viewport、device scale factor、browser zoom、window state、scroll position、frame transform 和 bounding box。Host 输入前确认窗口可见非最小化、目标 tab 有前台许可、布局没有未解释变化、目标仍在可点区域且无遮挡。输入前 resize/zoom/scroll 使 ticket stale，可以重新本地解析；输入后布局变化不得触发再次点击，只核验原动作后置条件，无法确认则 outcome unknown。

Host 可以在取得许可后恢复专用最小化窗口并切到目标 tab，但不擅自改变窗口尺寸、缩放或显示器位置；无法获得可见前台时返回 `foreground_unavailable`。不得依赖固定 1920×1080、100% 缩放或侦察时绝对坐标。

## 批次 156–160：文本、媒体、外部跳转、多窗口输入与用户关窗

### 156. 公开查询输入与提交拆分，禁止读取或借用系统剪贴板

`replace_public_query` 只作用于 Strategy 证明的 `public_search_input`，使用可信 focus、select-all 和 browser text input 支持中文，但不自动提交；`submit_public_query` 是独立 Enter/搜索按钮动作，提交前建立搜索结果 ObserverBinding，并使用独立 action ID。Ticket 必须证明输入框不是 password、验证码、私信、评论、发布或上传字段，且当前 pageRole 允许站内搜索。

Gateway 传递用户批准的 query，runtime journal 只记录 digest 和长度；Research Plan、coverage 与 evidence 按查询溯源规则保存必要文本。Host/Extension 不读取或写入系统剪贴板。搜索建议只有计划声明具体选择规则时才能作为新的动作执行，不能静默采用平台推荐词。

### 157. Collection Profile 默认浏览器层静音，媒体控制属于显式 Strategy 动作

默认 `audioPolicy = muted_during_collection`，页面可按平台正常逻辑加载/播放，但 Host 在浏览器或 tab 层静音，不通过点击播放器静音，也不自动暂停、播放、seek、切清晰度或全屏。依赖播放器状态的字幕、截图等能力必须声明并批准 `play_media / pause_media / seek_media_bounded / open_caption_menu / select_declared_caption`，进入预算与 action ledger。

自动播放产生的普通媒体请求不自动成为 evidence，只有批准 route/ObserverBinding 可采集。页面转为 retained_for_review 时 Console 显示静音状态，用户可以自行解除；任务结束不自动突然放声。

### 158. 未批准 origin、外部协议和系统通知默认阻断

普通导航仅允许 ActionPlan 已批准的 HTTP(S) origin；未批准外站返回 `external_origin_required`，等待新站点权限与 Strategy。`mailto:`、`tel:`、`sms:`、`intent:`、平台客户端 scheme 等外部协议一律阻止并返回 `external_protocol_blocked`；blob/data 只在批准 DownloadExpectation 中允许。浏览器或系统通知不点击、不回复、不打开，也不自动作为证据。

意外外部跳转已发生时页面 quarantine，不后退或关闭。公开外链可以保存为引用，但保存链接不授权访问新 origin 或启动本地应用。

### 159. 两个 Profile 可并发等待和处理，但全 Host 同时只发出一个可信输入

保留最多两个并发 Profile，它们可以重叠页面加载等待、已触发 XHR 接收、DOM 投影、artifact 写入和后置条件等待。Browser Host 增加全局 `TrustedInputPermit = 1`：任一时刻只有一个 Profile 可以发出 navigation、mouse、keyboard、hover、click、scroll 或 select。

全局许可只覆盖实际输入阶段，输入发出后立即释放，不占用整个网络等待期；每个窗口仍有自己的前台许可和 active tab。使用批准顺序与公平队列，不随机切换或添加随机延迟。多显示器不移动窗口，逐窗口核验 bounds/缩放/可见性；无法操作时返回 `foreground_unavailable`，不把输入误发给其他窗口。

### 160. 用户关闭 Collection Window 是外部终止信号，不自动重开

关闭时没有在途输入，则该窗口所有 lease 失效、页面 closed、任务为 `cancelled_by_window_close`，保留已完成 evidence；存在已发输入时 action outcome unknown、任务为 `window_closed_with_unknown_action`，Profile 进入对应安全状态。关闭 Profile 最后窗口会结束其 browser context/session，但 Browser Host 与其他 Profile 不受影响。

Host 不重新创建窗口、打开历史 URL、恢复动作或弹出 Control 页。Console 显示关闭时间、受影响 task 和 unknown 状态。单个 tab 关闭仍使用 target-closed 语义，不升级为整个 Profile 关闭。

## 批次 161–165：任务公平性、用户接管、空闲可信度与账号安全

### 161. Scheduler 按 Profile 公平轮转，并只在封存动作边界让出

全局最多两个 active Profile，不同 Profile 使用 weighted round-robin；同一 Profile 内按用户显式启动/恢复、普通批准任务、定时增量、Validation 的优先级排队，同级 FIFO。Blocked Profile 立即释放全局名额。长任务在完成一页目录、一个详情、一个评论批次、一个 ActionCommand 或一个 EvidenceBatch 后 yield，但保留 Enumeration Coordinator 对同一账号 cursor 的唯一所有权。

不得在可信输入已发出、binding sealing 或 artifact 原子封存中间抢占。Console 展示队列位置、阻塞原因、当前动作和下一个安全让出点；不能按 tab 数量分配优先级或用固定秒级中断切碎动作。

### 162. 被动观察不影响任务，用户通过显式 Take Over 安全接管

切到 tab、窗口聚焦、鼠标移动和阅读页面属于观察，不影响 lease。扩展图标、Control 页和 Console 提供“接管此页面”：无在途输入时停止后续动作、释放前台/全局输入许可、撤销 binding、结束 PageLease，并将页面转为 retained_for_review；已有输入时记录 takeover_requested，禁止后续动作，等待当前动作确定或 unknown 后再交给用户。

不在平台 DOM 注入阻断遮罩，也不锁住用户输入。用户未经入口直接 click/wheel/keyboard 时按第 108 题的意外用户活动处理：输入前良性隔离，输入后可能 outcome unknown。仅查看页面不能被误判为接管。

### 163. idle_reusable 超过 Strategy 信任窗口后转为 idle_stale

Strategy 声明 `maxIdleTrustMs`，默认十五分钟。正常 release 记录 lastReconciledAt；超过窗口只做本地状态转换为 `idle_stale`，不导航、刷新或关闭。Extension generation、document/route generation、主 frame 自刷新、target crash、identity observer 失联和用户活动也会使空闲页 stale 或 quarantine。

Acquire 遇到 idle_stale 时先执行无平台输入 reconcile，核验 session/target、document/route、规范页面身份、Strategy pageRole 和非敏感登录状态；全部通过才恢复 idle_reusable，否则 quarantine。retained_for_review 不因时间自动回池、回收或 reconcile。不得把永久 idle 信任、定时关页或复用前强制刷新作为替代。

### 164. 登录账号身份在首次绑定和每次认证 run 的关键边界核验

首次绑定由用户确认平台账号，保存稳定账号 ID 或安全 digest 与用户别名。每个 authenticated run 第一个平台动作前、登录恢复后、extension/document generation 换代后的下一动作前，以及出现账号切换/退出信号时重新核验。Strategy 只使用公开可见非敏感标识或经真实验证的只读身份投影，不读取 Cookie、Token、storage、认证请求或无关私有 myinfo response。

无法稳定证明身份时不开始平台动作，要求用户在可见页确认。账号不匹配返回 `account_identity_mismatch`，页面 quarantine、Profile 阻断动作，等待重新绑定、切回原账号或取消；不得凭昵称或头像相似度自动合并。

### 165. Page Pool 管页面可用性，Account Safety 管 Profile 动作许可

结构化错误同时携带 `pageDisposition` 与 `profileSafetyDisposition`。容量、lease conflict、stale version 不锁账号；无在途输入的用户导航、identity unverified 和 renderer crash 隔离页面并停止对应 run，但 Profile 可保持 ready；登录失效进入 authentication required；账号不匹配阻断 Profile；验证码、风控和限流使页面 risk quarantine 并持久锁定；断网/导航结果未知隔离页面、终止本 run 后回 ready，但绝不自动重试；存在在途输入的 renderer/window/Host crash 锁定当前认证 run；extension mismatch 阻断 Host 能力但不锁平台账号。

原则是页面 quarantine 不自动等于账号锁定，账号锁定也不能通过关页解除。普通断网不引入固定冷却，容量或 selector 漂移不升级为账号风险；真正的验证码、风控、账号错配和崩溃中在途动作不能被页面复用绕过。

## 批次 166–170：状态恢复、漂移治理、真实提交与 Console MVP

### 166. Gateway 通过版本化 Snapshot 与 Event Cursor 恢复页面池读模型

Browser Host 输出去敏 `PagePoolSnapshot`，包含 schema、host/browser session、snapshot revision、捕获时间、Host/Profile/Page 安全摘要、队列容量和 extension generation。每次合法状态转换递增 revision 并生成短期事件。Gateway 重连时提交上次 host/session/revision：同一 generation 且事件完整时增量回放，事件缺口时获取全量 Snapshot，Host 或 Browser Session 换代时丢弃旧缓存并重新同步。

Gateway 缓存只是 Console 读模型，不能修改 PageRecord。Snapshot 不包含 raw targetId、完整 URL、页面内容或认证材料，只使用 session-local page alias。不得把 Gateway 持久 JSON 写回 Host，也不得根据 URL 重建所有权。

### 167. Console 以状态、原因和唯一安全下一步呈现 stale 与 quarantine

idle_reusable 展示可复用与最后核验时间；idle_stale 默认不通知，Acquire 自动本地 reconcile，也允许用户手工本地核验；context changed 提供聚焦、重新规划、retain、transfer 和安全关闭；authentication required 引导用户本人登录后重新核验；verification/risk 只提供账号安全允许的人工处理；network outcome unknown 明确本 run 已停止且不会重试；retained_for_review 明确不调度不回收。

扩展 badge 只显示 active/needs-action/risk 计数，详细原因进入 Console。桌面通知仅用于登录、验证码、新权限、账号不匹配、风险锁和关键任务缺口，不为 stale、正常复用、翻页或 artifact 成功制造通知风暴。

### 168. Strategy 漂移使用独立 capability circuit breaker，不升级为账号风险

可信输入前 pageRole、target resolver 或 postcondition 稳定不变量失败时，action not attempted，返回 `strategy_drift_suspected`，页面 `quarantined / strategy_context_unverified`，Profile Account Safety 保持 ready。由同一真实页面的两类独立证据确认漂移后，按 platform/strategy/version/pageRole 打开本地 capability breaker，将能力降为 `degraded / live_revalidation_required`，阻止该精确能力的新 run，其他能力不受影响。

恢复必须重新完成视觉、DOM、XHR 侦察，修订 Strategy version，换代扩展 generation，并通过低频真实验证。禁止 selector 猜测、generic extractor、固定坐标或历史 API fallback；失败 artifact 与 drift dossier 保留。

### 169. Git checkpoint 只声明自身已验证能力，失败 canary 不冒充成功

Contracts/Browser Host core 通过真实本地 Chromium 门禁后可以独立提交，不因 B站暂时不可用否定本地能力。B站 dynamic 迁移只有真实 canary 通过才提交并标记 live verified；authentication required 暂停等待用户本人登录，不算代码失败；Strategy drift/代码失败保留失败 artifact、修复并重新验证；平台临时不可用时保持 build_ready/degraded，不宣称 live 完成；验证码/风控/限流立即停止，不为完成 Git checkpoint 重试。

失败证据不能删除或由成功结果覆盖。可以独立提交诊断文档或安全修复，但不能把失败 canary 包装为成功，也不需要回滚已经独立验证的 Host foundation。

### 170. Console MVP 提供完整浏览器运营面，不扩张为分析产品

现有本地 Gateway Console 增加 Host 连接/generation/扩展采纳与显式启动退出，Profile 平台/账号/窗口/session/安全与页面计数，Page alias/role/state/task/age/permit/reason 及 focus/take-over/retain/transfer/reconcile/close，Queue 当前动作/位置/pause/cancel/resume/block/yield，以及两阶段 Reclamation 和安全 Authentication/Risk 状态。Console 通过 Gateway Snapshot/Event 获取数据，不直连 Named Pipe。

Control 页仅保留连接状态、当前页状态、暂停、接管和紧急停止，不复制 Console。MVP 不做远程 Web 控制、云账号、团队协作、复杂分析看板、Evidence Explorer 重写或拖拽 tab 管理；目标是让用户看见状态、理解停机原因并执行安全操作。

## 批次 171：生产浏览器所有权模型修正

### 171. 正式产品部署在用户日常浏览器的扩展中，Collector 不管理任何 Browser Profile

用户日常使用的 Chrome/Edge 本身已经维持平台登录。正式 Collector 只安装 MV3 扩展并与本机 loopback Gateway 配对；不创建、启动、关闭、复制、迁移、定位或读取浏览器 Profile，也不导出 Cookie、Token、密码或 Storage。Chrome/Edge 的 Profile 仍是浏览器自身的内部事实，但不是 Collector 的产品资源。

生产 API 以 `browserBindingId` 指向已配对 extension instance，以短期 `tabLease` 指向用户明确选择的页面或扩展自己创建的可见工作标签页；不再接受 `profileId`、浏览器路径、任意 tab ID、窗口 ID、URL、selector、脚本或坐标。默认自动任务只使用扩展有明确因果记录的工作标签页，绝不接管、复用或关闭用户普通标签页；用户主动交给扩展的当前页只能被短期、受限地使用，用户导航、关闭或接管立即终止 run。

现有 Browser Host、Playwright 持久 context、Collection Profile 和 Native Messaging Host 控制链只保留为测试/隔离账号通道，不能再作为正式安装或上层服务的默认路径。日常浏览器模式的连续登录和可见交互不是绕过 CAPTCHA、风控、限流、付费限制、反自动化或平台规则的手段；account-safety、at-most-once、预算和风险停止规则继续完整适用。

## 最终一致性审计结论

2026-07-20 对第 1–170 题、产品规格、账号安全设计和当前分支实现进行了交叉审计。没有无法由“用户显式自定义 > 较晚决定 > 较早决定 > 旧规格 > 当前 POC”解决的阻塞冲突。权威覆盖关系为：

```text
139 覆盖 56 的“禁止纯逻辑单元测试”，但继续禁止 fixture 平台验证
101 覆盖 77 的“每任务一个 OS 窗口”
114 细化 80 的 Gateway restart 与 Browser Session restart
144 扩展 102 的 Collector-created 页面来源
124 / 163 扩展 104 的页面状态集合
141–149 覆盖早期扩展单体执行图和 Gateway 直接 Page ownership
137 覆盖 130 曾允许薄适配器的候选方向
165 固化 Page Pool 与 Account Safety 的职责边界
171 覆盖 101–170 中所有将受管 Browser Host / Collection Profile 作为正式生产所有权模型的规定；它们仅在 test/isolated-account lane 中继续适用
```

正式生产的权威规格为[用户自有浏览器扩展模式](user-owned-browser-extension-mode.md)。[Browser Host 与受管页面池 MVP](managed-page-pool-browser-host-mvp.md) 仅描述 test/isolated-account lane；只有真实平台验证或扩展/日常浏览器共存暴露现有规则无法决定的新选择时，才追加下一批问题。
