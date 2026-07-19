# Collector 实现状态

- 分支：`feat/browser-extension-system`
- 状态日期：2026-07-19
- 权威决策：[collector-grilling-decision-log.md](collector-grilling-decision-log.md)
- 产品规格：[platform-strategy-product-spec.md](platform-strategy-product-spec.md)
- 冲突审计：[collector-decision-audit.md](collector-decision-audit.md)
- 数据源勘察门禁：[source-reconnaissance-workflow.md](source-reconnaissance-workflow.md)
- 账号安全熔断门禁：[account-safety-circuit-breaker.md](account-safety-circuit-breaker.md)

## 1. 当前结论

Collector 已经从 fixture POC 迁移到最小权限 MV3 扩展加 loopback Gateway 的产品控制面。B站匿名首屏关键词搜索是目前唯一获得真实平台 admission、并完成正式 Research Task 调度与本地 Evidence batch 闭环的能力；其他平台和深度能力仍未发布。

2026-07-18 检查点补充：B站视频详情字段的独立 Validation Run `v1.4.0` 已 accepted，但正式多阶段 Task 在当前页面 document / content-script 生命周期中仍出现 `gateway_stage_watchdog_expired`，因此该详情策略已降为 `suspended`。启动时重复 `chrome-extension://` 控制页问题已经通过 control-page / version-recovery single-flight 和重复页清理修复；任务 stage 窗口也在 Evidence 或 blocked 后自动关闭。这些控制面修正仍须用真实单 stage 与双 stage 任务复验。

同日新增隔离的 `parallel_dom_and_network_metadata` Source Reconnaissance：DOM checkpoint、页面生命周期、扩展 validation/documentId 与 B站域名 XHR/fetch metadata 使用同一 run 时间轴。该模式不读取请求头/体、响应正文、Cookie 或 Token，不改变 production response routes，也不产生可 admission 的 Evidence。Google Chrome DevTools CLI 已在独立临时 Profile 中自动安装/重载生产扩展、触发 action、识别 service worker/Control 页并完成 B站 Fetch/XHR 去 query/hash 交叉观察，不再需要用户手工加载或点击扩展完成这类测试。

2026-07-19 新增认证 Profile 的有界交互勘察 runner：固定最多五个只读语义动作，每个动作三秒网络差分窗，观察 Fetch/XHR/texttrack 的 origin、pathname、query key、MIME、状态和声明尺寸；平台 API、`hdslb.com` CDN 与第三方/未知来源分开分类。该 runner 不读取请求头/体、响应正文、Cookie 或 Token，不修改 production route，结果仍不具备 admission 资格。

同一 runner 另有默认关闭的 `schema_only` 研究模式：仅允许四条精确 B站 API route 与路径含 subtitle 的平台 CDN 响应，单响应 512 KiB、总计 1 MiB；JSON 只输出过滤敏感字段后的路径、类型和数组规模，非 JSON 只输出内容类别、大小和摘要，原始正文不落盘。该模式仍不改变 production route 或策略成熟度。

用户指出断网、弱网、验证码和异常恢复可能导致重复平台动作并带来封号风险后，所有 B站认证实网研究曾立即暂停并写入 `locked / user_safety_pause`。账号安全门禁完成后，用户于 2026-07-19 先后给出两张相互独立的 subtitle-only / schema-only 单次授权票；两次都只提交一次并已消费，不能解释为恢复其他认证实网研究。随后第三张字幕单次授权在平台导航前因旧 MV3 service worker 返回 `control_message_unsupported` 而终止：没有导航、点击或字幕产物，但该次授权仍按一次提交消费。根因修复为独立的 control-surface revision 握手；相同扩展版本下的旧 worker 也必须自动重载，尚未再次实站验证。

实现已加入 `account-safety.json` 原子状态、崩溃遗留 run 启动锁定、固定 acknowledgement 解锁、同 action ID 二次拒绝、60 秒 run deadline、三次 Fetch/XHR failure 中止、正式 task dispatch 风险门禁和启动时 HTTP(S) 旧 tab 清理。按用户最新决定，正常完成、普通失败、断网和超时均由 `running` 直接回到 `ready`，不再存在计时冷却；验证码、风控、限流、登录失效、中断和用户暂停仍进入 `locked`。持久记录升级为 schema v2，旧 v1 `cooldown` JSON 会一次性迁移为 `ready`。

