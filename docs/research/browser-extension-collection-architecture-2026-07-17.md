# 浏览器扩展采集系统与无人值守测试基线（2026-07-17）

> 历史状态：本文保留 2026-07-17 POC 的实现证据，不再是当前执行架构。较晚的第 101–170 题已经用独立 Browser Host、多页面池、Native Messaging、Extension Strategy + Host trusted input、纯逻辑单元测试 + 真实 Chromium/真实平台验证覆盖了本文的扩展单体、Gateway 直连、per-task window 和 fixture E2E 方向。当前权威规格见 [Browser Host 与受管页面池 MVP](../design/managed-page-pool-browser-host-mvp.md)；本文中的 fixture 结果只能说明当时的历史运行时合约，不能作为当前平台或页面池能力证据。

> 决策：浏览器扩展成为登录态平台采集的执行面；Playwright bundled Chromium 成为唯一的扩展自动化验收面。用户日常 Chrome/Edge、BrowserWing、外部搜索引擎和手工 `chrome://extensions` 操作都不进入默认测试链。

## 为什么要转向扩展

对于知乎、微博、小红书、B站等站内搜索，真正的权限面在用户浏览器里：页面已渲染的结果、平台自己的登录态和可见的安全/验证码提示都属于浏览器上下文。扩展 content script 可以只读地读取用户**已经看得到**的 DOM；它不需要把 Cookie 复制给 Python、Node、SearXNG、BrowserWing 或第三方 Cookie 服务。

正确分层是：

```text
用户正常浏览器
  └─ Manifest V3 扩展
       └─ 平台 content script：只读可见 DOM、白名单字段
            └─ service worker：原生搜索任务、状态、去敏结果
                 └─ 本地 Gateway / DeepResearch（后续显式、受控桥接）

测试浏览器（完全独立）
  └─ Playwright bundled Chromium + 临时 persistent profile
       └─ 自动加载未打包 test extension
            └─ 离线 fixture、Worker、消息链与产物权限验收
```

这不是把平台访问限制绕过去；平台仍可以要求登录、验证码或重新验证。扩展的作用是让合法、用户授权的浏览器上下文成为统一且可测试的采集面。

## 已实现的最小系统

实现位于 [poc/collector-extension](../../poc/collector-extension/)。它是手写、显式的 Manifest V3 + TypeScript + esbuild，而不是先引入一个会自动生成权限和运行时的框架。

选择 plain MV3 的原因是第一阶段只有少量高风险边界：host permission、content script、service worker、消息和结果字段。显式 `manifest.json` 与 release artifact gate 比开发速度更重要。测试 harness 只依赖构建后的扩展目录；以后改用 WXT 或 CRXJS 时，它不需要重写。

当前扩展具有以下实际能力：

| 层 | 已实现行为 | 明确不做 |
|---|---|---|
| Native route | 为 B站、知乎、微博、小红书构造平台原生搜索 URL | Bing/搜狗/SearXNG/site fallback |
| DOM content script | 从可见锚点投影规范 URL、标题、类型、排名；页面 URL 去 query/hash | Cookie、storage、框架全局状态、评论/翻页 |
| 受控网络观察 | 已 arm、精确导航摘要匹配的原生搜索 tab 中，Worker 动态注入 MAIN world observer 观察 allowlist JSON `fetch`/XHR 响应；双重去敏后暂存 | OS/代理抓包、`webRequest`/`debugger`、请求头/体、原始 response/HAR、私有请求重放 |
| Service worker | 创建平台搜索 tab、创建短时 tab/platform/navigation-digest arm、定向注入 observer、接收并复核去敏结果、写入 `chrome.storage.session` | 自动登录、验证码处理、持久化用户资料、发布/互动 |
| Manifest | 只声明精确平台 host、`activeTab`、`storage` 与定向静态文件注入所需的 `scripting` | `<all_urls>`、`cookies`、`webRequest`、`debugger`、下载权限 |
| Test build | 可使用 loopback fixture 与 extension 内 test driver | 将 test driver 或 localhost permission 打入 production build |

