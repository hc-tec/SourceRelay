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
