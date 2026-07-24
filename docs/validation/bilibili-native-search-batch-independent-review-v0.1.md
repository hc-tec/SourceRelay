# B站原生搜索 batch 独立 Review 准备稿 v0.1

- 策略：`bilibili.search.breadth.dom.v2 @ 0.2.0`
- Review 类型：`machine_precheck_handoff`
- Review 状态：`pending_independent_review`
- Admission：`false`
- 覆盖 artifact：[39fb7c35-888e-44fd-b73a-a28385647c68](../../poc/collector-gateway/runtime/p2a-search-coverage-20260724b/bilibili-native-search-batch-coverages/39fb7c35-888e-44fd-b73a-a28385647c68/manifest.json)
- 机器预审接口：`GET /v1/bilibili-native-search-batch-coverage-artifacts/:coverageId/review`

## 1. Review 范围

这份 dossier 只审查原生搜索 batch 的“同查询、同类型、同排序、同页窗口”结果稳定性和安全边界，不审查：

- 详情页字段是否完整；
- 评论、字幕、弹幕或其他 B 站能力；
- response body projector；
- 账号登录持久性；
- 任何平台动作的自动恢复；
- 生产 admission 或用户侧任务批准。

## 2. 样本与证据

三次纳入的真实 batch 均使用 UTF-8 查询“人工智能”、视频类型、最新发布、页码 `[1,2]`，每次真实导航两页、各得到 40 条 unique、`duplicateCount=0`：

| artifact | capturedAt | pages | unique | duplicate |
|---|---|---:|---:|---:|
| `29b90d7f-2200-4054-b24d-1a717228d328` | `2026-07-24T01:55:55.778Z` | 2 | 40 | 0 |
| `72af4ca2-a442-4271-b46b-202f6020dd26` | `2026-07-24T01:56:32.718Z` | 2 | 40 | 0 |
| `d978c42e-7789-4847-b840-123b8934b6a4` | `2026-07-24T01:57:59.855Z` | 2 | 40 | 0 |

Coverage 结果：

```yaml
sampleCount: 3
pairCount: 3
meanOverlapRate: 0.9
meanJaccardRate: 0.8206913859
meanDriftRate: 0.1793086141
maximumPairDriftRate: 0.2608695652
attemptedCount: 4
excludedCount: 1
excludedArtifactIds:
  - a012802c-a836-4eff-bb80-59bf7d7887a2
```

三个 pair 的 intersection 分别为 `38 / 34 / 36`，Jaccard 分别约为 `0.905 / 0.739 / 0.818`。coverage manifest 只保存 query digest、artifact ID、计数和比例，未保存原始 query 或 BVID 列表；重启读取与 manifest digest 校验通过。

另有一次未纳入 coverage 的失败尝试：

```yaml
batchId: 580fefd7-1984-46ec-87b4-1f870a3d551d
artifactId: a012802c-a836-4eff-bb80-59bf7d7887a2
state: failed
terminalReason: search_batch_page_failed
errorCode: page_pool_capacity_exhausted
capturedPages: 1
capturedItems: 20
```

该失败发生在 3 个 `retained_for_review` 页面占满 managed page pool 后。它没有被重放；Profile 被显式关闭、重新启动后才执行新的独立第三轮。失败 artifact 保留，并通过 `attemptedArtifactIds` 写入同一 coverage manifest 的 `excludedArtifacts`，因此 reviewer 不会只看到成功样本。

## 3. 已通过的门禁

- 三个样本的 query digest、result type、sort 和 pages 完全一致；
- 三个样本均为 `search_batch_ready`，页数完整，页内无重复；
- 每个语义导航动作最多一次，没有刷新、back、自动重试或失败动作重放；
- coverage 比较只使用稳定 BVID 集合，原始 BVID 不写入 coverage manifest；
- 断点 checkpoint、未知动作拒绝重放和显式 abandon 处置均已在此前独立 canary 中验证；
- 临时 Profile 最终显式关闭，临时 Gateway 43132 已清理；
- 原 Profile 的 `previous_run_interrupted_manual_review_required` 锁没有被绕过或修改。

## 4. Review 风险与未决问题

### R1：样本时间跨度过短

三个样本集中在约两分钟内。它们证明了短窗口内的结果变化，但不能代表小时级、天级或不同登录状态下的稳定性。

### R2：存在一个 pair 的 Jaccard 低于 0.75

机器 policy 当前只要求平均 Jaccard `>=0.75` 和最大 pair drift `<=0.5`，因此整体通过；但第二个 pair 的 Jaccard 约为 `0.739`，应由独立 reviewer 决定是否需要增加“单 pair Jaccard 下限”或按任务类型区分广度/稳定性要求。不能为了让本次样本通过而事后修改 policy。

### R3：页面池容量失败需要影响 coverage 解释

`page_pool_capacity_exhausted` 证明“保留 review 页面”和“连续发起新 batch”之间存在容量冲突。当前 coverage ledger 已记录 attempted/excluded artifact，但独立 reviewer 仍需决定：这种调度失败是否降低 coverage 可信度、是否需要单独的 page-pool 预算，还是只作为采集能力之外的运营缺口。

### R4：公开匿名可见性与登录态能力仍未分离证明

本轮新 Profile 没有登录，证明的是公开搜索结果在临时 managed profile 中可读；它不能覆盖登录失效、账号风控或个性化排序样本。原登录 Profile 因安全锁保持未触碰。

### R5：machine precheck 不是独立 review

当前 `candidate_for_independent_review` 只代表统计条件满足，不能视为 reviewer 签字、策略批准或 admission。

## 5. Review 决定

```yaml
decision: pending_independent_review
admissionEligible: false
productionStatus: research-only
recommendedAction: review_pair_drift_and_failure_ledger
```

在独立 reviewer 明确确认以下问题前，不得把策略升级：

1. 两分钟内的三样本是否足以作为当前任务的稳定性证据；
2. 单 pair Jaccard 约 `0.739` 是否可接受；
3. page pool 容量失败进入 coverage ledger 后，是否还需要进入正式 admission 阈值；
4. 公开匿名结果能否满足产品对登录 Collection Profile 的目标，还是必须另建认证样本集；
5. 对“广度优先”任务和“排名/分页稳定性优先”任务，是否采用不同策略契约。

独立 review 完成前，Console 和 Planner 必须继续把该策略显示为 `research-only`，不能自动选择它执行正式生产任务。
