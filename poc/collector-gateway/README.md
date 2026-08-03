# Collector Gateway

这是浏览器 Collector Core 的本地控制面，不是旧 `intelligence-gateway` 爬虫连接器的延续。它只监听 `127.0.0.1`，负责固定 Gateway 身份、显式扩展配对和后续 Research Task / EvidencePlan 调度。

> **重要的生产边界（2026-07-30）。** 正式产品部署在用户日常 Chrome/Edge 中的已配对扩展，使用浏览器原有、由用户维护的登录会话；Collector 不管理 Browser Profile，也不启动或关闭用户浏览器。当前 `/v2` 目录共有 18 项能力：15 项 `direct_ready`（B站 10 项、小红书 5 项），另有 3 项明确迁移/路由准入边界。直接模式已真实验证：`/v2/collect` 的 scoped local API → 签名工作项 → 扩展自有 work tab 或用户已选 document → 固定 DOM/Network 投影 → HMAC result → capability-bound local artifact。它不会放宽到任意 URL、分页、筛选、滚动、脚本、selector 或 Browser Host fallback。`GET /v2/capabilities` 是运行时能力真相，`GET /v2/openapi.json` 是机器可读输入/响应契约；二者应由上层应用在启动或能力变更时读取。它们不读取登录凭据、Cookie、Token、Profile 文件或原始 Network response body。**本 README 下方的 `profileId`、Browser Host、Collection Profile 和 `POST /v1/collect` 是明确隔离的 `test/isolated-account` 旧通道，不能作为 direct-mode fallback。** 安装和上层 API 的完整操作见[日常浏览器扩展模式 runbook](../../docs/runbooks/user-owned-browser-extension.md)，架构边界见[用户自有浏览器扩展模式](../../docs/design/user-owned-browser-extension-mode.md)，全面验收见[上层 API 能力矩阵报告](../../docs/validation/collector-upper-api-full-matrix-2026-07-30.md)。

## 日常浏览器 Direct API（当前生产 MVP）

这条 API 的身份单位是 `browserBindingId`，不是 `profileId`。它只接受已经配对、最近在线、未被安全锁定的扩展实例；Gateway 仅投递已登记的 typed work item，不接收任意 URL、selector、脚本、坐标、CDP 或 Network body。

```text
本地应用（scoped token）
  → GET  /v2/collector-service/browser-bindings
  → POST /v2/collect
  → GET  /v2/collect/operations/{operationId}
  → GET  /v2/collect/artifacts/{artifactId}
  → GET  /v2/collect/artifacts/{artifactId}/content?offset=…&maxBytes=…
  → GET  /v1/collect/artifacts/{capability}/{artifactId}
```

当前支持 B站详情：

```json
{
  "schemaVersion": 3,
  "clientRequestId": "11111111-1111-4111-8111-111111111111",
  "browserBindingId": "…",
  "platform": "bilibili",
  "capability": "bilibili.video_detail",
  "executionTarget": "collector_work_tab",
  "input": {
    "canonicalVideoUrl": "https://www.bilibili.com/video/BV1qZSLBYEpa"
  }
}
```

以及固定首页站内搜索：

```json
{
  "schemaVersion": 3,
  "clientRequestId": "22222222-2222-4222-8222-222222222222",
  "browserBindingId": "…",
  "platform": "bilibili",
  "capability": "bilibili.native_search",
  "executionTarget": "collector_work_tab",
  "input": {
    "query": "DeepSeek"
  }
}
```

搜索任务由 Gateway 推导规范目标，固定为综合/相关性/第 1 页。调用方不能传 URL、排序、页码、selector 或脚本；产物路径为 `/v1/collect/artifacts/bilibili.native_search/{artifactId}`，终态 work ledger 与 artifact 不保存原 query 或带 query URL，只保存 SHA-256 摘要。

需要稳定的最小广度时，可改用固定两页搜索；调用方仍只提供关键词：

```json
{
  "schemaVersion": 3,
  "clientRequestId": "33333333-3333-4333-8333-333333333333",
  "browserBindingId": "…",
  "platform": "bilibili",
  "capability": "bilibili.native_search_batch",
  "executionTarget": "collector_work_tab",
  "input": {
    "query": "DeepSeek"
  }
}
```

