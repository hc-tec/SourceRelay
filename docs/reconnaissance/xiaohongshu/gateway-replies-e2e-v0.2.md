# 小红书搜索、详情、评论、回复当前构建真实闭环 v0.2

## 结论

`proved`。2026-07-28，在专用 `xiaohongshu_validation` 可见持久验证浏览器中，当前生产 MV3 扩展、User Browser Gateway 和 loopback API 完成一条连续的公开内容闭环：

```text
公开 Explore
  → query-only 站内搜索
  → 同文档首个结果详情浮层
  → 浮层公开评论
  → 浮层首个公开回复线程
```

本 run 同时验证四项能力：

```text
xiaohongshu.search.public_notes.v1
xiaohongshu.note.public_detail.v1
xiaohongshu.note.public_comments.v1
xiaohongshu.note.public_comment_replies.v1
```

## Run 摘要

```yaml
runId: 5db386dd-2d85-42ad-82e8-ee9a1ccc1709
platform: xiaohongshu
targetRole: search -> detail -> discussion
browserMode: visible persistent validation profile
browserLifecycle: managed_profile_session
authenticated: true
extensionInteractionLoaded: true
existingPlatformRunnerUsed: false
validationBaselineNavigations: 1
productPlatformNavigations: 0
automaticPlatformRetries: 0
finalPageState: retained_for_review
browserProfileOwner: xiaohongshu_validation
buildFingerprint: 2c803d4fdeedf945ff264b424fe1ecd8e5b5a40c5e1f566b53c412cd0a8e761a
```

验证浏览器在 run 前经过一次显式版本重建，headless probe 先确认 `0.7.17 / control revision 16 / build fingerprint` 一致后才启动唯一可见会话；没有打开 `chrome://extensions`，没有累积扩展页。

## 观察时间线与结果

| 阶段 | 结果 | Network / DOM 证据 | 平台动作 |
| --- | --- | --- | --- |
| Explore 基线 | 页面可见 | 18 条公开笔记卡片投影 | 导航 1 次（验证基线） |
| 公开搜索 | `search_ready` | 18 条规范公开笔记投影，终态只保留 query digest | 可信搜索 1 次 |
| 详情浮层 | `note_detail_ready` | 同一 document 的公开详情浮层，621 字正文；本次 `dom_fallback` | 可信详情点击 1 次 |
| 评论 | `note_comments_ready` | `hybrid`，6 条评论；Network 匹配 payload 1 个，读取 2368 bytes，观察到 cursor | 0 次滚动，短时 Network archive 足够 |
| 回复 | `comment_replies_ready` | `network_projection`，1 条回复；Network 匹配 payload 1 个，读取 2368 bytes，观察到 cursor | 0 次展开点击，预加载 archive 足够 |

详情操作只在原搜索 document 内打开浮层；没有创建新 tab。评论和回复均没有因为结果已在 Network archive 中而重复滚动或点击。

## Gateway / artifact 证据

```yaml
gatewayPath: user_browser_api_to_signed_queue_to_production_extension
replyOperationId: a959b96a-8999-4470-af22-a5c943e8f2a2
replyArtifactId: 308eee28-3575-4528-91bd-1f01239609d8
replyState: completed
replyTerminalReason: comment_replies_ready
replyCount: 1
replyNetworkMatchedPayloadCount: 1
replyNetworkBodyBytesRead: 2368
replyNetworkCursorObserved: true
actionTriggeredResponseCount: 0
rawPayloadStored: false
responseUrlsStored: false
debuggerDetached: true
```

搜索、详情、评论和回复的 operation/artifact 都经过签名 work item、Extension result 校验和 Gateway artifact store；本轮没有把 query、主页/笔记 URL、response URL、原始 response、Cookie、Token、tab ID 或 document ID 写入长期 artifact。

## 动作账本

```yaml
navigation:
  validationBaseline: 1
  product: 0
trustedSearchInput:
  attempted: true
  attemptCount: 1
detailClick:
  attempted: true
  attemptCount: 1
commentScroll:
  attempted: false
  attemptCount: 0
replyExpand:
  attempted: false
  attemptCount: 0
automaticPlatformRetries: 0
```

每个语义动作最多一次；结果未知时没有重放。评论/回复的 `attempted=false` 是因为目标公开数据已由同文档短时 Network archive 提供，不代表动作失败。

## 结论边界

