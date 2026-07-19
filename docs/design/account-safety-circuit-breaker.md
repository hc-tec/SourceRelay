# 账号安全、弱网与验证码熔断设计

- 状态：Accepted product safety gate；implemented；项目开发/验证采用常设实网授权，不再使用逐次聊天授权门禁
- 日期：2026-07-19
- 适用范围：所有使用 `user_managed` Collection Profile 的实网页面导航、语义动作、response reconnaissance 和正式采集 stage
- 优先级：高于数据覆盖、任务完成率、自动恢复和吞吐量

## 1. 问题与结论

用户明确指出：断网、弱网、页面卡顿、验证码和平台风控可能使自动化误以为动作没有成功，继而重复点击、刷新或打开页面；这类行为可能导致账号被限制甚至封禁。产品不能把“重试直到成功”当作默认韧性。

本系统采用以下总原则：

```text
不确定是否成功
  -> 停止下一平台动作
  -> 保存去敏检查点
  -> 冻结目标页，不再输入
  -> ready 或 persistent lock
  -> 告知用户真实原因
  -> 由代理在常设授权下创建新的独立 run；不得恢复或重放旧 run
```

自动恢复仅适用于本地控制页、扩展 service worker、状态查询和 Evidence 幂等提交。它不得自动重放平台导航、点击、滚动、翻页、筛选、评论展开或字幕选择。

## 2. 现有循环与风险分类

| 机制 | 频率/上限 | 是否触碰平台 | 当前性质 | 安全决定 |
|---|---:|---|---|---|
| Console workspace refresh | 3 秒 | 否，只读 loopback Gateway | 本地状态轮询 | 保留 |
| Gateway validation snapshot polling | 0.5 秒，35–50 秒 | 否，只读扩展状态 | 本地状态轮询 | 保留，但终态后立即停止 |
| Source DOM interval sampling | 0.5 秒，有总量上限 | 只读当前 DOM，不导航/点击 | 观察 | 保留，验证码终态后停止 |
| Content script readiness sampling | 0.5 秒，30 秒 | 只读当前 DOM | 观察 | 保留；不得刷新页面 |
| Content bundle injection recovery | 0.5 秒，最多 20 次 | 注入同一幂等本地 bundle，不发平台动作 | renderer 恢复 | 保留；marker 与 single-flight 必须存在 |
| Gateway preflight redelivery | 30 秒 | 否 | 签名控制消息重投 | 保留 |
| Approved dispatch redelivery | 30 秒 | 间接相关 | 已有 `task + stage` lease 时复用窗口 | 保留，但 risk lock 必须先于首次 dispatch；不得创建第二窗口 |
| Evidence submission retry | 有界/幂等摘要 | 否，提交 loopback Gateway | 本地证据提交 | 保留 |
| Extension control/version recovery | 每次冷启动一次 headless probe；仅不匹配时 reload 一次并增加第二个 headless verify context | 否，只操作本地扩展 worker 与 Control | 本地扩展恢复 | 历史版本不能跳过实际 marker 检查；禁止 `chrome://extensions`、可见恢复页和可见 context 自动重启 |
| Authenticated interaction runner | 每动作一次 | 是 | 真实平台动作 | 必须新增持久熔断、at-most-once ledger 和弱网检查 |

“有循环”不等于危险；危险边界是循环能否再次产生平台可观察的导航或用户事件。代码审查和构建门禁必须保持这个区分。

## 3. 风险状态机

每个逻辑 Profile × 平台保存独立状态，状态文件只含逻辑 ID、时间、错误码和 run/action ledger，不含路径、Cookie、Token、页面正文或账号身份。

```text
ready
  -> running
      -> ready          成功、普通失败、断网、超时、弱网；本轮不重试
      -> locked         验证码、风控、限流、run 崩溃/中断、用户暂停

locked
  -> ready              仅用户显式确认风险并解锁
```

