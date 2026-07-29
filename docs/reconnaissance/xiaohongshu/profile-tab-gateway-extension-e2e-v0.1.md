# 小红书已有公开主页 tab Gateway→Extension 真实闭环 v0.1

## 结论

`existing_public_profile_tab` 零导航目录采集 **proved**；主页 Network/XHR 正文投影 **inconclusive**。

2026-07-29，在 `xiaohongshu_validation` 隔离验证浏览器中，Gateway 收养浏览器已经保留的唯一小红书页面，没有提交任何平台导航，然后通过正式 MV3 Extension 执行 `xiaohongshu.account.public_notes.v1`。扩展确认当前文档是公开主页，首屏 DOM 已有 6 条公开笔记卡片，因此在零滚动、零刷新、零新 tab 的情况下完成 `profile_notes_ready`。

本轮没有捕获可与主页笔记结果对应的 Network/XHR 正文：`networkMatchedPayloadCount=0`、`networkBodyBytesRead=0`。因此本轮证明的是“自然存在的公开主页 tab → 有界公开笔记目录”能力，事实来源是 Network-first DOM fallback；不能把它解释成主页 Network/XHR route admission 已通过。

## Run 摘要

```yaml
runId: 4de777ab-a250-4da4-9a9e-93898020466a
operationId: 1767804f-0c83-4840-9ba9-4f3c3c1e2fc1
artifactId: 09048b23-79c9-47b2-bf27-76ce4e95c7e6
objective: 证明已有公开主页 tab 能否在零导航条件下交付公开笔记目录
platform: xiaohongshu
targetRole: account
targetIdentity: retained public profile tab
browserMode: visible persistent validation profile
browserLifecycle: managed_profile_session
authenticated: indeterminate
extensionInteractionLoaded: true
existingPlatformRunnerUsed: false
validationBaselineNavigations: 0
productPlatformNavigations: 0
semanticActionCount: 0
completedScrolls: 0
automaticPlatformRetries: 0
operationState: completed
terminalReason: profile_notes_ready
validationOutcome: completed
finalPageState: retained_for_review
```

本轮没有向验证器或 artifact 写入主页 URL、签名、响应 URL、响应正文或认证材料。

## 证据时间线

1. 临时 loopback Gateway 启动；没有使用 fake Gateway、平台 fixture 或伪造 XHR。
2. Browser Host 收养唯一的 `retained_for_review` 小红书页面；收养动作不导航、不刷新。
3. 基线视觉证据为 `0aa0101b-15ee-43d6-8131-d3e8fd256656`，页面可见公开主页笔记卡片。
4. 正式 MV3 Extension 完成配对；控制页销毁，未遗留扩展页。
5. Gateway 以 `executionTarget=existing_public_profile_tab` 派发一次 work，输入只有 `maximumScrolls=3`，没有 caller URL。
6. Extension 在当前 document 中确认公开主页并读取 6 条首屏笔记；因为已有投影满足后置条件，没有发送滚动输入。
7. Gateway 返回 `completed / profile_notes_ready`，artifact 验证通过。
8. 最终视觉证据为 `bd806ec9-1703-4d0c-8db8-0bfd5251ee6d`，页面仍保留供复核。

## 三面证据

### 视觉

- 基线截图：[0aa0101b-15ee-43d6-8131-d3e8fd256656.png](../../../poc/runtime/xiaohongshu-validation/host/state/visual-evidence/0aa0101b-15ee-43d6-8131-d3e8fd256656.png)；公开主页笔记卡片可见。
- 结果截图：[bd806ec9-1703-4d0c-8db8-0bfd5251ee6d.png](../../../poc/runtime/xiaohongshu-validation/host/state/visual-evidence/bd806ec9-1703-4d0c-8db8-0bfd5251ee6d.png)；页面没有打开详情、评论或新页面。

### DOM / artifact

```yaml
publicSurface: public_profile
itemCount: 6
semanticActionCount: 0
completedScrolls: 0
navigationAttempted: false
navigationAttemptCount: 0
rawPayloadStored: false
responseUrlsStored: false
debuggerDetached: true
```

零滚动不是“已取得账号历史全量”；它只表示当前公开主页 document 在本次固定预算内已经有 6 条可投影卡片，能力在首屏后置条件满足时按安全策略自然停止。

### Network

```yaml
networkMatchedPayloadCount: 0
networkBodyBytesRead: 0
networkPostcondition: no_confirmed_profile_note_payload
```

没有把后台刷新、遥测、媒体或其他时间接近的请求归因于主页笔记投影，也没有读取或保存响应正文。

## 动作账本

```yaml
navigation:
  attempted: false
  attemptCount: 0
scroll:
  requestedCount: 3
  completedCount: 0
  automaticRetries: 0
```

这条路径的生产边界仍然是：调用方不提交 URL、不提交 selector、不提交 tab ID；扩展只在浏览器中自然存在且唯一的公开主页 document 上工作。若页面不存在、页面不是公开主页或候选 tab 不唯一，必须停止并返回语义化错误，不能自动导航或换页。

## 生命周期与清理

- 临时 Gateway 与 loopback 状态目录已退出/清理；
- 浏览器 Host 保持 `ready`，同一 Chromium 进程继续复用；
- 扩展页：0；
- 目标页面按策略有意保留为 `retained_for_review`；
- 没有刷新、关闭页面、创建新 tab 或触碰用户日常浏览器。

## 产品登记影响

短时主页链接路径和已有公开主页 tab 路径现在都具备独立的真实 Gateway→Extension 闭环证据，`xiaohongshu.account.public_notes.v1` 保持：

```yaml
dispatchState: direct_ready
managedValidationState: gateway_extension_real_e2e_passed
```

两条路径的共同未决项是主页 Network/XHR 正文投影：当前两个真实 canary 都由 DOM fallback 完成，后续必须用新的短时主页链接做单独 Network-focused run，不能重放已经消费过的链接，也不能把 DOM 结果冒充 Network 证据。
