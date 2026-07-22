# 受管浏览器采集开发规范 v0.1

- 状态：Active development standard
- 日期：2026-07-21
- 适用范围：本仓库中所有平台策略、Browser Host、MV3 Extension、Collector Gateway、真实浏览器验证、证据产物与相关文档
- 目标架构：[Browser Host 与受管页面池 MVP](../design/managed-page-pool-browser-host-mvp.md)
- 策略开发流程：[数据源勘察工作流](../design/source-reconnaissance-workflow.md)
- 账号安全基线：[账号安全、弱网与验证码熔断设计](../design/account-safety-circuit-breaker.md)
- 产品决策来源：[Collector 决策审计](../design/collector-decision-audit.md)

## 1. 这份规范解决什么问题

本项目的产品路线是“在用户需要时，通过受管、可见、持久的真实浏览器采集公开页面已经呈现的证据”，而不是传统爬虫、私有接口模拟器或任意浏览器遥控器。

因此，开发规范不能只规定 TypeScript 格式或文件命名。它必须同时约束：

- 如何先像人一样理解真实页面，再把流程编码为策略；
- 如何把视觉、DOM、可信浏览器输入和 Network/XHR 作为并行证据面；
- 如何让页面、Profile、动作、网络观察与证据产物都有明确所有者；
- 如何在弱网、验证码、页面漂移和结果未知时停止，而不是重复触发平台动作；
- 如何证明“本地代码能运行”和“真实平台能力成立”是两件不同的事；
- 如何把一个已验证的能力、其覆盖范围和明确不覆盖的部分，如实留给后续开发者和研究 Agent。

本文是项目的默认开发约束。它不替代更精确的策略契约、账号安全设计或用户后续的显式决定；发生冲突时，按以下优先级处理：

~~~text
用户最新的显式决定
  > 后续且更具体的设计/策略契约
  > 本规范
  > 旧文档、旧代码、第三方示例和历史假设
~~~

本文描述的是目标开发方式，不把尚未完成的迁移写成已发布的平台能力。当前实现状态必须以策略成熟度、真实验证记录和对应 commit 为准。

## 2. 规范语言与基本原则

文中的“必须”表示不满足即不能合并、不能 admission 或不能继续平台动作；“应”表示默认做法，偏离时需要在策略或 run 记录中说明原因；“可以”表示在已批准边界内的选择。

所有文本文件必须以 UTF-8 读写。PowerShell 读取使用 **Get-Content -Encoding utf8**；检索使用 **rg --encoding utf-8**。不要让本机默认编码悄悄改变中文文档、策略文本或 evidence 摘要。

所有变更都遵循四个总原则：

1. **先证明，后编码。** 旧 selector、旧脚本、第三方仓库和历史接口文章只能是待验证假设。
2. **最小能力。** 每一个字段、网络 route、权限和用户输入都必须有明确目标；“通用一点以后可能有用”不是扩大能力面的理由。
3. **真实但克制。** 平台能力由低频、只读、真实页面验证；遇到不确定性时保守停止，不用重试、换代理或模拟规避。
4. **事实与推断分开。** 一个结果可以是 DOM 已渲染、UI 选中态变化、route 被观察到、字段投影完成或任务目标满足；它们不能互相偷换。

## 3. 产品边界：受管浏览器，而不是通用爬虫

目标执行链如下：

~~~text
Research Console / DeepResearch
              |
              v
Collector Gateway
任务、计划、预算、账号安全、artifact、coverage
              |
              v
Collector Browser Host  <------>  Native Messaging Bridge
Chromium 生命周期、页面账本、         |
PageLease、可信输入、回收             v
                              MV3 Collector Extension
                              页面语义、DOM、精确 XHR 投影
              |
              v
用户管理的持久、可见 Collection Profile
~~~

以下边界是硬约束：

- 不导出、导入、注入、分发 Cookie、Token、密码、浏览器 storage 或 Profile 凭据。
- 不绕过登录、验证码、付费限制、访问控制、限流、风控或其他平台安全措施。
- 不执行点赞、关注、收藏、评论、私信、发布、删除等改变平台状态的动作，除非用户另行明确授权该具体行为。
- 不提供任意 selector、任意 JavaScript、任意 CDP、任意 Playwright evaluate、任意 tab、任意坐标或任意 HTTP 请求的产品接口。
- 不让模型在运行时生成并直接执行平台点击脚本；策略必须是静态、版本化、可审阅的已构建代码与声明。
- 不复制、集成、运行第三方平台爬虫仓库作为产品数据源。它们只可帮助提出勘察问题，不能成为 runtime dependency 或 production adapter。
- 用户配置的固定浏览器网络代理可以是 Profile 的正常网络环境；系统不得读取代理凭据、自动轮换代理、维护账号池或把代理用于规避平台限制。

