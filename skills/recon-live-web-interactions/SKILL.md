---
name: recon-live-web-interactions
description: Investigate and prove interactions on real websites before automating them by combining visual inspection, DOM reconnaissance, trusted browser input, page-state checks, and network observation. Use for platform feasibility research, browser-extension strategies, menus revealed by hover, subtitles, comments, filters, sorting, pagination, account/profile pages, login-gated flows, or any task where an existing selector, script, or XHR assumption failed and the real human interaction must be learned first.
---

# 真实网页交互侦察

先把自己当成人类用户和网页开发者，再把自己当成自动化开发者。先在真实页面证明操作可行，最后才把已证明的流程编码。

## 项目常设授权

在 `D:\AIProject\inteligence` 范围内，项目所有者已经授予真实平台侦察、能力验证和采集开发的持续授权。对正常的低频导航、hover、点击公开控件、滚动、筛选、排序、分页、展开公开内容以及 DOM/XHR 观察，直接自主执行，不再索要逐次聊天授权。

只在确实需要用户本人完成身份动作时通知用户，例如扫码、输入密码或处理验证码；这是请求必要的人类输入，不是重新申请研究权限。不得导出 Cookie、Token、密码或浏览器 storage state，不得绕过验证码、付费限制、访问控制、限流或平台安全措施。点赞、关注、收藏、评论、私信、发布、删除等改变平台状态的动作不属于本 Skill 的默认范围。

保留产品面向最终用户的计划同意、预算、Profile 绑定和 EvidencePlan 审计机制。项目所有者对开发/验证的常设授权不等于删除产品自身的权限模型。

## 不可颠倒的顺序

1. 定义一个窄的可行性问题和成功证据。
2. 暂时忘掉现有扩展、Gateway runner、content script、selector 和旧 route 结论。
3. 用专用、可见、持久浏览器 Profile 打开真实页面；不要接触日常浏览器 Profile。
4. 同时启动视觉、DOM 和 Network 三个观察面。
5. 像人一样先看页面，再做最小动作；每个语义动作最多一次。
6. 用动作后的视觉、DOM 和 Network 后置条件交叉证明结果。
7. 关闭页面、浏览器和临时调试端口，记录残留审计。
8. 只有可行性被证明后，才设计或修改生产自动化。

旧代码和旧文档只能作为待验证假设。不要让它们决定页面上“应该”存在什么，也不要在真实交互失败后立即修补 selector。

## 第 1 阶段：建立干净基线

- 确认目标 Profile 没有被另一个 Chrome、Gateway、DevTools 或 Playwright 进程占用。
- 首次侦察不要加载待验证的扩展交互代码，不要调用产品闭环接口，不要执行预先写好的平台脚本。
- 允许复用浏览器正常持久化的登录状态，但不要读取认证材料。
- 在导航前开始 Network 观察；记录导航次数，平台导航不得因失败自动重发。
- 导航后先截图，记录标题、规范页面身份、登录/验证码/异常访问等公开可见信号。
- 先处理“人眼为什么没看到控件”：滚动位置、播放器控制栏自动隐藏、hover 菜单、遮罩、窗口大小、缩放和懒加载。

## 第 2 阶段：并行三面侦察

### 视觉

- 使用可见浏览器和真实截图理解布局、控件层级、当前选中态和操作顺序。
- 先移动鼠标或滚动到人类会到达的位置，再重新截图。
- 不要直接把截图像素当作 CSS 坐标。核对 `innerWidth`、`innerHeight`、`devicePixelRatio` 和页面滚动位置。

### DOM

- 从视觉上识别语义目标后，再查询可见文本、ARIA、role、稳定属性、父节点状态和实时 `getBoundingClientRect()`。
- 优先使用稳定语义属性，例如 `aria-label`、`data-*`、role 和父项 active/selected 状态；类名只能作为多项证据之一。
- 区分最小文本节点与真正接收交互、持有 active 状态的父节点。
- 每次页面显著变化后重新读取 DOM 和边界框；不要复用旧坐标或旧 element handle。

### Network

