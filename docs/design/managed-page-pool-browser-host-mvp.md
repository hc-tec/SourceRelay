# Browser Host 与受管页面池 MVP 架构

- 状态：Accepted / Checkpoint 2 verified / Checkpoint 3 pending
- 日期：2026-07-20
- 决策源：[Grill 决策账本 101–170](collector-grilling-decision-log.md)
- 一致性审计：[Collector 决策审计](collector-decision-audit.md)
- 实现状态：[Collector 实现状态](collector-implementation-status.md)

## 1. 结论

MVP 不再修补“一个 BrowserContext 记一个工作 tab”的 helper。它建立一个独立、长寿命的 Browser Host，由 Host 持有 Chromium、Collection Profile、页面所有权账本和浏览器输入边界；Gateway 管研究任务与证据，Extension 管平台语义与 DOM/XHR 观察。

```text
Research Console / DeepResearch
              |
              v
Collector Gateway
  task / plan / scheduler / account safety / artifact
              |
              | authenticated Named Pipe / Unix Socket
              v
Collector Browser Host  <------>  Native Messaging Bridge
  Chromium lifecycle                    |
  PageRecord / PageLease                 v
  trusted input                    Collector Extension
  foreground / reclamation          Strategy / DOM / XHR
              |
              v
Persistent visible Collection Profiles
```

三个核心原则：

1. 页面所有权只能由当前 Browser Session 的本地因果账本建立，URL 只能核验身份，不能建立所有权。
2. 页面资源并发与账号平台动作并发分离；页面池支持多个 lease，但每个认证 Profile 同时最多一个平台动作，全 Host 同时最多一个可信输入。
3. 正常 run 结束只释放页面，不立即关闭；关闭必须来自显式 Profile 生命周期或两阶段回收。

## 2. MVP 范围与非目标

MVP 必须交付：

- 当前用户单实例 Browser Host；
- Gateway 重启而 Host/Chromium 不重启时，同一窗口、session 与空闲页面继续存在；
- 每个 Collection Profile 一个持久、可见窗口，默认最多三个受管 Web 页面；
- 多 PageLease、确定性 acquire、idle/stale/quarantine/retain/reclaim 状态；
- Gateway 与 Host 的认证 IPC；
- Extension 与 Host 的 Native Messaging 通道；
- Extension Strategy + Host trusted input 的混合执行链；
- 去敏 Snapshot/Event、Runtime Journal 和最小 Console；
- 真实本地 Chromium 生命周期门禁；
- 一次低频真实 B站 dynamic canary。

MVP 明确不做：

- 旧单 tab API、状态文件或 endpoint 兼容；
- 自动超时关页或无人值守回收；
- Browser Host 崩溃后保证同一个 Chromium 进程存活；
- 用户日常 Chrome/Edge 接管；
- raw CDP、任意 Playwright/evaluate、任意 localhost 控制 API；
- OS/MITM 抓包、Cookie/Token/Profile 导出；
- 运行时下载 Strategy 代码或让模型临场生成点击脚本；
- 一次迁移所有平台或重做 Evidence Explorer。

## 3. 包与依赖边界

```text
poc/collector-contracts
  src/browser-host-protocol/
  src/page-pool-contracts/
  src/action-contracts/
  src/observation-contracts/
  src/error-contracts/

poc/collector-browser-host
  src/main.ts
  src/ipc/
  src/launcher/
  src/profile-runtime/
  src/page-ledger/
  src/page-lease/
  src/foreground/
  src/action-execution/
  src/extension-adoption/
  src/native-messaging/
  src/reclamation/
  src/journal/
  src/snapshot/

poc/collector-gateway
  task / plan / scheduler / account safety / artifact
  browser-host client only

poc/collector-extension
  MV3 worker / Strategy Registry / DOM/XHR observer
  Native Messaging client
```

依赖方向固定为：

```text
Gateway -----------> Contracts
Browser Host ------> Contracts
Extension ---------> Contracts（浏览器安全子集）
Gateway -----------> Browser Host IPC client
```

Gateway 完成切换后不得直接导入 Playwright、持有 `BrowserContext`/`Page` 或写页面账本。Browser Host 不导入平台 runner、Artifact Vault 或 DeepResearch。Extension 不持有长期密钥、Host journal 或文件系统路径。