Gateway 启动时若发现上次状态仍为 `running`，必须转换为 `locked / previous_run_interrupted_manual_review_required`。进程重启不得被用来绕过熔断。

## 4. 硬停止信号

以下信号一旦出现，本轮不得再执行任何平台动作：

- 公开页面出现验证码、安全验证、异常访问、风险验证或访问频繁；
- HTTP/页面状态明确显示 rate limited；
- `navigator.onLine === false`；
- 页面导航失败或超过总运行 deadline；
- 单一动作短窗中出现多个 Fetch/XHR request failure；
- 登录身份丢失、跳转到登录页或账号状态无法确认；
- 页面角色、规范 URL 或 document context 改变；
- 同一语义 action ID 已经出现在当前 run ledger；
- 同一 Profile 已有另一个 active run；
- Gateway 重启后发现未正常完成的 run。

验证码、风控、限流和登录失效进入 `locked`，绝不自动刷新、点击验证、切换代理、重新登录或稍后自动续跑。断网、弱网、超时和普通失败立即结束本轮并回到 `ready`；没有计时冷却。代理可以在项目常设授权下新建独立 run，但不能后台恢复、补发或重试已经失败/未知的旧 run。

## 5. At-most-once 语义动作

每次 run 创建不可重复的 `runId`；每个语义动作在执行前写入 `attemptedActionIds`。动作结果未知也视为已尝试，不能因没有看到 DOM 或网络结果而再次触发。

```text
check risk state
  -> write action intent once
  -> re-check page safety
  -> dispatch at most one user event
  -> observe bounded postcondition + network tail
  -> re-check page safety
  -> checkpoint outcome
  -> next action or stop
```

Playwright 对 actionability 的等待不等于重复点击；但业务代码不得在 catch/timeout 后再次调用 `.click()`。一个语义动作可以有多个只读 selector 候选，但只能选中一个元素并分发一次用户事件。

“用户事件已经投递”和“业务后置条件已经成立”必须分开记录。以字幕为例，点击字幕控件后只有在 2.5 秒有界窗口内观察到语言、关闭或字幕设置等菜单信号，`open_caption_menu` 才能返回 `completed`；否则返回 `postcondition_unmet`。依赖菜单的语言选择直接记为 `prerequisite_unmet / attempted=false`，不得为了等待菜单再次点击字幕控件。

run 的 `completed` 也不能由“至少一个动作完成”推导。每个 scope 明确列出 required actions，并记录 `objective.status = satisfied / partial / not_satisfied`；只有全部 required actions 均为 `completed`，run 才能标记 `completed`。这保证控制流正常结束不会被误报成采集目标成功。

## 6. 预算与节流

认证 Profile 默认值：

- 同一 Profile 同时最多 1 个实网 run；
- 每 run 最多 5 个只读语义动作；
- 每动作至多 1 个用户事件；
- 每动作观察尾窗 3 秒；
- 每 run 总 deadline 60 秒；
- 完成或普通失败后立即回到 `ready`，不设置计时冷却；
- 验证码、风控、限流、进程中断和用户暂停必须人工解锁；
- 不进行随机化、代理轮换、指纹伪装或其他规避平台安全措施的行为。

研究需要更高预算时，必须在计划和动作账本中明确展示增量动作与账号风险，并由控制面显式配置；不得由 DeepResearch、AI Planner 或失败恢复逻辑因为结果不足而自动提高。

## 7. 页面关闭与用户体验

