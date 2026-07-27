# B站视频评论用户已选页面 direct canary v0.1

- 日期：2026-07-27
- 结论：**通过**；`bilibili.discussion` 从 `direct_canary_pending` 升级为 `direct_ready`。
- 证据类型：真实 production MV3、真实 loopback Gateway、真实 Testbench、真实 B站公开页面的产品闭环；不是 fixture、fake XHR、fake Gateway 或页面克隆。
- 范围：只验证用户已加载评论页的单次被动根评论 DOM 投影。不验证自动滚动、最新排序、展开回复、回复分页、评论全量、response body 或任意 tab 控制。

## Run 摘要

```yaml
runId: validation-bilibili-discussion-user-selected-e2e-20260727
platform: bilibili
targetRole: video_discussion
targetIdentity: public-bvid-redacted
browserMode: visible persistent isolated validation Chromium
browserLifecycle: managed_profile_session
authenticated: true
extensionInteractionLoaded: true
gatewayMode: user_owned_browser_extension
browserProcessControl: not_available
outcome: proved
```

验证浏览器由 Browser Host 的受认证本地 IPC 持有 Playwright context。为避免把测试变成人工操作，验证流程只使用一个 validation-only、类型化的扩展 control 命令：它仅能在后台创建本扩展固定的 `control.html` target，填写固定配对字段、提交、选择当前评论页，然后关闭该 target；没有任意 URL、selector、脚本、CDP、tab/document ID 或 Network body 接口。该验证设施不属于用户日常浏览器产品 API。

## 动作账本与后置条件

| actionId | 层 | attempted / count | 后置条件 |
| --- | --- | --- | --- |
| `validation-discussion-navigate-once` | 隔离验证 Browser Host | `true / 1` | 目标视频 document 稳定；未出现验证码、异常访问或登录阻断 |
| `validation-discussion-scroll-once` | 隔离验证 Browser Host | `true / 1` | `scrollY: 0 → 760`；评论区域进入可见加载路径 |
| `run_validation_extension_control` | validation-only 后台扩展 control target | `true / 1` | loopback 配对在线；当前已加载评论页建立 120 秒、单次 document lease；control target 已关闭 |
| `submit_bilibili_discussion` | 真正的 Testbench API | `true / 1` | Gateway 签发一项已签名 `user_selected_tab` work；没有第二次提交 |
| `bilibili.discussion` 投影 | 已配对 MV3 扩展 | `true / 1` | `completed / discussion_ready`；同一 document 的根评论被动 DOM 投影完成 |

本轮实际结果：

- Browser Host 准备阶段只有 1 次平台导航、1 次可信下滚；页面随后以 `retained_for_review` 保留，视觉证据只落在 Git ignored 的本地 runtime。
- 正式 `bilibili.discussion` work：`executionTarget=user_selected_tab`、`captureMode=passive_dom_projection`、`userSelectedTabDisposition=observed`。
- 终态 operation：`completed / discussion_ready / errorCode=null`。
- artifact：20 条根评论；`platformNavigations=0`、`semanticActions=0`、`responseBodies=not_read`、`navigation.attempted=false`、`navigation.attemptCount=0`。
- artifact 递归检查未发现 `tabId`、`windowId`、`documentId` 或 `profileId`。

没有自动重放导航、滚动、配对、选择或任务提交。若页面身份、document、风险状态、网络结果或 loopback 回执不确定，流程会停止当前 run；不会以新的 action ID 重试平台输入。

## 产品结论与边界

`bilibili.discussion` 现在可被日常浏览器 direct API 调度，但它不是“让系统替用户爬评论”的任意控制入口：

```text
最终用户自己打开公开视频并将评论区滚到可见
  → 最终用户在扩展 popup 明确选择当前页
  → 上层应用只提交 BVID + browserBindingId
  → Gateway 签发一次 user_selected_tab work
  → 扩展仅对相同 tab/document 做一次有界根评论 DOM 投影
```

- Gateway、上层 API 和 artifact 不接收或保留 tab/window/document/profile 标识符。
- 扩展不会导航、聚焦标签页、滚动、刷新、排序、展开回复、翻页或读取 response body。
- 当前上限是已渲染的最多 20 条根评论；空结果、评论仍在加载、document 改变、用户接管、验证码/风控/限流或登录失效都会诚实停止。
- 验证脚本中的一次可信滚动仅用于隔离测试浏览器准备真实页面，不是生产 `bilibili.discussion` work 的授权或行为。

## 数据、安全与清理

- 本文不保存标题、评论正文、昵称、头像、截图、配对会话、配对码、Local API token、Cookie、Storage、原始网络数据或 browser 标识符。
- Gateway 仍保持 `user_owned_browser_extension`：生产服务不创建、附着、关闭或枚举用户日常浏览器 Profile。
- Testbench 只使用已持有的 scoped local API token；浏览器页面从未取得该 token。
- 隔离验证浏览器保持显式、持久生命周期；本 run 结束后的评论页面有意保留，关闭条件由后续明确的测试 Profile 生命周期决定。
