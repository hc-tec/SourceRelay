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

后续完整连续 run `cfb443e1-a157-4005-94b5-810dbb1fc69e` 进一步证明这条 Network continuity 会真实命中，而不是只存在于代码设计：

```yaml
operationId: ded87553-3316-4426-8efd-31682b1da018
state: completed
captureMode: hybrid
commentCount: 6
networkMatchedPayloadCount: 1
networkBodyBytesRead: 2368
networkCursorObserved: true
semanticActions: 0
rawPayloadStored: false
responseUrlsStored: false
```

该评论 JSON 在较早的搜索/详情观察阶段进入同一 document 的短时去敏 archive，评论 operation 根据内部选中笔记身份消费，并与公开 DOM 合并。结果没有暴露内部 note identity、route 或响应 URL。

## 2026-07-29：当前构建的 Network-first 回归

在修正评论懒加载判断、主页签名保留和验证命令参数透传后，使用当前生产构建重新执行了一次真实 Gateway→Extension 闭环。该 run 仍然没有使用 fake 页面、fake XHR 或旧 Browser Host fallback：

```yaml
runId: 3e57c393-4f1c-4fb3-b2ba-47ad4dc16d33
operationId: 98e32f10-ed3b-4d1d-b32d-ffff40022a86
artifactId: dba781d7-5f56-4a4c-b120-18caba98a077
state: completed
terminalReason: note_comments_ready
productPlatformNavigations: 0
validationBaselineNavigations: 1
semanticActions: 0
automaticPlatformRetries: 0
captureMode: network_projection
commentCount: 12
networkMatchedPayloadCount: 1
networkBodyBytesRead: 8191
networkCursorObserved: true
rawPayloadStored: false
responseUrlsStored: false
debuggerDetached: true
finalPageState: retained_for_review
```

这条回归证据证明：当同一详情 document 的短时 Network archive 已经包含可关联的公开评论时，生产评论能力不会为了“看起来像加载”而额外滚动；它直接返回 Network projection。只有 Network 不足且 DOM 仍可能懒加载更多评论时，才会进入声明的 1–3 次可信滚动预算。

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
