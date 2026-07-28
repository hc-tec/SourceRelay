# 小红书宿主浏览器扩展可信搜索 Canary v0.1

## 结论

`proved`。2026-07-28，在独立、可见、持久的 `xiaohongshu_validation` 验证浏览器中，正式 MV3 worker 使用受限 `chrome.debugger` 输入通道，在一个已经存在的公开 Explore tab 内完成了一次站内搜索，并取得 DOM、视觉和当前文档 Network 投影三面证据。

这证明的是扩展侧可信输入运行时；上层 Collector Service API 与 Gateway enqueue/artifact 路径尚未接通，因此能力目录状态为 `direct_gateway_dispatch_pending`，不能标记为 `direct_ready`。

## Run 摘要

```yaml
runId: faeb2878-6e64-4308-88b3-71612df1493d
objective: 证明正式 MV3 worker 能否在既有公开 Explore tab 中执行一次固定搜索并返回公开笔记投影
platform: xiaohongshu
targetRole: search
targetIdentity: public Explore -> same-tab public search
browserMode: visible persistent validation profile
browserLifecycle: managed_profile_session
authenticated: true
extensionInteractionLoaded: true
existingPlatformRunnerUsed: false
validationBaselineNavigationCount: 1
productNavigationCount: 0
semanticActionCount: 1
automaticRetries: 0
outcome: proved
```

验证脚本为 `poc/collector-browser-host/scripts/validate-xiaohongshu-extension-trusted-input.mjs`。它的一次官方 Explore 导航只用于建立独立 canary 基线，不属于最终用户浏览器能力；正式扩展动作既不创建 tab，也不导航或刷新 URL。

## 动作与后置条件

动作前，视觉证据显示公开 Explore 页面和顶部搜索控件。扩展内部从唯一合格 Explore 文档中发现已经实证过的 `#search-input-in-feeds / #search-input / input / textarea` 搜索控件；调用方不能提交 URL、tab ID、selector、坐标、脚本或 CDP 命令。

固定输入链如下：

1. 持久账本先写入 `semantic_action_intent_recorded`；
2. `chrome.debugger.attach` 仅附着内部 PageLease 对应 tab；
3. 仅发送固定 `Input.dispatchMouseEvent`、`Input.dispatchKeyEvent` 与 `Input.insertText`；
4. 输入“咖啡豆”，核对 query echo 后只按一次 Enter；
5. 取得可见搜索页、22 张卡片和当前文档公开响应投影；
6. 所有终态执行 `chrome.debugger.detach`，最终结果为 `debuggerDetached=true`。

视觉后置条件显示同一个 tab 内的公开笔记搜索页、搜索词“咖啡豆”和已渲染卡片。Playwright journal 在搜索动作后产生两个 `framenavigated` 通知；这类通知也包含 same-document history/SPA route 变化。扩展的精确 document observer 在动作前后保持有效并成功读出投影，因此没有把 journal 的 route 通知误报成扩展发起的新文档导航。

## Network 与公开投影

```yaml
matchedPayloadCount: 1
temporaryBodyBytesRead: 43643
projectedPublicItems: 17
rawPayloadStored: false
responseUrlsStored: false
```

公开投影示例包括标题、公开作者昵称和公开点赞文本，例如“世界八大好喝咖啡豆，你喝过哪几杯？”、“新手就选这几款咖啡豆，看完不出错！”。没有保存 response URL、query string、header、Cookie、Token 或原始 JSON。

## 失败审计

正式成功 run 前有三个前置条件失败，均未自动重试：

- 首次 validation bridge 错误被 Host 过度归一化为 `browser_host_internal_error`；只读扩展账本随后证明 `entryCount=0 / latestPhase=none`，没有发送输入。
- 第二次在 Native Bridge 派发前以 `native_bridge_command_timeout_invalid` 停止，没有发送输入。
- 第三次以 `xiaohongshu_trusted_input_search_target_unavailable` 停止；根因是第一版扩展发现器只检查 `input`，没有复用已实证的 `textarea` 与稳定 ID。动作意图尚未写入，未发送鼠标、文本或 Enter。

修复后才开始新的独立成功 run。整个过程中没有对结果未知的语义动作进行重放。

## 生命周期与残留

- 成功页状态：`retained_for_review`；
- 所有者：`xiaohongshu_validation` 受管验证浏览器；
- 保留目的：人工复核最终视觉、DOM 与公开投影；
- 关闭条件：下一次显式停止/重建验证浏览器或项目所有者要求关闭；
- 没有 extension page 累积，没有打开 `chrome://extensions`，没有触碰用户日常浏览器。