`bilibili.native_search_batch` 由 Gateway 固定签名综合/相关性的第 1、2 页，扩展只按顺序导航这两个 URL：最多两次导航、零 DOM click/scroll/filter/sort、零 response body；第 1 页为空、风险、用户接管、页面身份漂移、未知导航或 deadline 到期都会停止，不会进入或重放第 2 页。每页最多返回 12 张规范 BV 卡；产物路径是 `/v1/collect/artifacts/bilibili.native_search_batch/{artifactId}`，同样只持久化 query digest。

新增的 UP 主资料与视频首屏都只接收规范空间主页；Gateway 分别派生主页与 `/upload/video`，调用方不能传页码、筛选、任意路径或 URL：

```json
{
  "schemaVersion": 3,
  "clientRequestId": "44444444-4444-4444-8444-444444444444",
  "browserBindingId": "…",
  "platform": "bilibili",
  "capability": "bilibili.account_profile",
  "executionTarget": "collector_work_tab",
  "input": {
    "canonicalProfileUrl": "https://space.bilibili.com/7481602"
  }
}
```

将 capability 换为 `bilibili.account_inventory` 可请求同一 MID 的首屏公开视频卡片。两项均已通过 Testbench 的真实 user-browser 只读验证，因此在 `/v2/capabilities` 中为 `direct_ready`；它们的输入与单页边界保持不变。

- `GET /v2/openapi.json`：direct-mode OpenAPI 3.1 contract；
- `browser-bindings:read`：发现安全摘要后的 binding；
- `collect:execute`：投递一个异步的已登记 capability；
- `operations:read`：读取 `queued / claimed / completed / partial / stopped / failed` 状态；
- `artifacts:read`：读取终态返回的受控 artifact path；
- `profiles:read` 不属于 direct mode。

`clientRequestId` 是一次逻辑提交的必填 UUID。Core 会在投递扩展工作项之前持久化请求摘要和
预分配 Operation ID；相同 ID 与相同规范请求返回同一 Operation，相同 ID 与不同请求返回
冲突。若崩溃发生在预留后、无法证明投递是否成功，Core 明确返回 outcome-unknown，绝不会
自动重放平台动作。幂等账本不保存 query、URL 或 Artifact 正文。

新 `/v2/collect/artifacts/{artifactId}` 只返回元数据；`/content` 按 UTF-8 字节边界读取
最多 64 KiB 的规范 JSON 窗口，不暴露磁盘路径。旧 capability-bound 完整 JSON 路由暂时
保留给已有 SDK 的结构化结果读取。

工作 tab 只由扩展建立并在成功后保留为可复用；风险、未知导航、用户接管或关闭时不会自动重开或重放。当前 direct runner 对一次结果提交最多进行三次本地 loopback 重试，但绝不重试平台导航。具体命令、安装与恢复流程见 runbook。

## 正式部署（默认命令）

正式部署只有一条运行链路：

```text
用户日常 Chrome / Edge（已有登录状态）
  -> 已安装的 Collector MV3 扩展
  -> user-browser-server.js（127.0.0.1）
  -> 上层本地应用的 scoped API token
```

从 `poc` 目录运行：

```powershell
# 首次：构建并复制到稳定的 unpacked 扩展目录
npm run prepare:user-browser-deployment

# 在用户自己的 Chrome/Edge 中手动“加载已解压的扩展”
# 目录由上一命令打印；默认 %LOCALAPPDATA%\PersonalIntelligenceCollector\extension

# 每次需要本地服务时：
npm run start:user-browser
```

默认状态目录是 `%LOCALAPPDATA%\PersonalIntelligenceCollector\gateway`。正式入口不会启动、附着、关闭或枚举浏览器，不会创建或读取任何浏览器登录目录，也不会导出 Cookie、密码、Token 或网页 Storage。运行 `npm run check:user-browser -- --require-online` 可以只通过 loopback health 状态确认 Gateway 与已配对扩展在线；该检查会为扩展的 30 秒低频本地轮询等待最多 35 秒，但不触发平台导航。

