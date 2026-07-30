# B站 UP 主知识包 MVP 真实闭环验证

日期：2026-07-30

## 结论

知识包 MVP 的真实 Gateway→MV3 扩展→测试自有 Chromium Profile 闭环已完成一次有效
采集，知识包本身为 `completed`：

- 3 个 operation：`bilibili.account_profile`、`bilibili.account_inventory`、
  `bilibili.video_detail`；
- 3 个 operation 均为 `completed`，没有自动重放；
- 输出 2 个结构化资源：账号资源和视频资源；
- 每个 artifact 都写入本地 UTF-8 JSON；
- `evidence/provenance.jsonl` 写入 3 条来源链；
- inventory 真实投影包含 40 条投稿卡片；
- detail 真实投影捕获了首条视频 `BV1ybKh6LENe` 的标题、作者、标签和风险字段；
- 采集过程中没有读取 Cookie、Storage、Token、请求正文或响应正文。

知识包运行产物位于被 Git 忽略的 runtime 目录：

```text
poc/runtime/validation/bilibili-knowledge-pack-live-20260730/
```

## 侦察契约摘要

```yaml
runId: python-knowledge-pack-canary-20260730
objective: 验证 Python SDK 高层 B站知识包编排不破坏 direct Gateway 闭环
platform: bilibili
targetRole: account + detail
targetIdentity: space.bilibili.com/7481602
browserMode: visible fresh test-owned Chromium profile
browserLifecycle: temporary_recon
authenticated: indeterminate
extensionInteractionLoaded: true
existingPlatformRunnerUsed: false
navigationCount: 2 observed document navigations
outcome: proved_for_pack_partial_for_harness
```

这里的 `proved_for_pack_partial_for_harness` 是有意保守的表达：知识包的三个 operation
和 artifact 内容均已完成，但第一次 canary 运行的断言把“浏览器 document 事件数必须至少
为 3”当成了硬条件。inventory 可以复用 profile 已到达的同一账号文档，因此该条件过严，
已改为“至少两个目标角色文档 + 每个 artifact 自己的 at-most-once action ledger”。修正
后的断言只完成了静态 typecheck 和 unit gate，未为了变绿而重复真实平台动作。

## 真实 artifact 证据

知识包 manifest 的关键字段：

```json
{
  "state": "completed",
  "capabilities": [
    "bilibili.account_profile",
    "bilibili.account_inventory",
    "bilibili.video_detail"
  ],
  "counts": {
    "collectionOperations": 3,
    "successfulOperations": 3,
    "partialOperations": 0,
    "failedOperations": 0,
    "resources": 2
  }
}
```

三个 artifact 的 action ledger 均为单次尝试：

```text
open_canonical_account_profile   attempted=true  attemptCount=1  outcome=completed
open_canonical_account_inventory attempted=true  attemptCount=1  outcome=completed
open_canonical_video             attempted=true  attemptCount=1  outcome=completed
```

inventory 的公开 DOM 投影还记录了 `visibleCardCount=40`、`capturedItems=40`、
`unresolvedCardCount=0`。页面显示登录层信号，但公开投稿列表仍可投影；该字段原样保留在
artifact 中，不能被解释为当前账号身份已验证。

## 失败与修复

第一次运行没有触发平台失败，而是在 Windows 上因为 Playwright 描述性输出目录过深，
知识包临时文件路径超过文件系统可用路径预算，profile artifact 尚未完成落盘便退出。
修复为让真实 canary 使用短路径临时 pack 根目录；生产调用仍可指定普通本地输出目录。

修复后第二次运行完成了完整知识包。由于浏览器动作已经成功，不再额外重跑同一平台链路；
后续若需要把 canary 变成全绿，应使用一轮新的、明确独立的 live run，而不是在当前 run
中重放。

## 产品含义

这次验证证明了“资源搜索能力 → 原始 artifact → 本地知识包”这一纵向闭环，尚未证明：

- 所有投稿页的全量详情；
- 字幕、音频、视频下载或 OCR/ASR；
- 评论、弹幕和合集的知识包编排；
- 小红书媒体过期前下载；
- DeepResearch 证据适配。

这些能力继续作为独立、有界阶段加入，不能因为本次账号资料和首条视频成功就被隐式
视为已完成。
