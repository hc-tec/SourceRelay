# 日常浏览器扩展模式：安装、配对与本地 API

- 状态：可用的 direct-mode MVP
- 已完成真实 direct 闭环的 B站能力：`bilibili.native_search`、`bilibili.native_search_batch`、`bilibili.account_profile`、`bilibili.account_inventory`、`bilibili.video_detail`、`bilibili.discussion`、`bilibili.danmaku`、`bilibili.dynamic`、`bilibili.collection_series.overview`、`bilibili.collection_series.detail`。
- 已登记 B站能力：`GET /v2/capabilities` 会列出 12 项已有实现，其中 10 项为 `direct_ready`，`bilibili.account_inventory.pagination` 与 `bilibili.transcript` 仍为迁移边界；登记不等于自动开放旧 Browser Host fallback。
- 小红书 direct 能力：公开搜索、公开笔记详情、公开评论、公开评论回复、已有公开主页 tab、短时公开主页链接和笔记头像自然发现均已有真实 Gateway→Extension 闭环。最新组合 run 已覆盖搜索、详情、评论和回复；主页三种 execution target 分别验证了零导航、一次导航和一次自然发现尝试。Network/XHR 只保留受控投影，不保存原始正文、响应 URL 或短时 token；前置条件不满足时会记录 `prerequisite_unmet`，不点击、不刷新、不重试。

### 小红书临时主页链接入口

上层应用可以在链接仍有效时提交一次公开主页链接，调用 `xiaohongshu.account.public_notes.v1`：

```json
{
  "schemaVersion": 2,
  "browserBindingId": "<paired-browser-binding-id>",
  "platform": "xiaohongshu",
  "capability": "xiaohongshu.account.public_notes.v1",
  "executionTarget": "ephemeral_public_profile_url",
  "input": {
    "maximumScrolls": 20,
    "profileUrl": "https://www.xiaohongshu.com/user/profile/<temporary-id>?<short-lived-signature>"
  }
}
```

该模式只会在一个已有的小红书 tab 内导航一次，不刷新、不创建新 tab、不重试；公开主页响应优先进入受限 Network/XHR 投影，再用可见 DOM 补齐，最多 20 次可信滚动和 200 条笔记。主页链接 work 的 TTL 固定为 120 秒，不续租；连续两次滚动没有新增时返回 `profile_notes_ready`；达到滚动或投影上限但仍有结果时返回 `profile_notes_budget_exhausted`，并保留部分 artifact，不能把它解释成账号历史全量。终态 operation summary 和 artifact 不包含完整主页 URL、签名、响应 URL 或原始正文。`maximumScrolls: 1–3` 仍可用于已有主页 tab；`4–20` 只允许和 `ephemeral_public_profile_url` 一起提交。
- API：`/v2/release`、`/v2/openapi.json`、`/v2/capabilities`、`/v2/collector-service/browser-bindings`、`/v2/collect`、`/v2/collect/operations/{operationId}`
- 不属于本 runbook 的旧通道：`profileId`、Browser Host、Playwright persistent context、受管 Collection Profile、`POST /v1/collect`

## 1. 这条路径到底做什么

```text
你平时使用、已经登录的 Chrome / Edge
  └─ Collector MV3 扩展
       └─ 已配对的本机 Gateway（127.0.0.1）
            └─ 上层本地应用的 scoped API token
```

Collector 不创建、复制、读取、启动或关闭你的浏览器 Profile。浏览器自己的登录态仍只由浏览器维护；扩展不会导出 Cookie、密码、Token、Storage 或 Profile 文件。

大多数 direct work 都会在同一浏览器会话中新建或复用**扩展自己创建的后台工作标签页**。已完成真实 canary 的详情只导航一次到严格规范的视频 URL；单页搜索只导航一次到 Gateway 从关键词推导出的“综合 / 相关性 / 第 1 页”搜索页，既不点击搜索按钮，也不翻页、滚动、改排序或读取 Network response body。固定两页搜索是独立能力：Gateway 只接收同一个 `query`，签名第 1、2 页并按顺序导航，最多两次导航、零页面语义动作；第 1 页为空、风险、用户接管、未知导航或过期时不会进入第 2 页。UP 主公开资料与 UP 主视频首屏也只接受规范空间主页：Gateway 分别推导空间主页和固定 `/upload/video` 首屏，前者投影公开账号头信息，后者投影首屏可见视频卡片；两项均已通过 user-owned-browser real canary，均不翻页、不滚动、不筛选。`bilibili.discussion` 是受限例外：用户先自己将评论区滚到可见区域，并在扩展 popup 明确选择当前视频页；随后 Gateway 只能对同一 tab/document 执行一次零导航、零页面动作、零 response body 的根评论 DOM 投影。为应对评论懒加载，work 发现精确租约 tab 不在前台时，最多只激活并聚焦这个已经由用户选择的 tab 一次；不会选择其他 tab，也不会代替用户滚动、排序、展开回复、翻页或刷新。扩展自有工作页成功后留在浏览器中成为 `idle_reusable`，不会“刚打开就关闭”；用户关闭、移动、激活接管或导航该工作页时，当前 run 停止，不会自动重开、刷新、换 tab 或重放平台动作。