默认端口是 `43127`。如果它被其他进程占用，启动会明确输出 `collector_gateway_port_in_use`，不会再抛出无上下文的 Node 堆栈。应优先停止已确认的旧 Collector；如需保留占用者，请在首次配对前设置固定的 `COLLECTOR_GATEWAY_PORT`，并让扩展和 `COLLECTOR_SERVICE_ORIGIN` 使用同一新地址。端口变化需要重新配对。

`npm start` 在 Gateway package 内同样指向 user-browser entry。只有 `npm run start:isolated-browser` 才是旧 Browser Host 的测试/隔离账号通道；它不是正式安装、配对或上层 API 的 fallback。

## Local Collector Service API（Legacy test / isolated-account lane）

Gateway 同时提供给其他本地应用调用的稳定 API 外观。它只暴露已经登记的采集能力，不提供任意 URL、CSS selector、脚本执行、鼠标坐标或 Network 请求/响应正文接口。当前受管测试路径仍经由 Browser Profile / PageLease；正式日常浏览器路径将改为已配对 extension binding、受限 tab lease、账号安全锁、动作预算、DOM/Network 交叉证据与 raw-first 本地产物。

```text
Local application
  -> POST /v1/collect (registered capability + fixed input)
  -> existing Gateway runner
  -> Browser Host / MV3 / managed Collection Profile
  -> local artifact; result carries its controlled retrieval path
```

最小接口：

- `GET /v1/openapi.json`：返回版本化 OpenAPI 3.1 外部 consumer 契约；只描述下列可调用服务路由，不包含 Console、审计或浏览器控制面；
- `GET /v1/capabilities`：返回当前注册能力、平台、输入 schema 名称与 JSON Schema、实验状态和 Profile 前置条件；
- `GET /v1/collector-service/profiles`：返回可被当前服务使用的受管 Collection Profile 的安全目录；
- `POST /v1/collect`：执行一个已注册 capability。请求 envelope 固定为 `schemaVersion`、`profileId`、`platform`、`capability` 和 capability-specific `input`；`input` 不能再携带 `profileId`；
- `GET /v1/collect/artifacts/<capability>/<artifactId>`：读取上述结果 `artifact.retrievalPath` 指向的字段白名单化本地产物；
- `GET /v1/collector-service/audit`：只供 Gateway Console 精确同源读取去敏调用历史，独立本地 client 不可读取；
- 返回 `operationId` 和 `operationKind`（`run` 或 `batch`），而不是把批任务伪装成单次 run。

当前 OpenAPI `info.version` 是 `1.0.0-experimental`，请求/响应 envelope 的 `schemaVersion` 是 `1`。外部应用应按 OpenAPI 和 capability catalog 的当前版本生成调用，不应把 `experimental` capability 当作永久不变的业务承诺；任何不兼容的外部 surface 变更必须同时更新这两个版本化契约。

例如（`profileId` 必须是已登记、`collection + user_managed + bilibili` 的受管 Profile）：

```json
{
  "schemaVersion": 1,
  "profileId": "11111111-1111-4111-8111-111111111111",
  "platform": "bilibili",
  "capability": "bilibili.video_detail",
  "input": {
    "canonicalVideoUrl": "https://www.bilibili.com/video/BV1qZSLBYEpa"
  }
}
```

当前注册的能力都是已有 B站 runner 的安全 API 外观：原生搜索（单页/有界 batch）、账号资料、账号视频页（首屏/有界分页）、视频详情、字幕、评论、弹幕、动态、合集/系列概览和系列详情。`page_two` 与“从旧 artifact 继续 materialize detail”仍是内部组合流程，暂不作为稳定服务能力发布。

### 本地 client token

Console 的“其他本地应用的服务访问”面板可创建、查看和撤销 Local API Client。创建时 token 只显示一次；Gateway 只以 `SHA-256` 摘要保存它，并记录已授予 scope、最后使用时间与撤销时间。它不是平台 Cookie、登录 Token 或浏览器凭据，也不能用来导出这些数据。

创建 client 时必须选择最小权限；Console 默认勾选完整的 MVP scope，调用方可以取消不需要的项：

