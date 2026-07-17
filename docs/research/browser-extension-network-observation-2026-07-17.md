# 浏览器扩展的受控网络响应观察：设计、验证与实站基线（2026-07-17）

> 决策：把用户授权的“网络抓包”实现为浏览器扩展内、任务绑定、去敏的**响应观察层**，而不是 OS 级抓包、MITM、`webRequest`、DevTools `debugger` 或 Cookie 导出器。它用于确认平台自己的站内搜索响应结构，不能用于重放私有请求、绕过登录或导出认证材料。

## 要解决的真实问题

只读 DOM 对 B站、知乎、微博、小红书的站内搜索是一个安全而稳的起点，但它不总能提供排序、作者、时间、内容摘要、翻页线索或登录/风控失败语义。页面已经合法发出的 JSON 响应有时能补足这些结构。

关键不是“能否看到任何网络包”，而是同时满足：

```text
可观察当前页面已合法发生的搜索响应
  + 不导出用户认证材料
  + 不让页面任意触发特权扩展动作
  + 能在没有真实账号的情况下自动回归验证
```

因此该能力被称为“受控网络响应观察”，而非泛化抓包。

## 实现边界

| 做 | 不做 |
|---|---|
| Worker 定向注入的 MAIN world 中观察页面已经发出的 `fetch` / XHR 响应 | OS 级网卡抓包、代理 MITM、TLS 解密 |
| 只接受明确 `origin + pathname` 路由、2xx JSON | `webRequest` / `webRequestBlocking` / `debugger` / CDP 读取任意流量 |
| 响应内存中第一次去敏，桥接和 Worker 再次去敏 | 保存原始包、请求/响应头、HAR、trace、请求体 |
| 暂存受限 JSON 投影到 `chrome.storage.session` | 保存 Cookie、Token、密码、验证码、二维码、浏览器 Profile |
| 按 tab、平台、短 TTL 明确授权 | 自动登录、签名复刻、私有 API 重放、绕过风控 |

发布 manifest 使用 `activeTab`、`storage`、精确的平台 host permissions，以及唯一额外的 `scripting` 权限。`scripting` 只用于把固定 observer 文件定向注入 Worker 已复核的 tab/document；它不申请 `cookies`、`webRequest`、`webRequestBlocking`、`debugger`、`downloads` 或 `<all_urls>`。

## 数据流与信任边界

```text
显式站内搜索任务
  -> Worker 创建 about:blank tab
  -> Worker 为 {tabId, platform, navigationUrlDigest} 写入 2 分钟 session arm
  -> tab 导航到平台原生搜索 URL
  -> isolated bridge (document_start) 向 Worker 请求 arm
  -> Worker 复核 top frame、sender URL 摘要、platform 后动态注入固定 MAIN observer
  -> 页面自己的 allowlist JSON response
  -> 首次去敏、大小/数量 gate、window.postMessage
  -> isolated bridge：source/origin/schema + 第二次去敏
  -> Worker：top frame / sender tab / arm / platform / route + 第三次去敏
  -> chrome.storage.session 的短时安全投影
```

### 为什么三个世界都要复核

`world: "MAIN"` 让 observer 能看到页面自己的 JavaScript 网络 API，但也意味着它和页面脚本处于同一个执行环境。页面可以干扰 wrapper，也可以伪造外形相同的 `window.postMessage`。因此 observer **不能作为静态 content script**出现在每个匹配页；否则页面可伪造 ready 信号，让未授权页开始 clone/read response。

这不是可以用一个 nonce “修好”的密码学边界。正确处理是把 MAIN-world 数据当成不可信输入：

- isolated bridge 检查 `event.source === window`、同源、固定 channel、严格 schema，并再次去敏；
- Worker 先对 top frame、tab ID、原生搜索路径、精确导航 URL 摘要和未过期 arm 复核，再用 `scripting` 定向注入固定 observer 文件；
- Worker 要求 message 来自顶层 content script、已经 arm 的 tab、相同 platform 和允许路由；
- 这条消息链只能增加受限的只读 artifact，不能导航、请求任意 URL、调用本地 Gateway、提升权限或跨 tab 执行操作；
- 页面伪造最多造成当前任务内的有界错误证据，不能变成浏览器控制通道。

## 默认策略

当前常量与行为：

| 项目 | 策略 |
|---|---|
| 授权 | Worker 先创建空白 tab，再写 `{ platform, navigationUrlDigest, expiresAt }`，最后导航；TTL 2 分钟 |
| frame | 只接受顶层 frame；静态 bridge 也明确 `all_frames: false` |
| 响应类型 | 仅 `application/json`、`text/json` 或 `application/*+json` 的 2xx 响应 |
| 尺寸 | 单响应上限 96 KiB；流式读取 clone，超过即取消，不调用无界 `response.text()` |
| 配额 | 每个页面最多 3 个 observation |
| URL | 只保留 `origin + pathname`，删除 username/password/query/hash |
| JSON | 最大深度 8、对象属性 80、数组元素 80、字符串 4,000 字符 |
| 存储 | `chrome.storage.session`；tab 关闭后清理结果和 arm |

敏感字段名会先小写化并移除分隔符，然后删除含 `cookie`、`authorization`、`token`、`session`、`sid`、`csrf`、`xsrf`、`xsec`、`z_c0`、`password`、`captcha`、`verify`、`phone`、`email`、`apiKey`、`secret` 等片段的键。文本值还会消除明显的 Bearer/Basic、JWT 和 `key=value` 认证片段。