## 4. 进程与会话生命周期

### 4.1 Browser Host

- 项目本地构建与发布，当前用户按需启动；
- Windows 使用 Named Pipe，Linux/macOS 使用 Unix Domain Socket；
- 使用当前用户 state 目录的 PID、endpoint、heartbeat 和单实例锁；
- Gateway Launcher 只在不存在健康 Host 时启动一次 detached hidden 进程；
- 不注册管理员 Windows Service，不默认开机自启；
- Gateway 退出不结束 Host；只有显式 `exit_browser_host` 结束 Host。

### 4.2 Browser Session

Browser Host 每次启动 Chromium 生成新的 `browserSessionId`。Gateway 重连不改变该 ID；Browser Host 或 Chromium 换代必须改变该 ID。

```text
Gateway restart
  idle pages remain owned and idle
  active PageLease becomes quarantined/controller_disconnected
  old platform action never resumes

Browser/Host restart
  old targetId and leases become invalid
  restored tabs are unmanaged
  URL equality cannot re-adopt them
```

### 4.3 Collection Profile

- 每个账号使用独立 Collection Profile/user-data-dir；
- 每个 Profile 一个持久、可见 Collection Window；
- Profile 窗口可以包含多个受管 tab；
- 默认 `maximumManagedPagesPerProfile = 3`；
- 默认 `maximumActivePlatformActionsPerProfile = 1`；
- 全局默认最多两个 active Profile；
- 全 Host `maximumConcurrentTrustedInputs = 1`。

## 5. 页面所有权与 PageRecord

### 5.1 所有权来源

```text
direct_created
  Host reserve -> create about:blank -> register -> navigate

action_created
  已批准动作声明新 target，且 opener/action epoch/后置身份匹配

unmanaged / user_owned
  当前 Browser Session 所有权账本之外的任何页面
```

意外 popup 仍记录为 Collector 动作因果结果，但进入 `quarantined/unexpected_target_created`。它不能因超预算立即关闭，也不能伪装成用户页面。

### 5.2 内部 PageRecord

最小权威记录：

```text
schemaVersion
recordVersion
hostInstanceId
browserSessionId
profileId
targetId                         # 仅 Host 内部当前 session 使用
targetIdentityDigest             # journal 使用
pageAlias                         # Console 使用
ownershipSource
platform
pageRole
state
expectedIdentity
documentGeneration
routeGeneration
extensionGeneration
activePageLeaseId
activeStageLeaseId
foregroundPermitId
createdAt
lastUsedAt
lastReconciledAt
stateChangedAt
quarantineReason
```

URL、标题、DOM marker、`window.name`、query 参数或 tab 顺序都不能建立所有权。URL 规范摘要只能作为 `expectedIdentity` 的一部分验证当前页面是否仍符合最后批准上下文。

### 5.3 状态

```text
leased_pre_navigation
leased
idle_reusable
idle_stale
retained_for_review
quarantined
reclaim_pending
closed
```

关键转换：

```text
create/register -> leased_pre_navigation
successful navigation/identity -> leased
normal release -> idle_reusable
idle trust window elapsed -> idle_stale
local reconcile success -> idle_reusable
user retain -> retained_for_review
context/risk/unknown -> quarantined
approved reclaim plan -> reclaim_pending
explicit safe close -> closed
explicit ownership transfer -> unmanaged
```

`maxIdleTrustMs` 由 Strategy 声明，默认十五分钟。Stale reconcile 只读取本地浏览器状态，不导航、不刷新、不点击。

## 6. Lease 与许可

### 6.1 PageLease 与 StageLease

`PageLease` 管物理 tab 独占占用；`StageLease` 管获批任务 stage 与证据提交权限。一个页面同一时刻最多一个 active PageLease。侦察和登录检查即使没有正式 StageLease，也必须取得 PageLease。

PageLease 至少绑定：

```text
pageLeaseId
browserSessionId
targetId
profileId
taskId / runId
stageLeaseId?
platform / pageRole
controllerGeneration
expectedRecordVersion
issuedAt / expiresAt
```

Deadline 从获批 run/stage 预算派生。续租只能在原 lease、controller、task/run/stage、预算和页面身份均未变化且没有 unknown 动作时进行；续租不产生平台输入。

