# Personal Intelligence Collector Extension

这是浏览器内的个人情报采集底座：Chrome Manifest V3 扩展运行在用户自己的浏览器页面中，而不是把已登录 Profile 交给外部爬虫服务。它的目标是把“在平台内部搜索”变成一个可授权、可测试、可审计的执行能力。

当前的最小闭环已经实际覆盖：

```text
未打包扩展自动加载
  -> MV3 service worker 启动
  -> Worker 构造平台原生站内搜索 URL
  -> 为该搜索 tab 创建短时、平台绑定的采集授权
  -> document_start 的 isolated bridge 请求 Worker arm
  -> Worker 将固定 MAIN-world observer 动态注入该精确 tab/document
  -> 页面可见 DOM / allowlist JSON 响应的去敏投影
  -> Worker 的 sender、tab、平台、路由和配额复核
  -> chrome.storage.session 暂存安全结果
```

测试全过程不需要人工到 `chrome://extensions` 加载扩展、不需要点击工具栏图标、不需要登录平台，也不会读取用户日常 Chrome、Edge 或 BrowserWing Profile。

## 两条独立的采集路线

### 1. 可见 DOM（当前已启用）

平台适配器从用户已经看得到的搜索结果页投影：规范公开 URL、可见标题、内容类型和排名。页面 URL 会去掉 query/hash 后才进入结果，避免把搜索词或短期参数写入 artifact。

### 2. 受控网络响应观察（基础层已实现；生产路由尚未启用）

这里的“抓包”不是 OS 级抓包、MITM、DevTools 调试协议或 `webRequest`。它严格指：在**已经由显式站内搜索任务创建的顶层 tab**中，MAIN-world 脚本只观察页面自己已经完成的 `fetch` / `XMLHttpRequest` 响应。

```text
Worker 创建 about:blank tab
  -> 写入 2 分钟的 { tabId, platform, navigationUrlDigest } 授权
  -> 导航至平台原生搜索页
  -> isolated bridge 向 Worker 确认授权与精确导航摘要
  -> Worker 成功动态注入 MAIN observer 后才回传 armed
  -> 精确 route + JSON + 2xx + 大小/数量门槛
  -> 页面内第一次脱敏
  -> window.postMessage（不可信输入）
  -> isolated bridge 第二次校验/脱敏
  -> Worker 第三次校验、短时 session 暂存
```

硬限制如下：

| 边界 | 当前约束 |
|---|---|
| 授权范围 | 仅 Worker 刚创建、精确导航摘要匹配的顶层搜索 tab；2 分钟后过期 |
| 路由 | `origin + pathname` 精确匹配；query/hash 永不保存 |
| 响应 | 仅 2xx JSON；不读取请求体；只临时读取 `Content-Type` / `Content-Length` 作 gate |
| 体积/数量 | 单响应最多 96 KiB；每页面最多 3 条 |
| 结果 | JSON 深度、对象属性、数组、字符串均有上限；仅 `chrome.storage.session` 短暂保存 |
| MAIN world | 视为页面世界的**不可信输入**；不能触发导航、任意请求、本地 Gateway 或权限升级 |

递归脱敏会删除或替换 Cookie、Authorization、Token、Session、CSRF/XSRF、`xsec`、密码、验证码、手机号、邮箱及明显的 Bearer/JWT/`key=value` 文本模式。它不是“靠 AI 识别秘密”的边界；真正的前置边界仍然是 tab 授权、精确路由、MIME、大小和数量限制。

MAIN observer 不再作为静态 content script 出现在每个搜索页。只有 bridge 的 `sender.tab`、顶层 frame、平台和**导航 URL 的 SHA-256 摘要**都与 Worker arm 一致时，Worker 才通过 `scripting` 向该 document 注入固定文件。因此未授权页面和同 tab 的导航漂移不会被 observer 读取。这个选择可能错过页面最早的一次请求；这是刻意的安全取舍，DOM 采集仍是完整 fallback。

为了不把历史私有 API 误当作当前契约，`productionRoutes` 现在刻意为空。test build 只允许 `127.0.0.1` 的精确 `/api/network-search` fixture 路径。真实平台路径只能在低频、用户授权、正常浏览器上下文的 metadata-only 观察后逐条纳入；绝不从 GitHub 的旧签名/Token 方案直接复制进来。

## 明确不做的事