- 风险信号出现后冻结自动化创建的目标页并停止输入；验证码、登录失效或页面异常需要用户处理时保留原页面供人工查看，不得刷新、绕过或自动重开；
- 受管 Profile 每次启动都关闭浏览器尝试恢复的 HTTP(S) 旧 tab，只保留浏览器原生登录存储与扩展 Control 页；任何平台页必须来自新的显式动作；
- 平台 run 终态不等于 Profile 会话终态。字幕 validation 保留最终目标窗口以便视觉/DOM/Network 复核；下一独立 run 只复用仍停留于原规范目标的专用 tab。显式 Profile `/close`、账号暂停或 Gateway 退出才结束整个受管浏览器会话；
- 临时 DevTools、手工侦察和 headless 版本预热 context 仍必须结束即清理。残留审计要区分“未解释的泄漏”和“产品明确保留的受管会话”；
- 不在风险页面上继续截图、滚动、点击或读取响应正文；
- Console 显示 `ready / running / locked`、原因、时间和是否需要人工解锁；
- 不显示 Cookie、Token、Profile 路径、验证码图片或账号身份；
- 用户可以显式“暂停账号自动化”；解锁必须提交固定 acknowledgement，普通刷新/重启无效；
- 非最终 stage 完成后，Research Task 进入 `waiting_for_user_resume`；扩展轮询拿不到下一 stage，只有 Console 上针对该 task 的显式 resume 才能重新进入调度；该边界没有时间等待；
- task resume 只核对已批准计划中的下一个 pending stage 与既有 Profile binding，不启动浏览器、不导航、不修改预算或计划，也不能代替 `locked` 状态的人工解锁；
- 已采集结果按 `partial` 保存，不能因风险停止而丢弃，也不能称为完整。

## 8. 实现与验收门槛

恢复任何认证实网研究前必须满足：

1. 风险状态持久化且 Gateway 重启不能绕过；
2. 当前用户安全暂停已经写入 `locked`；
3. runner 在导航后、每动作前和每动作后检查风险；
4. action ledger 能拒绝同一 action 的第二次执行；
5. 验证码/限流信号触发 hard lock；
6. 断网、导航失败、run deadline 和 Fetch/XHR failure 触发停止并立即回到 `ready`，本轮不得重试；
7. 构建制品断言包含固定动作预算、at-most-once 和禁止自动验证码恢复；
8. 去敏 interaction artifact 必须原子落盘，剔除 Profile ID、原始 URL、原始 response body 和未知 DOM 字段，并提供 compact summary；
9. 安全状态机和投影器可先做单元测试；浏览器管线、DOM/XHR、弱网、验证码与页面清理必须实站验证，伪造平台 fixture 不得保留或 admission；
10. 项目所有者的常设授权已经满足开发/验证权限前提；下一次 B站实网 run 可由代理自主创建，但必须是新的独立 run，并继续满足本门禁的 Profile、预算、at-most-once、风险停止和清理条件。

多阶段任务的单元门禁已通过：`verify-task-account-safety-resume.mjs` 覆盖 stage 后等待、无后台恢复、无时间延迟的显式继续、精确下一 stage、重复/完成/locked 拒绝。平台与 Console 闭环只接受真实任务验证，不再使用 fake Gateway 或伪平台诊断。

当前实现已按用户最新决定删除 `cooldown` 状态和 `cooldownUntil` 字段；持久记录升级为 schema v2，历史 v1 JSON 中的旧 `cooldown` 会在 Gateway 启动时一次性迁移为 `ready`。v0.4.18 的 content-script 合成交互历史 run 为 `partial`；干净浏览器侦察随后用真实 mouse move/hover 与一次中文点击证明 509 段字幕可行。v0.4.23 已进一步完成两次相互独立的生产扩展/Gateway 真实闭环，均为 `completed / objective=satisfied / captureCount=2 / segmentCount=509`，每个语义动作在各自 run 内最多一次；第二次还证明复用原目标窗口且没有新增第三个窗口。v0.4.24 又以真实 poisoned Profile 证明：即使持久记录谎称已是新版本，启动器也会先读到旧 runtime、在无界面阶段只 reload 一次并复核成功，不再进入可见 mismatch 循环。正常结束后账号回到 `ready / activeRun=null`；run 目标页按产品生命周期保留，显式 Profile 升级重启则属于独立会话生命周期。详细方法已固化到仓库内 [`recon-live-web-interactions`](../../skills/recon-live-web-interactions/SKILL.md)。项目开发/验证采用常设授权，不再等待逐次聊天批准。
