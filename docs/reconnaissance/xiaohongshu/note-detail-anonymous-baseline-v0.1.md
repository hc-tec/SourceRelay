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

## 产品含义

匿名直连 URL 不是首个 MVP 的可靠入口，也不能因为历史样本中有笔记 ID 就尝试保存或重放短期访问上下文。

目前最合理的产品方向仍然是：

```text
用户在自己已登录的小红书浏览器中自然打开一篇笔记
  → 用户在扩展 popup 明确选择当前页
  → 上层应用只提交固定笔记身份 + browserBindingId
  → Gateway 签发一次 typed user_selected_tab work
  → 扩展只投影同一 tab/document 已可见的固定 DOM
```

这避免把 `xsec_token`、Cookie、浏览器存储或任意页面控制接口暴露给 Gateway 和上层应用。但该能力尚未实现或标记为 `direct_ready`：仍需先在已登录隔离验证浏览器完成视觉、DOM、XHR 三面实证。

## 下一独立 run

已在 Browser Host 的隔离验证 Profile 中打开并以 `retained_for_review` 保留一个小红书首页登录页。该页只等待用户本人扫码、输入密码或完成平台要求的身份动作；没有导出或读取凭据。

用户完成登录后，下一轮将使用一个新的、当前可访问的笔记详情页，并且：

1. 只导航一次，不依赖本轮已失效的旧详情 URL；
2. 先截图确认真实详情布局，再分析语义 DOM；
3. 在导航前后记录 XHR/Fetch 元数据，重点区分详情首屏水合、评论懒加载与登录/安全请求；
4. 只有确定可见详情与 DOM/XHR 证据一致后，才设计固定的 `user_selected_tab` 契约和扩展投影。