这条路线利用用户正常浏览器 Profile 中已有的登录状态，但不把浏览器上下文误称为“绕过访问控制”。

## 4. 分层职责与单一所有者

| 层 | 必须负责 | 明确不负责 |
|---|---|---|
| Collector Gateway | Research Task、EvidencePlan、预算、调度、账号安全、artifact、coverage、面向 Console 的读模型 | 直接拥有 Chromium、Page、原始浏览器输入或页面账本 |
| Collector Browser Host | Chromium / Collection Profile 生命周期、PageRecord、PageLease、可信 mouse/keyboard/wheel 输入、输入前后的上下文核验、回收与去敏 journal | 平台字段语义、DeepResearch 编排、Evidence Vault 的业务解释 |
| MV3 Collector Extension | 精确 tab/document/run 绑定、版本化 Platform Strategy、固定 DOM 投影、被批准的 route-bound response 投影 | 长期密钥、文件系统、浏览器进程生命周期、任意可信输入 |
| Contracts | 跨包数据结构、版本、错误和窄命令契约 | 平台特化 DOM 逻辑、运行时副作用 |

依赖方向必须保持单向：

~~~text
Gateway -----------> Contracts
Browser Host ------> Contracts
Extension ---------> Contracts（浏览器安全子集）
Gateway -----------> Browser Host 的认证 IPC client
~~~

Browser Host 是当前 browser session 内页面资源账本和状态机的唯一写入者。Gateway 缓存只能是读模型；Extension 只能提交绑定到精确上下文的观察结果。不得让三个进程分别维护 lease、页面所有权或动作结果。

## 5. 平台策略必须从真实勘察开始

每一个新平台、新页面角色、新字段集合或新主动交互都按以下顺序开发：

~~~text
窄的证据需求
  -> Source Reconnaissance Dossier
  -> 独立可见浏览器中的人类路径复现
  -> 视觉 + DOM + Network/XHR 并行勘察
  -> 字段到证据表面的逐项映射
  -> 最小方案和动作契约评审
  -> 静态、版本化策略实现
  -> 本地真实 Chromium 门禁
  -> 低频真实平台 canary
  -> review + explicit admission
~~~

### 5.1 先界定需求，而不是先写 selector

在任何 production selector、action graph 或 response route 出现之前，Dossier 必须写清：

- 研究问题、目标平台、页面角色和预期终态；
- 目标是广度目录、详情、账号上下文、账号归档、评论样本还是其他明确对象；
- 必需、重要、可选、禁止保存的字段；
- 匿名或用户管理登录态的覆盖要求；
- 页数、详情、评论、媒体、交互和时间预算；
- 可接受的 partial 定义、已知覆盖盲区与停止信号。

“尽量多抓”“顺便把所有数据保存下来”“先找接口再说”不是合格需求。需求不清时，能力状态保持 **unresearched** 或 **reconnaissance_in_progress**，Planner 不得把它变成可批准的采集 stage。

### 5.2 先复现人的正常路径

侦察开始时，暂时忘掉已有 Extension、Gateway runner、content script、selector 和 route 假设。使用专用、可见、持久的 Validation Browser Profile，在真实页面中按人类会走的路径操作：

~~~text
平台原生入口
  -> 关键词输入 / 已知 URL / 博主主页
  -> 观察当前页面状态
  -> 必要时使用筛选、排序、翻页、展开、详情或评论入口
  -> 判断可靠终点、懒加载、分页、登录门禁、验证和异常状态
~~~

不得把外部搜索结果冒充站内搜索结果，不得通过私有请求重放、签名复刻、Cookie 导出或页面状态篡改来缩短研究路径。

临时侦察浏览器与产品管理的 Collection Profile 必须区分。临时 context 在实验结束时关闭；产品 Profile 的单次 run 结束不等于关闭整个浏览器会话。

### 5.3 视觉、DOM 与 Network/XHR 必须并行

三面观察各自回答不同问题，不能互相代替：