该 run 暴露的结果语义随后已修正：字幕控件点击后必须在 2.5 秒内满足菜单后置条件，否则 `open_caption_menu=postcondition_unmet`；依赖动作记为 `select_caption_language=prerequisite_unmet / attempted=false`。run 新增 scope objective，只有全部 required actions 完成才能标记 `completed`。认证 interaction 结果现在原子保存为不含 Profile ID、原始 URL、正文和未知 DOM 字段的 ignored runtime artifact；列表只返回 compact summary，详情按 record ID 读取完整安全 schema 投影。

B站详情正式 Task 的 receipt / Evidence race 已加入控制面修复：accepted receipt 后最多 3 次、100ms 恢复 pending Evidence；Gateway poll 先恢复 pending 再取 work；content push 失败只安排本地 continuation，成功则立即清 watchdog。伪造平台页面与 fake Gateway 的集成诊断已删除；该修复必须通过新的真实单 stage 与双 stage 任务验证，`bilibili.video.detail.dom.v1 @ 1.4.0` 继续 `suspended`。

多 stage 推进使用显式任务状态 `waiting_for_user_resume`。非最终 stage 的 Evidence 完成后，任务不会后台取得下一 stage；Console-origin 保护的 `POST /v1/tasks/<task-id>/resume` 核对已批准计划中的下一个 pending stage 及其既有 Profile binding，并把任务放回调度队列。该端点没有时间等待，自身不启动浏览器、不导航、不修改计划，也不能代替 locked Profile 的人工解锁。单元测试覆盖立即显式恢复、精确下一 stage、重复恢复、completed 与 locked 拒绝；Console 和平台闭环仍只接受真实任务验证。

```text
已完成：P0 决策契约与构建门禁
已完成：P1a 扩展权限、控制页、EvidencePlan 与 stage lease
已完成：P1b Gateway 固定身份、显式配对与认证任务 preflight
已完成：P1c stage receipt、dispatch 重投去重与阻塞回报
已完成：P2a 受管 Collection / Validation Profile 生命周期与任务绑定
已完成：P2b B站匿名 breadth_search / visible_dom 真实验证与显式 admission
已完成：P2c 正式 B站 dispatch、认证 Evidence 回传、本地原始批次与 completed 闭环
进行中：P2d B站详情 DOM / XHR-fetch 并行 Source Reconnaissance（production route 仍为空）
未开始：P3 加密 Evidence Vault
未开始：P4 EvidencePackage / DeepResearch 正式接入
```

## 2. 已落地检查点

| Git 检查点 | 内容 | 能力含义 |
|---|---|---|
| `b3e7fdd` | P0 共享契约、移除 fixture / test build、生产构建门禁 | 只证明制品可构建和自动加载 |
| `1ec99cb` | optional host permission、控制页、EvidencePlan/preflight、专用窗口与 session lease | 只证明扩展控制面契约存在 |
| `95edf75` | loopback Gateway、P-256 固定身份、一次性签名配对 | 只证明配对双方可构建 |
| `e4a1816` | HMAC 轮询、签名 work item、Console task、preflight、formal-only 批准、stage receipt 与重投去重 | 当前策略会被阻断为 `live_validation_required` |
| `6334d17` | Gateway 受管持久 Profile、可见 Chromium、扩展自动加载、Profile API / Console 与任务绑定 | 只证明本地浏览器生命周期和绑定控制面，不证明平台可用 |
| P2b（本提交） | 独立 Validation Run、扩展版本恢复、B站 DOM v1.1、记录 review 与源码 admission | 只发布匿名 B站首屏关键词搜索标题与 BV URL |
| P2c（本提交） | Profile 级自动配对 / 精确权限 / 轮询、正式结果 HMAC 回传、原子 JSON batch / manifest、摘要幂等与任务 completed | 已以真实 B站页面验证单阶段正式闭环；仍不是加密 Vault |

## 3. 控制面边界

### 3.1 Manifest

- 安装时 API permissions：`alarms`、`storage`、`scripting`；
- 安装时 `host_permissions`：空；
- optional loopback：`http://127.0.0.1/*`，只用于固定身份 Gateway；
- optional 平台 origins：B站、知乎、微博、小红书的精确域名；
- 静态平台 `content_scripts`：空；
- `externally_connectable`：不存在；
- `<all_urls>`、通配 scheme / host、`localhost`、`cookies`、`debugger`、`webRequest`、`downloads`：禁止。

