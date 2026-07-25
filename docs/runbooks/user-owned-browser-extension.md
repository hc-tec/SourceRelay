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

## 2. 构建与启动 Gateway

在 PowerShell 中：

```powershell
Set-Location D:\AIProject\inteligence\poc
npm run build:collector-runtime

Set-Location .\collector-gateway
$env:COLLECTOR_GATEWAY_STATE_DIR = (Resolve-Path .\runtime\user-browser).Path
npm run start
```

默认地址是 `http://127.0.0.1:43127`。首次启动会在上述状态目录生成 Gateway 身份密钥和本地状态；不要把该目录、token 或浏览器数据提交到 Git。

Gateway 启动后在浏览器打开：

```text
http://127.0.0.1:43127
```

## 3. 在日常 Chrome / Edge 安装扩展

当前是开发态 unpacked 安装。请把扩展制品保留在固定路径，避免扩展 ID 因重新安装或移动目录变化而需要重新配对。

1. 打开 `chrome://extensions` 或 Edge 的扩展管理页；
2. 开启“开发者模式”；
3. 选择“加载已解压的扩展”；
4. 选择目录：`D:\AIProject\inteligence\poc\collector-extension\dist`；
5. 点击扩展图标，打开 Collector 控制页。

不要把测试用 Chromium Profile、Browser Host 启动命令或旧的 `runtime/profiles/` 目录用于这条路径。

## 4. 配对一次

1. 在 Gateway Console 的“日常浏览器连接”区域创建一次性配对会话；
2. Console 会显示固定 Gateway 地址、64 位身份指纹、会话 ID 和八位配对码；
3. 将这四项粘贴到扩展控制页并提交；
4. 浏览器会仅请求 `http://127.0.0.1/*` 的 optional host permission；批准后，扩展验证 Gateway 的公钥指纹、P-256 签名、会话挑战和 HMAC 授权；
5. Console 的浏览器绑定状态变为“在线”。

配对授权只保存在扩展自己的受限 storage；Console、上层 API、审计和产物都不会返回它。若扩展被重新安装、Gateway 状态目录被替换或绑定被撤销，请重新配对。

## 5. 创建给上层应用的最小权限 token

在 Console 的“其他本地应用的服务访问”中创建一个 client。对 direct-mode MVP，通常只需要：

- `browser-bindings:read`
- `collect:execute`
- `operations:read`
- `artifacts:read`

`profiles:read` 只属于旧的隔离 Browser Host 测试通道，不需要勾选。token 只显示一次；将它交给本机上层应用时优先放进进程环境变量，不要放到命令行、日志或 Git 中。

## 6. 上层应用调用方式

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

## 7. 停止、风险与恢复

- 扩展、浏览器、Gateway 或工作标签页消失：当前任务停止，不自动重开浏览器或重放导航；
- 断网：最多重试三次**本地 Gateway 结果提交**，不重试平台导航；
- 验证码、风控、限流或导航结果未知：binding 进入锁定状态，后续平台工作被拒绝，必须在 Console 进行明确人工恢复；
- 当前 MVP 不使用 `chrome.debugger`、CDP、任意 script、任意 selector、任意鼠标坐标或 Cookie 接口；
- 当前 MVP 不读取字幕、评论、弹幕、播放器响应或任何 Network response body；那些是独立 capability，需各自完成真实页面侦察后再接入。

## 8. 已验证的事实与尚未承诺的范围

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