生产版和测试版是不同构建产物：只有测试产物有 `127.0.0.1` 匹配规则和 `test-driver.html`。release-artifact gate 会拒绝 production `dist/manifest.json` 中的 localhost、`<all_urls>` 或敏感权限，并拒绝任何静态 MAIN world observer；observer 只能在 Worker 已复核的 task tab/document 中通过固定文件动态注入。当前生产 response route allowlist 刻意为空，直到低频、用户授权的实站验证确认一个当前路径。

## 无需人工加载/点击的完整测试链

当前 `npm run test:all` 已在本机通过。命令依次完成：

```text
TypeScript typecheck
  -> production build
  -> production manifest gate + SHA-256
  -> test build
  -> source security contract
  -> Playwright E2E
```

E2E 的真实链路是：

```text
Playwright bundled Chromium（headless）
  -> 新建临时 persistent profile
  -> --disable-extensions-except / --load-extension 自动加载 dist-test
  -> 自动发现 MV3 service worker，并从 worker URL 获得动态 extension ID
  -> 打开 test-driver.html（不是点击工具栏）
  -> 请求 Worker 发起平台原生搜索任务
  -> Worker 构造真实 B站/知乎/微博/小红书 native URL，并为新 tab 写入短时 navigation-digest arm
  -> test build 将导航严格映射到 loopback fixture
  -> document_start bridge 请求 Worker；Worker 动态注入 MAIN observer，content script 自动解析卡片
  -> fixture 触发 fetch、XHR、超限 JSON 和错误路径
  -> Worker 复核 tab/platform/route、写 chrome.storage.session
  -> Playwright 自动断言 URL、DOM 结果、去敏网络投影、超限拒绝与无外网请求
  -> 关闭 context 并删除临时 profile
```

关键点是：测试会断言真实的 native URL 契约，例如：

```text
https://search.bilibili.com/all?keyword=DeepSeek
https://www.zhihu.com/search?type=content&q=DeepSeek
https://s.weibo.com/weibo?q=DeepSeek
https://www.xiaohongshu.com/search_result_ai?keyword=DeepSeek&source=web_explore_feed
```

同时，测试构建下的实际浏览导航只允许到本机 loopback fixture；所有其它 HTTP(S) 请求被拦截并会使测试失败。这样不会把真实页面、外部搜索引擎、平台登录态或偶然的缓存结果误作为测试证据。

本轮运行的结果：

```json
{
  "ok": true,
  "extensionId": "picfcfkggbhcdckdkbgpikkiielebpfn",
  "testMode": "headless"
}
```

这证明了“构建 → 自动加载 → Worker → content script / MAIN observer → 原生 URL 任务 → 双重去敏结果回传 → 清理”的运行时闭环；它不宣称已经验证了真实平台登录后的 DOM 或私有 API。

## 为什么测试使用 bundled Chromium，而非用户 Chrome

Playwright 官方对扩展测试的关键约束是：

1. 扩展需要 `launchPersistentContext()`；
2. Google Chrome 和 Edge 已不再是可靠的命令行侧载扩展测试通道；
3. 测试应使用 Playwright bundled Chromium，`channel: "chromium"`；
4. Chrome extension 可在该通道的 headless persistent context 中运行；
5. `chromium-headless-shell` 不支持扩展，不能用于这一测试。

因此，默认 E2E 永远不会：

- 读取、复制、修改用户日常 Chrome/Edge profile；
- 依赖用户手工打开浏览器、加载扩展或点击 action；
- 访问真实平台或真实账号；
- 用 BrowserWing 保存个人登录态。

## 框架调研与选择

