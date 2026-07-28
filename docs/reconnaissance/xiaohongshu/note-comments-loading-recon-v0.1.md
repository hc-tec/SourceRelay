# 小红书详情浮层评论加载侦察 v0.1

日期：2026-07-28

## 结论

真实页面证明：详情浮层首批公开评论会异步渲染，但在点击详情前预装并持续 5.5 秒的 Playwright response 观察面没有看到新增 XHR/Fetch；在评论面板上执行一次可信滚轮后，也没有新增 comment XHR。首批评论必须允许 DOM fallback，后续深滚动分页继续保持 Network-first 观察。

## 评论滚动 run

```yaml
runId: a934a8e2-1719-4953-8d60-7f5dacfd2fb9
objective: inspect_public_comment_lazy_loading_and_network_shape
platform: xiaohongshu
targetRole: discussion
browserMode: visible persistent profile
browserLifecycle: managed_profile_session
authenticated: true
navigationCount: 0
semanticActionCount: 1
automaticRetries: 0
outcome: proved
```

动作前后：

```yaml
scrollTopBefore: 0
scrollTopAfter: 200
renderedCommentCountBefore: 6
renderedCommentCountAfter: 6
responseBodiesRead: false
temporaryBodyBytesRead: 0
commentResponses: 0
projectedNetworkComments: 0
```

Browser Host 从可见详情作者入口向上确认完整浮层，再把浮层根节点和后代共同作为滚动候选。最终找到右半屏、中心命中、`scrollHeight > clientHeight` 的真实滚动面板，移动鼠标到实时面板内部后只发送一次 `mouse.wheel(0, 1100)`。页面数量和 document 均未变化。

## 点击前 Network 观察 run

```yaml
runId: d9f98d2d-d26c-41ee-ba97-94b479fa975f
actionId: 4177345d-87cb-4091-aa73-93d0780af0d6
semanticActionCount: 1
automaticRetries: 0
overlayVisible: true
sameDocument: true
networkResponsesAfterClick: 0
```

该 run 在点击公开笔记主图之前安装 response listener，详情浮层出现后继续等待 5.5 秒。最终截图已经显示“共 24 条评论”、两条完整公开评论以及一个“展开 6 条回复”入口，但监听窗口内没有新增 XHR/Fetch。

因此不能把“评论已显示”错误归因于动作后 comment response。可能的数据来源包括搜索阶段已预取的页面状态、框架内部缓存或不经过当前 page Fetch/XHR 的数据通路；在没有直接证据前不进一步猜测。

## 产品含义

正式评论能力应采用：

```text
已有同页详情浮层
→ 动作前安装 MAIN-world Network observer
→ 等待评论区异步稳定
→ DOM 投影当前公开评论
→ 1–3 次有界可信面板滚动
→ 每次滚动后等待懒加载
→ 若出现公开 comment JSON，优先 Network projection
→ 没有 JSON 时合并可见 DOM 评论
→ 不保存 raw response 或 response URL
```

上层应用不应传 URL、笔记 ID、tab/document ID、selector、坐标、脚本、route 或 cursor。评论能力只作用于浏览器中已经由正式详情能力打开的唯一公开详情浮层。

本轮未点击评论输入框、点赞、收藏、关注、回复或展开回复，也没有刷新、新建 tab 或关闭最终页面。