## 2. 一次性准备稳定的扩展目录

在 PowerShell 中：

```powershell
Set-Location D:\AIProject\inteligence\poc
npm run prepare:user-browser-deployment
```

这会构建 direct-only Gateway 与 MV3 扩展，并将可安装扩展复制到稳定目录：

```text
%LOCALAPPDATA%\PersonalIntelligenceCollector\extension
```

命令会打印实际绝对路径。**首次安装后不要移动这个目录**，否则浏览器可能将它当作新的 unpacked 扩展实例并要求重新配对。默认 Gateway 状态保存在：

```text
%LOCALAPPDATA%\PersonalIntelligenceCollector\gateway
```

它只保存 Gateway 身份、配对记录、绑定安全状态、已授权本地 API client 和本地产物；不包含浏览器登录材料或任何浏览器管理目录。

若将来明确要用新制品替换稳定扩展目录，可执行：

```powershell
npm run prepare:user-browser-deployment -- --replace
```

然后由用户在扩展管理页点一次“重新加载”。该命令不会启动、关闭或控制浏览器。

## 3. 在日常浏览器安装扩展

当前是开发态 unpacked 安装。打开你平时使用、已经登录的 Chrome 或 Edge：

1. 打开 `chrome://extensions` 或 Edge 的扩展管理页；
2. 开启“开发者模式”；
3. 选择“加载已解压的扩展”；
4. 选择上一节命令打印的稳定目录（默认是 `%LOCALAPPDATA%\PersonalIntelligenceCollector\extension`）；
5. 点击扩展图标，打开 Collector 控制页。

这一步是浏览器必须显示给用户确认的本地安装操作；Collector 不会也不能静默把扩展塞进日常浏览器。不要使用测试 Chromium、Browser Host 或旧的隔离运行目录。

控制页中的“日常浏览器 Direct Work”才是当前已配对 Gateway 返回的正式 `/v2` 能力子集；页面会同时显示实际 MV3 worker 的短 build 指纹。下面的“研究 / 隔离 Strategy 库”只是编译进扩展的研究策略摘要，**不等于**它们已被日常浏览器 `/v2` API 开放。刷新扩展后，应先核对 build 指纹，再以 Direct Work 目录的真实状态判断能力是否可验证。

## 4. 启动 direct-only Gateway 并检查状态

在另一个 PowerShell 窗口中：

```powershell
Set-Location D:\AIProject\inteligence\poc
npm run start:user-browser
```

默认地址是 `http://127.0.0.1:43127`。这个进程只监听 `127.0.0.1`；它不会打开浏览器、不会创建 Chromium，也不会创建、查找或接触任何浏览器 Profile。浏览器是否打开、哪个账号已经登录，都完全由用户自己的 Chrome/Edge 决定。

如果启动明确报出 `collector_gateway_port_in_use`，说明有其他本地进程已占用 43127。优先停止那个已确认的旧 Collector 进程；如果该端口确实属于其他需要保留的程序，请在**首次配对前**选择一个固定端口，例如：

```powershell
$env:COLLECTOR_GATEWAY_PORT = '43128'
npm run start:user-browser
```

随后在扩展控制页填写 `http://127.0.0.1:43128` 并重新配对；上层应用与健康检查也使用同一地址：

```powershell
$env:COLLECTOR_SERVICE_ORIGIN = 'http://127.0.0.1:43128'
npm run check:user-browser
```

Gateway 地址是配对记录的一部分，已经配对后不要随意改端口；若必须改，请显式重新配对，而不是让系统自动挑一个随机端口。

启动后打开：

```text
http://127.0.0.1:43127
```

也可在另一个终端检查运行模型（不接触浏览器）：

```powershell
npm run check:user-browser
```

确认 Core 与扩展、Gateway、Browser Host 的兼容版本：

```powershell
npm run collector-user-browser-client -- release
```

