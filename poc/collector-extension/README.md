# Personal Intelligence Collector Extension

这是个人情报产品在用户自己浏览器 Profile 内的只读观察层。它不是传统爬虫，也不是一个把 Cookie、任意 selector 或任意请求转发给本地服务的代理。浏览器自然保留用户正常登录状态；扩展不导出凭证、不绕过验证码/限流，也不执行点赞、关注、评论、私信、发布或删除。

当前公开版本为 `0.7.17`。普通内部实现改动不会升级公开版本；生产构建会生成稳定的 `runtime-build.json` 指纹，Browser Host 只在指纹变化时最多刷新一次旧 MV3 worker。已编译的 Strategy 均是源专属、短时绑定的能力：

- `bilibili.dynamic.account-feed.response-dom.v1`：B 站账号动态页，两页以内的 DOM/XHR 观察；
- `bilibili.video.detail.dom.v2`：B 站视频详情首屏，一次导航、零页面交互、零 response 观察的有界 DOM 投影。
- `bilibili.account.video-inventory.dom.v1`：UP 主投稿视频首页，一次导航、零页面交互、零 response 观察的有界卡片投影。
- `bilibili.account.profile.dom.v2`：UP 主公开主页，一次导航、零页面交互、零 response 观察的有界档案 DOM 投影。
- `bilibili.search.breadth.dom.v2`：B 站站内综合相关性或视频相关性/最新发布搜索；每次仅导航一个经审查的页码 1–2，最多 20 条规范 BV 视频卡，零 response 观察。
- `bilibili.video.transcript.trusted-response.v2`：B 站视频中文字幕的固定 Host 鼠标流程与同一 MV3 document 的两条受限 response 投影；仅 `build_ready`，必须完成新的受管 Profile 实网闭环后才可能 admission。

```text
Gateway
  task / budget / account safety / artifact / Console read model

Browser Host
  visible persistent Chromium / Profile / PageRecord / PageLease /
  navigation / trusted input / tab ownership / lifecycle

MV3 Extension
  exact tab + document ObserverBinding /
  bounded DOM projection / route-bound XHR observation (dynamic and transcript validation only)
```

## 当前边界

- Gateway 不持有 Playwright `BrowserContext` 或 `Page`，也不能通过 URL、tab 顺序或“最近页面”认领页面。
- Browser Host 只把它自己新建、精确绑定到 Extension tab 的 `PageLease` 交给 Strategy。
- Extension 只接受 Native Messaging 的三种窄命令：tab inventory、绑定唯一 Strategy、读取唯一 Strategy 的观察结果。
- B 站动态页只允许 `https://space.bilibili.com/<mid>/dynamic`，当前 route 仅是研究验证中的 `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space`。
- B 站视频详情只允许无 query/hash 的 `https://www.bilibili.com/video/<BVID>`；它只保存公开首屏字段，并把已正向观察到的充电试看限制标为受限访问；不读取 XHR、response body、字幕、评论或推荐内容。
- B 站投稿视频首页只允许无 query/hash 的 `https://space.bilibili.com/<MID>` 输入，并在页面内转为固定 `/upload/video` 目标；链接 pathname 只用于提取 BVID，任何平台附加 query 都被丢弃。
- B 站账号主页只允许无 query/hash 的 `https://space.bilibili.com/<MID>`；它只投影目标账号 header 与 main 中正常可见的公开档案字段，明确排除全站 header、当前登录用户菜单、隐藏页面状态与 response 数据。
- B 站站内搜索只允许经审查的 `/all?keyword=...`（综合相关性）或 `/video?keyword=...`（视频相关性/最新发布）原生 URL，页码仅 1–2。搜索词只存在于短时导航和精确 document binding，长期 artifact 仅保存规范化搜索词的 SHA-256 摘要。更多筛选、更多页、详情跳转及非视频混合对象均是独立能力。
- 字幕只能由 Browser Host 用实时视频区/字幕父节点边界完成可信 hover 与单次中文点击；MV3 只在同一精确 document 上投影固定的轨道目录与公开字幕正文。若首轮播放器与字幕控件均未渲染、且无登录/风控信号，Gateway 至多在同一受管 tab 刷新式导航一次，并在刷新前重新绑定 observer。
- 绑定在下一个精确 document 上短时生效；页面世界只能回传经过路由、大小、深度和敏感字段清洗后的 JSON 投影。
- 同一受管 tab 同时只能保留一个 Strategy binding；切换绑定时会清除前一 binding 与其 route-bound network arm。
- 观察 payload、response 数量、绑定有效期和 document/route generation 都有明确上限；读操作无法传入任意 JS、selector、CDP 方法或 response route。