Chrome match pattern 不能限定 loopback 端口，因此扩展另外固定 `GatewayPairingRecord.loopbackOrigin`，验证 Gateway public-key fingerprint 和 P-256 签名，并对每个请求使用 extension instance、短时 timestamp、nonce、body digest 和 HMAC pairing authorization。任意网页和未配对 localhost 服务不能充当控制端。

### 3.2 任务执行

```text
Console 创建 ResearchTask
  -> paired extension 认证轮询
  -> 验证 Gateway 签名 / identity / nonce / expiry
  -> extension 生成平台 × 目标 capability preflight
  -> Gateway Console 展示计划
  -> 只有全部 stage = ready + formal 才允许用户批准
  -> dispatch 前扩展重新计算权限、策略 ID / version / maturity
  -> 专用可见 Collection Window
  -> session-only stage lease
  -> 精确任务 tab 动态注入固定 content.js
  -> 扩展按 task / stage / lease 暂存待提交结果
  -> HMAC POST /v1/extension/evidence
  -> Gateway 重建白名单结果并校验策略 / 来源 / 预算
  -> runtime/evidence 原子 JSON batch + manifest
  -> lease completed + task completed
```

B站 `bilibili.search.breadth.dom.v1 @ 1.1.0` 具有已审查的匿名 live-validation reference，因此在 Profile、任务同意和精确 host permission 均满足时可返回 `ready / formal`。知乎、微博和小红书仍为 `build_ready / liveValidation = null`，其 preflight 继续返回 `live_validation_required / experimental`，不能批准。

Research Task 必须按平台绑定由 Gateway 注册的 Collection Profile。Gateway 只接受逻辑 Profile ID，并在服务端重新解析平台、类型和账号类别；扩展收到签名任务后再次拒绝 Validation、anonymous、跨平台或畸形绑定。Profile 绑定不提升策略成熟度，也不授予平台权限。

### 3.3 受管浏览器 Profile

- `collection`：只能使用 `user_managed` 账号类别，用于未来正式采集任务；
- `validation`：允许 `anonymous` 或 `user_managed`，仅用于逐能力真实验证，不能绑定 Research Task；
- Gateway 内部生成 UUID 并推导 `runtime/profiles/<profile-id>`，API 不接受或返回任意目录；
- 始终使用可见 Playwright Chromium，自动加载生产扩展并打开其控制页；
- 不启动 Chrome / Edge 日常 Profile，不复用 BrowserWing / Maxun 或旧 POC Profile；
- 同一平台默认只运行一个 Profile，关闭进程后目录保留；
- UI 只暴露逻辑账号标签、expected visible identity 和运行 / 扩展 / 配对布尔状态；
- B站 `collection + user_managed` Profile 提供固定官方登录页入口；API 不接受任意 URL、不返回页面内容，扫码与验证码只由用户执行；
- B站登录状态探针使用独立短时官方首页，只返回公开页头账号入口/“登录”入口布尔信号和 `authenticated / anonymous / indeterminate` 三态，不读取身份内容或浏览器凭据；
- Collection Profile 另提供“配对 Gateway”“授予当前平台精确权限”“立即轮询任务”入口；一次性配对码只在 Gateway 进程和受管扩展页面之间传递，Profile API 不返回；
- 可选固定代理只接收无凭据、带 host 和 port 的 `http`、`https` 或 `socks5` server URL，不接受代理用户名或密码。

### 3.4 重启和页面漂移

- Gateway identity 和扩展配对授权持久化在本地 `runtime/` / `chrome.storage.local`；
- Profile 注册表和浏览器原生 Profile 数据持久化在 Gateway `runtime/`，Gateway 重启后可重新启动；
- 页面和 stage lease 只保存在 `chrome.storage.session`，浏览器重启后失效；
- 手工导航导致任务 URL 摘要变化时标记 `task_context_changed`；
- 撤销平台权限时活动 lease 标记 `permission_revoked`；
- 撤销 Gateway 配对时停止轮询并取消活动 lease；
- 当前 Gateway Research Task 队列只在内存中保存，重启恢复必须等加密任务/Vault 状态设计完成，不能把临时明文队列误写成正式持久化；
- 已完成的原始 Evidence batch 与 task manifest 保存到忽略的 `runtime/evidence/<task-id>/`，Gateway 启动时重新核验 JSON 形状与 result digest 后恢复 batch 摘要；任务问题和待处理计划仍不持久化；
- dispatch 在 receipt 丢失时按同一 task / stage 重投新签名 envelope；扩展先查找现有 lease，已有 active / completed lease 时只补发 receipt，不重复创建窗口；
- dispatch 前权限或策略状态变化会回传固定 `blocked` error code，Gateway 停止重投。

