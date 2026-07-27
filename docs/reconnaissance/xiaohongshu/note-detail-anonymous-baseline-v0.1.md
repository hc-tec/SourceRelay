# 小红书笔记详情：匿名基线侦察 v0.1

- 日期：2026-07-27
- 结论：**blocked**。匿名状态下，已知公开笔记路由不能形成可读取的笔记详情页；小红书将本轮目标重定向至首页并显示登录弹层。
- 本文只记录真实网页基线，不把历史 BrowserWing 结论、旧选择器或旧接口当作事实，也不宣称已经具备小红书详情采集能力。

## 窄问题

对一个已知的小红书公开笔记路由，在不加载 Collector 扩展、没有读取认证材料、没有页面交互的前提下，真实网页是否会在一次导航后稳定呈现可读的笔记详情 DOM？

这个问题的答案决定第一条产品能力能否是：

```text
xiaohongshu.note.detail.user_selected_tab
```

## 环境与边界

- 浏览器：一个可见、持久、隔离的临时 Playwright recon Profile；不接触用户日常浏览器、日常 Profile 或任何 Cookie/Token/Storage。
- 扩展：未加载，`extensionInteractionLoaded=false`；没有调用 Gateway、MV3 work、Native Messaging 或既有平台 runner。
- 页面输入：只有一次对已知笔记路由的导航；没有 click、hover、scroll、刷新、搜索、筛选、翻页或自动重试。
- 网络：在导航前开始记录小红书 document、XHR、Fetch 的**元数据**；未读取 request/response body、query、header 或认证字段。
- 本地证据：截图和完整去敏运行摘要仅保存在 Git ignored `poc/runtime/`，不提交原图、二维码、笔记正文或浏览器材料。

## 观察时间线

| Phase | 事实 | 结论 |
| --- | --- | --- |
| `browser_started` | 专用临时 Profile 启动，未加载扩展。 | 是干净匿名基线，不会把旧扩展选择器带入结论。 |
| `network_observer_attached` | 在导航前挂载 document/XHR/Fetch 元数据观察。 | 后续重定向与登录相关请求可与本次唯一导航关联。 |
| `navigation_submitted` | 对已知笔记路由仅导航 1 次，`DOMContentLoaded` 正常到达。 | 导航本身不是失败；不能因此假定笔记详情可读。 |
| `baseline_visible` | 浏览器最终显示小红书首页与半透明登录弹层，背景为推荐卡片，不是笔记详情。 | 人眼可见的流程被登录阻断。 |
| `dom_postcondition` | 规范页面身份为 `https://www.xiaohongshu.com/explore`；没有详情标题 heading；可见文本包含“登录后推荐更懂你的笔记”、二维码登录和手机号登录表单。 | 页面没有到达目标笔记的正文/作者/互动详情状态。 |
| `network_postcondition` | 目标路由发生 document `302`，随后经过安全跳转/`404` 页面；`/api/sns/h5/v1/note_info` 返回 `461`；同时出现登录二维码创建请求。 | 直接匿名详情读取不可用，且 `461` 与视觉登录弹层相互印证。 |
| `cleanup_verified` | 这个临时 recon context 已按完整 run 关闭；没有重放导航。 | 本轮没有残留临时浏览器或调试端口。 |

## 风险信号的正确语义

页面包含“获取验证码”，但它是手机号登录表单的短信验证码字段，不是 CAPTCHA 或安全挑战。截图中没有“完成安全验证”、异常访问、限流或风控拦截页。

因此本轮终态应当严格记为：

```text
login_required
```

而不是 `verification_required`、`rate_limited` 或 `source_unavailable`。后续策略必须避免仅凭“验证码”三个字误判风控。

## 动作账本

| actionId | 层 | attempted / count | 结果 |
| --- | --- | --- | --- |
| `navigate_known_public_note_once` | 隔离 Playwright 浏览器 | `true / 1` | `DOMContentLoaded`，但最终为首页登录弹层；没有第二次导航。 |

所有其他平台语义动作均为 `0`。等待渲染、截图、DOM 读取和网络元数据归档都是本地只读步骤，不是平台输入。

## 2026-07-28：产品策略收紧

小红书与其他平台不同。项目策略改为：

```text
允许：用户或浏览器直接打开一个原始页面后，对同一 document 做一次只读收集
禁止：刷新、页面内点击打开详情/新页、自动翻页、自动搜索、滚动触发更多内容、重试导航
优先：严格白名单的 Network/XHR 投影
降级：DOM 只用于与视觉、网络事实交叉核验，不作为首选数据源
```

因此，匿名直链 URL 不是首个 MVP 的可靠入口，也不能因为历史样本中有笔记 ID 就尝试保存或重放短期访问上下文。上层应用不会再提交任意小红书 URL、selector、脚本、tab/document ID 或页面动作计划。

## 匿名 Network 基线补充

在一个新的匿名隔离 Profile 中，对 `/explore` 只进行了一次原始导航，导航前开始 Network 监听：

- 视觉与 DOM：首页可见推荐卡片，但登录弹层可见；没有验证码挑战、限流或异常访问页。
- XHR/Fetch：观测到的 2xx 请求属于登录、身份、配置、安全或遥测面；没有发现可安全晋升为公开内容数据源的 route。
- 文档响应：`/explore` 返回约 843 KiB HTML，带初始状态标记；本轮只记录大小、哈希和结构标记，未导出 HTML，也没有读取任何 XHR/Fetch 正文。
- 输入预算：导航 1；刷新、页面内 click、页面内新 document、滚动、重试均为 0。

这证明的是“匿名首页存在、但未发现可用公开内容接口”，而不是“页面卡片即可通过某个私有接口采集”。

## 当前接口边界

已登记但尚不可调度的能力是：

```text
xiaohongshu.current_page.network_metadata
```

它只描述一个**已明确选择的当前页面**，固定预算为：平台导航 0、刷新 0、页面内新 document 0、语义动作 0、response body 0。未来只有当独立真实 run 证明一条公共内容 route 与可见页面对应，才会新建一个独立 capability 来允许那一条 route 的有界正文投影；不会放宽这个 metadata 能力，也不会把登录、安全、身份或遥测接口纳入数据源。
