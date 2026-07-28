# 小红书公开评论回复 Network-first canary v0.1

- 日期：2026-07-28
- 环境：真实小红书、可见持久 Validation Profile、生产 Gateway 与扩展闭环
- 当前结论：`partial`；正式能力已实现，评论 Network-first 已真实通过，回复正式 E2E 尚缺稳定的“含公开回复线程”canary 笔记。
- Catalog 必须继续保持：`direct_canary_pending / implementation_ready_live_e2e_pending`。

## 已真实证明

一次完整搜索、详情、评论链路得到：

```yaml
search:
  state: completed
  itemCount: 20
detail:
  state: completed
  publicSurface: note_detail_overlay
comments:
  state: completed
  terminalReason: note_comments_ready
  captureMode: hybrid
  commentCount: 6
  networkMatchedPayloadCount: 1
  networkBodyBytesRead: 2368
  networkCursorObserved: true
  semanticActions: 0
  completedScrolls: 0
  rawPayloadStored: false
  responseUrlsStored: false
  debuggerDetached: true
```

这证明评论能力可以先消费同一 document 的短时 Network archive；已有公开评论投影时不需要为了 DOM 加载而滚动页面。

另一次高互动笔记得到 24 条评论、8245 bytes Network JSON；另一次得到 22 条评论、7333 bytes。两次均为 0 滚动。页面当时没有可见“展开 N 条回复”控件，因此不能把 DOM 展开按钮作为 Network 回复能力的硬前置。

## 本轮修复的真实问题

1. 评论执行器过去先要求 DOM 评论或滚动容器，导致已有 Network 数据也错误停止；现已改为 Network archive first。
2. 回复 stopped result 过去错误要求 `thread.completedCount === semanticAction.attemptCount`，导致“点击已发、后置条件未满足”的安全终态无法持久化，Gateway 最终误报 work expired；现已修正并有回归测试。
3. 回复执行器过去先要求 DOM 展开控件；现已改为先按 archive 中公开 `parentCommentId` 组装 Network-only 线程，完整时 0 点击完成，Network 不足才允许一次可信展开。
4. 部分回复 JSON 以 `sub_comments / subComments / replies / reply_list` 嵌套在父评论下，子对象不一定重复携带 parent ID；observer 现在从公开 JSON 嵌套结构推导 `parentCommentId`，显式字段仍优先。
5. 搜索 Network rank 与当前 DOM 可交互卡片顺序不稳定同构；rank 2 和 rank 11 均真实出现 `search_result_rank_unavailable`。正式 canary 不再用 Network 点赞排序驱动 DOM 点击，固定使用已证明的首个渲染结果。

## 仍未证明

本轮随机搜索首条笔记有时没有评论接口数据或评论容器，正确停止为：

```text
xiaohongshu_comment_scroll_container_unavailable
```

另一些笔记有 22–24 条 Network 评论，但旧 payload projection 或笔记本身没有形成可关联回复线程，同时页面没有展开控件，正确停止为：

```text
xiaohongshu_reply_thread_target_unavailable
```

因此不能用随机 rank 反复运行来碰运气，也不能把实现完成冒充正式 E2E 已通过。下一次真实验证必须先选择一个已知公开可见、确实包含至少一组公开回复的稳定 canary 笔记；仍只允许一个独立 run、一次详情点击、回复阶段最多一次展开动作、零刷新、零新 tab、零自动重试。

## 隐私与清理

- artifact 不保存 URL、route、query、header、Cookie、Token、raw payload、tab/document ID、selector 或 script；
- Network body 只在浏览器短时读取并投影，长期只保存公开去敏字段；
- 每次失败都停止动作链并保留最终页面供复核；新的独立 run 只在显式重建 Validation 会话后开始；
- 用户原有 `AGENTS.md` 与 `.playwright-cli/` 未纳入提交。