## 4. 构建门禁状态

扩展门禁：

- TypeScript 编译；
- production bundle；
- MV3 Manifest；
- API / optional origin 精确清单；
- 禁止宽权限、静态 MAIN-world、持久平台注册脚本和 test / fixture 入口；
- Playwright 临时空 Profile 自动加载；
- MV3 service worker 启动；
- fresh Profile 零 optional origin grant；
- fresh Profile 零平台注册脚本；
- Collector 内部控制页加载。

Gateway 门禁：

- TypeScript 编译；
- Node 22 bundle；
- 只包含 `127.0.0.1` bind；
- 不包含 `0.0.0.0` all-interface bind；
- 不引入未审查的 Express / Fastify / Koa HTTP 表面。
- 正式 Evidence 路由、`responseObservation = disabled` 安全元数据和 Profile 显式轮询必须保留在 bundle 中。

这些都是构建门禁，不是平台测试，也不证明配对或任务控制已经完成真实环境验证。

### 4.1 P2a 本地功能验证

P2a 另外在隔离的 Gateway runtime 和可见浏览器中完成了本地功能验证；该过程没有打开任何平台页面，也没有使用登录态：

- Console 通过真实 UI 创建 B站匿名 Validation Profile；
- Gateway 重启后保留相同逻辑 Profile ID、账号标签和注册记录；
- Console 启动按钮创建非 headless 的持久 Playwright Chromium，进程参数包含生产扩展加载且不包含 headless flag；
- Gateway 状态返回 `running = true`、`extensionLoaded = true`、`extensionPaired = false`，未把未配对状态冒充成功；
- 关闭后受管浏览器进程归零，Profile ID 与 `lastLaunchedAt` 保留；再次启动复用同一 Profile；
- 同平台第二个运行 Profile 返回 `profile_platform_concurrency_rejected`；
- 任意 `path` 字段、匿名 Collection Profile 和把 Validation Profile 绑定 Research Task 均被服务端拒绝；
- 合法同平台 Collection Profile 可写入签名任务契约的 `profileBindings`；
- 无凭据的固定 `socks5://host:port` 配置可以通过 Gateway 启动解析。

这只证明本地 Profile 生命周期、生产扩展自动加载和任务绑定边界可工作。扩展与 Gateway 的显式配对、平台权限、平台页面、登录身份核对、DOM 策略和数据采集仍需各自验证；这些结果不能升级任何平台 strategy maturity。

### 4.2 P2b B站真实验证与 admission

- Validation Run 只接受 `validation + bilibili + anonymous` Profile，不复用 Research Task 或正式 stage lease；
- 使用真实 Chrome optional host permission；自动化只能操作浏览器原生权限对话框，不修改 Profile Preferences；
- 运行窗口 30 秒到期，只允许原生搜索导航、可见 DOM、首个渲染页面、最多 20 条和 0 次页面交互；
- production response route 保持为空，验证记录明确写入 `responseObservation = disabled`；
- `v1.0.0` 虽返回 20 个规范 BV URL，但标题误取“稍后再看”缩略图覆盖层，记录 `1220b4bc-4763-4087-8c83-e85b108e544a` 已以 `title_projection_captured_thumbnail_overlay` 拒绝；
- `v1.1.0` 按同一 BV URL 聚合多个可见 anchor，优先 `h3[title]` / anchor title / aria-label / heading text，并拒绝没有语义字符的覆盖层标题；
- `v1.1.0` 记录 `bb91e996-7758-4447-ba94-486bc99b7872` 返回 20 条可读标题、20 条规范 BV URL、`results_visible / completed`，人工 review 为 accepted；
- 运行时记录只保存在忽略的 Gateway runtime；仓库仅提交不含原查询和标题的[脱敏 admission 记录](../validation/bilibili-search-breadth-dom-v1.1.0.json)；
- 策略 admission 由源码中的精确 record ID / verifiedAt 显式完成，运行成功本身不会修改 maturity。

该 admission 不证明登录、翻页、排序穷尽、详情、评论、账号归档、response observation 或其他平台能力。

### 4.3 P2c 正式 B站 Research Task 全链路