| 候选 | 构建产物可被 Playwright 直接加载 | 权限审计透明度 | 当前取舍 |
|---|---:|---:|---|
| WXT + Playwright | 是，官方提供 E2E 文档/示例 | 中等，需审计生成的 manifest | UI/多浏览器需求扩大后优先候选 |
| CRXJS/Vite + Playwright | 是，包含相近 E2E fixture | 较高 | 可作为需要 Vite 生态时的替代 |
| Plain MV3 + esbuild + Playwright | 是 | 最高，manifest/产物完全显式 | **本阶段采用** |
| Plasmo | 理论可行 | 较低 | 不作为首版依赖，测试与打包已有公开兼容问题 |

这里的稳定边界不是某个框架，而是：

```text
release artifact directory
  + Playwright persistent Chromium context
  + deterministic fixture / message contract
```

只要这条边界保留，扩展框架的迁移不会破坏测试能力。

## 后续按风险分层推进

### 1. 继续扩展离线 adapter 与 response 路由合约

每个平台应新增独立 fixture 与状态分支：

```text
search-page.fixture.html
auth-required.fixture.html
no-results.fixture.html
layout-changed.fixture.html
```

并断言 `success`、`authentication_required`、`no_results`、`layout_changed` 互不混淆。每个 adapter 必须继续只输出去敏的白名单字段。response 观察路线还必须额外具备精确 origin/path、MIME、状态码、超限和敏感字段 fixture；不能因为 DOM fixture 成功就自动启用 production response route。

### 2. 增加可自动测试的 extension 页面

不要以浏览器工具栏 popup 的原生容器作为核心测试点；Playwright 没有稳定 API 来触发真实 browser action popup。后续状态页、popup 与 options 页均可直接打开：

```text
chrome-extension://<dynamic-extension-id>/popup.html
```

因此 UI、任务状态、错误原因和本地桥接授权都可以自动测试，而不依赖鼠标点击工具栏。

### 3. 本地桥接必须显式授权

扩展与 Gateway 的下一步不是让 Gateway 任意遥控浏览器，而是建立一个用户可见、可撤销的本地配对/任务协议。该协议需要：

- 平台与操作 allowlist；
- 只读动作；
- 每次任务的来源与范围；
- 不传 Cookie、Token、Profile 路径、二维码、密码或验证码；
- 结果先经过扩展内字段 allowlist；
- 默认不写入公共情报库。

### 4. 真实平台 metadata smoke 与登录集成另行处理

离线 E2E 完全自动化；真实平台 smoke 与登录集成必须分开：

| 层级 | 使用真实站点 | 需要登录 | 默认运行 |
|---|---:|---:|---:|
| Extension runtime contract | 否 | 否 | 是 |
| Anonymous platform metadata smoke | 是，仅 origin/path/status/MIME | 否 | 否，低频显式触发 |
| Authenticated native-search validation | 是 | 可能 | 否，用户显式授权后 |

用户未来只需要在正常浏览器里自行完成平台登录。系统不得要求或记录任何凭据；而“能不能找到真实搜索卡片/搜索响应”的结论只能来自独立、低频、显式的 live validation，不能从 fixture 推断。网络观察的详细安全模型与本轮匿名 metadata-only 结果见 [网络响应观察设计与验证](browser-extension-network-observation-2026-07-17.md)。

## 一手资料

- [Playwright Chrome Extensions](https://playwright.dev/docs/chrome-extensions)
- [Playwright `launchPersistentContext`](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
- [Playwright MV3 extension regression tests](https://github.com/microsoft/playwright/blob/main/tests/library/chromium/extensions.spec.ts)
- [Playwright MV3 Worker restart fix](https://github.com/microsoft/playwright/pull/39476)
- [Chrome content-script isolated worlds](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#work-in-isolated-worlds)
- [Chrome runtime messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome minimum permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chromium extension side-load flag change](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/FxMU1TvxWWg/m/daZVTYNlBQAJ)
- [WXT E2E testing](https://wxt.dev/guide/essentials/e2e-testing.html)
- [CRXJS issue #1218](https://github.com/crxjs/chrome-extension-tools/issues/1218)
- [Plasmo issue #1148](https://github.com/PlasmoHQ/plasmo/issues/1148)
