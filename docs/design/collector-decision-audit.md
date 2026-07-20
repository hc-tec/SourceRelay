# 浏览器采集产品：决策一致性与实现差距审计

- 状态：Complete through decision 170
- 日期：2026-07-20
- 决策源：[Grill 决策账本](collector-grilling-decision-log.md)
- 产品规格：[平台采集策略产品规格](platform-strategy-product-spec.md)
- 审计范围：第 1–170 题、当前 `feat/browser-extension-system` 分支和现有 Collector Extension / Gateway POC
- 页面池架构：[Browser Host 与受管页面池 MVP](managed-page-pool-browser-host-mvp.md)

## 1. 审计结论

第 1–170 题已经覆盖一期采集产品和 Browser Host 页面池 MVP 所需的核心选择，当前没有仍需用户决定的阻塞性产品问题。项目所有者已经授予仓库范围内、低频只读真实平台开发与验证的常设授权；实现不再等待逐 run 聊天批准，只有扫码、密码、验证码等本人身份动作需要用户参与。

决策优先级固定为：

```text
用户显式自定义选择
  > 较晚批次决定
  > 较早批次决定
  > 产品规格中的旧默认
  > 当前 POC 的既有实现
```

因此，当前代码“已经能运行”不等于它符合最终产品决定。实现阶段必须以决策账本和本审计为准。

## 2. 已解决的覆盖与冲突

### 2.1 真实执行面覆盖 fixture，同时保留纯逻辑单元测试

第 55、56 题取消 fixture 和模拟平台验证；较晚的第 139 题进一步明确最终边界：reducer、schema validator、canonicalization 和预算计算可以做纯单元测试，IPC、进程、Chromium、扩展、页面池和重连必须使用真实本地执行面，平台能力必须低频访问真实站点。因此第 139 题只覆盖第 56 题“连纯函数单元测试也取消”的部分，不恢复 fixture、fake Gateway、fake XHR 或合成页面 E2E。

当前成熟度统一为：

```text
draft
  -> build_ready
  -> live_anonymous_verified | live_authenticated_verified
  -> suspended
```

`build_ready` 不代表平台能力。平台能力只由用户控制环境中的低频真实验证升级。

### 2.2 “去敏”与全部公开可见信息长期保存

第 45 题明确选择保存任务页面上全部公开可见信息，包括公开联系方式；第 46–50 题限定采集表面、媒体、加密、历史和导出。因此“去敏”的当前含义是删除认证材料、隐藏状态、未呈现 response 字段和未授权数据，而不是删除页面公开显示字段。

公开字段进入本地加密长期档案；诊断日志仍不得包含页面正文、查询词、账号信息或公开联系方式。这两类产物的字段政策不同，不构成冲突。

### 2.3 response observation 不能扩大可见数据表面

第 35 题允许精确 route 的受控 response observation，第 46 题又明确长期保存仅限页面正常呈现的信息。最终规则是：response 可辅助结构、游标、稳定 ID 和状态判定，但未呈现字段不得进入长期证据。可见 DOM 与 response 投影不一致时必须报告差异或部分覆盖。

### 2.4 单平台队列与详情 Worker 并发

第 26 题的“单平台队列”保留为调度所有权和限流边界；第 72 题作为更具体的后项决定，允许稳定 item ledger 之后的有界 Detail Worker 并发。账号枚举仍是单一所有者，Agent 不直接争抢游标；平台调度器统一控制详情并发上限。

### 2.5 第三方平台爬虫与 DeepResearch 框架

第 96 题禁止复制、集成或运行第三方平台采集 / 爬虫仓库。第 74 题允许 DeerFlow、天工式方案等 DeepResearch 编排框架通过 EvidencePackage 边界适配。两者作用不同：前者不得成为数据源，后者可以成为证据消费者和研究编排器。通用构建依赖仍需许可证与 SBOM 记录。

### 2.6 浏览器上下文不是“绕过访问控制”