2026-07-17 使用受管、可见、持久 Collection Profile 完成一次正式任务；不需要登录，也没有读取浏览器凭据或页面响应：

- Collection Profile `ee439ada-a7d7-436f-a898-e959004316ee` 通过 Profile API 发起配对；Windows UI Automation 只识别并 Invoke Chromium 原生“允许”按钮，分别批准 loopback 与 B站两个精确站点范围，没有修改 `Preferences`；
- Chromium service worker 对无正文 `GET /v1/extension/work` 会省略 `Origin`。实测首次被 `extension_origin_required` 阻断后，Gateway 将规则收紧为：pairing claim 与 CORS preflight 始终要求精确扩展 Origin；已配对实际请求若携带 Origin 则必须匹配，省略时仍必须通过 extension ID / instance、timestamp、nonce、body digest 与 HMAC 全部认证；
- Collector Core `0.3.0` 的正式任务 `5f00540a-9a8d-4422-a7a3-46e657ba5664` 唯一 stage 返回 `ready / formal`，策略为 `bilibili.search.breadth.dom.v1 @ 1.1.0`，live-validation record 为 `bb91e996-7758-4447-ba94-486bc99b7872`；
- 显式批准后，扩展验证 Gateway P-256 签名和 plan digest，创建专用 Collection Window 与短时 lease，读取首个渲染页面的 20 条可见标题和规范 BV URL；
- Evidence batch `14216fae-5306-4e43-8171-4c5309a03707` 已落入本地 runtime；result canonical SHA-256 为 `eca7221cf28caa174cc963e74d7f140e58a6a9c97f50db8de4ab6de2c9d043f2`，独立重算一致；
- batch 的 `sourceUrl` 为去查询参数的 `https://search.bilibili.com/all`，`responseObservation = disabled`，`browserCredentialData = not_collected`，没有 Cookie、Token、header、request 或 response 字段；
- Gateway task 最终为 `completed`，item count 为 20。该 runtime 记录被 `.gitignore` 排除，不把真实查询结果提交到仓库。

这个闭环只证明已经 admission 的 B站匿名 breadth stage 可用于正式本地采集；它不扩大策略的页面、动作、登录或数据类型范围。

### 4.4 账号安全门禁与字幕 schema-only 单次实网验证

2026-07-19 在用户明确批准且仅批准一次后，对唯一 `collection + bilibili + user_managed` Profile 执行 subtitle-only 交互勘察：

- preflight 为 `ready`、`manualUnlockRequired=false`、无 active run；
- 唯一 POST 返回 HTTP 201，runner 为 `completed / errorCode=null`；
- `open_caption_menu` 为 `attempted=true / completed`，但动作尾窗内只看到字幕控件标签；
- `select_caption_language` 为 `attempted=false / option_unavailable`，没有盲点、坐标点击或重试；
- 观察 111 条网络 metadata，0 条因上限丢弃，2 条 Fetch/XHR failure，未达到 3 条中止阈值；
- `/x/player/wbi/v2` 映射为 3263 字节 JSON，只保留路径、类型、数组规模和 SHA-256；
- `/x/v2/subtitle/web/view` 映射为 408 字节 binary，只保留大小和 SHA-256，没有猜测正文；
- JSON 候选包含播放器、账号与区域相关的混合路径，生产 projector 因此必须使用字幕字段显式白名单，不能持久化整个通用对象；
- 当时版本在 run 结束后写入过旧 `cooldown` 状态；该状态现已从产品和持久 schema 删除并迁移为 `ready`。没有验证码/风控 hard lock；Profile 正常关闭后停止 Gateway；43127 监听器、可见 Chrome、DevTools MCP 和 Gateway 进程均为 0；
- production response routes 保持为空，`admissionEligible=false`，本轮结果不升级任何策略成熟度。

实网完成后的离线修复又通过两类零平台请求验证：

- contract verifier 覆盖菜单后置条件、依赖动作不投递、scope objective、artifact 原子恢复、Profile ID/未知 DOM 字段剔除，以及 compact-list/full-detail 分层；
- Playwright intercepted diagnostic 在生产扩展中真实完成 optional host permission 原生对话框、content injection、3 条 DOM 结果和权限撤销；另一个 Gateway diagnostic 完成字幕菜单、中文选择、JSON schema、binary 分类和目标页关闭；
- 两个 diagnostic 的所有 B站 URL 均在 BrowserContext 内本地 fulfill/abort，`livePlatformRequests=0`；它们不进入 `verify:build`，也不构成 platform validation 或 admission。