| Scope | 允许的服务路由 |
|---|---|
| `browser-bindings:read` | `GET /v2/collector-service/browser-bindings` |
| `profiles:read` | `GET /v1/collector-service/profiles` |
| `collect:execute` | `POST /v1/collect` |
| `collect:execute` | `POST /v2/collect` |
| `operations:read` | `GET /v2/collect/operations/<operationId>` |
| `artifacts:read` | `GET /v1/collect/artifacts/<capability>/<artifactId>`；`GET /v2/collect/artifacts/<artifactId>`；`GET /v2/collect/artifacts/<artifactId>/content` |

scope 不足固定返回 `403 collector_service_client_scope_denied`，缺失、格式错误或已撤销 token 固定返回 `401 collector_service_client_authorization_rejected`。旧的 schema-v1 client 会在本地启动时一次性迁移成三个 scope，保留原先全量服务访问语义；新建 client 的 scope 始终按上表的稳定顺序保存。

独立桌面应用或 CLI 应在没有 `Origin` / `Sec-Fetch-Site` 浏览器头的本地 loopback 请求中带上：

```text
Authorization: Bearer cst_...
```

Console 自己仍使用精确同源检查。任何带外站 `Origin` 或非 `same-origin` `Sec-Fetch-Site` 的请求，即使携带有效 token，也会被拒绝；撤销立即失效。不要通过开放到 `0.0.0.0`、取消 loopback 限制或伪造浏览器同源头来“方便调用”。

每次服务目录读取、采集调用和产物读取都会写入有上限（最近 1,000 条）、原子保存的本地审计。审计仅保留时间、Console/本地 client 主体、动作、capability、结果、错误码、artifact / operation ID，以及不可逆的 Profile 摘要；它严格不保存 input、查询词、URL、query/hash、标题/正文、产物正文、token、token 摘要、Authorization、Cookie、Profile 路径或浏览器身份材料。审计读取本身不产生递归审计记录。

### 独立本地进程参考 client

`scripts/collector-service-reference-client.mjs` 是一个可直接运行的原生进程参考消费者，用来说明其他桌面应用、CLI 或后续分析服务应如何只通过 HTTP 使用 Collector Service。它不会启动 Gateway、创建或撤销 token、读取审计、访问浏览器 Profile、传任意 URL 或控制浏览器。

在 PowerShell 中，token 放在进程环境变量，不要放在命令行参数中：

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-gateway
$env:COLLECTOR_SERVICE_ORIGIN = 'http://127.0.0.1:43127'
$env:COLLECTOR_SERVICE_TOKEN = 'cst_...'