### 6.2 Foreground 与可信输入

PageLease 不自动 `bringToFront()`。每个窗口最多一个 `ForegroundActionPermit`；全 Host 同时最多一个 `TrustedInputPermit`。Permit 只覆盖真正发出 navigation/mouse/keyboard 的短阶段，网络等待、DOM 投影和 artifact 写入可以跨 Profile 并行。

动作结束后页面停在最终状态，不切回 Control，不关闭。Host 不随机切 tab、不添加随机延迟、不移动/缩放用户窗口。

## 7. Acquire、Release 与 Reclamation

### 7.1 Acquire 顺序

```text
1. 同 Profile、平台、规范目标和 pageRole 的 idle_reusable
2. 同 Profile、平台和 role family 的 idle_reusable
3. 同 Profile 其他已核验 idle_reusable
4. 容量内 direct create
5. page_pool_capacity_exhausted
```

同级按最久未使用优先。Idle stale 必须先本地 reconcile；quarantined、retained、reclaim pending、leased 和 unmanaged 永不参与复用。

### 7.2 新页面原子流程

```text
reserve capacity
  -> acquire foreground/input permit
  -> create about:blank target
  -> obtain targetId and register ownership
  -> create PageLease
  -> install next-document ObserverBinding if required
  -> navigate once
  -> verify document/page role/target identity
```

外部导航尚未发出时，本地失败可以关闭纯 about:blank 并回滚。导航已发出但结果未知时，页面 quarantine；不能关页、重开或重试。

### 7.3 Release

- 正常完成或正常预算耗尽：重新核验后 `idle_reusable`；
- 用户导航、身份不符、observer 失联：`quarantined`；
- 验证码、风控、账号不匹配、在途结果未知：`quarantined` 并映射 Account Safety；
- 用户明确保留：`retained_for_review`；
- 不在 `finally` 中关闭页面。

### 7.4 两阶段回收

Plan 只选择 Collector-owned、idle reusable、无 lease/permit、非 Control、非 retained/quarantine 且身份仍匹配的页面。候选按低亲和度与 LRU 排序，生成短时 `reclaimPlanId` 并标记 reclaim pending。

Execute 逐页再次核验 session、record version、ownership、state、lease 与身份；变化页面跳过。MVP 只有用户显式执行、关闭 Profile 或明确开发生命周期切换才关闭页面，不自动定时回收。

## 8. 平台执行链

### 8.1 职责

```text
Gateway
  ActionPlan、逐动作批准、预算、账号安全、artifact

Extension Strategy
  pageRole、语义目标、DOM 投影、用户活动、精确 XHR projector

Browser Host
  PageLease、generation、trusted input、target 因果、动作去重
```

### 8.2 动作流程

```text
Gateway issues one typed ActionCommand
  -> Host validates lease/record/safety/budget
  -> Extension resolves one-time InteractionTargetTicket
  -> Host revalidates ticket and acquires input permit
  -> Host records attempted before trusted input
  -> Host dispatches input at most once
  -> Extension observes declared DOM/XHR postconditions
  -> Host records completed/failed/outcome_unknown
  -> Gateway seals evidence and coverage
```

Planner 可以展示完整计划，但 Host 一次只执行一个受限 AST 原语。禁止任意 Playwright、CDP、evaluate、模型脚本和无界循环。

### 8.2.1 窄化的可信滚动原语

`scroll_page` 是 Browser Host Protocol v4 中唯一的滚动输入，不是通用浏览器遥控接口。它只接受当前 `PageLease` 对应的 `profileId/pageAlias/pageLeaseId`，并额外要求 `runId`、`expectedRecordVersion`、`expectedDocumentGeneration`、稳定 `actionId`、正向且有上限的 `deltaY` 与短 deadline。