扩展运行在用户正常 Collection Browser Profile 中，避免传统爬虫模拟浏览器和维护私有 API 的路线；它不授权绕过登录、验证码、付费限制、限流或平台安全措施。遇到这些状态仍按第 27、60、65 题暂停和报告。

### 2.7 代理的最终边界

用户配置的固定浏览器网络代理可以作为 Collection Browser Profile 的正常网络环境，扩展不读取或管理代理凭据。禁止自动代理轮换、账号池或通过代理绕过平台限流和验证状态。

### 2.8 可读 Markdown 与加密 Vault

证据逻辑格式可为 Markdown、JSON 和 JSONL；磁盘长期保存由 Vault 加密。Evidence Explorer 或配对 Reader 在授权后解密并呈现可读内容，因此“人和 AI 可读”与“静态加密”不冲突。

### 2.9 每 Profile 一个窗口覆盖每任务一个窗口

第 101 题细化并覆盖第 77 题的窗口粒度。现在每个 Collection Profile 对应一个持久、可见的 Collection Window，任务专用性由 PageLease/StageLease 保证，不再为每个 task 创建 OS 窗口。默认每 Profile 三个受管 Web 页面，任务完成后页面释放复用，不立即关闭。

### 2.10 Gateway 重启与 Browser Session 重启分开处理

第 114 题细化第 80 题中含混的“重启”：Gateway 重启而 Browser Host/Chromium 存活时，idle 页面所有权继续有效，active lease 失效并隔离；Browser Host 或 Chromium 换代时才生成新 browserSessionId，旧 target/lease 全部失效，恢复出来的 tab 视为 unmanaged。任何情况都不自动恢复旧平台动作。

### 2.11 页面所有权来源与状态集合已经扩展

第 144 题将第 102 题的 Collector-created 细分为 Host 直接创建和已批准动作因果创建；仍禁止按 URL 认领页面。第 124、163 题在第 104 题的最小状态机上增加 `retained_for_review` 与 `idle_stale`；它们不是兼容状态，而是当前权威模型的一部分。

### 2.12 扩展单体执行图被混合执行面覆盖

第 136、141–149 题覆盖早期“扩展 Core 包办 planner、交互和 artifact”的简化图。当前边界是：Gateway 管任务/预算/安全/artifact，Browser Host 管 Chromium/PageLease/trusted input，Extension Strategy 管 pageRole/DOM/XHR 语义。Gateway 与 Host 使用认证 Named Pipe/Unix Socket，Extension 通过 Native Messaging Bridge 接入 Host；不得保留三方各写 lease 的旧 loopback 路线。

### 2.13 页面池与账号安全是正交状态机

第 165 题明确页面 quarantine 不自动等于账号 locked。容量、lease、stale、Strategy drift 和无在途输入的 renderer crash 不锁账号；普通断网/超时终止当前 run、页面隔离并回 ready，但不自动重试；验证码、风控、限流、账号错配和崩溃中的在途输入才进入人工处理或持久锁。

### 2.14 零兼容是明确产品决定

第 137 题禁止旧 API/状态/endpoint 的 adapter、dual write 和 fallback。切换 checkpoint 必须一次性迁移所有现有 runner、Console 和 Profile summary，并删除 URL 摘要所有权与 Gateway 直接 Page ownership；旧 user-data-dir 和正常登录状态保留，但旧 runtime 字段不能用于认领页面。

## 3. 当前代码与最终决定的主要差距