该接口只返回 Core release manifest、服务 schema 和本地进程协议版本，不返回浏览器
Profile、Cookie、Token 或平台会话信息。上层应用启动时可以先读取它，再决定是否继续
调用 `/v2/collect`。

## 5. 配对一次

1. 在 Gateway Console 的“日常浏览器连接”区域创建一次性配对会话；
2. Console 会显示固定 Gateway 地址、64 位身份指纹、会话 ID 和八位配对码；
3. 将这四项粘贴到扩展控制页并提交；
4. 浏览器会仅请求 `http://127.0.0.1/*` 的 optional host permission；批准后，扩展验证 Gateway 的公钥指纹、P-256 签名、会话挑战和 HMAC 授权；
5. Console 的浏览器绑定状态变为“在线”。

配对授权只保存在扩展自己的受限 storage；Console、上层 API、审计和产物都不会返回它。若扩展被重新安装、Gateway 状态目录被替换或绑定被撤销，请重新配对。

## 6. 创建给上层应用的最小权限 token

在 Console 的“其他本地应用的服务访问”中创建一个 client。对 direct-mode MVP，通常只需要：

- `browser-bindings:read`
- `collect:execute`
- `operations:read`
- `artifacts:read`

`profiles:read` 只属于旧的隔离 Browser Host 测试通道，不需要勾选。token 只显示一次；将它交给本机上层应用时优先放进进程环境变量，不要放到命令行、日志或 Git 中。

## 7. 上层应用调用方式

先发现在线 binding：

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-gateway
$env:COLLECTOR_SERVICE_ORIGIN = 'http://127.0.0.1:43127'
$env:COLLECTOR_SERVICE_TOKEN = 'cst_...'

npm run collector-user-browser-client -- bindings
```

保存下面的 UTF-8 JSON，替换 `browserBindingId`：

```json
{
  "schemaVersion": 2,
  "browserBindingId": "11111111-1111-4111-8111-111111111111",
  "platform": "bilibili",
  "capability": "bilibili.video_detail",
  "executionTarget": "collector_work_tab",
  "input": {
    "canonicalVideoUrl": "https://www.bilibili.com/video/BV1qZSLBYEpa"
  }
}
```

投递与读取：

```powershell
npm run collector-user-browser-client -- queue .\request.json
npm run collector-user-browser-client -- operation <operationId>
npm run collector-user-browser-client -- artifact /v1/collect/artifacts/bilibili.video_detail/<artifactId>
```

要执行固定 B站站内搜索，保存另一份 UTF-8 JSON。上层应用只能传 `query`；结果类型、排序、页码和目标 URL 均不接受调用方指定：

```json
{
  "schemaVersion": 2,
  "browserBindingId": "11111111-1111-4111-8111-111111111111",
  "platform": "bilibili",
  "capability": "bilibili.native_search",
  "executionTarget": "collector_work_tab",
  "input": {
    "query": "DeepSeek"
  }
}
```

搜索任务完成后，使用返回的 `/v1/collect/artifacts/bilibili.native_search/<artifactId>` 读取 artifact。关键词和带关键词的 URL 只在短时签名 work item 中用于导航；终态 operation 和 artifact 只保存关键词/目标 URL 的 SHA-256 摘要，结果文件保存的是白名单化的公开视频卡片字段。

要读取 UP 主资料或其公开视频首屏，调用方同样只传规范空间主页；不能传 `/upload/video`、页码、筛选或任意 URL。下面两种 capability 会由 Gateway 派生固定目标：

```json
{
  "schemaVersion": 2,
  "browserBindingId": "11111111-1111-4111-8111-111111111111",
  "platform": "bilibili",
  "capability": "bilibili.account_profile",
  "executionTarget": "collector_work_tab",
  "input": {
    "canonicalProfileUrl": "https://space.bilibili.com/7481602"
  }
}
```

将 `capability` 替换为 `bilibili.account_inventory` 即可请求同一 UP 主的投稿视频首屏；终态 artifact 路径分别以 `bilibili.account_profile` 或 `bilibili.account_inventory` 作为 capability 段。两项已完成真实 user-browser canary，因此 `/v2/capabilities` 显示为 `direct_ready`；这不扩大其固定输入、单页和只读边界。

也可先读取 machine-readable 约束和 Core release manifest：

```powershell
npm run collector-user-browser-client -- openapi
npm run collector-user-browser-client -- release
```

`POST /v2/collect` 会快速返回 `queued` 的 `operationId`；它不把任务伪装成同步完成。扩展在低频、受认证的 loopback 轮询中最多 claim 一次，Gateway 将工作项标为 `claimed`，扩展只允许一次平台导航，之后把固定 DOM 投影回传为本地产物。上层应用应读取 `/v2/collect/operations/{operationId}` 直到终态，再通过返回的 artifact path 读取结果。

### Python 上层应用

Python 使用独立的 `intelligence-collector-client` SDK，不要导入旧的
`deepresearch_gateway.client.GatewayClient` 来调用当前 `/v2` API。安装和分层说明见
[`poc/collector-python-client/README.md`](../../poc/collector-python-client/README.md)：

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-python-client
python -m pip install -e ".[dev]"
```