npm run collector-client -- capabilities
npm run collector-client -- openapi
npm run collector-client -- profiles
npm run collector-client -- collect .\request.json
npm run collector-client -- artifact /v1/collect/artifacts/bilibili.video_detail/<artifact-id>
```

`openapi` 与 `capabilities` 不需要 token。OpenAPI 3.1 文档包含每个当前 capability 的 input JSON Schema、scope、错误语义和明确排除的控制面；应用应先读取它或 capability catalog，再构造请求。其余命令分别要求对应的 `profiles:read`、`collect:execute` 或 `artifacts:read` scope。`collect` 只读取 UTF-8 JSON 文件，并且每次命令最多发出一次 HTTP 调用、不做平台动作重试，单次本地请求有 50 秒 deadline。成功结果写到 stdout；失败只以 `{ ok, status, error }` 写到 stderr，不回显 token 或请求正文。`audit` 不存在于这个 client 的命令集合，因为审计只属于 Gateway Console 的同源控制面。

### 上层应用薄客户端

需要在应用代码中调用 direct API 时，优先使用 workspace package
`@intelligence/collector-client`，而不是复制 testbench 的请求流程。它提供
`listDirectCapabilities()`、`readCapabilityCatalog()`、`readOpenApi()`、`listBrowserBindings()`、`collect()`、`waitOperation()`、
`readArtifact()`、`readArtifactMetadata()`、`readArtifactContentWindow()` 和 `collectAndWait()`，只在本地轮询 operation，不会在网络异常后重放
平台任务。artifact path 仍由已读取 operation 的 capability 绑定结果推导，调用方不能传
任意 Gateway path。使用说明见 [`poc/collector-client/README.md`](../collector-client/README.md)。
Python 上层应用使用同协议的独立 `intelligence-collector-client` 包，见
[`poc/collector-python-client/README.md`](../collector-python-client/README.md)；不要把旧
`deepresearch_gateway.client.GatewayClient` 当作当前 `/v2` SDK。

当前检查点实现：

- 首次启动生成 ECDSA P-256 Gateway 身份，并在本地 `runtime/` 持久保存；
- Gateway identity fingerprint 固定，端口或 Gateway 实例变化后必须重新配对；
- 本地 Console 创建五分钟有效的一次性配对 Session；
- 配对码为八位数字，最多尝试五次，成功后立即失效；
- 扩展 claim 必须来自 `chrome-extension://<extension-id>`，Origin 必须与请求中的扩展 ID 一致；
- Gateway 返回绑定 extension challenge、配对码摘要和 pairing authorization 摘要的 ECDSA P-256 / SHA-256 签名；
- 扩展验证 loopback origin、身份指纹、签名、过期时间和所有 challenge 后才保存配对授权；
- Console、日志和控制页都不显示 pairing authorization；
- 配对扩展使用 extension ID / instance、30 秒 timestamp、nonce、body SHA-256 和 HMAC 对每个 Gateway 请求认证；
- Gateway 给 preflight / dispatch work item 加入两分钟过期时间、nonce 和 P-256 签名；
- Console 可以创建 `scout` Research Task，并逐平台显示扩展回传的 capability preflight；
- Gateway 从内部逻辑 ID 创建并持久化独立的 Collection / Validation Browser Profile，不接受调用方提供磁盘路径；
- Gateway 最终只启动一个可见 Playwright Chromium，自动加载 `collector-extension/dist` 生产 MV3 扩展并打开唯一 Control 页；每次冷启动都先在不可见的 headless context 中读取实际 worker marker，只有不匹配时才 reload 一次并跨 context 复核；
- 每个平台同一时间默认只运行一个 Profile；关闭浏览器只结束进程，不删除 Profile 中由浏览器正常管理的状态；
- B站 `collection + user_managed` Profile 可通过固定产品动作打开官方登录页；调用方不能传入 URL，扫码与验证码始终由用户完成，API 不返回登录页内容；
- B站登录状态核对只在短时官方首页中比较公开可见的账号入口与“登录”入口，返回三态结果和布尔信号，不读取或返回昵称、UID、头像地址、Cookie 或 Token；
- `user_managed` Profile 使用持久账号安全状态：同一 Profile 单 run、动作 at-most-once、60 秒总 deadline、Fetch/XHR 连续失败中止；正常结束、普通失败、断网和超时立即回到 `ready`，验证码/风控/限流/登录失效/中断和用户暂停跨 Gateway 重启锁定并要求固定 acknowledgement 解锁；
- 受管 Profile 启动会关闭浏览器尝试恢复的 HTTP(S) 旧 tab，只保留浏览器原生登录存储与扩展 Control 页；登录页、状态探针、任务页和勘察页都必须来自新的显式动作；
- Console 只显示平台、Profile 类型、逻辑账号标签、扩展加载和配对状态，不显示 Profile 路径、Cookie、Token 或登录内容；
- Research Task 必须为每个平台选择同平台、`user_managed` 的 Collection Profile；Validation Profile 不能绑定正式任务；
- B站匿名 Validation Run 使用短时专用窗口、生产 content script、首屏 20 条上限和 0 次只读交互，保存白名单字段后进入人工 review；
- B站详情 Source Reconnaissance 使用同一个真实、可见 Validation Profile 并行记录 DOM checkpoint、页面生命周期、扩展 validation 状态和去 query/hash 的 XHR/fetch metadata；不读取请求头/体、响应正文、Cookie 或 Token，且记录不能自动准入策略；
- B站认证交互勘察使用用户管理的 Collection Profile，可按 `subtitle / discussion / all` 限定本轮范围，最多执行字幕菜单、中文轨道、评论滚动、最新排序和首个楼中楼五个只读语义动作；每个动作只有三秒 Fetch/XHR/texttrack metadata 差分窗，同时覆盖平台 API、`hdslb.com` CDN 和第三方/未知来源分类；
- 字幕菜单点击必须在 2.5 秒有界窗口内满足菜单后置条件；后置条件不成立时记录 `postcondition_unmet`，依赖它的语言选择记录 `prerequisite_unmet / attempted=false`，不会重试或继续点击；只有当前 scope 的全部必需动作完成，run 才能标为 `completed`；
- 字幕 validation 终态只撤销 alarm、动态脚本和 Network arm，不关闭目标窗口；下一独立 run 仅在原 tab 仍停留于已记录的规范目标时复用它，避免“run 结束即关窗”和重复测试堆积窗口；Profile 关闭仍由显式 `/close`、暂停或 Gateway 生命周期管理；
- 只有显式选择 `schema_only` 时，认证勘察才会对四条精确 B站 API route 和路径含 subtitle 的平台 CDN 响应做内存映射；单响应上限 512 KiB、总上限 1 MiB，JSON 只返回去敏字段路径/类型/数组规模，非 JSON 只返回类型、大小和摘要，原始正文不落盘；
- 认证交互结果原子保存为 ignored runtime artifact；artifact 不保存 Profile ID、原始 URL、原始 response body 或未知 DOM 字段。`GET /v1/reconnaissance/interactions` 只列 compact summary 与 `schemaPathCount`，`GET /v1/reconnaissance/interactions/<record-id>` 才返回完整安全结构投影；
- 运行结果不能自动改策略；只有仓库内显式 live-validation reference 才会让 Gateway 将 accepted 记录标记为 admitted；
- 持久 Profile 保存的最后成功版本只用于历史遥测，不能决定是否检查 worker。公开扩展版本与控制面 revision 不因普通内部改动升级；冷启动先在 headless context A 同时核对 manifest、运行时代码发布的 `collectorVersion`、`controlSurfaceRevision` 和稳定 `buildFingerprint`；全部匹配就直接关闭 A 并启动可见浏览器，不匹配才对旧 worker 发送一次 `chrome.runtime.reload()`、关闭 A，并在 headless context B 精确复核；
- manifest 文件版本不能替代运行时代码版本。启动器不再打开 `chrome://extensions`、不再点击 unpacked Reload，也不再因版本失败自动重启可见 context；Control 页创建和只读版本核验保持 single-flight，并合并同扩展的重复 Control tab。若无界面复核仍失败，API 返回 failure phase 与 expected/observed version、control revision，而不是只给无上下文 mismatch；
- 只有所有 stage 同时为 `ready + formal` 时才允许用户批准；未 admission 的 `build_ready` 策略会被明确阻断；
- 非最终 stage 完成后任务进入 `waiting_for_user_resume`，扩展轮询不能后台取得下一 stage；Console 的 `/v1/tasks/<task-id>/resume` 只核对既有 approved plan / pending stage / Profile binding，不启动浏览器、不导航，也不能代替 locked Profile 的 manual unlock；没有任何计时冷却；
- dispatch 未收到 receipt 时会重投；扩展按 task / stage 查找现有 lease，避免重复窗口，并回传 `accepted` 或固定 `blocked` error code；
- Collection Profile 可直接发起自动配对、当前平台精确权限申请和显式任务轮询；Chrome 原生权限对话框仍必须由用户确认，配对码不从 Profile API 返回；
- 正式页面结果通过 HMAC `POST /v1/extension/evidence` 回传；Gateway 只重建白名单字段，并核对 extension instance、task / stage / lease、approved strategy、来源 URL 和记录预算；
- 原始 JSON 保存到内部推导的 `runtime/evidence/<task-id>/`，每个 batch 带 canonical result SHA-256、安全元数据和 task manifest；相同 task / stage / result digest 幂等；
- 已完成 stage 的同 digest Evidence 直接返回当前状态，不得覆盖较新的 `stage_active`；Evidence 确认或明确 blocked 后自动关闭 stage 窗口，长期只保留单一 Control 页；
- Gateway 重启时扫描并重新核验 batch JSON 和 digest，只恢复不含实际磁盘路径的 evidence summary；Research Task 队列本身仍不持久化；
- 不读取仓库 `.env`，不接触搜索 API Key、Cookie、Token、密码、二维码或浏览器 Profile。