| 领域 | 当前 POC / 分支中间态 | 最终决定要求 | 实现处置 |
|---|---|---|---|
| 进程所有权 | Gateway 通过 Playwright pipe 直接持有 Chromium | Browser Host 独立长寿命；Gateway restart 不关浏览器 | 新建 Host 包、单实例 launcher 和认证 IPC |
| 页面池 | 单工作 Page + URL 摘要候选；Profile 字段已先删除 | 多 PageRecord/PageLease、target 因果所有权、stale/quarantine/retain/reclaim | 一次性删除旧 helper 和所有调用点 |
| 扩展通道 | Extension 与 Gateway loopback 轮询 | Native Messaging Bridge -> Browser Host -> Gateway | 自动安装当前用户 native host manifest，不保留旧 lease 写路径 |
| 执行动作 | Gateway runner 直接 locator/mouse；部分 content script synthetic click | Extension 解析语义 ticket，Host 发 trusted input，Gateway 逐动作批准 | 建立 Action AST、ticket、permit、command dedupe |
| 验证路线 | 仍有纯逻辑脚本和历史 loopback diagnostics | 纯逻辑可单测；浏览器集成真实 Chromium；平台能力真实站点 | 删除 fake 平台能力语义，保留明确标注 `livePlatformRequests=0` 的真实浏览器门禁 |
| 权限 | Manifest 预先声明多个静态 host permissions | Core 最小权限；策略启用时请求精确 optional host permission | 重构 manifest 与权限 preflight |
| Console | 单 Profile/browser 摘要和单工作 tab telemetry | Host/Profile/Page/Queue/Reclaim/Auth 安全运营面 | 使用 Snapshot/Event read model，去除 URL/target 公开字段 |
| 策略 | 四个平台的首屏 DOM discovery 元数据 | 平台 × 目标的静态策略矩阵、真实成熟度与 kill switch | 重构 registry、maturity 和 capability lock |
| 深度能力 | 多个 B站 Gateway research runner 与真实 artifact，尚未 MV3 admission | Strategy 随扩展发布，Host 执行动作，dynamic 先作 canary | 保留真实 contract，迁移执行面，不复制旧 Playwright ownership |
| Artifact | `storage.session` 暂存 | 本地加密 Vault、封存批次、schema、哈希、coverage 和 Explorer | 建立 Gateway Artifact Vault |
| DeepResearch | 尚无正式 handoff | 只读 EvidencePackage、Citation / Coverage、CollectionGapRequest | 实现稳定适配协议，禁用框架自带搜索 |
| 第三方采集器 | 调研文档中存在候选仓库 | 仅参考，不复制、不集成、不运行 | 保持代码与运行时依赖隔离 |

## 4. 响应观察底座的已知安全待办

当前 production response route 为空，这是安全的保守状态。在启用任何真实 route 前，至少要处理：

1. MAIN-world 观察期限不能依赖页面可改写的配置；到期后要停止读取并撤销 wrapper。
2. Release 权限门禁要覆盖等价宽泛 host pattern 和 optional permission 字段。
3. 真实 Validation Browser 要验证 next-document ObserverBinding 在输入前 ready，且 document/route/action generation 换代会撤销旧观察器。
4. route-specific projector 必须只输出页面可见字段；游标和状态字段仅作短时控制。
5. 页面世界 observation 始终是不可信输入；HostObservationReceipt 只证明上下文绑定，不把网页数据升级成密码学真实性证明。

在这些问题解决并完成真实验证前，production response route 必须继续保持为空。

## 5. 建议实现顺序

```text
Checkpoint 1 设计冻结
  -> 1–170 账本、审计、Browser Host 架构与产品规格

Checkpoint 2 Contracts + Browser Host Core
  -> IPC、PageRecord/PageLease、journal、snapshot、真实 Chromium 生命周期

Checkpoint 3 Gateway/Extension 零兼容切换
  -> Native Messaging、Action AST、ticket/binding/receipt、Console、全部 runner 调用迁移

Checkpoint 4 B站 dynamic canary
  -> 低频真实闭环、页面保留、Gateway 重连、失败语义与 capability 更新
```

详细模块、状态机和验收见 [Browser Host 与受管页面池 MVP](managed-page-pool-browser-host-mvp.md)。实现阶段按每个可验证 checkpoint 提交，不把平台数量当作进度替代品。

## 6. Grill 完成状态

第 1–170 题核心 grill 与一致性审计已经完成，没有需要继续以 A/B/C/D 追问的阻塞性产品选择。后续直接实现；只有真实平台验证暴露无法由现有 Strategy/安全规则决定的新产品选择时，才按每批 5 题追加，并先写入决策账本。
