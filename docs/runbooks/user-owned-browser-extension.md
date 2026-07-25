# 日常浏览器扩展模式：安装、配对与本地 API

- 状态：可用的 direct-mode MVP
- 当前直接能力：`bilibili.video_detail`、`bilibili.native_search`
- API：`/v2/openapi.json`、`/v2/collector-service/browser-bindings`、`/v2/collect`、`/v2/collect/operations/{operationId}`
- 不属于本 runbook 的旧通道：`profileId`、Browser Host、Playwright persistent context、受管 Collection Profile、`POST /v1/collect`

## 1. 这条路径到底做什么

```text
你平时使用、已经登录的 Chrome / Edge
  └─ Collector MV3 扩展
       └─ 已配对的本机 Gateway（127.0.0.1）
            └─ 上层本地应用的 scoped API token
```

Collector 不创建、复制、读取、启动或关闭你的浏览器 Profile。浏览器自己的登录态仍只由浏览器维护；扩展不会导出 Cookie、密码、Token、Storage 或 Profile 文件。

当前 MVP 收到 B站详情或站内搜索任务时，会在同一浏览器会话中新建或复用**扩展自己创建的后台工作标签页**。详情只导航一次到严格规范的视频 URL；搜索只导航一次到 Gateway 从关键词推导出的“综合 / 相关性 / 第 1 页”搜索页，既不点击搜索按钮，也不翻页、滚动、改排序或读取 Network response body。两者都只回传固定白名单 DOM 投影；搜索只保留可见规范 `bilibili.com/video/BV…` 视频卡片，直播、广告、课程和其他混合结果不会混入产物。成功后标签页留在浏览器中成为 `idle_reusable`，不会“刚打开就关闭”。用户关闭、移动、激活接管或导航该标签页时，当前 run 停止；不会自动重开、刷新、换 tab 或重放平台动作。

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

也可先读取 machine-readable 约束：

```powershell
npm run collector-user-browser-client -- openapi
```

`POST /v2/collect` 会快速返回 `queued` 的 `operationId`；它不把任务伪装成同步完成。扩展在低频、受认证的 loopback 轮询中最多 claim 一次，Gateway 将工作项标为 `claimed`，扩展只允许一次平台导航，之后把固定 DOM 投影回传为本地产物。上层应用应读取 `/v2/collect/operations/{operationId}` 直到终态，再通过返回的 artifact path 读取结果。

## 8. 停止、风险与恢复

- 扩展、浏览器、Gateway 或工作标签页消失：当前任务停止，不自动重开浏览器或重放导航；
- 断网：最多重试三次**本地 Gateway 结果提交**，不重试平台导航；
- 验证码、风控、限流或导航结果未知：binding 进入锁定状态，后续平台工作被拒绝，必须在 Console 进行明确人工恢复；
- 当前 MVP 不使用 `chrome.debugger`、CDP、任意 script、任意 selector、任意鼠标坐标或 Cookie 接口；
- 当前 MVP 不读取字幕、评论、弹幕、播放器响应或任何 Network response body；那些是独立 capability，需各自完成真实页面侦察后再接入。

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

它不等于“B站所有能力已经迁到日常浏览器模式”。旧 B站能力矩阵仍留在明确的 `test/isolated-account` Browser Host 通道，不能被生产 `/v2` API 当作 fallback 调用。下一批能力应按相同顺序：真实视觉、DOM、Network 三面侦察 → 固定 capability contract → work-tab 或用户显式选择 tab 的安全执行 → real canary。
