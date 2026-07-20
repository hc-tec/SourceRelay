# B 站账号动态：Browser Host Strategy canary v0.7.1

- 日期：2026-07-20
- 范围：一个已登录、项目管理的 Collection Profile；一个账号动态页；一页预算
- Strategy：`bilibili.dynamic.account-feed.response-dom.v1 @ 1.0.0`
- 当前成熟度：`research_validation`，不是 production admission，也不是“已自动归档可用”

本记录只描述 Browser Host / MV3 Extension / Gateway 新架构下的单页 canary。旧的直接浏览器研究记录仍是历史页面结构证据，不能替代本次闭环结果。

本记录中的“下一步”已在同日完成；字段来源、最小修复与独立真实复核见 [预约 Opus 字段映射真实闭环](dynamic-reservation-opus-field-mapping-v1.0.md)。

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

Browser Host 完成受控维护升级后，另一次独立单页 canary 已用于验证新增的逐卡诊断：

```text
runId:      6158ddb9-2fae-4c30-9901-feca4eaeabc9
artifactId: 1379b198-5eb3-4f90-9a55-a41f4009f902
state:      failed
reason:     dom_response_mismatch
```

它同样只有一次导航、零滚动、零筛选/评论/互动点击、零自动平台重试。页面在 run 后保留供复核。

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

它只包含 aggregate count、boolean 与 digest。现在还会按页面位置附带固定类别、链接/媒体数量与逐项 match boolean；仍不会携带正文、动态 ID、URL、作者名或 selector。

第二次 canary 已证明失败卡恰为第 4、10 张，且两者具有同一安全结构：

```text
cardKind                     = opus
reservation                  = true
accessState                  = public
forwarded                    = false
DOM links                    = 1
response primary kind        = opus
textMatch                    = false
primary identity checkable   = false
```

历史已验证 artifact 中的同类第 4、10 张卡也各有一个 DOM 链接，但该链接并不等于 Opus 主身份的 canonical URL。因此不能通过“将 Opus 主身份加入链接 allowlist”来让 gate 通过；这会把预约对象链接误报成动态主对象。

后续修改 DOM projector 或 response 规则前，应先以这份 evidence 缩小问题；不得为了通过而把 gate 降成“任一张卡匹配即可”。

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

实际 Browser Host 已完成一次受控重启，并已加载该修复；第二次 canary 后留下一个同目标 retained 页。由于该 run 是重启后的首次 run，选页为 `created_new_managed_tab` 是预期结果。真实 B 站页面的下一独立 run 应复用这个 exact retained 页；在此发生前，已成立的是隔离 real-Chromium lifecycle gate 对复用规则的证明。

## 5. 测试窗口策略

本地 Browser Host 生命周期、Strategy binding 与 Gateway↔Host integration 门禁仍使用真实 Chromium、真实 MV3 和 Native Messaging，且平台请求数为零。它们现在显式使用：

```text
browserMode: headless_test_scoped
```

原因是这些离线门禁没有人类视觉确认需求；headless 可避免桌面出现“突然打开又关闭”的测试窗口。真实平台侦察和产品 canary 仍使用可见、持久的 Collection Profile，并遵循视觉、DOM、Network 三面证据契约。

## 6. 后续闭环

本记录中列出的字段来源研究、最小映射修复和独立 retained-tab canary 已全部完成。结论与停止点以 [预约 Opus 字段映射真实闭环](dynamic-reservation-opus-field-mapping-v1.0.md) 为准。