- 四项公开内容能力已在当前构建完成真实 Gateway → Extension → artifact 闭环，可继续作为 direct-ready 能力使用。
- 本 run 只证明一条公开搜索到同文档详情/评论/回复链，不证明从作者入口自动进入主页；作者入口已被真实侦察证明会打开新 tab，因此仍禁止自动点击。
- `xiaohongshu.account.public_notes.v1` 的已有主页 tab 和短时主页链接路径仍需各自独立 live canary；不能用本 run 冒充主页能力证据。
- 图片/视频短时 CDN 链接的下载和媒体物化不在本 run 内，继续保持独立后续能力边界。

## 清理

- 临时 Gateway、loopback 状态和控制页已清理；
- 受管验证浏览器和最终目标页有意保留为 `retained_for_review`；
- 扩展页：0；
- 未创建新 tab；
- 用户日常浏览器：未触碰。

## 后续构建连续回归：操作完成、收尾 lease 过期

在构建指纹 `188f2cc3e5ac37194641729fab24971fcc861c68624ae36ba483f3b819fca459` 的连续回归中，搜索、详情、评论和回复四个 operation 均已经分别返回 `completed` 并成功读取 artifact：

```yaml
validationBaselineNavigations: 1
productPlatformNavigations: 0
automaticPlatformRetries: 0
searchItemCount: 17
detailPublicTextLength: 616
commentCount: 6
commentCaptureMode: hybrid
replyCount: 1
replyCaptureMode: network_projection
replyActionTriggeredResponseCount: 0
replyOperationId: 1b36fe09-d8bf-4641-8897-3e6cf3239055
```

该回归的整体脚本终态没有记为 `proved`：原验证脚本使用的 `120s` 本地 PageLease 在四段 operation 完成后的收尾阶段过期，Browser Host 按安全策略将页面转为 `quarantined / lease_expired`，脚本随后得到 `xiaohongshu_gateway_e2e_page_context_changed`。这不是平台动作未知，也没有重放任何语义动作；隔离页已用精确 record version 显式关闭。

验证脚本随后修复了三点本地生命周期问题：收养唯一 `retained_for_review` 小红书页、为 baseline 导航使用 run-scoped action ID、把连续闭环 lease 提高到有界的 `300s`。这次 partial 回归不改变前一节已完成四项能力的 direct-ready 结论，也不作为主页笔记能力的 live canary 证据。

## 2026-07-29 核心修复后的真实回归

本轮把 adoption contract 与连续闭环验证器统一为有界 `300s` lease，并补上“页面已有可见评论但没有滚动容器”时的合法 DOM fallback。验证浏览器经过 headless runtime probe 后以唯一可见会话运行，当前构建指纹为 `e15bba1c49ed120d3a00b66bef4e5cea43cff890ce067a0658efb3845cb27da5`。

组合路径真实通过：一次公开搜索动作同时请求 1 条详情、评论和 1 个回复线程，返回 19 条搜索结果、1 条详情、10 条评论和 1 个带 parent/reply 关系的 Network 线程；没有新 tab、刷新或自动重试，最终页面为 `retained_for_review`。验证 run：`9cffdce2-7ed7-499a-b044-5c8b72b2dc4f`。

独立评论 operation 在同一公开样本上也真实完成，采用 `dom_fallback`，收集 6 条评论并执行 2 次有界滚动。独立回复 operation 则按严格契约停止：页面视觉上已有多条带“回复”文本的内容，但没有可见“展开 N 条回复”控件，也没有可证明的稳定 parent id；不得把相邻 DOM 节点强行拼成线程。该失败属于 `xiaohongshu_comment_replies_postcondition_unmet`，不是 lease、闪退、验证码或风控。

最终 Browser Host 状态：`ready`、扩展页 `0`、受管目标页 `1`、`livePlatformRequests: 0`；journal 以 `page_released → retained_for_review` 结束，没有 `lease_expired`、`controller_disconnected` 或 `quarantined`。

## 2026-07-29 Network archive 连续性修复回归

前一轮的 standalone 回复失败根因已定位为本地 observer 代际切换：组合搜索完成后，standalone 详情重新注入同一 document 的 observer 时错误清空了仍在 3 分钟 bounded TTL 内的 `commentArchive`。修复后只重置当前 work 的计数和临时 comments，保留 archive，并在后续 operation 重新绑定 `selectedNoteId` 后再次按笔记过滤。

真实连续 run 已通过：`a03858b0-8b9d-4d1f-b7cb-54d7d5bf5c84`，构建指纹 `69876fbca6245f4b4df7ce27f26ad9a025693ef6cfbc95f41edc46c7ec951cf7`。

