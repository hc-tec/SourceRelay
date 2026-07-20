# B 站账号动态：Browser Host Strategy canary v0.7.1

- 日期：2026-07-20
- 范围：一个已登录、项目管理的 Collection Profile；一个账号动态页；一页预算
- Strategy：`bilibili.dynamic.account-feed.response-dom.v1 @ 1.0.0`
- 当前成熟度：`research_validation`，不是 production admission，也不是“已自动归档可用”

本记录只描述 Browser Host / MV3 Extension / Gateway 新架构下的单页 canary。旧的直接浏览器研究记录仍是历史页面结构证据，不能替代本次闭环结果。

## 1. 已执行的真实 canary

本次独立 run：

```text
runId:      5dd67e5b-e8bf-443b-9186-8e1012c50f2a
artifactId: fc2afc7d-66bb-4f8f-a225-6c756ec9b55e
state:      failed
reason:     dom_response_mismatch
```

动作预算与安全约束均成立：

| 动作 | 实际结果 |
| --- | --- |
| 受管页面导航 | 1 次，已完成 |
| 滚动 | 0 |
| 筛选、评论或互动点击 | 0 |
| 自动平台重试 | 0 |
| 认证材料读取、导出或保存 | 0 |
| 运行后的目标页面 | 保留供复核 |

Extension 在精确 tab/document/run binding 内观察到公共 feed route 的一次 `200` response；Gateway 只接收受限 public projection，不接收 Cookie、Token、请求头、query value 或原始 response bytes。Browser Host 同时保存了一张仅本地、ignored runtime 内的视觉截图；本文件不复制图片、账号身份或截图路径。

## 2. 三面证据与严格拒绝的原因

视觉上，页面身份、动态导航和“全部”筛选均处于预期状态。DOM、response 与截图都已在同一个受管页面闭环中取得。

但严格互证没有被放宽。去敏 diagnostic 结果如下：

| 检查项 | 结果 |
| --- | ---: |
| response page items / DOM cards | 12 / 12 |
| 同序页面卡片匹配 | 12 / 12 |
| 作者匹配 | 12 / 12 |
| 发布时间文本匹配 | 12 / 12 |
| 访问状态匹配 | 12 / 12 |
| 转发状态匹配 | 12 / 12 |
| 可交叉主身份 / 匹配 | 3 / 3 |
| 文本匹配 | 10 / 12 |
| 结构性 card evidence | 10 / 12 |

因此唯一失败项是：

```text
card_evidence_mismatch
```

当前运行没有把 12 条 item 写入正式 page artifact，也没有把卡片正文、作者名、动态 ID 或 response body 写入失败诊断。失败 artifact 仅保留：各项计数、布尔值、稳定 ID digest、response 路径/状态/大小及视觉证据元数据。

这证明了观察链路可用，但没有证明 Strategy 已可用于生产采集。

## 3. 这次新增的可诊断性

此前一旦严格 gate 失败，runner 只保存笼统的 response 元数据，无法回答“哪一种互证不成立”。现在新增：

```text
BilibiliDynamicCrossCheckDiagnostic
  -> RunRecord
  -> Artifact manifest
  -> Artifact read model
```

它只包含 aggregate count、boolean 与 digest。后续修改 DOM projector 或 response 规则前，应先以这份 evidence 缩小问题；不得为了通过而把 gate 降成“任一张卡匹配即可”。

历史已验证的页面结构可作为假设：首屏存在公开 Opus + 预约附加卡，它们是当前两个缺少文本/结构性证据的候选类型。该假设尚未被本次 Browser Host run 精确证明，因此不能据此直接修改 selector 或放宽规则。

## 4. 页面复用与浏览器生命周期修复

本次 canary 暴露出一个产品缺口：已有同一规范目标的 `retained_for_review` 页时，旧 PageLedger 只会从 `idle_reusable` 选页，因而创建了新页。

已实现并用隔离、真实 Chromium 门禁验证的规则：

```text
retained_for_review
  + 同 platform
  + 同 pageRole
  + 同目标 URL digest
  + 当前真实 page.url() 仍为该目标
  -> 可重新取得 exact PageLease
```

该页仍不参与泛用 role/profile 复用或自动回收；如果用户已把页面导航到别处，实际 URL 校验失败，系统不会劫持或关闭该 tab。

当前已登录 Browser Host 进程在此修复构建之前启动，尚未受控重启。因此“真实 B 站页面已在新规则下复用”还没有成立；目前成立的是隔离 real-Chromium lifecycle gate 已证明该规则。

## 5. 测试窗口策略

本地 Browser Host 生命周期、Strategy binding 与 Gateway↔Host integration 门禁仍使用真实 Chromium、真实 MV3 和 Native Messaging，且平台请求数为零。它们现在显式使用：

```text
browserMode: headless_test_scoped
```

原因是这些离线门禁没有人类视觉确认需求；headless 可避免桌面出现“突然打开又关闭”的测试窗口。真实平台侦察和产品 canary 仍使用可见、持久的 Collection Profile，并遵循视觉、DOM、Network 三面证据契约。

## 6. 下一步与停止条件

1. 先为失败的 card evidence 增加仍然去敏的逐位置结构诊断，或在新的独立真实 run 前完成对应的人类 DOM/视觉研究；
2. 仅在明确安排的受控 Browser Host 维护窗口中重启实际 Host，以加载 exact-retained-reuse 修复。该维护会改变浏览器进程生命周期，不能隐式执行；
3. Host 升级后，最多执行一个新的独立单页 canary，继续保持一次导航、零滚动、零筛选/评论动作和零自动平台重试；
4. 只有所有 strict cross-check 项通过，才把结果标记为 `live authenticated canary`；production admission 仍需独立评审。
