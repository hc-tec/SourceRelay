# 小红书公开评论回复展开实证

日期：2026-07-28

结论：`proved`。真实页面中第一个可见“展开 3 条回复”可以由一次浏览器级可信点击展开，入口随后消失且公开回复 DOM 出现；该动作后没有新增 XHR/Fetch。回复数据来自更早的评论 Network payload/页面缓存，生产能力应优先消费跨阶段 Network continuity，并用 DOM 证明展开后的公开层级。

## Run

```yaml
runId: cfb443e1-a157-4005-94b5-810dbb1fc69e
objective: expand_first_visible_public_reply_thread_and_observe_network
browserMode: visible persistent validation profile
navigationCount: 1
automaticPlatformRetries: 0
outcome: proved
finalPageState: retained_for_review
```

## 动作与后置条件

```yaml
target: 展开 3 条回复
inputLayer: browser
inputKind: trusted_mouse_click
attempted: true
attemptCount: 1
replyTargetVisibleAfter: false
sameDocument: true
newTab: false
```

动作前由 DOM 语义定位第一个可见、文字严格匹配 `展开 N 条回复` 的最小元素，并核对实时边界框与 `elementFromPoint` 命中链。上层没有提供 selector、坐标、comment ID、URL、route、cursor、tab ID、document ID 或脚本。

## Network

点击前开始监听真实页面 XHR/Fetch，点击后等待 3.5 秒：

```yaml
responseCount: 0
responseBodiesRead: false
temporaryBodyBytesRead: 0
projectedCommentCount: 0
```

同一完整 run 的普通评论 operation 在点击回复前已经获得：

```yaml
captureMode: hybrid
networkMatchedPayloadCount: 1
networkBodyBytesRead: 2368
networkCursorObserved: true
commentCount: 6
```

因此事实不是“回复没有 Network 数据”，而是“展开动作没有新增请求；公开回复已经包含在更早、与当前笔记绑定的评论 payload 或页面缓存中”。生产实现不能在点击后凭空等待一个不存在的接口，也不能把 DOM 展开误报为动作触发 Network。

## 产品含义

正式能力应独立登记，建议 ID：

```text
xiaohongshu.note.public_comment_replies.v1
```

建议固定边界：

```text
唯一已打开公开详情浮层
→ 读取当前笔记的短时 Network comment archive
→ 选择第一个可见“展开 N 条回复”入口
→ 持久化一次点击意图
→ 浏览器级可信点击一次
→ 验证同 document、无新 tab、入口状态或公开回复 DOM 变化
→ Network 回复优先，DOM 层级 fallback
→ URL-free artifact
```

调用方只能给出有界线程预算，不能指定具体 comment ID 或页面控制参数。首版只允许 `maximumThreads: 1`；多线程展开需要单独预算和真实安全验证。