```yaml
searchItemCount: 18
searchDetailCount: 1
searchCommentCount: 10
searchReplyThreadCount: 1
standaloneCommentCaptureMode: hybrid
standaloneCommentCount: 10
standaloneCommentSemanticActions: 0
standaloneReplyCaptureMode: network_projection
standaloneReplyCount: 1
standaloneReplySemanticActions: 0
networkMatchedPayloadCount: 1
networkBodyBytesRead: 3984
networkCursorObserved: true
actionTriggeredResponseCount: 0
automaticPlatformRetries: 0
finalPageState: retained_for_review
```

这证明 standalone comments/replies 可以复用同一 document 的短时 Network archive，不需要再次滚动或点击，也没有跨 tab、跨 document 或重放平台动作。最终 journal 仍以 `page_released → retained_for_review` 结束。

## 2026-07-29 多线程 bounded partial 交付回归

本轮验证了 standalone reply operation 的多线程上限和失败交付语义。Gateway 对单线程 work 保持 `60s` TTL；`maximumThreads=2/3` 的 standalone work 使用有界 `120s` TTL，以覆盖 MV3 低频轮询窗口，但不续租、不重放平台动作。验证器将组合阶段的 `replyThreads` 与 standalone 阶段的 `standaloneReplyThreads` 分开配置。

最新真实 run：`4c73da7d-b459-42cf-a46b-5c18eaced3fd`，构建指纹 `152ed716391c6be87acfcc6f77dc38edef68cbab2bf38f6362612260f3944492`。组合搜索、详情和评论先后完成；standalone 请求 `3` 个线程，最终证明 `2` 个线程：

```yaml
validationOutcome: partial_postcondition
requestedThreads: 3
completedThreads: 2
replyCount: 2
state: stopped
terminalReason: postcondition_unmet
captureMode: network_projection
semanticActionCount: 1
actionTriggeredResponseCount: 0
networkMatchedPayloadCount: 1
networkBodyBytesRead: 3984
networkCursorObserved: true
rawPayloadStored: false
responseUrlsStored: false
debuggerDetached: true
automaticPlatformRetries: 0
finalPageState: retained_for_review
```

这里的 `stopped / postcondition_unmet` 是有意保留的 bounded partial，不是成功伪装：请求值只是上限，平台只证明到两条就停止；没有为第三条强行点击、拼接或补造数据。artifact 已正常写入 Gateway，页面仍保留在同一受管 tab 供复核。

本轮之前曾出现 `extension_work_expired`。根因不是平台或登录状态，而是扩展在已经拥有部分 projection 时，如果后续展开后置条件失败，会把 `completedCount > 0` 与 `page: null` 一起提交，Gateway 按契约拒收 pending result，直到队列 TTL 到期。修复后：

- Network/DOM projection 一旦形成即保留同文档 page evidence；
- 每次 projection 写入后先更新 `completedCount`，再写本地动作完成账本；
- 多线程失败现在交付合法 `stopped + artifact`，不会变成无解释的 TTL 过期；
- 验证器明确区分 `completed` 与 `partial_postcondition`，不把部分结果报告为完整成功。

本回归仍遵守 at-most-once：验证基线导航 1 次、可信回复点击 1 次、动作后新增响应 0 次；没有刷新、换 tab、新 tab、自动重试、Cookie/Token/原始响应持久化。浏览器最终状态为 `ready`，扩展页 `0`，目标页 `1`，并保留为 `retained_for_review`。

## 2026-07-29 回复后置条件等待与 DOM 归因回归

针对上一节的第三线程未证明问题，扩展增加了一个有界后置条件等待：可信点击后最多等待 `10s`，每 `500ms` 在同一 document 内复核 DOM、Network、风险状态和子 tab 集合；同时把点击前父评论文本作为证据，优先选择包含该父评论的可见 DOM 根。该改动没有增加点击次数、刷新、导航或任意 selector 输入。

真实 run：`237cd33f-e913-4957-8025-d5f118380aa4`，构建指纹 `f97a0953bb77f73c0dbf0ee6e4c47687a177f4e89dfd6364058bc0f6c737ddfc`。结果仍稳定为：

```yaml
requestedThreads: 3
completedThreads: 2
state: stopped
terminalReason: postcondition_unmet
replyCount: 2
semanticActionCount: 1
networkMatchedPayloadCount: 1
networkBodyBytesRead: 3984
networkCursorObserved: true
actionTriggeredResponseCount: 0
finalPageState: retained_for_review
```

收尾视觉证据中可以看到一个嵌套回复，但当前证据不能可靠证明它属于本次点击的第三目标；Network 也没有出现动作后新增响应。因此不能把这段相邻可见 DOM 当成第三条线程，也不能报告为 `3/3`。当前产品边界保持为：稳定交付已证明的 2 条，第三条在没有可归因后置条件时安全停止。
