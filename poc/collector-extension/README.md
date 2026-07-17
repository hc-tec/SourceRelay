# Personal Intelligence Collector Extension

这是新的浏览器内采集底座：它以 Chrome Manifest V3 扩展运行在用户自己的浏览器页面中，而不是把已登录 Profile 交给外部爬虫服务。

当前实现是一个可自测的最小闭环，重点验证：

```text
未打包扩展自动加载
  -> MV3 service worker 启动
  -> content script 自动注入测试页
  -> service worker 与 content script 双向消息
  -> 平台适配器只读取可见 DOM
  -> 结果规范化与后台暂存
  -> 后台自动生成平台原生搜索 URL 并打开专用 tab
```

测试全过程不需要人工在 `chrome://extensions` 加载扩展、不需要点击图标、不需要登录平台，也不会读取任何用户的日常 Chrome Profile。

## 为什么改为扩展

平台站内搜索本质上是浏览器内能力：页面、登录态、反爬提示和结果卡片都在用户实际使用的浏览器上下文中。扩展的 content script 可以只读地读取用户已经看得到的 DOM；它不需要导出 Cookie，也不需要复刻私有接口签名。

本模块明确不使用：

- `cookies`、`webRequest`、`debugger`、`downloads` 等扩展权限；
- `<all_urls>` Host Permission；
- Cookie、local/session storage、网络请求/响应、HAR、trace、页面框架全局状态；
- 自动登录、验证码处理、绕过风控、翻页、发布、评论、点赞或关注。

每一个平台 adapter 当前只投影：规范公开 URL、可见标题、结果类型和排名。它不将用户身份、浏览器路径、短期签名参数或会话数据发出页面。

## 自测：不需要人工加载或点击

前置条件：Node.js 22+。测试使用 Playwright 管理的 Chromium，而不是用户日常 Chrome、Google Chrome 或 Edge；这样可以稳定地通过命令行加载未打包的 MV3 扩展。

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-extension
npm install
npm run test:all
```

`npm test` 会自动：

1. 执行 TypeScript 类型检查；
2. 构建一个 test-branded 未打包扩展；仅 test build 额外允许 loopback fixture host，生产 manifest 不含此权限；
3. 测试先断言 Worker 构造的是四条真实的平台**站内搜索 URL**，再仅在 test build 中将其映射到本地确定性 DOM fixture；所有非 loopback HTTP(S) 请求都会被阻止；
4. 以临时空 Playwright Chromium Profile 启动 Chromium，并以 `--load-extension` 自动加载该扩展；
5. 等待 MV3 service worker，确认 content script 已经自动注入 fixture；
6. 通过仅存在于 test build 的扩展内 test driver 自动下发“原生站内搜索”任务；后台必须构造正确的平台 URL、创建 tab、触发 content script，再接收结果；
7. 验证结果回传、后台 `storage.session` 暂存和每个规范 URL；
8. 对最终 `dist/manifest.json` 执行 release-artifact gate：检查 MV3、最终 JS 文件、SHA-256、最小权限、禁止 `<all_urls>` 与任何 localhost 匹配规则；
9. 关闭浏览器并删除临时 Profile。

第一次运行中，`npm run test:all` 会通过 Playwright 下载其专用 Chromium；后续运行会复用该受管理浏览器。测试优先使用 headless Chromium；若当前 Chromium 版本禁用 headless 扩展，测试会自动以 headed 模式重试，但仍然不需要人工点击或加载。输出里的 `testMode` 会如实标记实际模式。

## 生产构建

```powershell
npm run build
```

生成物位于 `dist/`，其中没有测试 host。正式安装/分发方式将在连接本地 Gateway 后确定；它与自动化测试相互独立。也就是说，开发和回归测试从第一天起都不依赖用户去开发者模式手动加载插件。

## 当前平台适配器边界

| 平台 | 当前可见 DOM 规则 | 尚未承诺 |
|---|---|---|
| B站 | 规范 `https://www.bilibili.com/video/BV...` 链接 | 排序、筛选、分页、详情和评论 |
| 知乎 | 问题/回答与专栏的规范 URL | 登录后真实搜索页的字段稳定性 |
| 微博 | PC/mobile 规范帖子 URL | 登录后搜索结果卡结构、分页和验证码语义 |
| 小红书 | 规范 `/explore/<note-id>` 链接 | 详情打开、短期访问上下文和评论 |

这四条规则均经过“真实原生 URL 契约 + test-only loopback fixture”的端到端消息链测试；测试不会真正访问平台，也不把 fixture 测试冒充平台实测。真实平台适配器必须在用户登录后的实际页面上，按照固定样本、范围、失败语义和字段白名单分别验证。

## 后续接入设计

```text
用户在正常浏览器中自行登录平台
  -> 扩展在已授权页面内读取可见 DOM
  -> 只发送去敏、白名单结果给本地 Gateway
  -> Gateway 保存本地 raw artifact 或立即交给 DeepResearch
```

下一步先实现一个用户明确授权的本地桥接协议与扩展 UI/命令权限模型，再为知乎、微博、小红书逐个平台完成真实搜索卡片契约。桥接不会要求或接收 Cookie、密码、二维码、验证码或 Token。