| 证据面 | 回答的问题 | 开发时必须注意 |
|---|---|---|
| 视觉 | 人真正看见什么、控件层级如何、hover/遮罩/播放器/滚动是否影响可操作性 | 使用可见浏览器与截图；不要把截图像素直接当 CSS 坐标 |
| DOM | 哪个元素有语义、真实 active/selected 状态在哪、字段何时已渲染 | 优先 role、aria、data 属性和结构关系；每次页面显著变化后重读 DOM 与边界框 |
| Network/XHR | 正常页面动作是否触发语义相关的数据流、响应何时到达、是否有状态差异 | 导航前开始观察；记录动作前后时间线，不因请求时间接近就错误归因 |

开发者必须区分以下事实：

~~~text
已渲染到 DOM                不等于当前像素视口可见
UI active/selected 已变化   不等于列表/详情数据已经替换完成
看见目标 route              不等于允许把它当作私有 API 调用
收到成功 status              不等于产品目标已经满足
一次人工成功                不等于 production strategy 已验证
~~~

页面布局可能在点击后重排。例如分页点击后页面回到顶部，原鼠标位置可能落到视频卡片或播放器区域。任何可信输入策略必须把布局变化视为新的上下文：重新读取实时 DOM/边界框，并在必要时把指针移动到已审计的非交互中性区域，避免后续 hover 或媒体请求被误判为目标动作后果。

### 5.4 字段逐项选择证据表面

不得把整个平台简单标为“DOM 方案”或“接口方案”。每个输出字段和关键状态都必须在 Dossier 中有一行映射：

| 输出字段/状态 | 页面是否正常可见 | DOM 稳定性 | 响应候选 | 是否需交互 | 最终表面 | 选择原因 | Fallback |
|---|---:|---:|---|---:|---|---|---|
| 示例：标题 | 是 | 高 | 有但非必要 | 否 | visible DOM | 最小且可解释 | layout changed |
| 示例：下一页已加载 | 间接可见 | 中 | 有 | 一次分页点击 | DOM + metadata | 需要同时证明 UI 与数据更新 | partial 并停止 |

选择规则是“满足需求的最小、最稳定、最可解释手段”：

1. DOM 已稳定覆盖的字段，不为数据结构漂亮而扩大到 response observation。
2. DOM 需要脆弱猜测而页面正常响应能稳定映射到公开可见字段时，可采用精确 response projector。
3. 内容只有在平台正常筛选、展开、翻页或进入详情后出现时，才加入有上限的语义动作。
4. 混合方案允许存在，但每个字段必须声明来源表面、字段白名单和 fallback。
5. 任何方案不能可靠满足契约时，能力保持 draft / build_ready 或返回 capability gap；不得交付“差不多能抓”的策略。

### 5.5 Dossier 是实现的前置产物