- Host 固定在当前页面可视区域中心执行浏览器级 `mouse.move()` 和 `mouse.wheel(0, deltaY)`；调用者不能给坐标、selector、JavaScript、反向滚动或任意输入事件；
- 输入前只读采样滚动位置与页面可滚动余量；没有下行余量时不发送任何输入；
- 输入已发出后，同一 `actionId` 永远拒绝重放。超时、页面身份/文档 generation 改变、页面关闭或滚动后置条件不成立，都将页面 quarantine 并要求新 run，绝不自动重试；
- Gateway 只有内部 typed client wrapper，不开放 Console/loopback 的“任意 tab 滚动”接口。未来平台 runner 必须先建立 ObserverBinding，再将此原语包进自己的单次、源专属动作；
- 该原语在真实无头 Chromium、真实 MV3 和 Native Messaging 的离线页面上验证了滚动、动作去重、lease/run/record 拒绝与显式清理，且 `livePlatformRequests=0`。这只证明 Host 输入边界，不证明任何平台的滚动采集能力。

### 8.3 ObserverBinding

可能触发 XHR 的输入前必须完成：

```text
pending -> ready -> active -> sealing -> sealed
                         \-> revoked / expired
```

Binding 绑定精确 origin/path/MIME/projection、PageLease、document/route generation、action epoch、尺寸/数量/deadline。未 ready 不输入；迟到、跨页、跨动作或超预算 batch 拒绝。Request headers/body、Cookie、Token 和 raw response 不进入证据。

### 8.4 Extension 通道

Extension 使用 `chrome.runtime.connectNative()` 连接当前用户级 Native Messaging Bridge；Bridge 只做 framing/身份绑定并转发到 Host Named Pipe，不写页面账本。安装流程自动登记 manifest 与固定 extension ID，不要求用户编辑注册表。

## 9. IPC、命令去重与错误

Host-Gateway 命令 envelope 至少包含：

```text
protocolVersion
hostInstanceId / browserSessionId
controllerGeneration
commandId / commandClass
pageLeaseId / expectedRecordVersion
taskId / runId / stageId / actionId
nonce / issuedAt / expiresAt
authenticationDigest
```

Host 在输入前持久记录 attempted。相同 command ID 只返回已有 outcome；响应丢失时 Gateway 查询 outcome，不能重发动作。Controller 断开后旧 generation 的命令全部拒绝。

错误使用版本化 `BrowserHostError`，明确 code、category、scope、terminality、retryClass、platformActionAttempted、pageDisposition、profileSafetyDisposition 和 safeDetails。禁止从 `Error.message` 正则猜状态。

## 10. 调度与账号安全

- Gateway 按 Profile 公平轮转，同 Profile 内按显式用户任务、普通任务、定时任务、Validation 排序；
- 长任务只在一页、一个详情、一个评论批次、一个动作或一个 sealed batch 后 yield；
- Enumeration Coordinator 继续独占账号目录 cursor；
- Page Pool 回答页面是否可用，Account Safety 回答 Profile 是否可发新平台动作；
- 容量、lease conflict、stale、Strategy drift 不锁账号；
- 普通断网/超时终止当前 run、页面 quarantine、Profile 回 ready，但绝不自动重试；
- 验证码、风控、限流、账号错配和崩溃中的在途输入进入人工处理或持久锁；
- 关闭页面不能解除账号锁。

## 11. Snapshot、Journal 与 Console

Browser Host 是唯一写入者。Gateway 通过带 revision 的去敏 Snapshot/Event Cursor 恢复读模型；Gateway 缓存不能写回 Host。

Runtime Journal 只保存 generation、page alias、target digest、record version、state/role、lease/action/command 摘要和安全终态，不保存 URL、标题、正文、DOM/XHR 原文或认证材料。已结束 session 默认保留七天并受 32 MiB 总上限约束；Evidence 与安全锁不随 journal 清理。

Console MVP 展示：

- Host/session/extension generation 与连接状态；
- Profile 窗口、账号安全、页面状态计数；
- page alias、role、state、task、age、permit、transition/quarantine reason；
- queue、pause/cancel/resume/take-over；
- retain/transfer/reconcile/close；
- reclamation plan/execute；
- authentication/risk 的唯一安全下一步。

Control 页每 Browser Session 最多一个，不进入页面池，不在每次 run 前后切到前台。Worker mismatch 只能不可见 probe、空闲时 reload 一次；失败后阻断动作并保持窗口，不打开 `chrome://extensions` 或循环 Control 页。

## 12. 零兼容迁移

不提供兼容期。切换 checkpoint 一次性删除：

