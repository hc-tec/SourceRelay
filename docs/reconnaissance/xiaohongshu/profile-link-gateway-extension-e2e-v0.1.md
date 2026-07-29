# 小红书短时公开主页链接 Gateway→Extension 真实闭环 v0.1

## 结论

有界主页目录采集 **proved**；主页 Network/XHR 正文投影 **inconclusive**。

2026-07-29 使用一条全新的、由调用方提供的短时公开主页链接，在 `xiaohongshu_validation` 隔离验证浏览器中完成了真实 Gateway→正式 MV3 Extension→去敏 artifact 闭环。Gateway 复用同一个已保留的小红书页面，在同一 tab 内只导航一次到主页，随后执行两次可信滚动，得到 6 条公开笔记卡片并以 `profile_notes_ready` 完成。

本轮没有捕获到可与页面结果对应的公开 Network/XHR payload：`networkMatchedPayloadCount=0`、`networkBodyBytesRead=0`。因此 6 条笔记的事实来源是 Network-first DOM fallback，而不是已证明的主页 Network 投影。该能力可以作为“短时链接 → 有界公开笔记目录”使用，但不能把本 run 当作主页 Network/XHR route admission 证据。

## Run 摘要

```yaml
runId: 25326ef9-3d5e-415d-956e-141e2a31ad24
operationId: a8c360c8-e58a-4ef0-8614-5e3da49d626f
artifactId: 4d03b3a7-233c-4bc2-94e5-a145e9842e51
objective: 证明短时公开主页链接能否在单次导航和有界可信滚动内交付公开笔记目录
platform: xiaohongshu
targetRole: account
targetIdentity: caller-supplied ephemeral public profile link
browserMode: visible persistent validation profile
browserLifecycle: managed_profile_session
authenticated: indeterminate
extensionInteractionLoaded: true
existingPlatformRunnerUsed: false
validationBaselineNavigations: 1
productPlatformNavigations: 1
semanticActionCount: 2
completedScrolls: 2
automaticPlatformRetries: 0
operationState: completed
terminalReason: profile_notes_ready
validationOutcome: completed
finalPageState: retained_for_review
```

短时主页链接、签名、响应 URL、响应正文和原始认证材料没有写入本文件、artifact、operation summary 或长期档案。

## 证据时间线

1. Gateway 在独立 loopback 进程启动；没有使用 fake Gateway 或平台 fixture。
2. Browser Host 精确收养上一轮唯一的 `retained_for_review` 小红书页面，没有创建第二个页面。
3. 验证基线只导航一次官方 Explore 页面，随后记录基线视觉证据 `b7cf876c-aaab-49c8-87e2-6c0c8e7fc598`。
4. 正式扩展完成 loopback 配对；控制页随后销毁，未遗留扩展页。
5. Gateway 以 `executionTarget=ephemeral_public_profile_url` 派发一次短链 work，目标仍是同一个页面。
6. 扩展在同一页面中完成一次主页导航和两次可信滚动；没有刷新、没有打开新 tab、没有重试导航。
7. Gateway 收到 `completed / profile_notes_ready`，artifact 包含 6 条公开笔记卡片。
8. 最终页面保留供复核；视觉证据 `4595c609-d861-47fc-b1e4-655c8f950668` 显示主页笔记卡片已渲染，滚动位置为 `scrollY=620`。

## 三面证据

### 视觉

- 基线：`b7cf876c-aaab-49c8-87e2-6c0c8e7fc598.png`，Explore 页面可见；窗口 CSS 尺寸 `1280×720`，DPR 约 `1`。
- 结果：`4595c609-d861-47fc-b1e4-655c8f950668.png`，公开主页的笔记列表可见，页面已滚动；没有详情浮层、评论面板或新 tab。

### DOM / artifact

```yaml
publicSurface: public_profile
itemCount: 6
semanticActionCount: 2
completedScrolls: 2
navigationAttempted: true
navigationAttemptCount: 1
rawPayloadStored: false
responseUrlsStored: false
debuggerDetached: true
```

结果只保留受限公开笔记卡片投影。`itemCount=6` 表示本轮滚动预算内的公开结果，不表示该账号历史笔记全量。

### Network

```yaml
networkMatchedPayloadCount: 0
networkBodyBytesRead: 0
networkPostcondition: no_confirmed_profile_note_payload
```

没有因“看起来像主页请求”而把后台刷新、遥测或其他响应归因到滚动动作；本轮不读取或保存任何响应正文。

## 动作账本

```yaml
navigation:
  attempted: true
  attemptCount: 1
  outcome: completed
scroll:
  requestedCount: 20
  completedCount: 2
  automaticRetries: 0
  outcome: completed
```

主页链接入口的固定预算仍是一次导航、最多 20 次可信滚动和最多 200 条投影；本次因连续两次滚动没有新增结果而提前以 `profile_notes_ready` 结束。没有执行刷新、换 tab、重复导航或任何改变平台状态的动作。

## 生命周期与清理

- Gateway 临时进程和 loopback 状态目录已退出/清理；
- 扩展控制页：0；
- 浏览器 Host：`ready`，运行时 marker 与构建指纹匹配，未 reload；
- 目标主页页：按产品策略有意保留为 `retained_for_review`，供后续只读复核；
- 没有触碰用户日常浏览器，也没有导出 Cookie、Token、密码或 storage state。

## 产品登记影响

`xiaohongshu.account.public_notes.v1` 的短时链接执行目标现在可以登记为：

```yaml
dispatchState: direct_ready
managedValidationState: gateway_extension_real_e2e_passed
```

这只表示短时链接路径的 Gateway→Extension 闭环已经有真实证据。浏览器中自然存在的 `existing_public_profile_tab` 零导航路径仍需要独立 canary；主页 Network/XHR 正文投影也仍需另一条新的短时链接单独研究，不能用本 run 的 DOM fallback 结果替代。
