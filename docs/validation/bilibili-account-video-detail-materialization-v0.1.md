# B站账号目录到选中视频详情：受限物化真实闭环 v0.1

- 日期：2026-07-22
- 状态：`completed` / 单条真实本地 canary；`admissionEligible=false`
- 上游：已完成的 B站账号公开视频目录分页 artifact（7 页、262 个唯一 BVID、0 未解析卡片）
- 详情策略：`bilibili.video.detail.dom.v2 @ 0.1.0`
- 本次选中条目：上游 artifact 第 1 页中的 `BV136K36TEa8`

## 结论

已形成可用的“目录 artifact → 显式选中 BVID → 视频详情 artifact”底层入口。调用者不能提交视频 URL、任意 selector、脚本、坐标、并发数或“全量详情”开关；Gateway 只接受上游分页 artifact 中存在的 BVID，并从经校验的源条目复制规范视频 URL。

本次真实 run 成功物化 1/1 条详情。来源 artifact ID 与 manifest SHA-256、源页码、BVID、子详情 run/artifact 引用都被写入独立 batch manifest；详情正文仍由已有的单视频 artifact 保存。无数据库依赖，也没有把 Cookie、Token、请求/响应 body、query 或 fragment 写入 artifact。

## MVP 预算与停止规则

```text
每批显式 BVID                    1–3 条
同一认证 Profile 平台动作并发     1（严格串行）
每个 BVID 详情导航               至多 1 次
任一详情未 completed              停止后续 BVID，不自动重试
账号安全非 ready / 有 active run  停止后续 BVID
```

这不是“目录内全部详情”的隐式升级。扩大详情预算、并发、评论或字幕必须由独立能力和实网验证推进。

## 真实证据

| 维度 | 结果 |
|---|---|
| 来源完整性 | 上游分页 artifact 为 `completed`，7/7 页、262 条、0 未解析；本条 BVID 位于源页 1 |
| 平台动作 | 详情导航 1 次，`attempted=true`、`attemptCount=1`、`completed`；无自动重试或重放 |
| 视觉 | 详情页基线视觉证据已保存到 ignored local runtime，并由子 artifact 引用 |
| DOM | BVID、标题、可见元数据、播放器可见状态与 9 个标签已投影；无登录遮罩、验证码、限流或页面不可用信号 |
| 来源链路 | batch manifest 保存父 artifact ID/SHA、稳定账号 ID、源页码、子 detail run/artifact ID 与各自 SHA-256 |
| 生命周期 | 目录页和详情页均 `retained_for_review`，0 active lease、0 quarantined page、0 extension page，账号安全为 `ready` |

本详情策略当前是可见 DOM 策略，不读取或重放详情接口 response body；本次详情 run 的可信性来自一次真实导航、视觉后置条件、页面 DOM 身份/内容投影和一对一 artifact 来源链，而不是伪造 XHR 或离线页面。

## 初始样本的诚实字段覆盖

此次样本的详情 artifact 已捕获标题、可见元数据和 9 个标签，但 `descriptionCaptured=false`、`creatorCaptured=false`、`episodeSummaryCaptured=false`。这些字段在当前策略中本就是可选字段，因此单条 run 仍可达到 `detail_ready`；这只能说明“详情身份与部分公开字段已取得”，**不能**说明视频详情字段完整。

该初始样本不能据此推断“所有 B站详情页没有简介”或“selector 已失效”。后续真实布局校准见下一节；评论、字幕、弹幕、推荐和多 P/合集信息继续保持独立能力边界。

## `0.7.8` 真实布局校准

为区分“当前 DOM selector 失效”与“视频本身没有可见简介”，先以两条来自同一完成目录 artifact 的独立 BVID 复验，再使用此前已实证有简介的已知 URL 做对照。所有 run 都是一次导航、零 click/scroll、零 response body 读取，且没有自动重试。

| 样本 | 来源 | 简介 | 创作者 | 其他首屏字段 | 结论 |
|---|---|---:|---|---|---|
| `BV136K36TEa8` | 目录页 1 | absent | 创作团队的公开数字账号 ID | 标题、元数据、播放器、9 标签 | 目录未见“充电专属”标记；团队布局 fallback 生效；页面没有可投影简介 |
| `BV1BoKD6ZEir` | 目录页 1 | absent | 显示名 + 公开数字账号 ID | 标题、元数据、播放器、6 标签 | 目录卡明确标为“充电专属”；标准作者卡捕获正常；页面没有可投影简介，但本策略尚未判定访问状态 |
| `BV1qZSLBYEpa` | 已知 URL 对照 | present | 显示名 + 公开数字账号 ID | 标题、元数据、播放器、10 标签、选集摘要 | 当前描述容器 fallback 已在真实页面捕获简介 |

`0.7.8` 的固定投影保留旧 `#v_desc`，并只增加当前桌面页面实证的 `.video-desc-container` 描述候选和 `.up-panel-container` 团队卡候选；不引入通用 DOM 扫描、任意 selector、任意 JS 或 response body。已知 URL 对照证明这些描述候选当前有效；未标“充电专属”的 `BV136K36TEa8` 同样没有可投影简介，因此“充电专属”不是空简介的充分或必要解释。另一方面，`BV1BoKD6ZEir` 的 `playerVisible=true` 只证明可见播放器容器，尚不等于可播放、可获取字幕或可访问其他受限内容。访问状态必须由独立的真实页面侦察与字段建模完成，当前空字段只能诚实记为 `absent`。

## API 形状

```text
POST /v1/profiles/<profile-id>/bilibili/account/video-inventory/pagination-artifacts/<artifact-id>/materialize-details

{ "bvids": ["BV..."] }
```

该路径中的 artifact ID 与 body 中的 BVID 都经过固定格式、数量、去重、完成状态、页数、未解析卡片和“BVID 必须属于来源 artifact”的验证。结果返回批次摘要；完整 batch manifest 与每条详情 artifact 均可通过只读 artifact 路由复核。
