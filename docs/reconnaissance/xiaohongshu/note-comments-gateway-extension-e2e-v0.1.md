# 小红书公开评论 Gateway→扩展真实 E2E

日期：2026-07-28

结论：`xiaohongshu.note.public_comments.v1` 已通过真实 Gateway、签名队列、生产扩展、真实小红书详情浮层和 artifact 回读闭环，可以登记为 `direct_ready`。

## 环境与边界

- 真实网站、可见持久 Validation Profile，登录状态由浏览器自身持有。
- 生产扩展 `v0.7.17`，control surface revision `16`。
- 能力只使用唯一、已经打开的公开详情浮层。
- 上层输入只有 `maximumScrolls: 1 | 2 | 3`；没有 URL、note ID、tab/document ID、selector、坐标、脚本、route 或 cursor。
- 没有刷新、新标签页、自动平台重试或账号状态变更。

## 通过的正式闭环

```text
User Browser Collector Service API
→ Gateway signed work queue
→ installed production extension
→ existing public note overlay
→ Network-first public projection
→ semantic DOM fallback when no JSON exists
→ de-sensitised artifact
→ artifact API read
```

```yaml
runId: 37d3094a-c020-47a8-8afa-b9095b4a2d00
operationId: 2c54c0a4-551e-41af-9a25-284cd8af3b61
artifactId: c6e89034-adfb-4c60-927d-ba268f604a3f
state: completed
terminalReason: note_comments_ready
productPlatformNavigations: 0
validationBaselineNavigations: 0
semanticActions: 0
automaticPlatformRetries: 0
captureMode: dom_fallback
commentCount: 3
networkMatchedPayloadCount: 0
networkBodyBytesRead: 0
networkCursorObserved: false
rawPayloadStored: false
responseUrlsStored: false
debuggerDetached: true
finalPageState: existing_overlay_retained
```

## Network 结论

本次复用已经显示评论的公开详情浮层。扩展在有界等待和读取窗口内没有观察到可消费的评论 JSON：`matchedPayloadCount=0`、`bodyBytesRead=0`。因此该 run 使用 DOM fallback 是真实页面数据来源决定的结果，不能虚报为 Network 命中。

生产实现仍然保持 Network 优先：搜索前安装 MAIN-world observer，并在同一 document 内短时保留去敏评论投影；详情点击前绑定内部选中笔记身份；评论能力先消费该笔记的历史与增量 Network projection。只有没有匹配 JSON 时才读取公开 DOM。短时 archive 最长三分钟，不保存原始响应、响应 URL、认证材料，也不向上层暴露内部笔记身份。

## DOM 与动作事实

只读视觉证据显示详情浮层公开呈现“共 6 条评论”、公开主评论和“展开 3 条回复”。正式 comments-only run 开始时评论已经渲染，因此零滚动完成是最小动作策略的正确结果，而不是漏执行：`semanticAction.attempted=false`、`attemptCount=0`、`completedScrolls=0`。

若评论未渲染，能力最多执行调用方批准的 1–3 次可信 wheel；每次后等待并重新检查，评论出现立即早停。Worker 中断后动作账本阻止已发滚动被重放。

## 产品状态

```yaml
dispatchState: direct_ready
managedValidationState: gateway_extension_real_e2e_passed
captureMode: network_first_dom_fallback_trusted_scroll
```

评论回复的主动“展开 N 条回复”仍是另一项语义动作，必须单独侦察、单独预算和单独登记，不能偷偷混入本能力。
