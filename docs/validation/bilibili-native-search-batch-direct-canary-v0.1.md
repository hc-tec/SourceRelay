# B站固定两页站内搜索 direct canary v0.1

- 日期：2026-07-27
- 结论：**通过**；`bilibili.native_search_batch` 可从 `direct_canary_pending` 升级为 `direct_ready`。
- 证据类型：真实产品闭环，不是 fixture、fake XHR、fake Gateway 或离线页面测试。
- 范围：只验证“输入一个关键词，Gateway 固定派生综合/相关性第 1、2 页，扩展以自己的 work tab 连续导航并回传受控 DOM 投影”。不验证任意分页、排序、筛选、滚动、评论、字幕或账号投稿分页。

## Run 摘要

```yaml
runId: bilibili-direct-native-search-batch-20260727
platform: bilibili
targetRole: search
targetIdentity: native-search-query-redacted
browserMode: visible temporary persistent Chromium profile
browserLifecycle: temporary_recon
authenticated: false
extensionInteractionLoaded: true
existingPlatformRunnerUsed: false
gatewayMode: user_owned_browser_extension
browserProcessControl: not_available
navigationCount: 2
outcome: proved
```

临时浏览器自动加载刚编译的 production MV3；它与一个临时、direct-only Gateway 配对，再由真正的 loopback-only Testbench UI 创建最小权限本地 client 并提交一次任务。没有启动、附着、关闭或读取用户日常浏览器，也没有使用 Browser Host、`profileId` 或旧 `/v1/collect` 路径。

## 动作账本与后置条件

| actionId | 层 | attempted / count | 后置条件 |
| --- | --- | --- | --- |
| `submit_bilibili_native_search_batch` | Testbench 本地 UI | `true / 1` | Gateway 创建一个签名 work item；没有第二次提交 |
| `open_fixed_native_search_page_1` | 扩展自有 work tab | `true / 1` | 第 1 页受控 DOM 投影完成 |
| `open_fixed_native_search_page_2` | 扩展自有 work tab | `true / 1` | 第 2 页受控 DOM 投影完成；分页按钮 active |

- Gateway terminal operation：`completed / search_batch_ready / errorCode=null`。
- artifact：`observedPages=[1,2]`、两个 action 都是 `attemptCount=1 / outcome=completed`、`platformNavigations=2`、`semanticActions=0`、`responseBodies=not_read`、`itemCount=24`。
- 视觉：第 2 页搜索结果网格可见；匿名页面出现一个平台的可选登录推广浮层，但未要求输入认证信息，也不是验证码、风控或访问限制。
- DOM：第 2 页按钮可见且为 active；至少一个规范 BV 视频链接可见。
- Network：任务后观察到 `GET https://search.bilibili.com/all`，`200`，`text/html`。只记录去 query/hash 的 route、状态和 MIME；没有读取 request/response body。此前的人类分页侦察中观察到的 API route 不被当作本次 direct URL 导航的因果证据。

没有 click、hover、scroll、刷新、排序切换、response body 读取或平台动作重放。第 1 页与第 2 页之间的 1200ms 冷却是固定等待；如果风险、用户接管、页面身份漂移、导航未知或 deadline 到期，执行器会停在已完成页面，不会尝试下一页。

## 数据、安全与清理

- Testbench 调用方只提供 `query`；它不能提供 URL、页码、排序、selector、脚本、tab、鼠标或 Network 控制参数。
- 终态 operation 与 artifact 只保留查询 digest；本文不保存查询词、完整搜索 URL、截图、账号标识、Cookie、token、Storage、原始网络数据或结果文本。
- 临时 Gateway state、Local API token、Testbench 进程、浏览器 context 和 Profile 均在 run 结束后关闭并删除；用于人工视觉核对的临时截图已在核对后删除且不进入 Git。

## 产品结论

`bilibili.native_search_batch` 现在是日常浏览器 direct API 可调度的固定两页能力：每页最多 12 张规范 BV 卡的公开 DOM 投影，最多两次已签名导航，零语义页面动作，零 Network 正文。它不把 `bilibili.account_inventory.pagination` 一并升级；后者在当前匿名页面仍为内容空白的 inconclusive 状态，继续保持 `direct_migration_required`。