`research_validation` 只表示 route 有历史实证并允许做低频 canary，不等于 production admission。每个 Strategy 都必须在真实 B 站页面完成自己的闭环：动态页需要视觉、DOM、Network 三面互证；视频详情刻意排除 Network，至少需要视觉和 DOM 的独立证据。

投稿视频首页同样刻意排除 Network；它只承诺首屏卡片。翻页、排序、筛选、图文、音频和合集都不是这个 Strategy 的隐式能力。

## 已移除的旧路径

当前 Extension runtime 不包含以下旧路径：

- Extension 到 `127.0.0.1` Gateway 的配对、轮询、fetch、签名任务 envelope 和 evidence 回传；
- stage lease、单工作 tab、URL digest 认领、静态 `content.js` 和旧的 capability-validation runner；
- 把字幕、详情或搜索的历史验证流程冒充为当前 Browser Host Strategy 能力的控制面。

历史研究投影与 Gateway artifact 代码可以作为后续 Strategy 的参考，但不能重新接入为 Extension 的兼容/回退路径。

## 构建与本地门禁

`verify:build` 是真实 Chromium 的扩展加载门禁，不访问平台页面：它加载 production bundle 到临时 Profile，验证 MV3 worker、runtime marker、Native Bridge 初始状态、控制页和制品边界。

```powershell
Set-Location D:\AIProject\inteligence\poc
npm run typecheck --workspace @intelligence/collector-extension
npm run build --workspace @intelligence/collector-extension
npm run verify:artifacts --workspace @intelligence/collector-extension
npm run verify:extension-load --workspace @intelligence/collector-extension
```

Browser Host 的真实 Chromium 门禁与 Extension build 分开执行：

```powershell
npm run verify:browser-host
```

这些门禁只能证明本地 bundle、持久 Profile 生命周期、Native Messaging 和精确 tab 绑定；它们不证明 B 站页面能力。平台验证必须遵循 [`skills/recon-live-web-interactions/SKILL.md`](../../skills/recon-live-web-interactions/SKILL.md) 的可见浏览器、视觉/DOM/Network 三面证据契约，并在验证码、异常访问、限流、登录失效、网络错误或动作结果未知时停止新的平台动作。

## 权限与数据安全

Manifest 固定使用 `nativeMessaging`、`storage`、`scripting`，不申请 `cookies`、`debugger`、`downloads`、`webRequest`、`webRequestBlocking` 或 `<all_urls>`。B 站动态/投稿所需的 `space`/`api`、视频详情所需的 `www` 与站内搜索所需的 `search` origin 都是 required host permission；其他平台 origin 仍仅是未来独立 Strategy 的 optional 候选，尚未获得运行时采集能力。

扩展不会把页面 URL query/hash、认证字段、Cookie、Authorization、Token、密码、验证码或 Profile 路径写入观察结果。截图、原始运行材料和用户身份信息只留在 ignored runtime，不能提交进 Git。

相关权威规格：

- [Browser Host 与受管页面池 MVP](../../docs/design/managed-page-pool-browser-host-mvp.md)
- [Collector 决策审计](../../docs/design/collector-decision-audit.md)
- [B站动态实证基线](../../docs/reconnaissance/bilibili/account-dynamic-recon-v1.0.md)