这不是对任意服务器任意字段的完整保密证明。因此 route、MIME、尺寸、数量和不落原始包仍是必要的第一道边界。

## 路由准入：生产默认空白

`src/shared/network-capture.ts` 中的 `productionRoutes` 故意为空。test build 仅允许：

```text
http://127.0.0.1:<dynamic-port>/api/network-search
```

且仍要求每个页面对应的 platform。这样可以测试“精确路径”而不会把 `127.0.0.1/*` 误当作 allowlist。

这项空白是刻意的安全/真实性决策：旧 GitHub 爬虫、公开文章或历史接口样例都不能证明当前平台的私有路径、签名、登录要求和字段仍有效。它们更不能自动进入 production observer。

单个生产路径的准入必须完成全部条件：

1. 用临时或用户明确授权的专用浏览器上下文，低频确认当前的 `origin + pathname`；
2. 不读取或保存 headers/query/body 的前提下，确认该路径确实是站内搜索结果，而不是安全、风控、账户或 telemetry 接口；
3. 登录态（如需要）下验证其去敏后的字段投影确有搜索结果价值；
4. 为该路径添加独立 fixture、敏感字段反例、MIME/超限/失败状态测试；
5. 审阅后显式加入 production route，并在 capability 文档中标注验证时间、适用状态和失败语义。

## 无人值守验证证据

复现命令：

```powershell
Set-Location D:\AIProject\inteligence\poc\collector-extension
npm run test:all
```

自动测试使用 Playwright bundled Chromium、临时 persistent profile 和自动加载的 `dist-test` 扩展。它从不接触用户浏览器 Profile，也不会访问真实平台。

离线 fixture 采用严格 CSP，并由同源脚本在 observer-ready 握手后顺序触发：

```text
allowlist fetch JSON
  -> allowlist XHR JSON
  -> non-allowlist JSON
  -> allowlist oversized JSON
```

已自动断言：

- production manifest 没有静态 MAIN-world observer；只有精确匹配、`document_start`、`all_frames: false` 的 isolated bridge，且 Worker 必须先验证 task 才能动态注入 observer；
- source 没有 `chrome.*`、Cookie/storage、请求 header/body、`getAllResponseHeaders` 或 HAR/trace 访问；
- fetch 与 XHR 都经过 MAIN -> bridge -> Worker -> `storage.session`；
- 嵌套 Authorization/Token/Session、URL query 和 Bearer 文本中的 synthetic sentinel 均不会进入 session storage；
- 响应 query/hash 从存储 URL 删除；超限响应只留下 `payload_too_large` 枚举，body 不被保存；非 allowlist 路径不写入；
- 所有非 loopback HTTP(S) 请求均被 Playwright 阻断，失败信息也不会打印完整 URL。

本轮最后通过结果：

```json
{
  "ok": true,
  "extensionId": "picfcfkggbhcdckdkbgpikkiielebpfn",
  "testMode": "headless"
}
```

该结果证明扩展运行时、脱敏和权限边界；不宣称真实平台已经验证成功。

## 匿名 metadata-only 实站探测（2026-07-17）

在用户授权观察网络后，进行了仅一次、低频的匿名基线探测。方法：

- Playwright bundled Chromium，临时空 persistent profile，结束后删除；
- 不加载扩展、不读取 `.env`、不使用 Cookie/Token/代理或用户 Profile；
- 仅浏览四个原生搜索入口；第三方域请求被阻断；
- 只记录平台相关响应的 `origin + pathname`、HTTP 状态和 MIME；**不读取响应正文、请求/响应头或 query**；
- 不产生 HAR、trace、截图或持久化网络 artifact。

结果：

| 平台 | 安全的 metadata 观察 | 决策 |
|---|---|---|
| B站 | 搜索页返回 200 HTML，并已呈现内容资源；本次窗口内未出现可确认的搜索结果 JSON endpoint | 继续以 DOM 为主；不启用 JSON route |
| 知乎 | 搜索页/相关 JSON 请求为 403 | 明确记录匿名受限；不猜接口，后续仅在正常登录状态下再验证 |
| 微博 | 搜索入口转入 visitor bootstrap | 不是搜索结果证据；不纳入 route |
| 小红书 | 页面加载了安全、配置、个人资料/风控相关 JSON；本次未确认搜索结果数据路径 | 特别排除安全/账户接口；不纳入 route |

这个探测的价值是排除了几个危险误判：不能把 B站首屏 HTML 当成 JSON 接口契约；不能把知乎 403 当成“无结果”；不能把微博 visitor bootstrap 或小红书安全/用户配置接口当作可采集搜索数据。它也解释了为什么 production allowlist 必须仍为空。

## 后续执行顺序

1. 保持 DOM adapter 和离线网络观察测试为默认可回归能力；
2. 用户需要某个平台真实字段时，先运行同样去敏的 metadata-only 探测，确认是否需要正常登录；
3. 如需要登录，用户自行在正常浏览器/专用隔离 Profile 完成人工登录；系统不接收任何凭据；
4. 在明确站内搜索任务内观察当前路径，仅以去敏响应投影验证字段与失败语义；
5. 每次只准入一个精确 route，并把 fixture、测试和 capability 证据一起提交；
6. 最后再设计本地 Gateway 的显式配对与原始 artifact 落地边界。

## 一手参考

- [Chrome Manifest content scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)
- [Chrome content script isolated worlds](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#work-in-isolated-worlds)
- [Chrome extension messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Playwright Chrome extensions](https://playwright.dev/docs/chrome-extensions)