同日用户又给出第二张独立的一次性 subtitle-only / schema-only 授权票。系统没有后台恢复，直到收到新授权才提交唯一一次 POST。该 run 返回 `inconclusive / objective=partial`：字幕菜单在 2.5 秒内就绪，精确“中文”只点击一次；点击后选项仍可见且没有可验证的选中状态，因此严格记为 `postcondition_unmet`，没有补点或重试。动作窗首次捕获到 `aisubtitle.hdslb.com/bfs/ai_subtitle/prod/<opaque-id>` 的 200 JSON schema，确认 `body[].content/from/to` 与根级 `lang` 结构；导航阶段播放器对象也确认了 `subtitle.subtitles[].lan/ai_type/subtitle_url` 等轨道目录结构。原始字段值与正文没有落盘，production response routes 仍为空，`admissionEligible=false`。Profile、Gateway、43127/43128、受管 Chrome 与 DevTools MCP 均已关闭，第二张授权已经消费。

完整证据与二进制/JSON 摘要见[字幕 Source Reconnaissance](../reconnaissance/bilibili/video-subtitle-recon-v1.0.md)。

## 5. 已知未完成项

| 领域 | 当前状态 | 下一门槛 |
|---|---|---|
| Gateway 配对 | Profile 级显式配对已通过真实 Chromium loopback 权限与 HMAC 轮询 | 后续补撤销、身份变化与失败恢复的产品验收 |
| Task dispatch | B站单阶段 preflight → approval → signed dispatch → lease → evidence → completed 已实测；多阶段使用无时间等待的显式 user resume，单元状态机已通过 | 详情策略重新 admission 后做真实双 stage 验证；再增加取消和加密重启恢复 |
| Profile | 受管持久生命周期、可见 Chromium、生产扩展自动加载、关闭/重启、并发门禁、任务绑定与 B站固定官方登录页入口已实现 | 平台认证动作仍只由用户执行；完成扫码后的可见身份与关闭/重启持久性核验 |
| B站 discovery | `v1.1.0 live_anonymous_verified`，正式闭环已验证；只覆盖首屏可见标题与规范 BV URL | 再扩展独立的 detail 策略，不复用 breadth admission |
| B站字幕 | 第二张单次授权下，菜单完成且精确“中文”只点击一次；DOM 选中确认未满足，但动作窗首次映射到 AI 字幕 JSON 的 `body[].content/from/to` 与 `lang`，播放器响应也确认轨道目录结构 | 设计两段显式字段白名单并完成轨道 URL、语言、正文与可见 DOM 的一致性验证；production route 继续为空，后续实网仍需新授权 |
| response observation | 生产 route 为空 | 先完成 wrapper 到期撤销、route projector 和 document race 验证 |
| Evidence | 认证回传、待提交重试、原子原始 JSON batch、task manifest、result SHA-256 与重启摘要恢复 | 加密 Vault、不可变审计、coverage 与删除/导出边界 |
| Gateway task persistence | 仅内存 | 与 Vault 密钥和 schema 一起设计加密恢复，不写普通明文队列 |
| 多 stage 用户续跑 | `waiting_for_user_resume`、精确 `/v1/tasks/<task-id>/resume`、Console 按钮及单元状态机已完成；没有计时等待，不会后台续跑，也不能用 resume 代替 manual unlock | 详情策略重新 admission 后验证真实两 stage；任务队列持久化前保持 Gateway 重启即清空 |
| DeepResearch | 未接入当前 Collector | 只读 EvidencePackage / Citation / Coverage / CollectionGapRequest |

## 6. 下一实现顺序

```text
P2a  Collection / Validation Profile launcher（完成）
  -> P2b B站匿名 discovery 真实验证与 admission（完成）
  -> P2c 正式 Gateway dispatch / Evidence 闭环（完成）
  -> B站 detail / subtitle / bounded discussion（各自独立策略与独立 admission）
  -> P3 encrypted Evidence Vault
  -> P4 DeepResearch EvidencePackage adapter
```

任何真实平台验证前，生产 response route 继续为空；任何 capability 未获得当前策略版本的真实验证记录前，Console 不得批准执行。认证 Profile 的新实网动作还必须满足账号安全状态门禁并取得新的明确、逐次授权；系统不再设置任何计时冷却。