独立 DevTools 交叉验证可以使用 Google `chrome-devtools-mcp` CLI 的 extension 与 network 工具，自动安装/重载 `collector-extension/dist`、触发 extension action、检查 service worker/Control 页并列出 Fetch/XHR。该工具只用于研究与测试，不是 Collector runtime backend；运行时应使用隔离 Profile、关闭 usage statistics / CrUX，并在输出前去除 query/hash，避免调用会导出 request/response body 的命令。

真实页面交互开发必须先遵循仓库内 [`recon-live-web-interactions`](../../skills/recon-live-web-interactions/SKILL.md)：先在不调用待验证 Gateway runner、扩展交互脚本或旧 selector 的可见浏览器中，从视觉、DOM、可信浏览器输入和 Network 四个表面证明人类流程，再迁移到产品控制循环。项目所有者已对本仓库开发/验证授予常设实网权限，不再要求逐 run 聊天授权；产品本身的 EvidencePlan、预算、最终用户同意和风险锁仍保持不变。

## 隔离测试通道（非正式部署）

下面的命令、环境变量、Profile 与 Browser Host 内容仅用于测试/隔离账号验证；不要把它们用于用户日常 Chrome/Edge。

安装和构建：

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-gateway
npm install
npm run setup:browser
npm run verify:build
```

平台集成和端到端测试不得通过 Playwright route 伪造 B站页面、DOM、XHR 或 Gateway 响应。纯状态机、投影器和本地产物逻辑可以使用单元测试；浏览器侧平台能力只接受项目专用 Profile 中按常设权限产生的真实网站运行记录。

启动：

```powershell
npm run start:isolated-browser
```

默认 Console 地址：

```text
http://127.0.0.1:43127
```

可选环境变量：

- `COLLECTOR_GATEWAY_PORT`：1024–65535，默认 `43127`；
- `COLLECTOR_GATEWAY_NAME`：控制页显示名称；
- `COLLECTOR_GATEWAY_STATE_DIR`：身份与配对授权目录，默认当前目录下 `runtime/`。
- `COLLECTOR_EXTENSION_DIRECTORY`：生产扩展制品目录，默认 `../collector-extension/dist`；
- `COLLECTOR_BROWSER_PROXY_SERVER`：整个受管浏览器使用的固定 `http`、`https` 或 `socks5` 代理地址，必须明确包含 host 和 port。

代理配置只接受 server URL，不接受用户名、密码、path、query 或 fragment；系统不读取、管理或轮换代理凭据。Profile 实际目录始终由 Gateway 在 `COLLECTOR_GATEWAY_STATE_DIR/profiles/<logical-profile-id>` 内部推导，API 和 Console 都不接收或返回该路径。它不会启动 Chrome / Edge 日常 Profile，也不会复用 BrowserWing 或旧 POC Profile。

浏览器扩展的 loopback host permission 是 optional，首次配对时由用户显式授予。Chrome match pattern 无法把 host permission 限定到单一端口，因此扩展另外固定并验证 `GatewayPairingRecord.loopbackOrigin`、Gateway 公钥指纹和签名；网页没有 `externally_connectable` 通道，不能绕过扩展控制面下发任务。

任务控制面已经具备认证 preflight、formal-only 批准、单/多 stage Evidence 推进，以及 stage 间无时间等待的显式用户 resume；但当前任务队列只保存在内存中。在加密 Vault 与恢复 schema 建立前，不把研究问题和计划写入普通明文长期文件。Gateway 重启会清空待处理任务，配对身份、pairing authorization、浏览器 Profile 注册表和已完成的原始 Evidence batch 仍保留。当前原子 JSON batch 是本地 raw-first 证据层，不等于未来具备密钥管理、不可变审计、coverage 和删除边界的 Evidence Vault。

即使未来某项策略进入正式能力，dispatch 仍必须携带短时 nonce、过期时间、已批准 EvidencePlan digest 和 Gateway 签名，扩展会在创建 Collection Window 前重新运行 capability preflight。配对成功本身不授予任何平台权限或采集能力。
