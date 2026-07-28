# 小红书公开笔记详情 Gateway → Extension 真实 E2E v0.1

日期：2026-07-28

## 结论

`xiaohongshu.note.public_detail.v1` 已通过真实 Gateway、签名队列、生产扩展、真实小红书搜索页、同页详情浮层和 artifact 回读闭环，可以登记为 `direct_ready`。

## 最终通过的 run

```yaml
runId: c73f6b3e-77b1-4a05-a679-2766c7ac1bf2
operationId: ea6d6633-0f7d-4d7f-83ab-bf453507e24a
artifactId: d71b7696-4a42-490b-aa2d-4ca91a2ac19e
state: completed
terminalReason: note_detail_ready
resultRank: 1
productPlatformNavigations: 0
semanticActions: 1
automaticPlatformRetries: 0
captureMode: dom_fallback
publicTextLength: 559
rawPayloadStored: false
responseUrlsStored: false
debuggerDetached: true
persistedQueryCopies: 0
finalPageState: retained_for_review
```

## 真实链路

```text
临时 loopback Gateway
→ 创建并授权真实浏览器 binding
→ /v2/collect 提交公开搜索
→ 扩展执行一次可信搜索并得到 17 条 Network note_card 投影
→ /v2/collect 提交 resultRank=1 的公开详情
→ 扩展在唯一已有搜索 tab 上定位第一张可见主图
→ 预装 MAIN-world Fetch/XHR observer
→ 持久动作账本记录 click intent
→ chrome.debugger 发送一次可信点击
→ 同 document 详情浮层出现
→ Network-first 结果为空，选择 DOM fallback
→ 559 字公开详情投影进入去敏 artifact
→ 上层应用通过 artifact route 回读
```

验证使用真实网站、真实扩展、真实签名队列和真实 Gateway。没有平台 fixture、fake XHR、fake Gateway 或合成页面。

## Network-first 与 DOM fallback

详情点击前已经安装 MAIN-world Fetch/XHR observer。真实运行中，搜索动作产生公开 `note_card` JSON，而点击详情没有新增可用于详情正文的 XHR/Fetch。因此本次 artifact 如实记录：

```text
captureMode = dom_fallback
```

## 2026-07-29：同文档 Network continuity 回归

为修复一个会抹掉搜索阶段公开投影的生命周期问题，新增了一轮独立真实 Gateway → Extension canary：

```yaml
runId: 98469152-f7d3-4301-bdd8-d6423a6e27ee
operationId: 2ba4fb08-8bac-4e81-85f3-f828aefa2b16
artifactId: ead8fedf-e6a3-4e71-9428-9911bf393509
state: completed
terminalReason: note_detail_ready
productPlatformNavigations: 0
validationBaselineNavigations: 1
semanticActions: 1
automaticPlatformRetries: 0
captureMode: dom_fallback
networkMatchedPayloadCount: 1
networkBodyBytesRead: 51533
rawPayloadStored: false
responseUrlsStored: false
debuggerDetached: true
finalPageState: retained_for_review
```

这轮证明搜索到详情之间的同文档连续性已生效：搜索阶段捕获的公开 Network payload 没有因详情 work 重新注入 observer 而丢失。该 payload 能够被记录为公开 Network 观察，但当前真实响应没有足够的详情正文字段，因此详情正文仍按证据契约使用可见浮层 DOM fallback；没有把搜索卡片数据误报成详情正文，也没有重放点击。

这不是降低 Network 优先级。运行时会先检查受限 Network 详情投影；只有没有公开详情响应时，才读取已经对用户可见的同页详情浮层文本。原始 response、response URL 和任意认证材料均不持久化。

## 质量修复证据

首次真实闭环虽然 operation 完成，但 DOM fallback 只投影 55 字，视觉上正文远多于此。该结果未被接受为 `direct_ready`。

根因是作者 anchor 和正文处于兄弟区域，直接选择“包含作者链接”的嵌套节点会拿到作者头部，而不是完整浮层。修复后从可见作者 anchor 向上寻找符合浮层尺寸的共同祖先，再按规范化公开文本长度选取信息最完整的候选。最终真实 E2E 得到 559 字，并与最终截图中的完整标题、正文、作者和互动区一致。

验证器现要求公开文本至少 120 字；不再允许仅凭“浮层出现”通过详情质量门禁。

## 安全与产品边界

上层调用只能提交：

```json
{
  "schemaVersion": 2,
  "browserBindingId": "UUID",
  "platform": "xiaohongshu",
  "capability": "xiaohongshu.note.public_detail.v1",
  "executionTarget": "existing_public_search_tab",
  "input": { "resultRank": 1 }
}
```

`resultRank` 只能为 `1–20`。调用者不能提供 URL、笔记 ID、tab/document ID、selector、坐标、脚本、CDP 命令或 Network route。

真实 run 中没有产品导航、刷新或新 tab。最终详情页由验证 Browser Host 有意保留用于复核，临时 Gateway 和临时 state directory 均已清理。