- 在页面导航前开始监听 Fetch/XHR/媒体/文本轨道响应，并按时间阶段区分基线与动作后新增请求。
- 先记录 method、去 query/hash 的 route、status、MIME、大小和触发阶段。
- 只有在目标数据公开可见、任务确实需要且项目边界允许时读取 response body；正文证据与认证材料严格分离。
- 不因时间接近就把请求归因于动作。至少同时要求 route 语义合理和页面出现对应状态变化。

## 第 3 阶段：执行真实浏览器输入

使用 Playwright mouse、Chrome DevTools Protocol Input 或等价的浏览器级输入。不要把以下内容当作真实交互证明：

```text
HTMLElement.click()
dispatchEvent(new MouseEvent(...))
content script synthetic pointer events
直接修改 class / style / application state
```

按以下顺序执行每个语义动作：

1. 读取目标的实时边界框和遮挡/可见性。
2. 记录动作前状态，确认目标尚未满足预期状态。
3. 用浏览器级鼠标移动到实时中心；需要 hover 的菜单先只 hover。
4. 检查菜单、浮层或目标项已经真实可见。
5. 重新读取最终目标的实时边界框。
6. 只执行一次点击、滚动、筛选或展开动作。
7. 把结果未知也记为 `attempted=true`，不得为了确认而再执行一次。

不要在正式实现中写死侦察时坐标。坐标只用于证明浏览器输入可行；生产流程必须从当时 DOM、可见页面或经审查的视觉定位得到位置。

## 第 4 阶段：证明，而不是猜测

对会触发网络请求的 UI 操作，默认要求三类证据全部成立：

- 视觉：截图显示菜单、选中态、内容面板或其他人类可见结果；
- DOM：目标父节点 active/selected、面板可见且有内容，或其他明确后置条件；
- Network：出现语义匹配的新响应，并能用公开字段或内容与页面结果对应。

若操作本来不会触发网络请求，至少使用视觉与 DOM 两类独立证据。不要用“请求出现了”替代页面成功，也不要用“页面文字出现了”推断完整响应已经取得。

使用 [证据契约](references/evidence-contract.md) 记录 run、动作账本、观察时间线、失败语义和结论。处理 B站字幕、hover 菜单、媒体轨道或类似案例时，读取 [B站字幕实证](references/bilibili-subtitle-case.md)。

## 第 5 阶段：风险停止与清理

- 遇到验证码、异常访问、风控、限流或登录失效，停止新的平台动作并通知用户完成必要身份处理；不要刷新、换代理或绕过。
- 遇到断网、导航失败、弱网或动作结果未知，结束当前动作链；不要自动重放平台动作。
- 只允许本地状态读取、证据序列化和幂等 loopback 提交有界重试。
- 结束后关闭临时页面、浏览器、CDP 端口和 Gateway，核对目标 Profile 进程与监听端口为零。
- 保留必要的去敏证据；不要把 Profile、截图、原始运行材料或认证信息提交进 Git。

## 从实证迁移到产品代码

把生产职责按能力拆开：

```text
浏览器控制层
  -> 真实导航、mouse move、hover、click、scroll

MV3 Extension
  -> 精确 tab/document/run 绑定、DOM/response 观察、投影和提交

Gateway
  -> Profile 生命周期、动作账本、预算、风险状态和证据持久化
```

当前项目不申请扩展 `debugger` 权限，因此优先让 Gateway 管理的 Playwright 浏览器控制层执行可信输入。不要为了保留错误的 content-script 执行边界而继续堆叠 synthetic event 技巧。

实现后先通过纯逻辑和构建门禁，再直接运行真实网站闭环。禁止用平台 HTML fixture、伪 XHR、fake Gateway 或离线 E2E 冒充真实能力。

## 完成标准

只有同时满足以下条件才结束侦察：

- 已证明或如实否定最初的可行性问题；
- 每个语义动作的尝试次数和结果明确；
- 视觉、DOM、Network 证据能够区分事实与推断；
- 登录、验证码、弱网、页面漂移和空结果具有明确语义；
- 已指出生产实现应使用 DOM、可信浏览器输入、response 投影或混合方案；
- 没有遗留浏览器、Gateway、调试端口或未说明的平台动作；
- 没有把人工可行性成功误报为产品闭环已经通过。