每个候选能力在 **docs/reconnaissance/<platform>/** 下建立独立 Dossier，至少记录：

- 需求、边界、Profile 类别和预算；
- 人类浏览路径、页面角色和状态矩阵；
- DOM、Network/XHR、交互和字段映射证据；
- 候选方案及被否决方案；
- 覆盖范围、自动导航/媒体行为、失败语义和已知盲区；
- strategy ID / version、权限、批准 route、真实验证矩阵和 admission 结论。

实现过程中发现页面行为与 Dossier 不一致时，必须回到勘察并更新文档；不得静默扩大 selector、route、权限、动作预算或数据表面。

## 6. 窄的可信输入，而非“浏览器遥控接口”

平台动作必须是源专属、typed、可审阅的能力。例如“B 站账号投稿目录从第 1 页切换到第 2 页”可以是一个固定动作；“点击任意 selector”“执行任意 JS”“在任意 x/y 点击”不可以是能力。

每个会触发平台行为的命令至少绑定：

- 精确的 PageLease、Profile、run、pageRole、record version 与 document generation；
- 稳定 actionId 和有界 deadline；
- 已批准的 Strategy、目标状态和动作预算；
- 输入前的实时目标 ticket 或经审计的实时定位；
- 明确的前置条件、至多一次输入、后置条件和失败 disposition。

标准动作链如下：

~~~text
Gateway 逐动作批准
  -> Host 校验 lease / record / safety / budget
  -> Extension 解析一次性语义 target
  -> Host 再校验上下文并取得输入 permit
  -> 先持久记录 attempted
  -> 浏览器级输入至多一次
  -> Extension/Host 观察声明的 DOM/XHR 后置条件
  -> Host 记录 completed / failed / outcome_unknown
  -> Gateway 封存 evidence 与 coverage
~~~

以下方式不能作为可信人类交互的证明或 production 输入实现：

~~~text
HTMLElement.click()
dispatchEvent(new MouseEvent(...))
content script synthetic pointer event
直接修改 class、style 或页面 application state
侦察时记录下来的硬编码旧坐标
~~~

对 hover 菜单、字幕、评论展开、筛选、排序、分页等交互，必须先用浏览器级输入证明人类路径可行。输入时按顺序执行：

1. 读取目标的实时边界框、可见性与遮挡；
2. 记录动作前状态，确认目标尚未满足；
3. 用浏览器级 mouse move 到实时中心；若目标依赖 hover，先只 hover；
4. 确认菜单/浮层/最终目标真实出现；
5. 重新读取最终目标的实时边界框；
6. 只发送一次 click、wheel、筛选、展开或提交；
7. 把结果未知也写成 attempted，不得为了确认再做一次。

可能触发 XHR 的动作必须先完成 ObserverBinding。binding 绑定精确 route、MIME、document/route/action generation、PageLease、大小/数量上限和短 deadline；未 ready 时不输入，迟到、跨页、跨动作或超预算的观察结果必须拒绝。

## 7. Network/XHR 的最小化与证据归因

默认的网络观察只允许保存如下 metadata：

~~~text
HTTP method
origin
去 query / fragment 的 pathname
status
必要时的 MIME、大小、receivedAt 和动作阶段
~~~

默认禁止读取、显示、持久化或提交：

~~~text
Cookie、Token、密码、浏览器 storage
request header、request body、response header
URL query、fragment、签名、游标原值
raw response body、HAR、未白名单字段
~~~

只有同时满足以下条件，才可以为某个精确 route 设计受限的 response projector：

1. 目标字段在页面正常呈现且属于已批准 EvidencePlan；
2. 字段—页面可见性映射已经在真实页面勘察中证明；
3. DOM 无法稳定、最小地覆盖该字段，或 route 仅作为必要控制状态；
4. projector 只输出白名单字段，游标和内部状态不进入长期 Evidence；
5. route、MIME、数量、大小、document/route/action generation 都受 binding 限制；
6. 真实 canary 证明观察不会扩大认证或隐藏数据表面。

请求出现不能单独证明动作成功。对会触发网络的 UI 动作，默认要求同时成立：

- 视觉上出现人可见的菜单、选中态、内容面板或结果变化；
- DOM 出现对应的 active/selected、可见面板或数据后置条件；
- Network 中出现语义匹配、位于动作窗口内且能与页面结果对应的新 metadata。

如果操作按设计不触发网络，至少保留视觉与 DOM 两个独立证据面。

## 8. Collection Profile、页面池与浏览器生命周期

### 8.1 页面所有权先于页面复用

页面所有权只能来自当前 Browser Session 的本地因果账本：

~~~text
direct_created
  Host reserve -> create about:blank -> register -> navigate

action_created
  已批准动作创建新 target，且 opener/action epoch/后置身份匹配

unmanaged / user_owned
  当前 session 账本之外的一切 tab
~~~

URL、标题、DOM marker、query、tab 顺序和“看起来像是上次打开的页面”都不能建立所有权。它们最多用于核验已拥有页面是否仍符合预期身份。

只有同时满足以下条件的 tab 才能复用：

- 当前 Browser Session 的 Host 账本明确拥有它；
- 无 active lease 或 input permit；
- 状态为 **idle_reusable**，且 identity/pageRole/platform 仍与新任务兼容；
- 没有用户接管、验证、登录、风险、未知导航或页面漂移迹象；
- 如果已超过 Strategy 信任窗口，先执行只读本地 reconcile，不能导航、刷新、点击或滚动。

**idle_stale**、**retained_for_review**、**quarantined**、**reclaim_pending**、**leased** 和一切 unmanaged 页面都不得被自动复用或按 URL 认领。

### 8.2 正常结束不等于关闭浏览器

Browser Host 是 Chromium / Collection Profile 生命周期的唯一拥有者。正常 run 结束时：

- 最终目标页保留供视觉、DOM、Network 复核；
- 身份仍匹配且无风险时释放为 **idle_reusable**；
- 用户要求检查或不宜自动复用时进入 **retained_for_review**；
- 页面身份改变、动作结果未知、观察器丢失、验证码或风控时进入 **quarantined**；
- 不在 finally 中自动 close 页面，不因 run 成功自动关闭浏览器。

Gateway 退出或重启不应关闭健康的 Browser Host / Chromium。只有显式关闭 Collection Profile、显式退出 Browser Host、用户主动关窗，或经过两阶段回收 plan + execute 后，才可以结束相应页面或会话。

临时 DevTools、临时侦察浏览器、headless extension 版本探测 context 和独立调试端口则必须在其用途结束时清理。残留审计要区分“产品有意保留、可解释的窗口”与“未解释的泄漏”。

### 8.3 防止异常 tab、扩展页和闪退循环

扩展版本恢复只能在无界面探测阶段进行：

1. 检查 manifest version、真实 worker runtime marker 和 control revision；
2. 三者一致时直接进入唯一可见 Collection Window；
3. 不一致时最多执行一次本地 runtime reload，再用独立无界面 context 精确复核；
4. 仍不一致则本地失败，保持可见窗口不被重启，也不再打开新的可见 context；
5. 禁止自动打开 chrome 扩展管理页，禁止累计 chrome-extension tab，禁止循环重启浏览器。

每次受管 Profile 冷启动都必须读真实 worker marker；持久记录或 manifest 文件版本都不能单独证明实际 MV3 worker 已经升级。

### 8.4 扩展发布批次：代码迭代不等于升级

**修改工作树、运行本地测试、提交代码，都不是对 Collection Profile 的扩展升级。** 受管登录态是稀缺且有风险的真实验证环境；不能把每一个小修复都变成一次 Browser Host 退出、Chromium 重启、MV3 重新加载和实网 run。

以下三个概念必须分开记录：

| 概念 | 含义 | 是否接触已登录 Collection Profile |
|---|---|---|
| 本地开发批次 | 策略、projector、Gateway 或纯函数代码的连续修改；可运行 typecheck、unit、integration 和隔离的本地基础设施验证 | 否 |
| 部署批次 | 已收敛的一组改动准备交给受管 Profile；一次构建、一次明确的 Host 生命周期切换、一次计划内真实验证 | 是，且只能按计划一次 |
| 兼容性升级 | MV3 runtime / Native Bridge / control-surface 的兼容性身份发生实际变化 | 仅在部署批次中发生 |

因此，以下情况**不得**单独触发版本或 control-surface revision 递增，也不得为了“看看新代码”立即重启已登录浏览器：

- 单个 DOM projector、字段投影、可见性判断、混合卡过滤或 artifact 映射修复；
- 文档、测试、日志、诊断或本地构建脚本改动；
- 尚未通过本地验证、仍可能与同一能力的其他问题一起收敛的代码；
- 仅为了让一次临时真实 run 带上新的版本号或日志标签。

`COLLECTOR_EXTENSION_VERSION` 不是逐 commit 计数器。它只在有意形成新的 MV3 部署兼容性边界时变更，例如 manifest / 权限 / runtime bootstrap 的兼容性变化，或明确发布新的受管扩展包。`COLLECTOR_CONTROL_SURFACE_REVISION` 更窄：只在 Browser Host 与 extension 的 Native Bridge、命令/结果形状或 control-surface 语义不兼容时递增。策略实现本身应由 strategy ID、strategy version、commit/build 证据和 artifact manifest 追踪，而不是滥用全局 revision。

一个真实部署批次必须满足以下顺序：

1. 先在 worktree 中收敛同一能力的改动，并完成相关本地验证；
2. 明确写出本批次的能力边界、预期实网动作和停止条件；
3. 在没有 active lease / active run 时，至多进行一次受控 Browser Host 生命周期切换；
4. 使用该批次唯一的新运行时执行计划内的低频真实验证；
5. 将结果、版本身份、artifact 与未覆盖范围写入验证记录。若发现新的非紧急缺陷，回到本地开发批次，而不是立刻串行发布下一版。

Browser Host 的冷启动 marker-first probe 仍然必须存在：它解决的是“已部署版本的 worker 是否真的被 Chromium 执行”的正确性问题，不是发布触发器。版本匹配时它必须是零 reload 的本地预检；版本不匹配时最多一次无界面 reload。不得把它描述为、或扩展为，每次代码编辑后的自动升级流程。

## 9. 账号安全、失败模型与 at-most-once

平台动作的韧性不是“失败后尽快重试”，而是“结果未知时不再扩大风险”。每个 Profile × 平台维护独立、持久的安全状态和 run/action ledger：

~~~text
ready
  -> running
      -> ready     成功、普通失败、断网、弱网、超时；本轮不重试
      -> locked    验证码、风控、限流、账号错配、在途动作时崩溃、用户暂停

locked
  -> ready         仅由明确人工解锁恢复
~~~

每个 run 具有唯一 runId；每个语义动作在真实输入前写入 attemptedActionIds。输入已投递但结果未知，也视为已经尝试。网络超时、DOM 未变化、结果丢失或页面卡住，不能成为第二次点击、刷新、重新导航或自动补发旧动作的理由。

以下信号一旦出现，当前 run 必须停止新的平台动作：

| 信号 | 页面 / Profile 处置 | 自动恢复是否允许 |
|---|---|---|
| 验证码、异常访问、风控、访问频繁、明确限流 | 当前页面冻结或 quarantine；Profile 进入 locked | 否；用户完成必要身份处理并显式解锁后才可新建 run |
| 登录失效、账号身份无法确认、跳转到登录页 | 停止，页面保留供人工查看；按风险语义 locked | 否 |
| 断网、弱网、导航失败、run deadline、动作结果未知 | 结束当前 run，页面 quarantine，Profile 回 ready | 不重放旧 run；只可在常设授权下从新的独立 run 开始 |
| 页面角色、document、规范身份或 action context 改变 | 停止并 quarantine | 否 |
| 同一 actionId 已存在、同 Profile 有 active run | 拒绝命令 | 否 |
| 用户关闭 Collection Window | 视为外部终止信号 | 不自动重开 |

只有本地、幂等、不会触及平台的控制面操作可以有界重试，例如 Snapshot 读取、Extension worker 探测、loopback evidence 提交和已知幂等的控制消息。它们必须与平台导航、点击、滚动、翻页、筛选、评论展开和字幕选择在代码与日志中明确分开。

默认预算以账号安全设计为准：同一认证 Profile 同时最多一个实网 run、每个语义动作至多一个用户事件、每个 run 有总 deadline。任何提高页数、详情数、评论数、交互数或并发的要求必须写入计划、动作账本和策略配置；AI Planner、DeepResearch 或失败恢复逻辑不能因为结果不足自行提高预算。

## 10. 数据、Evidence 与诊断日志

本项目允许 raw-first 的本地证据路线，但“原始”不等于“无边界地保存浏览器内部数据”。每份长期 Evidence 至少应能回答：

| 最小信息 | 目的 |
|---|---|
| stable identity | 区分同一内容、账号或页面对象 |
| canonical target / page role | 知道证据来自哪个明确页面语义 |
| strategy ID / version | 知道由哪一套已审阅规则产生 |
| Profile 类别和可见性边界 | 区分匿名、用户管理登录态和页面正常可见表面 |
| coverage / budget | 知道采到多少、未采什么、是否耗尽 |
| action ledger / terminal reason | 知道是否真的完成、为何 partial 或停止 |
| artifact digest / manifest | 支持完整性核验与后续引用 |

数据面必须分离：

| 产物 | 可以包含 | 不得包含 |
|---|---|---|
| 加密本地 Evidence Vault | 页面正常公开可见、且 EvidencePlan 允许的字段；公开联系方式若页面可见且已批准可保留 | 凭据、隐藏状态、未呈现 response 字段、未批准媒体/下载 |
| 去敏 runtime journal、console telemetry、Git 文档 | 版本、状态、digest、计数、去 query 路由、终态和安全原因 | 页面正文、查询词、账号身份、公开联系方式、原始 URL、截图路径、认证材料、raw response |
| 临时验证材料 | 经当场去敏且有用途的最小实验摘要 | HAR、完整请求/响应、Profile 目录、Cookie、Token、密码、验证码内容 |

页面公开可见信息被写入长期 Evidence 时，仍应受本地加密、容量预算、版本化 schema、hash manifest、损坏隔离和授权读取约束。公开信息能进入 Vault，不代表它可以进入日志、终端输出、commit 或远程 CI。

## 11. 代码设计与演进规则

### 11.1 以职责拆分，而非以临时流程堆叠

文件变长时，不按机械行数随意拆分；按稳定职责拆分。以下情形应拆成独立模块：

- 跨包契约、平台语义、可信输入、artifact 序列化和 Gateway 编排混在同一文件；
- 一个函数同时解析 DOM、发输入、解释响应、修改风险状态和写磁盘；
- 可测试的纯投影/状态机被 browser I/O、时间等待或 IPC 掩盖；
- 平台特化逻辑开始影响其他平台的通用生命周期边界。

推荐把“固定平台投影”“受限平台动作”“Host 页面账本”“Gateway runner / artifact”和“纯数据转换”按责任分开。拆分后的依赖必须仍然遵守第 4 节的方向；不要为了减少文件数量让 Gateway 直接持有 Page，或让 Extension 直接写本地 Vault。

### 11.2 不提供泛化逃生通道

每当新功能似乎需要“一个通用 helper”时，先证明它不会成为任意控制接口。通常正确的抽象是：

~~~text
受限的 Host 原语
  + 固定 source-specific action
  + 已批准的 Strategy / ticket / binding
  + 精确的 lease、generation、budget 和终态
~~~

不是：

~~~text
任意 selector
任意脚本
任意 URL
任意坐标
任意 browser page
任意 response route
~~~

错误必须使用版本化、结构化的错误契约，至少表达 code、category、scope、terminality、retry class、是否已经触发平台动作、页面 disposition、Profile safety disposition 和去敏 details。不得从 Error.message 文本猜测状态。

### 11.3 零兼容迁移

当目标架构替换旧生命周期、旧 endpoint 或旧 ownership 模型时，采用一次性迁移：

- 同一 checkpoint 中迁移全部调用点、Console 读模型、构建脚本和文档；
- 删除旧 API、旧字段、adapter、dual write 和 fallback；
- 保留正常的用户登录状态和专用 user-data-dir，但不允许旧 runtime 数据重新建立页面所有权；
- 使用构建门禁扫描旧 symbol，防止“新旧两套都保留一阵”的隐性分叉。

兼容层只有在用户明确要求且安全边界可证明时才能引入；本项目当前的默认是零兼容。

## 12. 验证证据与能力成熟度

测试必须回答“它证明了什么”，而不是只回答“它是否绿色”。三类验证的证据强度不同：

| 验证层 | 合法用途 | 能证明 | 不能证明 |
|---|---|---|---|
| 纯逻辑单元测试 | reducer、schema、canonicalization、预算计算、纯 projector | 算法和状态转换 | Chromium、Extension、页面行为或平台能力 |
| 本地真实 Chromium 门禁 | 离线 about/data 页面、真实 MV3、Native Messaging、Browser Host 生命周期、IPC、lease、输入去重 | 本地执行面、进程/浏览器生命周期和安全边界 | 任一真实网站的 selector、交互、XHR 或字段能力 |
| 低频真实平台 canary | 项目管理、可见、用户控制的 Profile 中的只读真实页面 | 精确版本策略在明确页面/账号类别/预算下的能力与失败语义 | 其他页面、其他账号、未验证字段、全量分页或长期稳定性 |

以下材料不得冒充真实平台能力证据：

~~~text
平台 HTML fixture
fake XHR
fake Gateway
synthetic page clone
第三方 README 或 issue
旧接口文章
一次人工成功但没有 production 闭环
~~~

纯逻辑可以有 unit tests；Chromium、Extension、Native Messaging、页面池、重连和浏览器生命周期应使用真实本地执行面；平台能力必须用低频真实站点 canary。远程 CI 不得访问平台或使用用户登录态。

策略成熟度统一使用：

~~~text
unresearched
  -> reconnaissance_in_progress
  -> strategy_draft
  -> build_ready
  -> live_anonymous_verified | live_authenticated_verified
  -> suspended
~~~

**build_ready** 只代表代码、构建产物和本地门禁满足要求，不代表平台能力。每次真实 canary 必须清楚记录：

- 精确 strategy ID / version、页面角色、Profile 类别和验证时间；
- 导航、hover、click、scroll、详情、评论和 response body 的实际计数；
- 每个语义动作的 attempted / completed / unknown 状态；
- 视觉、DOM、Network 的独立后置条件；
- 成功、partial、failed、locked 或 capability gap 的终态；
- 明确覆盖了什么、明确没有覆盖什么；
- 去敏 artifact digest，而不是原始页面材料或认证材料。

任何 selector、策略、Host 输入、权限、response route、状态机或页面生命周期改动，都应按影响范围重新跑相应的本地门禁。影响真实平台行为时，还必须安排新的、低频、独立 real canary；旧 canary 不能替代变更后的验证。

## 13. 文档、Git 与交付纪律

开发过程必须留下能被人和后续 Agent 理解的记录：

1. 新能力先有 Dossier，后有 production strategy；
2. Dossier 完成后，把真实侦察结论、未覆盖范围和失败语义写入对应平台文档；
3. 策略实现、构建/本地门禁、真实 canary、产品 admission 分成可审阅的 checkpoint；
4. 每个 commit 只声明自身已经验证的事实，失败 canary 也要保留事实和终态，不能为“看起来完成”而改写结论；
5. 新发现若改变产品规则，先更新决策账本/设计文档，再修改实现；不得悄悄扩大行为。

推荐的提交粒度：

~~~text
研究/设计冻结
  -> contracts 或单一 Host/Extension/Gateway 能力
  -> 对应 typecheck、build、local Chromium gate
  -> 去敏的真实 canary 记录
  -> strategy admission 或能力矩阵更新
~~~

提交前至少执行：

- 只暂存本次改动涉及的文件，保留无关 dirty worktree；
- 运行与变更相称的 typecheck、build、契约或生命周期门禁；
- 执行 diff --check；
- 检查文档链接、strategy version、maturity 与实现事实一致；
- 检查 Git 中没有 .env、Profile、runtime、截图、下载、日志、endpoint、credentials、原始 response 或其他本机运行材料；
- 用清楚、可追溯的 commit message 描述能力或修复，而不是笼统的 update。

真实侦察文档必须是去敏文字证据。不要把原始 title、BVID、账号昵称、URL query、截图路径、Cookie、Token、Profile 路径或完整网络输出复制进 Git。

## 14. 可直接执行的检查清单

### 14.1 开始一个新平台能力前

- [ ] 已把目标缩小为一个明确页面角色与证据目标。
- [ ] 已定义 must / should / optional / forbidden 字段与页数、详情、评论、交互预算。
- [ ] 已建立对应 Dossier，且没有把第三方代码当作实现输入。
- [ ] 已选择独立可见 Validation Profile 或明确记录为何复用受管 Profile。
- [ ] 已在导航前建立 Visual、DOM、Network/XHR 三面观察。
- [ ] 已记录正常、空结果、未登录、验证、限流、不可达和布局漂移的状态语义。

### 14.2 把一个人类交互编码前

- [ ] 已在真实页面以浏览器级输入证明该动作可行。
- [ ] 已证明语义目标、实时边界框、hover/遮挡和最终交互元素，而非只找到一个文本节点。
- [ ] 已定义输入前置条件、一次性 actionId、最大次数、deadline 和 stop conditions。
- [ ] 已在输入前准备必要的 ObserverBinding。
- [ ] 已定义视觉、DOM、Network 三面后置条件；不触发网络的动作至少有视觉 + DOM。
- [ ] 已处理动作后重排、鼠标落点变化、自动播放、popup、导航和结果未知。

### 14.3 真实 canary 前

- [ ] 当前 Strategy、Extension、Host、Gateway 均来自已构建且已通过对应本地门禁的版本。
- [ ] Profile 账号安全为 ready、无 active run、无遗留 input permit / PageLease。
- [ ] 当前 run 的页面、动作、详情、评论、网络观察和时间预算已明确。
- [ ] 确认是只读行为；没有任何绕过验证码、限流、登录或付费限制的路径。
- [ ] 已准备去敏 artifact 与终态写入位置，但不会收集 credentials 或原始网络材料。
- [ ] 已明确成功、partial、locked、unknown 时不重试、不刷新、不重开、不换代理。

### 14.4 提交或 admission 前

- [ ] 验证记录精确说明“已证明什么”和“仍未证明什么”。
- [ ] build_ready 与 live verified 没有混用。
- [ ] 公开页面信息、诊断日志、Git 交付物三者的数据边界没有混用。
- [ ] 真实平台证据不是 fixture、fake Gateway、fake XHR 或合成页面。
- [ ] commit 中没有本机 runtime、Profile、凭据、截图、原始页面/网络材料。
- [ ] 相邻的设计文档、能力矩阵、Dossier 和 implementation status 已同步。

## 15. 规范的演进

这份规范应随着真实平台事实和产品决定演进，但变化必须可追溯：

- 页面 drift、验证码、异常 tab、worker mismatch 或未知动作结果首先是事实记录，不应被悄悄“修成成功”；
- 若现有规则无法决定新问题，再发起有限的产品决策讨论，并把结论记入决策账本；
- 新策略只在完成自己的真实证据链后才提升成熟度，不能借用相邻平台或旧版本的成功；
- 性能、并发和覆盖提升必须服从账号安全、最小权限和 Evidence 可解释性；
- 文档、契约、代码与真实 canary 是同一项能力的四个侧面，任何一面缺失时都不应过度声称完成。

项目的长期价值不在于拥有多少个看似可用的爬取脚本，而在于能在需要时，以可解释、可复核、可停止的方式安全地理解并采集一个真实页面。