```text
acquireManagedTargetPage
retainManagedTargetPage
managedTargetUrlDigest
单工作 tab state/telemetry
lastManagedTargetUrlDigest
Gateway 直接 BrowserContext/Page ownership
旧 extension-to-Gateway 轮询 lease 写入路径
```

所有现有 runner、Console、Profile summary、构建脚本与文档同时迁移。旧 runtime JSON 的未知字段在读取边界丢弃；专用 user-data-dir 和正常登录状态保留。构建门禁扫描旧 symbol，禁止 fallback、adapter 和 dual write。

## 13. 实施工作分解与 Git checkpoint

### Checkpoint 1：设计冻结

- 本文；
- 1–170 决策账本；
- 冲突审计与产品规格更新；
- 不改运行时代码。

### Checkpoint 2：Contracts 与 Browser Host Core（完成）

- workspace 与四包边界；
- IPC schema、错误、PageRecord reducer；
- Host 单实例、Named Pipe、journal、Snapshot；
- Profile runtime、PageLease、permit、reconcile/reclamation；
- 真实本地 Chromium 验证双 lease、复用、stale/quarantine/retain/reclaim；
- `livePlatformRequests=0`。

### Checkpoint 3：Gateway/Extension 一次性切换

- Native Messaging Bridge 与自动安装；
- Strategy ticket/ObserverBinding/Host receipt；
- Gateway Host client、scheduler、Console；
- 所有现有 runner 迁移；
- 删除旧 API、直接 Playwright ownership 与 URL 所有权；
- Gateway restart 保持 Host/Chromium/session。

### Checkpoint 4：B站 Dynamic Canary

- Dynamic Strategy 迁入扩展语义面；
- 使用现有真实 DOM/XHR/artifact contract；
- 一次低频真实 run；
- release 后页面保持可见可复用；
- Gateway 重启后浏览器仍打开；
- 无重复动作、写操作、认证材料或多余扩展页；
- 通过后更新 capability 与实现状态。

## 14. MVP 验收

必须同时满足：

1. 所有包 typecheck/build 成功，旧 symbol 扫描为零；
2. Browser Host 按需单实例启动，Gateway 两次重连保持同一 Host PID、Chromium PID、browserSessionId 与窗口；
3. 一个 Profile 可取得两个不同 PageLease，release 后后续任务复用空闲页；
4. 三页容量、用户导航隔离、idle stale reconcile、retained 保护和两阶段回收均在真实 Chromium 验证；
5. command ID 重放不产生第二次输入，响应丢失只查询 outcome；
6. Worker mismatch 最多 reload 一次，Control 页至多一个，`chrome://extensions` 为零；
7. 任务结束不关页，Gateway 退出不关浏览器，用户关窗不自动重开；
8. Runtime Journal、Snapshot、Console 和 artifact 去敏扫描无禁用字段；
9. B站 dynamic canary 产生真实 DOM/XHR/artifact 互证并保留失败语义；
10. 除纯 reducer/schema 等单元测试外，浏览器集成使用真实 Chromium，平台能力使用真实站点，fixture/fake 不冒充 E2E。

## 15. 当前实现差距

截至 2026-07-20，Checkpoint 2 已实现独立 Contracts 与 Browser Host Core：当前用户单实例 Host、Windows Named Pipe/HMAC、controller generation、真实持久 Chromium、Profile 页面池、PageLease、Host 内部 target 因果账本、去敏 Snapshot/Journal、隔离与显式两阶段回收均已落地。真实可见 Chromium 门禁加载生产扩展但只使用 `about:` / `data:` 页面，证明失效 endpoint 替换、重复 launcher 复用同一 Host/Chromium、三页容量、release 后复用、idle stale 本地 reconcile、retained 保护、意外导航与 controller 断连 quarantine、command replay 去重和显式清理；`livePlatformRequests=0`，因此它不构成任何平台能力验证。

Checkpoint 3 尚未开始一次性切换。当前分支仍有旧 Gateway 直接持有 Playwright、单页 helper、旧 Console page lifecycle 和扩展 loopback 控制路径；这些路径必须与新 Gateway Host client、Native Messaging Bridge 和 PageLease runner 同一次删除，不提供 adapter、dual write、legacy endpoint 或 fallback。B站 dynamic 的真实侦察与 artifact contract 已完成，可作为 Checkpoint 4 canary，但尚未通过 Browser Host。