Python SDK 使用 `asyncio`，方法名采用 snake_case；协议字段仍保持 Gateway 的 camelCase。
它和 JS SDK 共享 `/v2/capabilities`、`/v2/openapi.json`，但包、依赖、测试和源码完全
分开。两套 SDK 都只允许 15 项 `direct_ready` capability，不接受任意 URL、tab、selector、
脚本、CDP 或 Network body。可直接复制的上层应用入口见
[`apps/collector-python-sdk-smoke`](../../apps/collector-python-sdk-smoke/README.md)。

## 8. 停止、风险与恢复

- 扩展、浏览器、Gateway 或工作标签页消失：当前任务停止，不自动重开浏览器或重放导航；
- 断网：最多重试三次**本地 Gateway 结果提交**，不重试平台导航；
- 验证码、风控、限流或导航结果未知：binding 进入锁定状态，后续平台工作被拒绝，必须在 Console 进行明确人工恢复；
- 当前 MVP 不使用 `chrome.debugger`、CDP、任意 script、任意 selector、任意鼠标坐标或 Cookie 接口；
- 当前 MVP 不读取字幕、播放器响应或任何 Network response body；这些仍是独立 capability。评论仅开放已完成 canary 的 `bilibili.discussion`：用户已选、当前已加载 document 的最多 20 条根评论被动 DOM 投影；它不是自动滚动、最新排序、回复树、分页或评论全量接口。

停止 Gateway 时只在它所在的 PowerShell 中按 `Ctrl+C`。这只停止本地 loopback 服务；不会关闭、枚举、移动或刷新用户的任何浏览器窗口和标签页。浏览器下次仍按用户自己的方式启动并保留自己的登录状态。Gateway 再次启动且仍使用同一状态目录后，已配对扩展会继续通过原 binding 连接；可用下面命令确认：

```powershell
npm run check:user-browser -- --require-online
```

扩展以 30 秒的低频本地轮询恢复在线状态；带 `--require-online` 的检查会等待最多 35 秒，不会触发任何平台页面导航或其他浏览器操作。

## 9. 已验证的事实与尚未承诺的范围

已用临时真实 Chromium、生产 MV3 build、真实 Gateway、真实原生 loopback permission、真实 B站公开详情页和真实 B站搜索页完成过 direct-mode 闭环：

```text
scoped local API token
  → /v2/collect
  → signed work item
  → extension-owned work tab
  → one B站详情导航（允许页面自身一次 trailing-slash redirect）
  → fixed DOM projection
  → signed HMAC result
  → raw-first local artifact
```

同一真实 canary 随后又完成：

```text
scoped local API token
  → /v2/collect(bilibili.native_search)
  → signed fixed-search work item
  → extension-owned retained/reused work tab
  → one B站综合搜索首页导航
  → fixed visible-BV-card DOM projection
  → signed HMAC result
  → raw-first local artifact（关键词只以 digest 持久化）
```

固定两页搜索也已在独立、临时、可见 Chromium 中通过真实 direct canary：

```text
scoped local API token
  → /v2/collect(bilibili.native_search_batch)
  → one signed work item with fixed pages [1, 2]
  → one extension-owned retained/reused work tab
  → page 1 then page 2, at most two URL navigations
  → bounded visible-BV-card DOM projection (at most 12 per page)
  → signed HMAC result and direct-only artifact
```

这不是任意分页接口，也不让调用方传 page、URL、排序、selector 或脚本。完整去敏证据见[固定两页搜索 direct canary](../validation/bilibili-native-search-batch-direct-canary-v0.1.md)。

这不等于“B站所有能力已经迁到日常浏览器模式”。字幕、有界投稿分页、评论排序/回复树/全量分页等仍各自保持迁移状态；旧 B站能力矩阵也不能被生产 `/v2` API 当作 Browser Host fallback 调用。每个后续能力仍遵循：真实视觉、DOM、Network 三面侦察 → 固定 capability contract → work-tab 或用户显式选择 tab 的安全执行 → real canary。