- 除最小的定向静态文件注入权限 `scripting` 外，不申请 `cookies`、`webRequest`、`webRequestBlocking`、`debugger`、`downloads` 或 `<all_urls>`；
- 不读取 Cookie、`localStorage`、`sessionStorage`、页面框架全局状态、浏览器 Profile 路径；
- 不读取或保存请求头、请求体、Authorization、Cookie、`Set-Cookie`、HAR、trace、二维码、验证码、密码；
- 不复刻签名、不重放私有请求、不自动登录、不绕过验证码或风控；
- 不写入公共情报库，也不让页面消息直接调用 Gateway。

## 自测：无需人工加载或点击

前置条件：Node.js 22+。测试使用 Playwright 管理的 Chromium，而不是用户日常 Chrome、Google Chrome 或 Edge；这样可以稳定地通过命令行加载未打包的 MV3 扩展。

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-extension
npm install
npm run test:all
```

`npm test` 会自动：

1. 执行 TypeScript 类型检查；
2. 构建 production 与 test-branded 未打包扩展；只有 test build 额外允许 loopback fixture host；
3. 对 production `manifest.json` 执行 release gate：拒绝高危权限、`<all_urls>`、localhost、任何静态 MAIN world 脚本和 `web_accessible_resources`；
4. 对纯策略运行单元测试：精确 route、递归脱敏、URL/text 去敏、非 JSON、超限响应和“生产路由默认空”；
5. 以临时空 Playwright Chromium Profile 自动加载 test extension；
6. 通过扩展内 test driver 下发四个平台的站内搜索任务；Worker 必须先构造真实 native URL，再仅在 test build 映射到 loopback fixture；
7. 在严格 CSP fixture 中触发一次 `fetch`、一次 XHR、一次超限响应和一次非 allowlist 路由；
8. 断言 `MAIN -> bridge -> Worker -> storage.session` 的真实消息链、fetch/XHR 两种传输、敏感 sentinel 缺失、query/hash 缺失、超限被拒绝、未允许路径未入库，以及零非 loopback HTTP(S) 请求；
9. 自动关闭 context 并删除临时 Profile。

第一次运行中，`npm run test:all` 会下载 Playwright 专用 Chromium；后续会复用该受管理浏览器。测试优先使用 headless Chromium，若环境不支持则自动以 headed 模式重试，但不需要人工点击或加载。

## 生产构建

```powershell
npm run build
```

生成物位于 `dist/`，其中没有 test driver、localhost 权限或已启用的生产网络响应路径。正式安装/分发方式与后续本地 Gateway 配对协议独立：开发、回归测试和真实登录态验证都不能共用浏览器 Profile。

## 当前平台状态

| 平台 | 原生搜索 URL 契约 | 可见 DOM 规则 | 网络响应生产路由 |
|---|---|---|---|
| B站 | `/all?keyword=...` | 规范 `https://www.bilibili.com/video/BV...` | 未启用；匿名探测看到首屏 HTML，不能据此假设 JSON API |
| 知乎 | `/search?type=content&q=...` | 问题/回答与专栏规范 URL | 未启用；匿名探测返回 403，需单独登录态验证 |
| 微博 | `/weibo?q=...` | PC/mobile 规范帖子 URL | 未启用；匿名探测停在 visitor bootstrap |
| 小红书 | `/search_result_ai?keyword=...` | 规范 `/explore/<note-id>` | 未启用；匿名探测只见安全/配置相关请求，未确认搜索结果数据路由 |

这张表把离线 E2E、匿名 metadata-only 探测和真实登录态验证严格分开。fixture 成功不等于真实平台成功；未确认路由不被当作能力承诺。

更完整的设计、安全推理、自动化证据和本轮匿名路线探测结论见 [网络响应观察设计与验证](../../docs/research/browser-extension-network-observation-2026-07-17.md)。

## 后续接入设计

```text
用户在正常浏览器中自行登录平台
  -> 用户明确启动一个只读站内搜索任务
  -> 扩展收集去敏 DOM / 已批准 response 投影
  -> 本地 Gateway 以显式配对、平台/动作 allowlist 接收结果
  -> 本地保存安全 artifact 或交给 DeepResearch 分析
```

下一个平台阶段不是“放开抓包”，而是逐站验证：先以 metadata-only 路径确认候选，再在用户正常登录后的专用、可撤销浏览器上下文中验证字段白名单、失败语义和是否需要人工操作。整个过程不会要求或接收 Cookie、密码、二维码、验证码或 Token。
